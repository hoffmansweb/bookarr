// Background download jobs for Anna's Archive: resolve a file link (member API or
// slow partner servers), fetch it with the built-in downloader (or hand it to
// aria2 if `annas_downloader` = aria2), then import it into the library.
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const logger = require('../config/logger');
const annasArchive = require('../scrapers/annasArchive');
const { downloadFile, sanitizeFileName } = require('../utils/httpDownloader');
const { importEbook, emit, getLibraryFolder } = require('./libraryImport');
const { getSetting } = require('../controllers/settingsController');

const MAX_CONCURRENT = 2;
const queue = [];
const active = new Set(); // bookIds currently being processed
let running = 0;

const progress = (bookId, stage, extra = {}) => emit('download:progress', { bookId, source: 'annas', stage, ...extra });

const stagingDir = async () => {
  // Stage next to the library so the final move is a cheap rename
  const lib = await getLibraryFolder('ebook');
  const dir = lib ? path.join(lib, '.bookarr-incoming') : path.join(os.tmpdir(), 'bookarr-incoming');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const sendToAria2 = async (book, url) => {
  const { DownloadClient } = require('../models');
  const client = await DownloadClient.findOne({ where: { enabled: true, type: 'aria2' } });
  if (!client) return false;
  const Aria2Service = require('./aria2Service');
  const aria2 = new Aria2Service(client);
  const filename = `${sanitizeFileName(book.author?.name || 'Unknown')} - ${sanitizeFileName(book.title)}${path.extname(new URL(url).pathname) || '.epub'}`;
  const result = await aria2.addUri(url, { out: filename, referer: new URL(url).origin + '/' });
  if (!result.success) throw new Error(`aria2: ${result.error}`);
  await book.update({ status: 'downloading', downloadName: filename, downloadId: result.gid, downloadClientId: client.id });
  logger.info(`Anna's Archive: handed ${book.title} to aria2 (${result.gid})`);
  return true;
};

const processJob = async ({ bookId, candidates, userId, onFailed }) => {
  const { Book, Author, Notification } = require('../models');
  const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
  if (!book) return { ok: false, error: 'Book not found' };

  await book.update({ status: 'downloading', downloadName: `Anna's Archive: ${book.title}`, downloadClientId: null, downloadId: null });
  emit('book:updated', { bookId, status: 'downloading' });

  const useAria2 = (await getSetting('annas_downloader')) === 'aria2';
  let lastError = null;

  for (const md5 of candidates) {
    try {
      progress(bookId, 'resolving', { md5, message: 'Waiting for Anna\'s Archive download link…' });
      const url = await annasArchive.getDirectDownloadUrl(md5);
      if (!url) throw new Error('Could not get a download link from any server');

      if (useAria2 && await sendToAria2(book, url)) {
        progress(bookId, 'queued', { message: 'Sent to aria2' });
        return { ok: true };
      }

      const ext = (path.extname(decodeURIComponent(new URL(url).pathname)) || '.epub').toLowerCase();
      const tmpPath = path.join(await stagingDir(), `${md5}${ext}`);
      progress(bookId, 'downloading', { percent: 0 });
      await downloadFile(url, tmpPath, {
        headers: { Referer: new URL(url).origin + '/' },
        maxBytes: 500 * 1024 * 1024,
        onProgress: p => progress(bookId, 'downloading', { percent: p.percent, received: p.received, total: p.total })
      });

      progress(bookId, 'importing');
      const finalPath = await importEbook(book, tmpPath);
      progress(bookId, 'done', { path: finalPath });
      if (userId) {
        await Notification.create({ userId, type: 'download_complete', title: 'Download complete', message: `"${book.title}" was added to your library`, metadata: { bookId } }).catch(() => {});
      }
      return { ok: true };
    } catch (error) {
      lastError = error;
      logger.warn(`Anna's Archive download of ${md5} for "${book.title}" failed: ${error.message}`);
    }
  }

  logger.error(`Anna's Archive: giving up on "${book.title}": ${lastError?.message}`);
  await book.update({ status: 'wanted', downloadName: null, downloadId: null });
  emit('book:updated', { bookId, status: 'wanted' });
  // With a fallback, the next source is tried and the final outcome is reported there
  progress(bookId, 'failed', { message: lastError?.message, willRetry: !!onFailed });
  if (userId && !onFailed) {
    await Notification.create({ userId, type: 'download_failed', title: 'Download failed', message: `"${book.title}": ${lastError?.message}`, metadata: { bookId } }).catch(() => {});
  }
  return { ok: false, error: lastError?.message };
};

const pump = () => {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    processJob(job)
      .catch(e => {
        logger.error(`Anna's Archive job crashed: ${e.message}`);
        return { ok: false, error: e.message };
      })
      .then(outcome => {
        running--;
        active.delete(job.bookId);
        pump();
        if (!outcome?.ok && job.onFailed) job.onFailed(outcome?.error);
      })
      .catch(e => logger.error(`Anna's Archive fallback failed: ${e.message}`));
  }
};

/**
 * Queue a download. `candidates` is an ordered list of md5s (best first);
 * later ones are fallbacks if a file can't be fetched.
 * @returns {boolean} false if this book is already queued
 */
const enqueue = (bookId, candidates, { userId, onFailed } = {}) => {
  const list = [...new Set((Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean))];
  if (!list.length) throw new Error('No Anna\'s Archive records to download');
  if (active.has(bookId)) return false;
  active.add(bookId);
  queue.push({ bookId, candidates: list, userId, onFailed });
  pump();
  return true;
};

/**
 * Search Anna's Archive for a book and queue the best matches.
 * @returns {Promise<boolean>} true if something was queued
 */
const searchAndEnqueue = async (book, opts = {}) => {
  const results = await annasArchive.searchBooks(book.title, book.author?.name, { isbn: book.isbn13 || book.isbn10 });
  if (!results.length) return false;
  return enqueue(book.id, results.slice(0, 3).map(r => r.md5), opts);
};

const isActive = (bookId) => active.has(bookId);

module.exports = { enqueue, searchAndEnqueue, isActive };
