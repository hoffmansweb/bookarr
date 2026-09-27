// Discover indexers configured in Prowlarr or Jackett and add them as Bookarr indexers.
//
// Prowlarr: GET {base}/api/v1/indexer (X-Api-Key). Each indexer is proxied as
//           Newznab/Torznab at {base}/{id}/api, authenticated with Prowlarr's API key.
// Jackett:  GET {base}/api/v2.0/indexers/all/results/torznab/api?t=indexers&configured=true
//           (API key only, no admin password). Each indexer lives at
//           {base}/api/v2.0/indexers/{id}/results/torznab/api.
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

// Newznab categories Bookarr searches: Audiobook, Books, EBook
const BOOK_CATEGORIES = [3030, 7000, 7020];
// Other book subcategories (Mags, Comics, Technical, Foreign...) mean the indexer carries books
const BOOK_RANGE = (id) => id === 3030 || (id >= 7000 && id < 8000);

// Accept whatever the user pastes: http://host:9117/UI/Dashboard, trailing slashes, etc.
const normalizeBase = (url) => {
  let base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/(UI\/Dashboard|UI|system\/status|settings.*)$/i, '');
};

// Store only categories the indexer supports; fall back to all book categories if caps are empty
const pickCategories = (supportedIds) => {
  const set = new Set(supportedIds);
  const cats = BOOK_CATEGORIES.filter(c => set.has(c));
  // Some indexers only list 7000 subcategories (e.g. 7020) without the parent, or vice versa
  if (!cats.includes(7000) && supportedIds.some(id => id > 7000 && id < 8000 && id !== 7020)) cats.push(7000);
  return (cats.length ? cats : BOOK_CATEGORIES).join(',');
};

const discoverProwlarr = async (base, apiKey) => {
  const { data } = await axios.get(`${base}/api/v1/indexer`, { headers: { 'X-Api-Key': apiKey }, timeout: 15000 });
  if (!Array.isArray(data)) throw new Error('Unexpected response from Prowlarr (check the URL)');

  return data.map(ix => {
    const ids = [];
    for (const c of ix.capabilities?.categories || []) {
      ids.push(c.id);
      for (const s of c.subCategories || []) ids.push(s.id);
    }
    const supportsBooks = ids.some(BOOK_RANGE);
    return {
      remoteId: String(ix.id),
      name: ix.name,
      protocol: ix.protocol === 'usenet' ? 'usenet' : 'torrent',
      remoteEnabled: ix.enable !== false,
      privacy: ix.privacy || null,
      supportsBooks,
      supportsAudiobooks: ids.includes(3030),
      type: 'newznab', // Prowlarr's proxy speaks Newznab/Torznab at {url}/api
      url: `${base}/${ix.id}`,
      categories: pickCategories(ids)
    };
  });
};

const discoverJackett = async (base, apiKey) => {
  const { data } = await axios.get(`${base}/api/v2.0/indexers/all/results/torznab/api`, {
    params: { apikey: apiKey, t: 'indexers', configured: 'true' },
    timeout: 20000,
    responseType: 'text',
    validateStatus: s => s < 500
  });
  if (typeof data === 'string' && /<error/i.test(data)) {
    const msg = /description="([^"]+)"/.exec(data)?.[1] || 'Jackett rejected the request';
    throw new Error(/api key/i.test(msg) ? 'Invalid Jackett API key' : msg);
  }
  const parsed = await parseStringPromise(data);
  const list = parsed?.indexers?.indexer || [];

  return list.map(ix => {
    const id = ix.$?.id;
    const ids = [];
    for (const c of ix.caps?.[0]?.categories?.[0]?.category || []) {
      ids.push(parseInt(c.$?.id, 10));
      for (const s of c.subcat || []) ids.push(parseInt(s.$?.id, 10));
    }
    const supportsBooks = ids.some(BOOK_RANGE);
    return {
      remoteId: id,
      name: ix.title?.[0] || id,
      protocol: 'torrent',
      remoteEnabled: true,
      privacy: ix.type?.[0] || null, // public / semi-private / private
      supportsBooks,
      supportsAudiobooks: ids.includes(3030),
      type: 'jackett',
      url: `${base}/api/v2.0/indexers/${id}/results/torznab`,
      categories: pickCategories(ids)
    };
  }).filter(ix => ix.remoteId && ix.remoteId !== 'all');
};

const describeError = (e, kind) => {
  if (e.response?.status === 401 || e.response?.status === 403) return `${kind}: invalid API key`;
  if (e.response?.status === 404) return `${kind}: not found at that URL (check host/port and any URL base)`;
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return `${kind}: can't reach server (${e.code})`;
  return `${kind}: ${e.message}`;
};

/**
 * List indexers from a Prowlarr/Jackett instance, flagging which are already in Bookarr.
 */
const discover = async ({ kind, url, apiKey }) => {
  if (!['prowlarr', 'jackett'].includes(kind)) throw new Error('kind must be prowlarr or jackett');
  if (!url || !apiKey) throw new Error('URL and API key are required');
  const base = normalizeBase(url);
  const label = kind === 'prowlarr' ? 'Prowlarr' : 'Jackett';

  let remote;
  try {
    remote = kind === 'prowlarr' ? await discoverProwlarr(base, apiKey) : await discoverJackett(base, apiKey);
  } catch (e) {
    throw new Error(describeError(e, label));
  }

  const { Indexer } = require('../models');
  const existing = await Indexer.findAll();
  const byUrl = new Map(existing.map(i => [i.url.replace(/\/+$/, '').replace(/\/api$/, ''), i]));
  return {
    base,
    indexers: remote
      .map(r => ({ ...r, existingId: byUrl.get(r.url)?.id || null }))
      .sort((a, b) => Number(b.supportsBooks) - Number(a.supportsBooks) || a.name.localeCompare(b.name))
  };
};

/**
 * Add/update Bookarr indexers for the chosen remote ones.
 * @param {string[]} [remoteIds] which to add; defaults to every book-capable, enabled indexer
 * @param {boolean} [removeMissing] delete Bookarr indexers from this source that no longer exist remotely
 */
const sync = async ({ kind, url, apiKey, remoteIds, removeMissing = false, saveConnection = true }) => {
  const { Indexer, Setting } = require('../models');
  const { base, indexers } = await discover({ kind, url, apiKey });
  const label = kind === 'prowlarr' ? 'Prowlarr' : 'Jackett';
  const wanted = remoteIds
    ? indexers.filter(i => remoteIds.map(String).includes(i.remoteId))
    : indexers.filter(i => i.supportsBooks && i.remoteEnabled);

  let added = 0;
  let updated = 0;
  for (const r of wanted) {
    const data = {
      name: `${r.name} (${label})`,
      type: r.type,
      url: r.url,
      apiKey,
      categories: r.categories,
      enabled: r.remoteEnabled
    };
    const current = r.existingId ? await Indexer.findByPk(r.existingId) : null;
    if (current) {
      // Keep the user's own name/priority/enabled choice; refresh connection details and categories
      await current.update({ type: data.type, url: data.url, apiKey: data.apiKey, categories: data.categories });
      updated++;
    } else {
      await Indexer.create({ ...data, priority: r.protocol === 'usenet' ? 60 : 40 });
      added++;
    }
  }

  let removed = 0;
  if (removeMissing) {
    // Indexers that came from this instance are recognisable by their URL prefix
    const prefix = kind === 'prowlarr' ? `${base}/` : `${base}/api/v2.0/indexers/`;
    const remoteUrls = new Set(indexers.map(i => i.url));
    for (const ix of await Indexer.findAll()) {
      const u = ix.url.replace(/\/+$/, '').replace(/\/api$/, '');
      if (u.startsWith(prefix) && !remoteUrls.has(u)) {
        await ix.destroy();
        removed++;
      }
    }
  }

  if (saveConnection) {
    await Setting.upsert({ key: `${kind}_url`, value: base });
    await Setting.upsert({ key: `${kind}_api_key`, value: apiKey });
  }

  logger.info(`${label} sync: ${added} added, ${updated} updated, ${removed} removed (${indexers.length} found)`);
  return { added, updated, removed, found: indexers.length };
};

// Daily refresh of saved connections: updates URL/API key/categories of indexers already added
// (e.g. after rotating the Prowlarr key). Never adds new indexers on its own.
const refreshSavedConnections = async () => {
  if ((await getSetting('indexer_auto_sync')) === 'false') return 'Disabled (indexer_auto_sync = false)';
  const parts = [];
  for (const kind of ['prowlarr', 'jackett']) {
    const url = await getSetting(`${kind}_url`);
    const apiKey = await getSetting(`${kind}_api_key`);
    if (!url || !apiKey) continue;
    try {
      // Only refresh indexers already added; new ones are added only when chosen in the UI
      const { indexers } = await discover({ kind, url, apiKey });
      const known = indexers.filter(i => i.existingId).map(i => i.remoteId);
      if (known.length) {
        const r = await sync({ kind, url, apiKey, remoteIds: known, saveConnection: false });
        parts.push(`${kind}: ${r.updated} refreshed`);
      } else {
        parts.push(`${kind}: nothing to refresh`);
      }
    } catch (e) {
      logger.warn(`Indexer auto-sync (${kind}) failed: ${e.message}`);
      parts.push(`${kind}: failed (${e.message})`);
    }
  }
  return parts.length ? parts.join('; ') : 'No Prowlarr/Jackett connection saved';
};

module.exports = { discover, sync, refreshSavedConnections, normalizeBase, pickCategories };
