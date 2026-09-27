const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { fetchHtml, pollHtml, USER_AGENT } = require('./antiBot');

// Official mirrors per Anna's Archive FAQ (Aug 2026). The .org/.li/.se domains are
// seized or parked, and .su/.io/.is are known fakes. Override with the
// `annas_archive_domains` setting (comma-separated) when domains change again.
const DEFAULT_DOMAINS = ['https://annas-archive.gl', 'https://annas-archive.pk', 'https://annas-archive.gd'];
const BOOK_EXTS = ['epub', 'mobi', 'azw3', 'pdf', 'fb2', 'djvu', 'cbz', 'cbr'];

let workingDomain = null;

const getDomains = async () => {
  const configured = await getSetting('annas_archive_domains');
  const list = configured
    ? configured.split(/[\s,]+/).filter(Boolean).map(d => (d.startsWith('http') ? d : `https://${d}`).replace(/\/+$/, ''))
    : DEFAULT_DOMAINS;
  // Try the last domain that worked first
  return workingDomain && list.includes(workingDomain) ? [workingDomain, ...list.filter(d => d !== workingDomain)] : list;
};

// A parked/hijacked domain still returns 200, so confirm we actually got Anna's Archive
const isRealAnnasPage = (html) => /Anna’s Archive|Anna's Archive/.test(html) && !/forsale|abovedomains|Redirecting\.\.\./i.test(html.slice(0, 3000));

// DDoS-Guard's manual CAPTCHA ("could not verify your browser automatically"): the IP is flagged.
// Retrying only keeps it flagged, so pause Anna's Archive for a while instead.
const isCaptchaPage = (html) => /ddg-captcha|could not verify your browser automatically/i.test(html);
const CAPTCHA_PAUSE_MS = 30 * 60 * 1000;
let pausedUntil = 0;
const pauseStatus = () => (Date.now() < pausedUntil ? { paused: true, until: new Date(pausedUntil) } : { paused: false });

// Fetch a path from the first mirror that returns a genuine page
const fetchFromMirror = async (pathAndQuery, opts = {}) => {
  if (Date.now() < pausedUntil) {
    throw new Error(`Anna's Archive paused until ${new Date(pausedUntil).toLocaleTimeString()} (DDoS-Guard CAPTCHA)`);
  }
  const domains = await getDomains();
  let lastError;
  let captchas = 0;
  for (const domain of domains) {
    try {
      const { html, via } = await fetchHtml(domain + pathAndQuery, opts);
      if (isCaptchaPage(html)) {
        captchas++;
        lastError = new Error(`${domain} is showing a DDoS-Guard CAPTCHA`);
        continue;
      }
      if (!isRealAnnasPage(html)) {
        const pageTitle = (/<title>([^<]*)/i.exec(html)?.[1] || '').trim().slice(0, 80);
        lastError = new Error(`${domain} did not return an Anna's Archive page (got "${pageTitle || 'no title'}", ${html.length} bytes via ${via})`);
        logger.warn(lastError.message);
        continue;
      }
      workingDomain = domain;
      logger.debug(`Anna's Archive: fetched ${pathAndQuery} from ${domain} via ${via}`);
      return { html, domain };
    } catch (e) {
      lastError = e;
      logger.warn(`Anna's Archive mirror ${domain} failed: ${e.message}`);
    }
  }
  if (captchas && captchas === domains.length) {
    pausedUntil = Date.now() + CAPTCHA_PAUSE_MS;
    const msg = `Anna's Archive: every mirror is showing a DDoS-Guard CAPTCHA (this IP is flagged for too many automated requests). `
      + `Pausing Anna's until ${new Date(pausedUntil).toLocaleTimeString()} so the flag can expire.`;
    logger.warn(msg);
    throw new Error(msg);
  }
  throw lastError || new Error('No Anna\'s Archive mirror reachable');
};

// Returns the ISBN (digits/X only) if it is a valid ISBN-10 or ISBN-13, else null
const validIsbn = (value) => {
  const s = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + (ch === 'X' ? 10 : Number(ch)) * (10 - i), 0);
    return sum % 11 === 0 ? s : null;
  }
  if (/^97[89]\d{10}$/.test(s)) {
    const sum = [...s].slice(0, 12).reduce((acc, ch, i) => acc + Number(ch) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  return null;
};

const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const parseSize = (s) => {
  const m = /([\d.]+)\s*(KB|MB|GB)/i.exec(s || '');
  if (!m) return null;
  const mult = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase()];
  return Math.round(parseFloat(m[1]) * mult);
};

// Parse search result cards. Only `a.js-vim-focus` links are real results — other
// /md5/ links on the page belong to the header's "recently downloaded" ticker.
const parseSearchResults = (html, domain) => {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('a.js-vim-focus[href^="/md5/"]').each((i, el) => {
    const link = $(el);
    const md5 = /\/md5\/([a-f0-9]{32})/.exec(link.attr('href'))?.[1];
    if (!md5 || seen.has(md5)) return;
    seen.add(md5);

    const card = link.parent().parent();
    const authorLink = link.nextAll('a').filter((_, a) => $(a).find('[class*="user-edit"]').length > 0).first();
    const publisherLink = link.nextAll('a').filter((_, a) => $(a).find('[class*="company"]').length > 0).first();
    const metaLine = card.find('div.font-semibold.text-sm').first().text().replace(/\s+/g, ' ').trim();
    const metaParts = metaLine.split('·').map(s => s.trim());
    const ext = metaParts.map(p => p.toLowerCase()).find(p => BOOK_EXTS.includes(p)) || null;
    const language = /\[([a-z]{2,3})\]/.exec(metaLine)?.[1] || null;
    const year = metaParts.find(p => /^\d{4}$/.test(p)) || null;
    const filename = card.find('div.font-mono').first().text().trim();

    results.push({
      md5,
      title: link.text().trim(),
      author: authorLink.text().trim() || null,
      publisher: publisherLink.text().trim() || null,
      extension: ext,
      language,
      year,
      size: parseSize(metaLine),
      filename,
      annasArchiveUrl: `${domain}/md5/${md5}`
    });
  });

  return results;
};

// Rank results against the wanted book so the best match is first
const scoreResult = (r, title, author, preferredExts) => {
  const t = normalize(r.title);
  const wantTitle = normalize(title).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const titleWords = wantTitle.split(' ').filter(w => w.length > 2);
  const hay = `${t} ${normalize(r.filename)}`;
  let score = 0;

  if (t === wantTitle) score += 30;
  else if (t.startsWith(wantTitle) || t.includes(wantTitle)) score += 20;
  if (titleWords.length) score += 15 * (titleWords.filter(w => hay.includes(w)).length / titleWords.length);

  if (author) {
    const authorWords = normalize(author).split(' ').filter(w => w.length > 1);
    const a = `${normalize(r.author)} ${hay}`;
    const hits = authorWords.filter(w => a.includes(w)).length;
    score += authorWords.length ? 20 * (hits / authorWords.length) : 0;
    if (hits === 0) score -= 15;
  }

  const extIdx = preferredExts.indexOf(r.extension);
  score += extIdx === -1 ? -20 : (preferredExts.length - extIdx) * 3;
  if (r.size && r.size < 20 * 1024) score -= 20; // Stub/broken files
  if (/summary|study guide|workbook|sparknotes|analysis of/i.test(r.title)) score -= 25;
  return score;
};

const getPreferredExts = async () => {
  const setting = await getSetting('annas_archive_formats');
  return (setting || 'epub,azw3,mobi,pdf').split(/[\s,]+/).map(s => s.toLowerCase()).filter(Boolean);
};

/**
 * Search Anna's Archive. Tries ISBN first (exact edition match) then title + author.
 * @returns {Promise<Array>} results sorted best-first, each with `score`
 */
const searchBooks = async (title, author = '', { isbn, limit = 10 } = {}) => {
  const preferredExts = await getPreferredExts();
  const lang = (await getSetting('annas_archive_language')) || 'en';
  const extParams = preferredExts.map(e => `&ext=${encodeURIComponent(e)}`).join('');
  const langParam = lang === 'any' ? '' : `&lang=${encodeURIComponent(lang)}`;

  const queries = [];
  // Only a real ISBN-10/13 (valid checksum). Stripping a non-ISBN value such as an ASIN
  // ("B09…") down to digits produced junk queries like "09".
  const cleanIsbn = validIsbn(isbn);
  if (cleanIsbn) queries.push(cleanIsbn);
  queries.push(author ? `${title} ${author}` : title);

  for (const q of queries) {
    try {
      const path = `/search?q=${encodeURIComponent(q)}${langParam}${extParams}`;
      logger.info(`Anna's Archive search: "${q}"`);
      const { html, domain } = await fetchFromMirror(path, { waitForSelector: 'a.js-vim-focus, .js-not-found-additional' });
      let results = parseSearchResults(html, domain);
      results.forEach(r => { r.score = scoreResult(r, title, author, preferredExts); });
      results = results.filter(r => r.score > 10).sort((a, b) => b.score - a.score);

      logger.info(`Anna's Archive: ${results.length} relevant results for "${q}"${results[0] ? ` (best: ${results[0].title} [${results[0].extension}])` : ''}`);
      if (results.length) return results.slice(0, limit);
    } catch (error) {
      // While paused (CAPTCHA) don't log an error on every search
      if (/paused until/.test(error.message)) logger.debug(error.message);
      else logger.error(`Anna's Archive search error: ${error.message}`);
      return [];
    }
  }
  return [];
};

/**
 * Get download options for a record.
 * @returns {Promise<{downloadLinks: Array<{url, source, type}>}|null>}
 */
const getBookDetails = async (md5) => {
  try {
    const { html, domain } = await fetchFromMirror(`/md5/${md5}`, { waitForSelector: 'a[href*="_download/"]' });
    const $ = cheerio.load(html);
    const downloadLinks = [];
    const seen = new Set();

    $('a[href*="/slow_download/"], a[href*="/fast_download/"]').each((i, el) => {
      const href = $(el).attr('href').split('?')[0];
      if (seen.has(href)) return;
      seen.add(href);
      const type = href.includes('/fast_download/') ? 'fast' : 'slow';
      downloadLinks.push({ url: domain + href, source: $(el).text().trim(), type });
    });

    logger.info(`Anna's Archive ${md5}: ${downloadLinks.filter(l => l.type === 'slow').length} slow / ${downloadLinks.filter(l => l.type === 'fast').length} fast servers`);
    return { downloadLinks };
  } catch (error) {
    logger.error(`Anna's Archive details error: ${error.message}`);
    return null;
  }
};

// Member fast-download API (needs a donation key from your Anna's Archive account page)
const getFastDownloadUrl = async (md5, key) => {
  const domains = await getDomains();
  for (const domain of domains) {
    const url = `${domain}/dyn/api/fast_download.json?md5=${md5}&key=${encodeURIComponent(key)}`;
    try {
      const { data } = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': USER_AGENT }, validateStatus: () => true });
      if (data?.download_url) return data.download_url;
      if (data?.error) {
        logger.warn(`Anna's Archive fast download API: ${data.error}`);
        if (/invalid|not a member|no downloads left/i.test(data.error)) return null;
      }
    } catch (e) {
      logger.debug(`Fast download API via ${domain} failed: ${e.message}`);
    }
  }
  return null;
};

// Extract the partner-server file link that appears on a slow download page after its countdown
const extractSlowLink = (html) => {
  const $ = cheerio.load(html);
  const text = $('main').text() || $('body').text();
  if (/no slow download slots|slow partner servers are full|too many downloads/i.test(text)) {
    const err = new Error('Slow download server is busy');
    err.abort = true;
    throw err;
  }

  const candidates = [];
  $('main a[href^="http"], a[href^="http"]').each((i, el) => candidates.push($(el).attr('href')));
  $('main code, main pre, main span').each((i, el) => {
    const t = $(el).text().trim();
    if (/^https?:\/\/\S+$/.test(t)) candidates.push(t);
  });

  const fileRe = new RegExp(`\\.(${BOOK_EXTS.join('|')})(\\?|$)`, 'i');
  return candidates.find(u => !/annas-archive\./i.test(u) && fileRe.test(decodeURIComponent(u).split('#')[0])) || null;
};

/**
 * Resolve a direct file URL for an md5 (or for a specific slow_download URL).
 * Tries the member API if `annas_archive_key` is set, then slow partner servers in turn.
 */
const getDirectDownloadUrl = async (md5OrSlowUrl) => {
  const md5 = /([a-f0-9]{32})/.exec(md5OrSlowUrl)?.[1];
  if (!md5) throw new Error('Invalid Anna\'s Archive identifier');

  const key = await getSetting('annas_archive_key');
  if (key) {
    const fast = await getFastDownloadUrl(md5, key);
    if (fast) {
      logger.info(`Anna's Archive: using member fast download for ${md5}`);
      return fast;
    }
  }

  let slowUrls = [];
  if (/\/slow_download\//.test(md5OrSlowUrl)) slowUrls.push(md5OrSlowUrl);
  const details = await getBookDetails(md5);
  slowUrls.push(...(details?.downloadLinks || []).filter(l => l.type === 'slow').map(l => l.url));
  if (slowUrls.length === 0) {
    const domain = (await getDomains())[0];
    slowUrls = [0, 1, 2, 3].map(i => `${domain}/slow_download/${md5}/0/${i}`);
  }
  slowUrls = [...new Set(slowUrls)];

  // Spread load: start from a random server but try up to 4
  const start = Math.floor(Math.random() * slowUrls.length);
  const ordered = slowUrls.slice(start).concat(slowUrls.slice(0, start)).slice(0, 4);

  for (const slowUrl of ordered) {
    logger.info(`Anna's Archive: waiting on ${slowUrl.replace(/^https?:\/\/[^/]+/, '')} (countdown can take ~1-2 min)`);
    try {
      const url = await pollHtml(slowUrl, extractSlowLink, { timeoutMs: 180000 });
      if (url) {
        logger.info(`Anna's Archive: resolved file on ${new URL(url).host}`);
        return url;
      }
      logger.warn('Anna\'s Archive: no link appeared before timeout, trying next server');
    } catch (e) {
      logger.warn(`Anna's Archive slow server failed: ${e.message}`);
    }
  }
  return null;
};

module.exports = { pauseStatus, searchBooks, getBookDetails, getDirectDownloadUrl, parseSearchResults, extractSlowLink };
