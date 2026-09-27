// Torznab/Newznab search shared by manual search and the auto-search job.
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const logger = require('../config/logger');

const redact = (url) => url.replace(/(apikey=)[^&]+/i, '$1***');

const AUDIO_RE = /audiobook|audio book|\bm4b\b|\bmp3\b|\d+\s*kbps|unabridged|narrated/i;

const detectFormat = (title, category) => {
  const t = title.toLowerCase();
  if (category === '3030' || AUDIO_RE.test(t)) return 'audiobook';
  if (/\bpdf\b/.test(t)) return 'pdf';
  if (/\bmobi\b|\bazw3?\b/.test(t)) return 'mobi';
  return 'epub';
};

// Newznab/Torznab endpoint for an indexer; tolerates URLs pasted with or without the trailing /api
const apiEndpoint = (indexer) => {
  const base = indexer.url.replace(/\/+$/, '');
  return /\/api$/.test(base) ? base : `${base}/api`;
};

const buildUrl = (indexer, query) => {
  const categories = indexer.categories || '';
  const key = encodeURIComponent(indexer.apiKey || '');
  if (indexer.type === 'jackett') {
    const cat = categories ? `&cat=${encodeURIComponent(categories)}` : '';
    return `${apiEndpoint(indexer)}?t=search&apikey=${key}&q=${encodeURIComponent(query)}${cat}`;
  }
  const cats = categories || '3030,7000,7020';
  return `${apiEndpoint(indexer)}?t=search&apikey=${key}&q=${encodeURIComponent(query)}&cat=${encodeURIComponent(cats)}`;
};

// Indexers that answered 429 (rate limited) are skipped until their Retry-After passes;
// retrying right away just extends the ban
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const cooldowns = new Map(); // indexer key -> timestamp

// A dead indexer (moved URL, expired API key, offline tracker) answers the same error to every
// search, and warning each time filled the log with the same line: one session logged "... (Jackett)
// returned HTTP 400" 49 times and Prowlarr's "... returned HTTP 429" 71 times, while the rest of the
// app was healthy. Warn once per indexer and message per window, counting the repeats it swallowed;
// a different error still warns straight away.
const WARN_WINDOW_MS = 10 * 60 * 1000;
const warnState = new Map(); // indexer key -> { message, at, repeats }

const warnOnce = (indexer, message) => {
  const key = indexer.id ?? indexer.name;
  const state = warnState.get(key);
  if (state && state.message === message && Date.now() - state.at < WARN_WINDOW_MS) {
    state.repeats++;
    return;
  }
  const repeats = state && state.message === message ? state.repeats : 0;
  const suffix = repeats ? ` (${repeats} repeat${repeats > 1 ? 's' : ''} not logged)` : '';
  logger.warn(`${message}${suffix}`);
  warnState.set(key, { message, at: Date.now(), repeats: 0 });
};

const searchIndexer = async (indexer, query) => {
  const key = indexer.id ?? indexer.name;
  if ((cooldowns.get(key) || 0) > Date.now()) return [];
  const url = buildUrl(indexer, query);
  logger.debug(`Searching ${indexer.name} (${indexer.type}): ${redact(url)}`);
  const response = await axios.get(url, { timeout: 15000, validateStatus: s => s < 500 });
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers?.['retry-after'], 10);
    const ms = retryAfter > 0 ? Math.min(retryAfter * 1000, 6 * 3600 * 1000) : DEFAULT_COOLDOWN_MS;
    const until = Date.now() + ms;
    cooldowns.set(key, until);
    warnOnce(indexer, `${indexer.name} is rate limiting (HTTP 429) — skipping it until ${new Date(until).toLocaleTimeString()}`);
    return [];
  }
  if (response.status >= 400) {
    warnOnce(indexer, `${indexer.name} returned HTTP ${response.status}`);
    return [];
  }

  const data = await parseStringPromise(response.data);
  const items = data.rss?.channel?.[0]?.item || [];
  const indexerBase = indexer.url.match(/^(https?:\/\/[^/]+)/)?.[1];

  return items.map(item => {
    const enclosure = item.enclosure?.[0]?.$;
    let downloadUrl = enclosure?.url || item.link?.[0];
    const title = item.title?.[0] || '';
    const attrs = {};
    (item['torznab:attr'] || item['newznab:attr'] || item.attr || []).forEach(a => {
      if (a.$?.name) attrs[a.$.name] = a.$.value;
    });

    let coverUrl = attrs.coverurl || null;
    // Jackett in Docker often reports its internal hostname; rewrite to the configured one
    if (indexerBase) {
      if (coverUrl) coverUrl = coverUrl.replace(/^https?:\/\/[^/]+/, indexerBase);
      if (downloadUrl && /^https?:\/\//.test(downloadUrl) && indexer.type === 'jackett') {
        downloadUrl = downloadUrl.replace(/^https?:\/\/[^/]+/, indexerBase);
      }
    }

    const isTorrent = /^magnet:/.test(downloadUrl || '') || /\.torrent(\?|$)/.test(downloadUrl || '') ||
      enclosure?.type === 'application/x-bittorrent' || indexer.type === 'jackett' || attrs.seeders !== undefined;
    const category = attrs.category || item.category?.[0] || '';
    const size = parseInt(enclosure?.length || item.size?.[0] || attrs.size || '0', 10) || null;

    return {
      title,
      size,
      pubDate: item.pubDate?.[0],
      indexer: indexer.name,
      downloadUrl,
      guid: item.guid?.[0]?._ || item.guid?.[0],
      type: isTorrent ? 'torrent' : 'nzb',
      format: detectFormat(title, category),
      seeders: parseInt(attrs.seeders || '0', 10) || 0,
      peers: parseInt(attrs.peers || '0', 10) || 0,
      coverUrl,
      genre: attrs.genre || null
    };
  }).filter(r => r.downloadUrl);
};

/** Search all given indexers in parallel; failures are logged and skipped. */
const searchAll = async (indexers, query) => {
  const settled = await Promise.allSettled(indexers.map(ix => searchIndexer(ix, query)));
  const results = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(...s.value);
    else warnOnce(indexers[i], `Indexer ${indexers[i].name} error: ${s.reason?.code === 'ECONNABORTED' ? 'timeout' : s.reason?.message}`);
  });
  return results;
};

// Relevance score: title words, exact title, author words, seeders as tie-breaker
const scoreRelease = (r, title, author) => {
  const rTitle = (r.title || '').toLowerCase();
  const titleLower = title.toLowerCase();
  const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2);
  const authorWords = (author || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let score = titleWords.filter(w => rTitle.includes(w)).length * 2;
  if (rTitle.includes(titleLower)) score += 10;
  score += authorWords.filter(w => rTitle.includes(w)).length * 3;
  score += Math.min(r.seeders || 0, 50) / 25;
  return score;
};

/**
 * Is this release really the wanted book? Used before anything is grabbed automatically.
 * The old rule (a couple of shared words) grabbed comics like "The Walking Dead Deluxe 143"
 * for "The King" and "Donna Mia 001 [Dark lover]" for "Dark Lover".
 *  - the book title must appear as a phrase (series/subtitle noise ignored)
 *  - the author's surname must appear
 *  - no multi-book packs ("05-08", collection, box set) — importing one file from a pack
 *    would attach an arbitrary book
 *  - no comics / magazines
 */
const isRelevantRelease = (release, title, author) => {
  const norm = (s) => ` ${String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const raw = String(release?.title || '');
  const rel = norm(raw);
  const core = norm(String(title || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').split(/:\s| - /)[0]);
  if (core.trim().length < 2 || !rel.includes(core)) return { ok: false, reason: 'title not found as a phrase' };

  const surname = norm(author).trim().split(' ').filter(w => w.length > 1).pop();
  if (surname && !rel.includes(` ${surname} `)) return { ok: false, reason: `author "${surname}" not in release name` };

  if (/\b(collection|box(ed)?\s*set|omnibus|anthology|complete\s+series|bundle|books?\s*\d+\s*[-–]\s*\d+)\b|(^|[^\d])\d{1,2}\s*[-–]\s*\d{1,2}(?!\d)/i.test(raw)) {
    return { ok: false, reason: 'multi-book pack' };
  }
  if (/\b(dcp|comics?|cbz|cbr|magazine|issue\s*\d+|deluxe\s+\d+|v\d{2}\b|full\s+color|graphic\s+novel|manga)\b/i.test(raw)) {
    return { ok: false, reason: 'comic / magazine' };
  }
  return { ok: true };
};

module.exports = { searchAll, searchIndexer, scoreRelease, detectFormat, redact, apiEndpoint, isRelevantRelease };
