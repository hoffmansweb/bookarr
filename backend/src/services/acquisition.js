// Finds and downloads a book by walking the user's source priority list
// (Settings → Sources → Download source priority). If a source finds nothing, or its
// download later fails (dead Anna's link, fake/short YouTube upload...), the next
// source is tried automatically.
const logger = require('../config/logger');
const { getEnabledOrder, SOURCES } = require('./sourcePriority');

const CONFIDENT = 60; // minimum score to auto-download from the catalogue/web sources
const PIPELINE_SOURCES = ['youtube', 'librivox', 'archive', 'web'];

const isBusy = (bookId) => {
  const annasDownloader = require('./annasDownloader');
  const audiobookPipeline = require('./audiobookPipeline');
  return annasDownloader.isActive(bookId) || audiobookPipeline.isActive(bookId);
};

// Indexer search is shared by the usenet and torrent steps of one acquisition
const indexerReleases = async (ctx) => {
  if (ctx.releases) return ctx.releases;
  const { Indexer } = require('../models');
  const { searchAll, scoreRelease, isRelevantRelease } = require('./indexerSearch');
  const indexers = await Indexer.findAll({ where: { enabled: true } });
  const authorName = ctx.book.author?.name || '';
  const all = indexers.length ? await searchAll(indexers, `${ctx.book.title} ${authorName}`.trim()) : [];
  // Automatic grabs only take a release that is clearly this book by this author
  // (title as a phrase + author surname, no packs/comics) — see isRelevantRelease
  ctx.releases = all
    .filter(r => (ctx.mediaType === 'audiobook') === (r.format === 'audiobook'))
    .filter(r => isRelevantRelease(r, ctx.book.title, authorName).ok)
    .map(r => ({ ...r, score: scoreRelease(r, ctx.book.title, authorName) }))
    .sort((a, b) => b.score - a.score);
  if (all.length && !ctx.releases.length) {
    logger.info(`Acquire: ${all.length} indexer results for "${ctx.book.title}", none clearly this book by ${authorName || 'this author'}`);
  }
  return ctx.releases;
};

const tryIndexers = async (ctx, protocol) => {
  const { dispatchRelease, findClient } = require('./clientDispatch');
  // Skip releases that previously stalled or failed for this book
  const failed = new Set((ctx.book.metadata?.failedReleases || []).map(t => String(t).toLowerCase()));
  const releases = (await indexerReleases(ctx))
    .filter(r => (protocol === 'usenet' ? r.type === 'nzb' : r.type === 'torrent'))
    .filter(r => !failed.has(String(r.title).toLowerCase()));
  if (!releases.length) return false;
  if (!(await findClient(protocol === 'torrent', ctx.mediaType))) {
    logger.debug(`Skipping ${protocol}: no ${protocol === 'torrent' ? 'torrent' : 'NZB'} client configured`);
    return false;
  }
  for (const release of releases.slice(0, 5)) {
    try {
      await dispatchRelease({ url: release.downloadUrl, title: release.title, type: release.type, format: ctx.mediaType, book: ctx.book });
      logger.info(`Acquire: sent ${ctx.mediaType} "${ctx.book.title}" to ${protocol} client from ${release.indexer}`);
      return true;
    } catch (e) {
      logger.warn(`Acquire: ${release.indexer} release failed (${e.message}), trying next`);
    }
  }
  return false;
};

/**
 * Start acquiring a book. Resolves once something has been queued (or every source came up empty);
 * later failures of a queued attempt continue down the list in the background.
 * @param {object} opts { userId, mediaType } — mediaType overrides book.mediaType ("Get Audio" on an ebook entry)
 * @returns {Promise<{queued: boolean, source?: string}>}
 */
const acquireBook = async (book, { userId, mediaType } = {}) => {
  const format = mediaType || book.mediaType || 'ebook';
  if (isBusy(book.id)) return { queued: true, source: 'already running' };
  // Lets auto-search rotate through wanted books (Get / author search count as a search too)
  if (book.update) await book.update({ lastSearchedAt: new Date() }).catch(() => {});

  const order = await getEnabledOrder(format);
  const ctx = { book, mediaType: format, userId };

  // Each step returns true if it queued a download
  const steps = [];
  for (const id of order) {
    if (id === 'annas') steps.push({ id, run: (onFailed) => require('./annasDownloader').searchAndEnqueue(book, { userId, onFailed }) });
    else if (id === 'usenet' || id === 'torrent') steps.push({ id, run: () => tryIndexers(ctx, id) });
    else if (PIPELINE_SOURCES.includes(id)) {
      // Up to two confident candidates per source, each its own step
      let candidates = null;
      const pick = async (n) => {
        if (!candidates) {
          const { searchSource } = require('./webAudiobookSearch');
          candidates = (await searchSource(id, book.title, book.author?.name || '').catch(() => [])).filter(r => (r.score || 0) >= CONFIDENT);
        }
        return candidates[n];
      };
      for (const n of [0, 1]) {
        steps.push({
          id,
          run: async (onFailed) => {
            const result = await pick(n);
            if (!result) return false;
            return require('./audiobookPipeline').enqueue(book.id, result, { userId, onFailed });
          }
        });
      }
    }
  }

  const finalFailure = async (lastError) => {
    logger.info(`Acquire: no ${format} found for "${book.title}" (${order.map(id => SOURCES[id].label).join(' → ') || 'no sources enabled'}) — left as wanted`);
    if (userId && lastError) {
      const { Notification } = require('../models');
      await Notification.create({ userId, type: 'download_failed', title: 'Not found yet', message: `"${book.title}" (${format}): ${lastError}. Auto-search will keep trying.`, metadata: { bookId: book.id } }).catch(() => {});
    }
  };

  const runFrom = async (i, lastError = null) => {
    for (let s = i; s < steps.length; s++) {
      const step = steps[s];
      try {
        const queued = await step.run((err) => {
          logger.info(`Acquire: ${SOURCES[step.id].label} failed for "${book.title}" (${err}); trying next source`);
          runFrom(s + 1, err).catch(e => logger.error(`Acquire fallback error: ${e.message}`));
        });
        if (queued) {
          logger.info(`Acquire: "${book.title}" (${format}) queued via ${SOURCES[step.id].label}`);
          return { queued: true, source: step.id };
        }
      } catch (e) {
        lastError = e.message;
        logger.warn(`Acquire: ${SOURCES[step.id].label} error for "${book.title}": ${e.message}`);
      }
    }
    await finalFailure(lastError);
    return { queued: false };
  };

  return runFrom(0);
};

module.exports = { acquireBook };
