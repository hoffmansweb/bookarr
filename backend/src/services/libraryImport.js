// Final hand-off for finished downloads: verify, move into the library with a
// consistent name, update the book record, and tell Audiobookshelf to rescan.
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { sanitizeFileName } = require('../utils/httpDownloader');

let io = null;
const setIO = (socketIo) => { io = socketIo; };

// Latest progress per book for in-app jobs (Anna's, audiobook pipeline, TTS), so a
// book opened mid-download shows where it is without waiting for the next event
const lastProgress = new Map();
const emit = (event, payload) => {
  if (event === 'download:progress' && payload?.bookId) {
    lastProgress.set(payload.bookId, { ...payload, at: Date.now() });
    if (['done', 'failed'].includes(payload.stage)) {
      setTimeout(() => lastProgress.delete(payload.bookId), 60000).unref();
    }
  }
  if (io) io.emit(event, payload);
};
const getLastProgress = (bookId) => lastProgress.get(bookId) || null;

const getLibraryFolder = async (mediaType) => {
  const specific = await getSetting(mediaType === 'audiobook' ? 'audiobooks_folder' : 'ebooks_folder');
  return specific || getSetting('books_folder');
};

// Detect the real format of a downloaded ebook from its magic bytes
const sniffEbookFormat = async (filePath) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024);
    await handle.read(buf, 0, 1024, 0);
    if (buf.toString('hex', 0, 4) === '504b0304') {
      return buf.includes('application/epub+zip') ? 'epub' : 'zip';
    }
    if (buf.toString('ascii', 60, 68) === 'BOOKMOBI') return 'mobi';
    if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
    if (/<(!doctype )?html/i.test(buf.toString('utf8', 0, 512))) return 'html';
    return null;
  } finally {
    await handle.close();
  }
};

const moveAcrossDevices = async (src, dest) => {
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV' && e.code !== 'EPERM') throw e;
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
};

/**
 * Move a finished ebook file into the library and mark the book available.
 * Library layout: <ebooks>/<Author>/<Author> - <Title>.<ext>
 */
const importEbook = async (book, sourcePath) => {
  const detected = await sniffEbookFormat(sourcePath);
  if (!detected || detected === 'html' || detected === 'zip') {
    await fs.unlink(sourcePath).catch(() => {});
    throw new Error(detected === 'html' ? 'Download was an HTML page, not a book' : 'Downloaded file is not a valid ebook');
  }

  const libraryFolder = await getLibraryFolder('ebook');
  if (!libraryFolder) throw new Error('No ebooks library folder configured (Settings > General)');

  const authorName = sanitizeFileName(book.author?.name || 'Unknown');
  const destDir = path.join(libraryFolder, authorName);
  let destPath = path.join(destDir, `${authorName} - ${sanitizeFileName(book.title)}.${detected}`);
  await fs.mkdir(destDir, { recursive: true });
  await moveAcrossDevices(sourcePath, destPath);

  if (detected === 'mobi' || detected === 'azw3') {
    try {
      const ebookConverter = require('../utils/ebookConverter');
      destPath = await ebookConverter.convertToEpub(destPath);
      detected = 'epub';
    } catch (err) {
      logger.warn(`Auto-conversion failed, keeping original ${detected} file: ${err.message}`);
    }
  }

  const formats = { ...(book.availableFormats || {}), [detected]: true };
  await book.update({
    status: 'available',
    filePath: destPath,
    mediaType: 'ebook',
    bookType: 'ebook',
    availableFormats: formats,
    downloadName: null,
    downloadId: null,
    // Arrival time for the Dashboard's "New Arrivals" row; a re-import keeps the first one
    importedAt: book.importedAt || new Date()
  });

  logger.info(`Imported ebook: ${book.title} -> ${destPath}`);
  emit('book:updated', { bookId: book.id, status: 'available' });
  notifyAudiobookshelf().catch(() => {});
  
  const { sendWebhook } = require('./webhookService');
  sendWebhook('New Book Downloaded', `${book.title} by ${book.author?.name || 'Unknown'} has been imported.`, book.coverImage);
  
  return destPath;
};

/**
 * Ask Audiobookshelf to rescan its libraries (settings: abs_url, abs_api_key,
 * optional abs_library_ids as a comma-separated list; scans all libraries if unset).
 */
const notifyAudiobookshelf = async () => {
  const baseUrl = (await getSetting('abs_url'))?.replace(/\/+$/, '');
  const apiKey = await getSetting('abs_api_key');
  if (!baseUrl || !apiKey) return;

  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    let ids = ((await getSetting('abs_library_ids')) || '').split(/[\s,]+/).filter(Boolean);
    if (ids.length === 0) {
      const { data } = await axios.get(`${baseUrl}/api/libraries`, { headers, timeout: 10000 });
      ids = (data.libraries || data || []).map(l => l.id);
    }
    for (const id of ids) {
      await axios.post(`${baseUrl}/api/libraries/${encodeURIComponent(id)}/scan`, {}, { headers, timeout: 10000 });
    }
    logger.info(`Audiobookshelf: requested rescan of ${ids.length} librar${ids.length === 1 ? 'y' : 'ies'}`);
  } catch (e) {
    logger.warn(`Audiobookshelf rescan failed: ${e.response?.status || ''} ${e.message}`);
  }
};

module.exports = { setIO, emit, getLastProgress, getLibraryFolder, importEbook, notifyAudiobookshelf, sniffEbookFormat, moveAcrossDevices };
