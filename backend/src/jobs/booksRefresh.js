const { Book } = require('../models');
const aggregator = require('../services/aggregator');
const logger = require('../config/logger');

let io;
let isRunning = false;

// Books whose metadata can't be completed would otherwise be re-scraped from
// every source every 2 hours. Only retry a given book once per week.
const RETRY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const setIO = (socketIO) => { io = socketIO; };

const refreshBooksMetadata = async () => {
  if (isRunning) return 'Already running';
  isRunning = true;
  if (io) io.emit('job:status', { job: 'booksRefresh', status: 'running' });
  
  try {
    logger.info('Starting books metadata refresh...');
    const { Author } = require('../models');
    const quickMetadata = require('../services/quickMetadata');
    const books = await Book.findAll({ include: [{ model: Author, as: 'author', attributes: ['name'] }], raw: true, nest: true });
    
    let updated = 0;
    let skipped = 0;
    for (const book of books) {
      try {
        // Parse genres safely since it may contain invalid JSON in SQLite
        let genres = null;
        try { genres = typeof book.genres === 'string' ? JSON.parse(book.genres) : book.genres; } catch(e) {}
        
        if (book.description && book.coverUrl && book.rating && genres && book.pageCount && book.publisher) {
          skipped++;
          continue;
        }

        let meta = {};
        try { meta = (typeof book.metadata === 'string' ? JSON.parse(book.metadata) : book.metadata) || {}; } catch (e) { meta = {}; }
        if (typeof meta !== 'object' || Array.isArray(meta)) meta = {};
        const lastAttempt = meta.lastMetadataRefresh ? Date.parse(meta.lastMetadataRefresh) : 0;
        if (lastAttempt && Date.now() - lastAttempt < RETRY_INTERVAL_MS) {
          skipped++;
          continue;
        }
        const attemptMeta = { ...meta, lastMetadataRefresh: new Date().toISOString() };
        
        const authorName = book.author?.name || '';

        // 1) Fast APIs (Google Books / Open Library), only accepting a title + author match
        let enriched = await quickMetadata.lookup(book.title, authorName).catch(() => ({}));

        // 2) Browser scrapers only if key fields are still missing — and still require a match,
        //    so another book's description/cover can never be applied to this one
        if (!(enriched.description || book.description) || !(enriched.coverUrl || book.coverUrl)) {
          // Google/Open Library were just queried by quickMetadata above; only the scrapers add
          // anything here, and re-asking the APIs burned Google's daily quota (its 429s)
          const results = await aggregator.searchAllSources(`${book.title} ${authorName}`.trim(), { skip: ['google', 'openlibrary'] });
          const match = results.find(r => quickMetadata.matches(r, book.title, authorName));
          if (match) enriched = { ...(await aggregator.enrichBookData(match)), ...enriched };
        }

        const patch = {};
        for (const k of ['description', 'coverUrl', 'rating', 'ratingsCount', 'pageCount', 'publisher', 'isbn13', 'isbn10', 'publishedDate']) {
          if (!book[k] && enriched[k]) patch[k] = enriched[k];
        }
        if (!genres && enriched.genres) patch.genres = enriched.genres;
        await Book.update({ ...patch, metadata: attemptMeta }, { where: { id: book.id } });
        if (Object.keys(patch).length) updated++;

        // Be gentle with the metadata sites and the shared headless browser
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        logger.warn(`Failed to refresh book ${book.title}: ${logger.describeError(error)}`);
      }
    }
    
    logger.info(`Books metadata refresh complete. Updated: ${updated}, Skipped: ${skipped}, Total: ${books.length}`);
    return `Updated ${updated} of ${books.length} books (${skipped} complete or retried recently)`;
  } catch (error) {
    logger.error('Books metadata refresh error:', error);
  } finally {
    isRunning = false;
    if (io) io.emit('job:status', { job: 'booksRefresh', status: 'idle' });
  }
};

const getStatus = () => ({ job: 'booksRefresh', status: isRunning ? 'running' : 'idle' });

// Scheduled by jobs/index.js
module.exports = { refreshBooksMetadata, setIO, getStatus };
