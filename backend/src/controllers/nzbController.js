const { Indexer, DownloadClient, Book, Author } = require('../models');
const logger = require('../config/logger');
const annasArchive = require('../scrapers/annasArchive');
const youtube = require('../scrapers/youtube');
const annasDownloader = require('../services/annasDownloader');
const audiobookPipeline = require('../services/audiobookPipeline');
const webAudiobookSearch = require('../services/webAudiobookSearch');
const { searchAll: searchIndexers, scoreRelease, isRelevantRelease } = require('../services/indexerSearch');
const { dispatchRelease } = require('../services/clientDispatch');
const { getSetting } = require('../controllers/settingsController');
const { getEnabledOrder } = require('../services/sourcePriority');

const ANNAS_SEARCH_TIMEOUT_MS = 75000;
const AUDIO_SEARCH_TIMEOUT_MS = 75000;

const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);

// Basic SSRF guard for user-supplied audiobook URLs
const isPrivateHost = async (url) => {
  const { hostname } = new URL(url);
  const { lookup } = require('dns').promises;
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (e) {
    return false; // Unresolvable; the download itself will fail
  }
  return addresses.some(({ address }) =>
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ||
    address === '::1' || /^f[cd]|^fe80/i.test(address));
};

const annasEnabled = async () => (await getSetting('annas_archive_enabled')) !== 'false';

exports.searchBook = async (req, res) => {
  try {
    const { title, author, isbn, mediaType } = req.query;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

    const indexers = await Indexer.findAll({ where: { enabled: true } });
    const clients = await DownloadClient.findAll({ where: { enabled: true } });
    const wantAnnas = mediaType !== 'audiobook' && await annasEnabled();
    // YouTube / LibriVox / Archive / web audiobooks, limited to the sources enabled in Settings
    const audioOrder = mediaType === 'ebook' ? [] : await getEnabledOrder('audiobook');
    const wantAudio = webAudiobookSearch.AUDIOBOOK_SOURCES.some(src => audioOrder.includes(src));

    // Anna's Archive, indexers and audiobook sources run in parallel; slow ones are capped so they can't stall the UI
    const [annaResults, indexerResults, audioResults] = await Promise.all([
      wantAnnas
        ? withTimeout(annasArchive.searchBooks(title.trim(), author, { isbn }), ANNAS_SEARCH_TIMEOUT_MS, []).catch(() => [])
        : [],
      indexers.length ? searchIndexers(indexers, title.trim()) : [],
      wantAudio
        ? withTimeout(webAudiobookSearch.searchAll(title.trim(), (author || '').trim(), { order: audioOrder }), AUDIO_SEARCH_TIMEOUT_MS, [])
          .catch(e => { logger.warn(`Audiobook sources search failed: ${e.message}`); return []; })
        : []
    ]);

    const results = [
      ...annaResults.slice(0, 8).map(r => ({
        title: r.author ? `${r.title} — ${r.author}` : r.title,
        indexer: 'Anna\'s Archive',
        downloadUrl: r.annasArchiveUrl,
        md5: r.md5,
        guid: r.md5,
        type: 'annas',
        format: r.extension || 'epub',
        size: r.size,
        language: r.language,
        year: r.year,
        _source: 'annas',
        _score: r.score
      })),
      ...indexerResults.map(r => ({
        ...r,
        _source: r.type === 'nzb' ? 'usenet' : 'torrent',
        _score: scoreRelease(r, title.trim(), author),
        // Clearly this book by this author (used by one-click "Auto" to avoid grabbing junk)
        matched: isRelevantRelease(r, title.trim(), author).ok
      })),
      // Already filtered to real full-length readings of this title
      ...audioResults.map(({ sourceId, score, ...r }) => ({ ...r, format: 'audiobook', _source: sourceId, _score: score || 0 }))
    ];

    // Group by the user's source priority for this format, then by relevance
    const order = await getEnabledOrder(mediaType === 'audiobook' ? 'audiobook' : 'ebook');
    const prio = (r) => (order.indexOf(r._source) === -1 ? order.length : order.indexOf(r._source));
    // Real matches first, then source priority, then relevance
    results.sort((a, b) => Number(b.matched !== false) - Number(a.matched !== false) || prio(a) - prio(b) || b._score - a._score);
    results.forEach(r => { delete r._score; delete r._source; });

    const audioCounts = {};
    audioResults.forEach(r => { audioCounts[r.sourceId] = (audioCounts[r.sourceId] || 0) + 1; });
    logger.info(`Search "${title}": ${annaResults.length} Anna's + ${indexerResults.length} indexer + ${audioResults.length} audiobook-source results`
      + (wantAudio ? ` (YouTube ${audioOrder.includes('youtube') ? audioCounts.youtube || 0 : 'off'})` : ''));
    // Per enabled audiobook source, including zeros, so the UI can say "YouTube: none"
    const audioSources = wantAudio ? {} : undefined;
    if (wantAudio) webAudiobookSearch.AUDIOBOOK_SOURCES.filter(src => audioOrder.includes(src))
      .forEach(src => { audioSources[src] = audioCounts[src] || 0; });
    res.json({ results, audioSources, hasClients: clients.length > 0 || wantAnnas });
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const clients = await DownloadClient.count({ where: { enabled: true } });
    const indexers = await Indexer.count({ where: { enabled: true } });
    res.json({ hasClients: clients > 0, hasIndexers: indexers > 0, hasAnnas: await annasEnabled(), hasYoutube: true, hasAudiobookSearch: true });
  } catch (error) {
    res.json({ hasClients: false, hasIndexers: false, hasAnnas: true, hasYoutube: true, hasAudiobookSearch: true });
  }
};

exports.youtubeSearch = async (req, res) => {
  try {
    const { title, author } = req.query;
    if (!title) return res.status(400).json({ error: 'title is required' });
    // Respect Settings → YouTube switched off
    if (!(await getEnabledOrder('audiobook')).includes('youtube')) {
      return res.json({ results: [], disabled: true, message: 'YouTube is turned off in Settings' });
    }
    const results = await youtube.search(title, author);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.youtubeDownload = async (req, res) => {
  try {
    const { url, bookId } = req.body;
    if (!url || !bookId) return res.status(400).json({ error: 'url and bookId required' });
    if (!/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url)) return res.status(400).json({ error: 'Not a YouTube URL' });
    if (!await Book.findByPk(bookId)) return res.status(404).json({ error: 'Book not found' });

    const queued = youtube.download(url, bookId, { userId: req.user?.id });
    res.json({ success: true, queued, message: queued ? 'YouTube download queued — it will be converted to M4B' : 'Already downloading' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Unified audiobook search: Google/web, LibriVox, Internet Archive, YouTube
exports.audiobookSearch = async (req, res) => {
  try {
    const { title, author } = req.query;
    if (!title) return res.status(400).json({ error: 'title is required' });
    // Grouped by the audiobook source priority from Settings, then relevance
    const order = await getEnabledOrder('audiobook');
    const results = await webAudiobookSearch.searchAll(title.trim(), (author || '').trim(), { order });
    // Per-source counts (including zeros) so the UI can say e.g. "YouTube: none"
    const sources = {};
    webAudiobookSearch.AUDIOBOOK_SOURCES.filter(src => order.includes(src))
      .forEach(src => { sources[src] = results.filter(r => r.sourceId === src).length; });
    res.json({ results, sources });
  } catch (error) {
    logger.error(`Audiobook search error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

// Find -> download -> convert -> save, in the background. Progress is sent on the
// `download:progress` socket event.
exports.audiobookDownload = async (req, res) => {
  try {
    const { bookId, result } = req.body;
    if (!bookId || !result) return res.status(400).json({ error: 'bookId and result required' });
    const url = result.downloadUrl || result.url || result.rssUrl;
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Only http(s) URLs are supported' });
    if (url && await isPrivateHost(url)) return res.status(400).json({ error: 'Refusing to fetch from a private/internal address' });
    if (!await Book.findByPk(bookId)) return res.status(404).json({ error: 'Book not found' });

    const queued = audiobookPipeline.enqueue(bookId, result, { userId: req.user?.id });
    res.status(202).json({ success: true, queued, message: queued ? 'Audiobook queued' : 'Already downloading' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get the audiobook automatically: walks the audiobook source priority (e.g. YouTube first), with fallback
exports.audiobookAuto = async (req, res) => {
  try {
    const { bookId } = req.body;
    const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const { acquireBook } = require('../services/acquisition');
    const { SOURCES } = require('../services/sourcePriority');
    const result = await acquireBook(book, { userId: req.user?.id, mediaType: 'audiobook' });
    if (!result.queued) return res.json({ success: false, message: 'No audiobook found in any enabled source' });
    res.status(202).json({ success: true, message: `Audiobook queued via ${SOURCES[result.source]?.label || result.source}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Resolved source priority lists for the settings page
exports.getSourceOrder = async (req, res) => {
  try {
    const { getOrder } = require('../services/sourcePriority');
    res.json({ ebook: await getOrder('ebook'), audiobook: await getOrder('audiobook') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.download = async (req, res) => {
  try {
    const { url, title, bookId, type, format, md5 } = req.body;

    // Anna's Archive: resolve and download in the background (the slow-server countdown takes 1-2 min)
    if (type === 'annas' || type === 'direct') {
      const id = md5 || /([a-f0-9]{32})/.exec(url || '')?.[1];
      if (!id) return res.status(400).json({ error: 'Missing Anna\'s Archive md5' });
      if (!bookId || !await Book.findByPk(bookId)) return res.status(400).json({ error: 'A library book is required for Anna\'s Archive downloads' });

      const queued = annasDownloader.enqueue(bookId, [id], { userId: req.user?.id });
      return res.status(202).json({ success: true, queued, message: queued ? 'Anna\'s Archive download queued' : 'Already downloading' });
    }

    if (!url) return res.status(400).json({ error: 'url is required' });

    const book = bookId ? await Book.findByPk(bookId) : null;
    await dispatchRelease({ url, title, type, format, book });
    res.json({ success: true, message: 'Download started' });
  } catch (error) {
    logger.error(`Download error: ${error.message}`);
    res.status(error.status || 500).json({ error: error.message });
  }
};
