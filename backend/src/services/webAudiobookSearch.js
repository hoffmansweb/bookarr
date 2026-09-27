// Finds audiobook sources on the open web and merges them with LibriVox,
// Internet Archive and YouTube into one ranked list.
//
// Web search backends, in order:
//   1. Google Programmable Search JSON API (settings: google_cse_key + google_cse_cx).
//      Closed to new sign-ups and shutting down 2027-01-01; only useful with existing keys.
//   2. SearXNG (setting: searxng_url) - self-hosted metasearch that queries Google for you.
//      Requires `formats: [html, json]` under `search:` in SearXNG's settings.yml.
//   3. Brave Search API (setting: brave_search_key)
//   4. Google results page via the stealth browser (usually CAPTCHA'd; backs off 30 min when it is)
//   5. DuckDuckGo, then Bing, via the stealth browser
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { fetchHtml } = require('../scrapers/antiBot');

const AUDIO_EXT_RE = /\.(mp3|m4b|m4a|aac|ogg|opus|flac)(\?|#|$)/i;

// Storefronts / metadata sites: DRM-protected or no audio to fetch
const SKIP_HOSTS = /(^|\.)(audible\.|amazon\.|goodreads\.com|audiobooks\.com|libro\.fm|spotify\.com|apple\.com|play\.google\.com|books\.google\.|chirpbooks\.com|scribd\.com|everand\.com|storytel\.|kobo\.com|barnesandnoble\.com|wikipedia\.org|reddit\.com|facebook\.com|pinterest\.|instagram\.com|tiktok\.com|x\.com|twitter\.com|quora\.com|bookshop\.org|hoopladigital\.com|overdrive\.com|libbyapp\.com|penguinrandomhouse\.com|harpercollins\.com|simonandschuster\.com|macmillan\.com)/i;

const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const googleCse = async (query) => {
  const key = await getSetting('google_cse_key');
  const cx = await getSetting('google_cse_cx');
  if (!key || !cx) return null;
  const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', { params: { key, cx, q: query, num: 10 }, timeout: 15000 });
  return (data.items || []).map(i => ({ url: i.link, title: i.title, snippet: i.snippet }));
};

const searxng = async (query) => {
  const base = (await getSetting('searxng_url'))?.replace(/\/+$/, '');
  if (!base) return null;
  const { data } = await axios.get(`${base}/search`, { params: { q: query, format: 'json', language: 'en' }, timeout: 20000 });
  return (data.results || []).map(r => ({ url: r.url, title: r.title, snippet: r.content }));
};

const braveSearch = async (query) => {
  const key = await getSetting('brave_search_key');
  if (!key) return null;
  const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: { q: query, count: 20 },
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    timeout: 15000
  });
  return (data.web?.results || []).map(r => ({ url: r.url, title: r.title, snippet: r.description }));
};

const googleScrape = async (query) => {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&hl=en&filter=0`;
  const { html, url: finalUrl } = await fetchHtml(url, { timeoutMs: 30000, flaresolverr: false });
  if (/\/sorry\/|unusual traffic|captcha/i.test(finalUrl + html.slice(0, 20000))) throw new Error('Google CAPTCHA');
  const $ = cheerio.load(html);
  const results = [];
  $('#search a[href^="http"]').each((i, el) => {
    const a = $(el);
    const h3 = a.find('h3').first();
    if (!h3.length) return;
    const block = a.closest('div.g, div[data-hveid], div.MjjYud');
    results.push({ url: a.attr('href'), title: h3.text().trim(), snippet: block.find('div[data-sncf], .VwiC3b').first().text().trim() });
  });
  return results;
};

// DuckDuckGo's plain-HTTP endpoints now answer bots with an "anomaly" challenge, so use the browser
const duckDuckGo = async (query) => {
  const sel = 'a[data-testid="result-title-a"]';
  const { html } = await fetchHtml(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web&kl=us-en`, { timeoutMs: 30000, waitForSelector: sel, flaresolverr: false });
  const $ = cheerio.load(html);
  const results = [];
  $(sel).each((i, el) => {
    const href = $(el).attr('href') || '';
    if (!/^https?:/.test(href)) return;
    const article = $(el).closest('article');
    results.push({ url: href, title: $(el).text().trim(), snippet: article.find('[data-result="snippet"]').text().trim() });
  });
  return results;
};

// Bing wraps result links as /ck/a?...&u=a1<base64url(target)>
const bing = async (query) => {
  const sel = '#b_results li.b_algo h2 a';
  const { html } = await fetchHtml(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30&setlang=en`, { timeoutMs: 30000, waitForSelector: sel, flaresolverr: false });
  const $ = cheerio.load(html);
  const results = [];
  $(sel).each((i, el) => {
    let href = $(el).attr('href') || '';
    const wrapped = /[?&]u=a1([^&]+)/.exec(href);
    if (wrapped) {
      try { href = Buffer.from(wrapped[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { return; }
    }
    if (!/^https?:/.test(href)) return;
    results.push({ url: href, title: $(el).text().trim(), snippet: $(el).closest('li.b_algo').find('p').first().text().trim() });
  });
  return results;
};

let googleBlockedUntil = 0;

const webSearch = async (query) => {
  try {
    const cse = await googleCse(query);
    if (cse) return { engine: 'google-api', results: cse };
  } catch (e) {
    logger.warn(`Google Custom Search failed: ${e.response?.data?.error?.message || e.message}`);
  }

  for (const [engine, fn] of [['searxng', searxng], ['brave', braveSearch]]) {
    try {
      const results = await fn(query);
      if (results) return { engine, results };
    } catch (e) {
      if (engine === 'searxng' && e.response?.status === 403) {
        // SearXNG answers 403 when the JSON output format isn't enabled
        if (!searxngHinted) logger.warn('SearXNG refused the request (403): enable JSON output by adding "- json" under search: formats: in its settings.yml, then restart SearXNG');
        searxngHinted = true;
      } else {
        logger.warn(`${engine} search failed: ${e.response?.status || ''} ${e.message}`);
      }
    }
  }

  if (Date.now() > googleBlockedUntil && (await getSetting('audiobook_google_scrape')) !== 'false') {
    try {
      const results = await googleScrape(query);
      if (results.length) return { engine: 'google', results };
    } catch (e) {
      logger.warn(`Google search scrape failed: ${e.message}`);
      if (/captcha/i.test(e.message)) googleBlockedUntil = Date.now() + 30 * 60 * 1000;
    }
  }

  for (const [engine, fn] of [['duckduckgo', duckDuckGo], ['bing', bing]]) {
    try {
      const results = await fn(query);
      if (results.length) return { engine, results };
    } catch (e) {
      logger.warn(`${engine} search failed: ${e.message}`);
    }
  }
  return { engine: 'none', results: [] };
};

const classify = (r) => {
  if (AUDIO_EXT_RE.test(r.url)) return 'direct';
  if (/index of/i.test(r.title) || /index of/i.test(r.snippet || '')) return 'directory';
  return 'page';
};

const scoreWeb = (r, title, author) => {
  const hay = normalize(`${r.title} ${decodeURIComponent(r.url)} ${r.snippet || ''}`);
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const authorWords = normalize(author).split(' ').filter(w => w.length > 2);
  const titleHit = titleWords.length ? titleWords.filter(w => hay.includes(w)).length / titleWords.length : 0;
  const authorHit = authorWords.length ? authorWords.filter(w => hay.includes(w)).length / authorWords.length : 0;
  let score = titleHit * 50 + authorHit * 20;
  if (/audio ?book|narrat|unabridged|chapter/i.test(hay)) score += 10;
  if (r.kind === 'direct' || r.kind === 'directory') score += 10;
  if (/summary|review|trailer|sample|podcast|preview/i.test(hay)) score -= 20;
  return score;
};

/** Web-only search (Google/DDG). */
let searxngHinted = false; // log the SearXNG JSON hint once, not on every search
const searchWeb = async (title, author) => {
  const quoted = `"${title}"${author ? ` "${author}"` : ''}`;
  const queries = [
    `${quoted} audiobook (mp3 OR m4b)`,
    `intitle:"index of" "${title}" (mp3 OR m4b)`,
    `${quoted} full audiobook`
  ];

  const seen = new Set();
  const results = [];
  for (const q of queries) {
    const { engine, results: hits } = await webSearch(q);
    for (const h of hits) {
      let host;
      try { host = new URL(h.url).hostname; } catch (e) { continue; }
      if (SKIP_HOSTS.test(host) || seen.has(h.url)) continue;
      seen.add(h.url);
      const r = { ...h, host, engine, kind: classify(h) };
      r.score = scoreWeb(r, title, author);
      results.push(r);
    }
  }

  return results
    .filter(r => r.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(r => ({
      title: r.title,
      indexer: `Web (${r.host})`,
      source: 'web',
      type: 'web',
      kind: r.kind,
      format: 'audiobook',
      downloadUrl: r.url,
      snippet: r.snippet,
      engine: r.engine,
      score: Math.round(r.score)
    }));
};

/**
 * All-sources audiobook search, best first. Each source failing is non-fatal.
 */
// Catalogue-style ranking (LibriVox / Archive.org / YouTube): title + author match, popularity;
// penalise dramatisations, abridged versions and samples. null = not a match.
const makeRanker = (title, author) => {
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const authorWords = normalize(author).split(' ').filter(w => w.length > 2);
  const frac = (words, text) => (words.length ? words.filter(w => text.includes(w)).length / words.length : 1);
  return (r, base, popularity = r.downloads) => {
    const t = normalize(r.title);
    const titleHit = frac(titleWords, t);
    if (titleHit < 0.6) return null;
    let score = base + titleHit * 10 + frac(authorWords, normalize(`${r.author || r.channel || ''} ${r.title}`)) * 10;
    if (t === normalize(title)) score += 5;
    if (popularity) score += Math.min(10, Math.log10(popularity + 1) * 2.5);
    if (/dramati[sz]|radio|bbc|abridged|excerpt|sample|summary|review|trailer/i.test(r.title)) score -= 25;
    return Math.round(score);
  };
};

const AUDIOBOOK_SOURCES = ['librivox', 'loyalbooks', 'gutenberg', 'spotify', 'archive', 'youtube', 'web'];

/**
 * Search a single audiobook source; results ranked best-first, each with `score`.
 * Scores are comparable across sources: >= 60 is a confident match.
 */
const searchSource = async (source, title, author) => {
  const rank = makeRanker(title, author);
  const scored = (list, base, map) => list
    .map(r => ({ ...map(r), score: rank(r, base, r.downloads || r.viewCount) }))
    .filter(r => r.score !== null)
    .sort((a, b) => b.score - a.score);

  switch (source) {
    case 'librivox': {
      const librivox = require('./librivox');
      return scored(await librivox.search(title, author), 70, r => ({ ...r, indexer: 'LibriVox', downloadUrl: r.rssUrl }));
    }
    case 'loyalbooks': {
      const loyalbooks = require('./loyalbooks');
      return scored(await loyalbooks.search(title, author), 65, r => ({ ...r, indexer: 'Loyal Books', type: 'loyalbooks', downloadUrl: r.rssUrl || r.url }));
    }
    case 'gutenberg': {
      const gutenberg = require('./gutenberg');
      return scored(await gutenberg.search(title, author), 65, r => ({ ...r, indexer: 'Project Gutenberg', type: 'gutenberg', downloadUrl: r.url }));
    }
    case 'spotify': {
      const spotify = require('./spotify');
      return scored(await spotify.search(title, author), 65, r => ({ ...r, indexer: 'Spotify', type: 'spotify', downloadUrl: r.url }));
    }
    case 'archive': {
      const internetArchive = require('./internetArchive');
      return scored(await internetArchive.search(title, author), 60, r => ({ ...r, indexer: 'Internet Archive', downloadUrl: r.archiveUrl }));
    }
    case 'youtube': {
      // youtube.search already drops videos under 30 minutes and weak title matches
      const youtube = require('../scrapers/youtube');
      return scored(await youtube.search(title, author), 50, r => ({ ...r, indexer: 'YouTube', type: 'youtube', downloadUrl: r.url }));
    }
    case 'web':
      return searchWeb(title, author);
    default:
      return [];
  }
};

/**
 * All-sources audiobook search. With `order` (source ids, highest priority first) results are
 * grouped by source priority, then relevance; otherwise sorted by relevance only.
 */
const searchAll = async (title, author, { order } = {}) => {
  // With an order (enabled sources from Settings), only search those: a source switched off
  // in Settings (e.g. YouTube) isn't queried at all
  const sources = order ? AUDIOBOOK_SOURCES.filter(src => order.includes(src)) : AUDIOBOOK_SOURCES;
  const settled = await Promise.allSettled(sources.map(src => searchSource(src, title, author)));
  const results = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(...s.value.map(r => ({ ...r, sourceId: sources[i] })));
    else logger.warn(`${sources[i]} audiobook search failed: ${s.reason?.message}`);
  });
  const prio = (r) => {
    const idx = order ? order.indexOf(r.sourceId) : -1;
    return idx === -1 ? (order ? order.length : 0) : idx;
  };
  results.sort((a, b) => prio(a) - prio(b) || (b.score || 0) - (a.score || 0));
  logger.info(`Audiobook search "${title}": ` + (sources.length
    ? sources.map(src => `${src} ${results.filter(r => r.sourceId === src).length}`).join(', ')
    : 'no audiobook sources enabled'));
  return results;
};

module.exports = { searchAll, searchSource, searchWeb, webSearch, AUDIO_EXT_RE, AUDIOBOOK_SOURCES };
