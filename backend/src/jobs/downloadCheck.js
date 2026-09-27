const fs = require('fs');
const path = require('path');
const { Book, DownloadClient, Author } = require('../models');
const { getCompletedDownloads, moveFile, deleteFromHistory } = require('../services/downloadClientService');
const { getSetting } = require('../controllers/settingsController');
const { importEbook, getLibraryFolder, notifyAudiobookshelf } = require('../services/libraryImport');
const logger = require('../config/logger');

const BOOK_FILE_RE = /\.(epub|mobi|azw3|pdf|m4b|mp3|m4a)$/i;
const IN_APP_PREFIXES = ['Anna\'s Archive:', 'Audiobook:'];

// Rate-limit repeated warnings (e.g. an unreachable network share) to once per 30 min
const lastWarned = new Map();
const warnOnce = (key, msg) => {
  if (Date.now() - (lastWarned.get(key) || 0) < 30 * 60 * 1000) return;
  lastWarned.set(key, Date.now());
  logger.warn(msg);
};

const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Does a client item look like this book? Requires most significant title words.
const looksLike = (itemName, book) => {
  const name = normalize(itemName);
  const words = normalize(book.title).split(' ').filter(w => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w));
  if (!words.length) return name.includes(normalize(book.title));
  const hits = words.filter(w => name.includes(w)).length;
  return hits / words.length >= 0.75;
};

const idMatches = (item, downloadId) => {
  if (!downloadId) return false;
  const id = String(downloadId).toLowerCase();
  return [item.hash, item.nzo_id, item.nzbid, item.id]
    .filter(v => v != null)
    .some(v => {
      const s = String(v).toLowerCase();
      return s === id || (id.length >= 20 && s.startsWith(id)); // older records stored a 20-char hash prefix
    });
};

// Books downloaded in-process (Anna's Archive / audiobook pipeline) lose their job on restart
const resetOrphanedInAppDownloads = async (books) => {
  const annasDownloader = require('../services/annasDownloader');
  const audiobookPipeline = require('../services/audiobookPipeline');
  for (const book of books) {
    if (book.downloadClientId || !IN_APP_PREFIXES.some(p => (book.downloadName || '').startsWith(p))) continue;
    if (annasDownloader.isActive(book.id) || audiobookPipeline.isActive(book.id)) continue;
    logger.warn(`Resetting orphaned download "${book.title}" to wanted (app restarted mid-download)`);
    await book.update({ status: 'wanted', downloadName: null, downloadId: null });
  }
};

const EBOOK_RE = /\.(epub|azw3|mobi|pdf)$/i;
const EBOOK_RANK = { '.epub': 0, '.azw3': 1, '.mobi': 2, '.pdf': 3 };
// Release clutter that may be left behind in a download folder after the book is taken out
const JUNK_FILE_RE = /\.(nfo|sfv|srr|srs|jpe?g|png|txt|url|nzb|par2|md5|db)$/i;

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// Best ebook inside a download folder (2 levels deep): EPUB > AZW3 > MOBI > PDF, largest first
const findEbookInFolder = (dir, depth = 0) => {
  let found = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && EBOOK_RE.test(e.name) && !/sample/i.test(e.name)) {
      found.push({ full, rank: EBOOK_RANK[path.extname(e.name).toLowerCase()], size: fs.statSync(full).size });
    } else if (e.isDirectory() && depth < 1) {
      const inner = findEbookInFolder(full, depth + 1);
      if (inner) found.push({ full: inner, rank: EBOOK_RANK[path.extname(inner).toLowerCase()], size: fs.statSync(inner).size });
    }
  }
  found = found.sort((a, b) => a.rank - b.rank || b.size - a.size);
  return found[0]?.full || null;
};

// Remove a download folder once the book is out of it — only if nothing but clutter remains
const cleanupDownloadFolder = (dir) => {
  try {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    const left = walk(dir);
    if (left.every(name => JUNK_FILE_RE.test(name))) {
      fs.rmSync(dir, { recursive: true, force: true });
      logger.info(`Removed leftover download folder ${dir}`);
    }
  } catch (e) { /* best effort */ }
};

const importCompletedFile = async (book, sourcePath, altPaths = []) => {
  const paths = [sourcePath, ...altPaths].filter(Boolean);
  if (book.mediaType !== 'audiobook') {
    // The first path from a client is not always the file itself: use whichever candidate is an
    // ebook file really on disk. A release *folder* can be named like a file
    // ("Author-Title.2023.RETAIL.EPUB"), so check it's a file, and look inside folders.
    const ebookPath = paths.find(p => EBOOK_RE.test(p) && isFile(p));
    if (ebookPath) return importEbook(book, ebookPath);
    const folder = paths.find(isDir);
    const inner = folder && findEbookInFolder(folder);
    if (inner) {
      const imported = await importEbook(book, inner);
      cleanupDownloadFolder(folder);
      return imported;
    }
    // Don't fall through to copying a folder as if it were a file (that was the EPERM error):
    // this download simply has no ebook in it (wrong release, or only .nfo/.diz files)
    if (folder || !paths.some(isFile)) {
      throw Object.assign(new Error(`No ebook file found in the download${folder ? ` (${path.basename(folder)})` : ''}`), { noBook: true });
    }
  }
  const authorName = book.author?.name || 'Unknown';
  const libraryFolder = await getLibraryFolder(book.mediaType);
  if (!libraryFolder) throw new Error('No library folder configured');
  const moved = await moveFile(sourcePath, path.join(libraryFolder, authorName), book.title, authorName, altPaths);
  if (!moved) throw new Error('Move failed');
  await book.update({
    status: 'available',
    downloadName: null,
    downloadId: null,
    filePath: moved,
    // Arrival time for the Dashboard's "New Arrivals" row; a re-import keeps the first one
    importedAt: book.importedAt || new Date()
  });
  notifyAudiobookshelf().catch(() => {});
  return moved;
};

// aria2: ask aria2 where the file went, fall back to scanning the download folder
const checkAria2 = async (client, books) => {
  const Aria2Service = require('../services/aria2Service');
  const aria2 = new Aria2Service(client);
  let found = false;

  for (const book of books) {
    let sourcePath = null;
    if (book.downloadId) {
      const status = await aria2.tellStatus(book.downloadId);
      if (status.success) {
        if (status.status === 'error' || status.status === 'removed') {
          logger.warn(`aria2 download failed for "${book.title}" (${status.status})`);
          await book.update({ status: 'wanted', downloadName: null, downloadId: null });
          continue;
        }
        if (status.status !== 'complete') continue;
        sourcePath = status.files?.[0]?.path || null;
      }
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) sourcePath = await findInDownloadFolder(book);
    if (!sourcePath) continue;

    try {
      await importCompletedFile(book, sourcePath);
      logger.info(`✓ aria2 download imported: ${book.title}`);
      if (book.downloadId) await aria2.purgeDownloadResult(book.downloadId);
      found = true;
    } catch (e) {
      logger.error(`Import failed for "${book.title}": ${e.message}`);
      await book.update({ status: 'wanted', downloadName: null, downloadId: null });
    }
  }
  return found;
};

// Look for a finished file named after the book in the shared download folder
// (aria2 / JDownloader2). Category folders are searched too: clients that sort
// downloads into categories put them one level below the download folder.
const findInDownloadFolder = async (book, downloadFolder = null, category = null) => {
  downloadFolder = downloadFolder || await getSetting('download_folder');
  if (!downloadFolder) return null;

  const roots = [downloadFolder];
  if (category && String(category).toLowerCase() !== 'default') roots.push(path.join(downloadFolder, category));

  for (const root of roots) {
    let entries;
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (error) {
      warnOnce(`scan:${root}`, `Cannot read download folder ${root}: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      if (!looksLike(entry.name, book)) continue;
      const full = path.join(root, entry.name);
      if (entry.isFile() && BOOK_FILE_RE.test(entry.name) && !/\.(part|aria2)$/i.test(entry.name) && !fs.existsSync(`${full}.aria2`)) return full;
      if (entry.isDirectory()) {
        const inner = (await fs.promises.readdir(full).catch(() => [])).filter(f => BOOK_FILE_RE.test(f));
        if (inner.length && !inner.some(f => /\.part$/i.test(f))) return full;
      }
    }
  }
  return null;
};

const checkJDownloader = async (client, books) => {
  let found = false;
  for (const book of books) {
    const sourcePath = await findInDownloadFolder(book);
    if (!sourcePath) continue;
    try {
      await importCompletedFile(book, sourcePath);
      logger.info(`✓ JDownloader2 download imported: ${book.title}`);
      found = true;
    } catch (e) {
      logger.error(`Import failed for "${book.title}": ${e.message}`);
    }
  }
  return found;
};

// Imports that keep failing (wrong release, nothing usable on disk) used to retry every minute
// forever. After 3 attempts: mark the release failed, set the book back to wanted.
const importFailures = new Map(); // "bookId|release" -> count
const giveUpAfterFailures = async (book, releaseName, error) => {
  const key = `${book.id}|${releaseName}`;
  const n = (importFailures.get(key) || 0) + 1;
  importFailures.set(key, n);
  if (n < 3) {
    logger.error(`Import failed for "${book.title}" (attempt ${n}/3): ${error.message}`);
    return;
  }
  importFailures.delete(key);
  const meta = book.metadata || {};
  const failedReleases = [...new Set([...(meta.failedReleases || []), releaseName, book.downloadName].filter(Boolean))].slice(-20);
  await book.update({
    status: 'wanted', downloadId: null, downloadName: null, downloadClientId: null, lastSearchedAt: null,
    metadata: { ...meta, failedReleases, downloadStartedAt: null, currentRelease: null }
  });
  logger.warn(`Gave up importing "${book.title}" from "${releaseName}" after 3 attempts (${error.message}); marked the release as failed and set the book back to wanted`);
};

const checkQueueClient = async (client, books) => {
  const completed = (await getCompletedDownloads(client)).filter(i => i.status === 'Completed');
  if (!completed.length) return false;
  const downloadFolder = await getSetting('download_folder');
  const used = new Set();
  let found = false;

  for (const book of books) {
    const match = completed.find(i => !used.has(i) && idMatches(i, book.downloadId)) ||
      completed.find(i => !used.has(i) && book.downloadName && i.name === book.downloadName) ||
      completed.find(i => !used.has(i) && looksLike(i.name, book));
    if (!match) continue;
    used.add(match);
    logger.info(`Match for "${book.title}": ${match.name}`);

    // The client reports several possible locations: use the first one that exists,
    // otherwise look for the book in the download folder / category folder.
    const altPaths = Array.isArray(match.altPaths) ? match.altPaths : [];
    const reportedPaths = [match.path, ...altPaths].filter(Boolean);
    let searchPath = reportedPaths.find(p => fs.existsSync(p)) || match.path ||
      (downloadFolder ? path.join(downloadFolder, match.name) : null);
    let extraPaths = altPaths;

    if (![searchPath, ...extraPaths].some(p => p && fs.existsSync(p))) {
      const fallback = await findInDownloadFolder(book, downloadFolder, match.category);
      if (!fallback) {
        warnOnce(`nodisk:${match.name}`, `Nothing on disk for completed download "${match.name}" (tried ${[...new Set([searchPath, ...extraPaths].filter(Boolean))].join(' | ') || 'no path'})`);
        continue;
      }
      searchPath = fallback;
      extraPaths = [];
    }

    try {
      await importCompletedFile(book, searchPath, extraPaths);
      logger.info(`✓ Book completed and moved: ${book.title}`);
      await deleteFromHistory(client, match);
      found = true;
    } catch (e) {
      await giveUpAfterFailures(book, match.name, e);
    }
  }
  return found;
};

const checkDownloads = async () => {
  try {
    const downloadingBooks = await Book.findAll({
      where: { status: 'downloading' },
      include: [{ model: Author, as: 'author' }]
    });
    if (downloadingBooks.length === 0) return null; // nothing to do: scheduler doesn't record a run

    await resetOrphanedInAppDownloads(downloadingBooks);

    const clients = await DownloadClient.findAll({ where: { enabled: true } });
    let foundAny = false;

    for (const client of clients) {
      // Only books sent to this client (legacy records without a client id are checked everywhere)
      const books = downloadingBooks.filter(b => b.status === 'downloading' &&
        (b.downloadClientId === client.id || (!b.downloadClientId && !IN_APP_PREFIXES.some(p => (b.downloadName || '').startsWith(p)))));
      if (!books.length) continue;

      try {
        let found;
        if (client.type === 'aria2') found = await checkAria2(client, books);
        else if (client.type === 'jdownloader2') found = await checkJDownloader(client, books);
        else found = await checkQueueClient(client, books);
        foundAny = foundAny || found;
      } catch (e) {
        warnOnce(`client:${client.id}`, `Download check failed for ${client.name}: ${e.message}`);
      }
    }

    if (foundAny) {
      logger.info('Running library sync to update file types...');
      const { syncLibrary } = require('./librarySync');
      await syncLibrary();
    }
    const still = await Book.count({ where: { status: 'downloading' } });
    return `${downloadingBooks.length - still > 0 ? `${downloadingBooks.length - still} imported; ` : ''}${still} still downloading`;
  } catch (error) {
    logger.error(`Download check failed: ${error.message}`);
    throw error;
  }
};

/**
 * Downloads handed to a client that never finish (dead torrent, removed from the client, failed NZB)
 * would otherwise sit at "downloading" forever. After `download_stall_hours` (default 48) the release
 * is marked failed for that book and the book goes back to wanted, so auto-search tries a different
 * release or the next source.
 */
const checkStalledDownloads = async () => {
  const hours = Math.max(1, parseFloat(await getSetting('download_stall_hours')) || 48);
  const cutoff = Date.now() - hours * 3600 * 1000;
  const books = await Book.findAll({ where: { status: 'downloading' }, include: [{ model: Author, as: 'author' }] });
  let reset = 0;

  for (const book of books) {
    if (!book.downloadClientId) continue; // in-app jobs are handled by resetOrphanedInAppDownloads
    const meta = book.metadata || {};
    const started = Date.parse(meta.downloadStartedAt || book.updatedAt);
    if (!started || started > cutoff) continue;

    const release = meta.currentRelease || book.downloadName;
    const failedReleases = [...new Set([...(meta.failedReleases || []), release].filter(Boolean))].slice(-20);
    await book.update({
      status: 'wanted',
      downloadId: null,
      downloadName: null,
      downloadClientId: null,
      lastSearchedAt: null, // search it again soon
      metadata: { ...meta, failedReleases, downloadStartedAt: null, currentRelease: null }
    });
    reset++;
    logger.warn(`Download of "${book.title}" (${release}) didn't finish within ${hours}h — marked the release as failed and set the book back to wanted`);
    try {
      const { Notification, User } = require('../models');
      const admins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
      for (const u of admins) {
        await Notification.create({ userId: u.id, type: 'download_failed', title: 'Download stalled', message: `"${book.title}" didn't finish within ${hours}h; Bookarr will try a different release.`, metadata: { bookId: book.id, release } });
      }
    } catch (e) { /* notifications are best-effort */ }
  }
  return reset ? `Reset ${reset} stalled download(s) (older than ${hours}h)` : `No stalled downloads (limit ${hours}h)`;
};

module.exports = { checkDownloads, checkStalledDownloads };
