const { Book, Author } = require('../models');
const UserBooks = require('../models/UserBooks');
const aggregator = require('../services/aggregator');
const amazon = require('../scrapers/amazon');
const amazonAuth = require('../services/amazonAuth');
const { getSetting } = require('./settingsController');
const { Op } = require('sequelize');

// Fields a regular user must not set directly. filePath in particular is served
// verbatim by GET /books/:id/file, so letting any user set it allowed reading
// arbitrary files from the server (e.g. backend/.env).
const ALWAYS_PROTECTED = ['id', 'createdAt', 'updatedAt'];
const ADMIN_ONLY_FIELDS = ['filePath', 'downloadId', 'downloadClientId', 'downloadName', 'chapters'];

const sanitizeBookInput = (body, user) => {
  const data = { ...(body && typeof body === 'object' ? body : {}) };
  ALWAYS_PROTECTED.forEach(k => delete data[k]);
  if (!user || user.role !== 'admin') ADMIN_ONLY_FIELDS.forEach(k => delete data[k]);
  return data;
};

exports.search = async (req, res) => {
  try {
    const { query } = req.query;
    const results = await aggregator.searchAllSources(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, monitored, search, mediaType } = req.query;
    const where = {};
    
    if (status) where.status = status;
    if (monitored !== undefined) where.monitored = monitored === 'true';
    if (mediaType) where.mediaType = mediaType;
    if (search) {
      // Search the local catalogue only: title, author name, ISBNs and series. The
      // author-name match is resolved to author ids first (like the Authors page does
      // for book titles) so the `author` include below is never filtered by the query.
      const like = `%${search}%`;
      const or = [
        { title: { [Op.like]: like } },
        { isbn10: { [Op.like]: like } },
        { isbn13: { [Op.like]: like } },
        { series: { [Op.like]: like } }
      ];
      const authorsMatching = await Author.findAll({
        attributes: ['id'],
        where: { name: { [Op.like]: like } },
        raw: true
      });
      const authorIds = authorsMatching.map((author) => author.id);
      if (authorIds.length) or.push({ authorId: { [Op.in]: authorIds } });
      where[Op.or] = or;
    }

    const books = await Book.findAll({
      where,
      include: [{ model: Author, as: 'author' }],
      order: [['createdAt', 'DESC']]
    });

    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id, {
      include: [{ model: Author, as: 'author' }]
    });
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Get user-specific data if authenticated
    if (req.user) {
      const userBook = await UserBooks.findOne({
        where: { UserId: req.user.id, BookId: book.id }
      });
      
      if (userBook) {
        book.dataValues.lastPosition = userBook.lastPosition;
        book.dataValues.lastReadingPosition = userBook.lastReadingPosition;
        book.dataValues.ttsPosition = userBook.ttsPosition;
        book.dataValues.ttsCharPosition = userBook.ttsCharPosition;
        book.dataValues.starred = userBook.starred;
        book.dataValues.progress = userBook.progress;
      }
    }

    res.json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const bookData = sanitizeBookInput(req.body, req.user);
    
    if (bookData.googleBooksId) {
      const enriched = sanitizeBookInput(await aggregator.enrichBookData(bookData), req.user);
      Object.assign(bookData, enriched);
    }

    const book = await Book.create(bookData);
    res.status(201).json(book);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// One-click "Get" from search results: add + start searching per the auto_get_formats setting
exports.grab = async (req, res) => {
  try {
    const { grab } = require('../services/bookGrabber');
    const { formats, ...bookData } = req.body || {};
    const result = await grab(bookData, { userId: req.user?.id, formats });
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

// Add every book in a series: re-search for the series name, keep the results that
// actually name it, and grab each one (grab() reuses existing entries, so this is idempotent).
exports.addSeries = async (req, res) => {
  try {
    const { series, author } = req.body || {};
    const name = String(series || '').trim();
    if (!name) return res.status(400).json({ error: 'Series name is required' });

    const query = author ? `${name} ${author}` : name;
    const results = await aggregator.searchAllSources(query);

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(name);
    const inSeries = results.filter((b) => b.series && norm(b.series) === target);
    // A series search can return standalone hits too; prefer the books that name the series,
    // but fall back to every result when none do (e.g. a series with no scraped name).
    const pool = inSeries.length ? inSeries : results;

    const { grab } = require('../services/bookGrabber');
    const added = [];
    const seen = new Set();
    for (const book of pool) {
      const key = norm(book.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const { books } = await grab(book, { userId: req.user?.id });
      added.push(...books);
    }

    res.status(201).json({ added: added.length, books: added });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

// Best-effort removal of a partial download for a book: files/folders with an incomplete
// suffix (.part / .aria2) in the download folder whose name matches the book. Queue clients
// (SABnzbd, qBittorrent, ...) keep their incomplete data on the client, so there is nothing to
// remove here — the reset below is what un-sticks those.
const removePartialDownload = async (book) => {
  try {
    const { getSetting } = require('./settingsController');
    const folder = await getSetting('download_folder');
    if (!folder || !fs.existsSync(folder)) return null;

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = [norm(book.title), norm(book.downloadName)].filter(Boolean);
    const matches = (name) => keys.some((k) => k && norm(name).includes(k));
    const PARTIAL = /\.(part|aria2)$/i;
    const removed = [];

    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!matches(entry.name)) continue;
      const full = path.join(folder, entry.name);
      try {
        if (entry.isFile() && PARTIAL.test(entry.name)) {
          fs.unlinkSync(full);
          removed.push(entry.name);
        } else if (entry.isDirectory()) {
          const inner = fs.readdirSync(full);
          if (inner.length && inner.every((f) => PARTIAL.test(f))) {
            fs.rmSync(full, { recursive: true, force: true });
            removed.push(`${entry.name}/`);
          }
        }
      } catch (err) { /* best effort */ }
    }
    return removed.length ? removed.join(', ') : null;
  } catch (e) {
    return null;
  }
};

// Manually clear a book stuck at "downloading": reset it to wanted so auto-search can try again,
// and drop any partial file left in the download folder. Does not touch a finished file.
exports.cancelDownload = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (book.status !== 'downloading') return res.status(400).json({ error: 'Book is not downloading' });

    const removed = await removePartialDownload(book);

    const meta = book.metadata || {};
    const failedReleases = book.downloadName
      ? [...new Set([...(meta.failedReleases || []), book.downloadName])].slice(-20)
      : (meta.failedReleases || []);

    await book.update({
      status: 'wanted',
      downloadId: null,
      downloadName: null,
      downloadClientId: null,
      lastSearchedAt: null,
      metadata: { ...meta, failedReleases, downloadStartedAt: null, currentRelease: null }
    });

    res.json({
      message: removed ? `Download cancelled; removed ${removed}` : 'Download cancelled',
      status: 'wanted'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await book.update(sanitizeBookInput(req.body, req.user));
    res.json(book);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await book.destroy();
    res.json({ message: 'Book deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const fs = require('fs');
const path = require('path');

// A library can move: a drive letter changes, a share is renamed, or the machine
// hosting it is switched off. LIBRARY_PATH_REMAP re-points stored roots at serve
// time so the whole catalogue keeps working without rewriting every row, e.g.
//   LIBRARY_PATH_REMAP=\\192.168.1.76\j\ebooks=D:\ebooks;\\Desktop-6m9k4qs\h\Calibre=D:\Calibre
const normalizeForCompare = (value) => value.replace(/\//g, '\\').toLowerCase();

const LIBRARY_PATH_REMAP = (process.env.LIBRARY_PATH_REMAP || '')
  .split(';')
  .map(entry => entry.split('='))
  .filter(parts => parts.length === 2 && parts[0].trim() && parts[1].trim())
  .map(([from, to]) => ({ key: normalizeForCompare(from.trim()), to: to.trim() }));

// Every path the stored filePath could live at right now (remapped roots first).
const pathCandidates = (filePath) => {
  const candidates = [];
  const normalized = filePath.replace(/\//g, '\\');
  const key = normalized.toLowerCase();

  for (const { key: fromKey, to } of LIBRARY_PATH_REMAP) {
    if (key.startsWith(fromKey)) {
      const suffix = normalized.slice(fromKey.length).replace(/^\\+/, '');
      candidates.push(suffix ? path.join(to, suffix) : to);
    }
  }

  candidates.push(filePath);
  return candidates;
};

// Resolve a stored filePath against the filesystem, or null when nothing is reachable.
const resolveBookFile = (filePath) => {
  if (!filePath) return null;

  for (const candidate of pathCandidates(filePath)) {
    try {
      // A dead share can throw instead of answering false, so keep trying.
      if (fs.existsSync(candidate)) return candidate;
    } catch (error) {
      console.log(`[File] Path unreachable: ${candidate} (${error.message})`);
    }
  }

  return null;
};

// Why a book can or cannot be read, in a shape the reader UI can show verbatim.
const inspectBookFile = (book) => {
  if (!book) {
    return { available: false, code: 'BOOK_NOT_FOUND', reason: 'This book is no longer in the catalogue.' };
  }

  if (!book.filePath) {
    return { available: false, code: 'NO_FILE_LINKED', reason: 'No file is linked to this book yet.' };
  }

  const resolved = resolveBookFile(book.filePath);
  if (!resolved) {
    return {
      available: false,
      code: 'FILE_MISSING',
      reason: 'The linked file cannot be reached. If it lives on a network share, a mapped drive or an external disk, check that this is online and that the path still exists.',
      path: book.filePath,
      tried: pathCandidates(book.filePath)
    };
  }

  try {
    const stats = fs.statSync(resolved);
    return { available: true, resolved, stats, path: book.filePath };
  } catch (error) {
    return {
      available: false,
      code: 'FILE_MISSING',
      reason: `The linked file disappeared before it could be read (${error.message}).`,
      path: book.filePath
    };
  }
};

// Asked by the reader before it downloads anything, so an unreadable book is
// explained up front instead of surfacing as a bare 404.
exports.getFileStatus = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    const info = inspectBookFile(book);

    res.json({
      available: info.available,
      code: info.code || null,
      reason: info.reason || null,
      path: info.path || null,
      resolvedPath: info.resolved || null,
      isDirectory: info.stats ? info.stats.isDirectory() : false,
      size: info.stats && info.stats.isFile() ? info.stats.size : null,
      tried: info.tried || [],
      remapConfigured: LIBRARY_PATH_REMAP.length > 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getFile = async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log('[File] No token provided');
      return res.status(401).json({ error: 'Please authenticate' });
    }

    const jwt = require('jsonwebtoken');
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.log('[File] Invalid token:', error.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    // Tokens of deleted users must not keep working
    const { User } = require('../models');
    if (!decoded?.id || !(await User.findByPk(decoded.id, { attributes: ['id'] }))) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const book = await Book.findByPk(req.params.id);
    const info = inspectBookFile(book);

    if (!info.available) {
      console.log(`[File] ${info.code} for book ${req.params.id}: ${info.path || 'no path linked'}`);
      return res.status(404).json({ error: info.reason, code: info.code, path: info.path || null, tried: info.tried || [] });
    }

    // If it's a directory (MP3 audiobook folder), find the first MP3
    if (info.stats.isDirectory()) {
      console.log('[File] Path is directory, looking for MP3');
      const files = fs.readdirSync(info.resolved);
      const mp3File = files.sort().find(f => f.toLowerCase().endsWith('.mp3'));
      if (!mp3File) {
        console.log('[File] No MP3 files found in directory');
        return res.status(404).json({ error: 'No MP3 files found in this audiobook folder', code: 'NO_MP3_IN_FOLDER', path: info.resolved });
      }
      const fullPath = path.join(info.resolved, mp3File);
      console.log('[File] Serving MP3:', fullPath);
      
      const fs = require('fs');
      const stats = fs.statSync(fullPath);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', stats.size);
      const stream = fs.createReadStream(fullPath);
      stream.on('error', (error) => {
        console.error('[File] Stream error:', error.message);
        if (!res.headersSent) res.status(500).json({ error: error.message });
      });
      return stream.pipe(res);
    }

    console.log('[File] Serving file:', info.resolved);

    // Set content type based on file extension
    const ext = info.resolved.toLowerCase().split('.').pop();
    const contentTypes = {
      'epub': 'application/epub+zip',
      'pdf': 'application/pdf',
      'mobi': 'application/x-mobipocket-ebook',
      'mp3': 'audio/mpeg',
      'm4b': 'audio/mp4',
      'aac': 'audio/aac'
    };

    if (contentTypes[ext]) {
      res.setHeader('Content-Type', contentTypes[ext]);
      res.setHeader('Content-Disposition', 'inline');
    }
    
    res.setHeader('Accept-Ranges', 'bytes');
    const fileSize = info.stats.size;
    const range = req.headers.range;

    const fs = require('fs');

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunksize);

      const stream = fs.createReadStream(info.resolved, { start, end });
      stream.on('error', (error) => {
        console.error('[File] Stream error:', error.message);
        if (!res.headersSent) res.status(500).json({ error: error.message });
      });
      return stream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      const stream = fs.createReadStream(info.resolved);
      stream.on('error', (error) => {
        console.error('[File] Stream error:', error.message);
        if (!res.headersSent) res.status(500).json({ error: error.message });
      });
      return stream.pipe(res);
    }
  } catch (error) {
    console.error('[File] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.addToLibrary = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await req.user.addLibrary(book);
    res.json({ message: 'Book added to library' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getLibrary = async (req, res) => {
  try {
    const books = await req.user.getLibrary({
      include: [{ model: Author, as: 'author' }],
      through: { attributes: ['starred', 'progress', 'lastRead'] }
    });
    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStarred = async (req, res) => {
  try {
    const starredEntries = await UserBooks.findAll({
      where: { UserId: req.user.id, starred: true }
    });
    
    if (starredEntries.length === 0) {
      return res.json([]);
    }
    
    const bookIds = starredEntries.map(e => e.BookId);
    const books = await Book.findAll({
      where: { id: bookIds },
      include: [{ model: Author, as: 'author' }]
    });
    
    // BookCard reads book.UserBooks.starred for its star; these rows are starred by definition
    // (and auto-starred books arrive here without a through-row), so hand the flag over.
    res.json(books.map(b => ({ ...b.toJSON(), UserBooks: { starred: true } })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getContinueReading = async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findByPk(req.user.id);
    const books = await user.getLibrary({
      where: {
        '$UserBooks.progress$': { [Op.gt]: 0, [Op.lt]: 100 },
        bookType: { [Op.in]: ['ebook', 'physical'] }
      },
      include: [{ model: Author, as: 'author' }],
      through: { attributes: ['starred', 'progress', 'lastRead'] }
    });
    res.json(books);
  } catch (error) {
    console.error('Get continue reading error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getContinueListening = async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findByPk(req.user.id);
    const books = await user.getLibrary({
      where: {
        '$UserBooks.progress$': { [Op.gt]: 0, [Op.lt]: 100 },
        bookType: 'audiobook'
      },
      include: [{ model: Author, as: 'author' }],
      through: { attributes: ['starred', 'progress', 'lastRead'] }
    });
    res.json(books);
  } catch (error) {
    console.error('Get continue listening error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Dashboard "New Arrivals": books whose file landed recently, newest first. Sorted by
// importedAt - not createdAt/updatedAt - so refreshing metadata on an old book cannot make it
// look new again (see the note on the column in models/Book.js).
exports.getRecentArrivals = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
    const days = parseInt(req.query.days, 10);

    // New Arrivals = books whose file actually landed. A catalogue entry with no downloaded
    // file yet (wanted/downloading, blank cover) must never show up here, so require a filePath.
    const hasFile = { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] };
    // ?days=30 limits the row to the last month; without it every arrival is eligible
    const where = Number.isInteger(days) && days > 0
      ? { filePath: hasFile, importedAt: { [Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
      : { filePath: hasFile, importedAt: { [Op.ne]: null } };

    const books = await Book.findAll({
      where,
      include: [{ model: Author, as: 'author' }],
      order: [['importedAt', 'DESC']],
      limit
    });

    // BookCard reads book.UserBooks.starred for its star
    const starredEntries = await UserBooks.findAll({
      where: { UserId: req.user.id, starred: true },
      attributes: ['BookId']
    });
    const starred = new Set(starredEntries.map(entry => entry.BookId));

    res.json(books.map(book => ({ ...book.toJSON(), UserBooks: { starred: starred.has(book.id) } })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.toggleStar = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const userBook = await UserBooks.findOne({
      where: { UserId: req.user.id, BookId: book.id }
    });

    if (!userBook) {
      await UserBooks.create({ UserId: req.user.id, BookId: book.id, starred: true });
      return res.json({ starred: true });
    }

    const starred = !userBook.starred;
    await userBook.update({ starred });
    res.json({ starred });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateBookProgress = async (req, res) => {
  try {
    const { progress, status } = req.body;
    const userBook = await UserBooks.findOne({
      where: { UserId: req.user.id, BookId: req.params.id }
    });

    if (!userBook) {
      return res.status(404).json({ error: 'Book not in library' });
    }

    const updates = { lastRead: new Date() };
    if (progress !== undefined) updates.progress = progress;
    if (status !== undefined) updates.status = status;

    await userBook.update(updates);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getAmazonBestsellers = async (req, res) => {
  try {
    const books = await amazon.getBestsellerList();
    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAmazonNewReleases = async (req, res) => {
  try {
    const books = await amazon.getNewReleases();
    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAmazonMyBooks = async (req, res) => {
  const io = req.app.get('io');
  // Everything the Settings → Amazon animation shows is driven by these events.
  const emit = (payload) => { if (io) io.emit('amazon:progress', payload); };
  const startedAt = Date.now();
  const { fn, col, where } = require('sequelize');
  const quickMetadata = require('../services/quickMetadata');

  // Find an ASIN for an entry the library page didn't expose one for (Kindle store first)
  const findAsin = async (book) => {
    const query = [quickMetadata.coreTitle(book.title), book.author].filter(Boolean).join(' ');
    for (const store of ['digital-text', 'stripbooks']) {
      const hits = await amazon.searchBooks(query, { store }).catch(() => []);
      const hit = hits.find(h => quickMetadata.matches(h, book.title, book.author));
      if (hit) return hit;
    }
    return null;
  };

  const findAuthor = async (name) => {
    const clean = String(name || '').split(/,| and | & /)[0].trim(); // first listed author
    if (!clean) return null;
    return (await Author.findOne({ where: where(fn('lower', col('name')), clean.toLowerCase()) })) || Author.create({ name: clean });
  };

  try {
    const result = await amazonAuth.scrapeMyBooks(emit);
    if (!result.success) {
      // scrapeMyBooks already reported the failure over the socket.
      return res.status(400).json({ error: result.error });
    }

    const total = result.books.length;
    const stats = { found: total, imported: 0, duplicates: 0, skipped: 0, enriched: 0, asinLookedUp: 0 };
    const saved = [];

    for (let i = 0; i < total; i++) {
      const book = { ...result.books[i] };
      const position = { index: i + 1, total };

      if (!book.title) {
        stats.skipped += 1;
        emit({ stage: 'book', ...position, book, action: 'skipped', message: 'Entry has no readable title' });
        continue;
      }

      // No ASIN on the page entry: search Amazon for it by title + author
      if (!book.amazonAsin) {
        emit({ stage: 'lookup', ...position, book, message: `Searching Amazon for the ASIN of "${book.title}"` });
        const hit = await findAsin(book);
        if (hit) {
          book.amazonAsin = hit.amazonAsin;
          book.amazonUrl = hit.amazonUrl;
          book.coverUrl = book.coverUrl || hit.coverUrl;
          book.author = book.author || hit.author;
          stats.asinLookedUp += 1;
        }
      }

      const author = await findAuthor(book.author);

      // Existing entry: same ASIN, or same title by the same author
      const existing = (book.amazonAsin && await Book.findOne({ where: { amazonAsin: book.amazonAsin } })) ||
        await Book.findOne({
          where: {
            [Op.and]: [
              where(fn('lower', col('title')), book.title.toLowerCase()),
              ...(author ? [{ authorId: author.id }] : [])
            ]
          }
        });

      if (existing) {
        stats.duplicates += 1;
        // Backfill Amazon details on the existing record
        const patch = {};
        if (!existing.amazonAsin && book.amazonAsin) patch.amazonAsin = book.amazonAsin;
        if (!existing.amazonUrl && book.amazonUrl) patch.amazonUrl = book.amazonUrl;
        if (!existing.coverUrl && book.coverUrl) patch.coverUrl = book.coverUrl;
        if (!existing.authorId && author) patch.authorId = author.id;
        if (Object.keys(patch).length) await existing.update(patch);
        emit({ stage: 'book', ...position, book, action: 'duplicate', message: `Already in your catalogue as "${existing.title}"` });
        saved.push(existing);
        continue;
      }

      const dbBook = await Book.create({
        title: book.title,
        authorId: author?.id || null,
        coverUrl: book.coverUrl || null,
        amazonUrl: book.amazonUrl || null,
        amazonAsin: book.amazonAsin || null,
        mediaType: 'ebook',
        bookType: 'ebook',
        status: 'wanted',
        monitored: true
      });
      stats.imported += 1;
      emit({
        stage: 'book', ...position, book, action: 'created',
        message: book.amazonAsin
          ? `Added as "wanted"${stats.asinLookedUp && !result.books[i].amazonAsin ? ' (ASIN found by search)' : ''}`
          : 'Added as "wanted" (no ASIN found — matched by title and author)'
      });

      // Metadata from Google Books / Open Library (fast APIs); deeper enrichment is left to the metadata refresh job
      emit({ stage: 'enriching', ...position, book, message: 'Looking up description, ISBN and details' });
      const metadata = await quickMetadata.lookup(book.title, book.author).catch(() => ({}));
      if (book.coverUrl) delete metadata.coverUrl; // Amazon's cover is the right edition
      const fields = Object.keys(metadata);
      if (fields.length) {
        await dbBook.update(metadata);
        stats.enriched += 1;
      }
      emit({ stage: 'enriched', ...position, book, fields, message: fields.length ? `Metadata found (${fields.join(', ')})` : 'No extra metadata found' });
      saved.push(dbBook);
    }

    emit({ stage: 'complete', ...stats, durationMs: Date.now() - startedAt });
    res.json({ imported: stats.imported, books: saved, stats });
  } catch (error) {
    emit({ stage: 'failed', message: error.message, durationMs: Date.now() - startedAt });
    res.status(500).json({ error: error.message });
  }
};

exports.checkAmazonConnection = async (req, res) => {
  try {
    res.json({ connected: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.fetchMetadata = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id, {
      include: [{ model: Author, as: 'author' }]
    });
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const openLibrary = require('../services/openLibrary');
    const searchQuery = book.author ? `${book.title} ${book.author.name}` : book.title;
    
    const olResults = await openLibrary.searchBooks(searchQuery);
    if (olResults.length > 0) {
      const firstResult = olResults[0];
      let details = firstResult;
      
      if (firstResult.isbn13 || firstResult.isbn10) {
        const fullDetails = await openLibrary.getBookByISBN(firstResult.isbn13 || firstResult.isbn10);
        if (fullDetails) details = fullDetails;
      }
      
      await book.update({
        description: details.description || book.description,
        isbn13: details.isbn13 || book.isbn13,
        isbn10: details.isbn10 || book.isbn10,
        pageCount: details.pageCount || book.pageCount,
        publisher: details.publisher || book.publisher,
        publishedDate: details.publishedDate || book.publishedDate,
        coverUrl: details.coverUrl || book.coverUrl,
        language: details.language || book.language
      });
      return res.json({ message: 'Metadata updated', book });
    }
    
    res.status(404).json({ error: 'No metadata found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDownloadProgress = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    // In-app jobs (Anna's Archive, audiobook pipeline, TTS) have no download client
    if (!book.downloadClientId) {
      const last = require('../services/libraryImport').getLastProgress(book.id);
      return res.json(last
        ? { inApp: true, source: last.source, stage: last.stage, percentage: last.percent ?? null, part: last.part, parts: last.parts, chapter: last.chapter, chapters: last.chapters, message: last.message, status: book.status }
        : { percentage: null, status: book.status === 'downloading' ? 'downloading' : 'unknown', inApp: true });
    }
    if (!book.downloadId) return res.json({ percentage: 0, status: 'unknown' });
    
    const { DownloadClient } = require('../models');
    const client = await DownloadClient.findByPk(book.downloadClientId);
    
    if (!client) {
      return res.json({ percentage: 0, status: 'unknown' });
    }
    
    const { getProgress } = require('../services/downloadProgressService');
    const progress = await getProgress(client, book.downloadId);

    // Normalise units for the UI: speed in bytes/s, ETA in seconds ("h:mm:ss" strings from SABnzbd)
    const toSeconds = (eta) => {
      if (eta == null || eta === '') return null;
      if (typeof eta === 'number') return eta >= 8640000 ? null : eta; // qBittorrent uses 8640000 for "infinite"
      const parts = String(eta).split(':').map(Number);
      return parts.every(n => !Number.isNaN(n)) ? parts.reduce((acc, n) => acc * 60 + n, 0) : null;
    };
    res.json({
      ...progress,
      speed: Number(progress.speed) > 0 ? Number(progress.speed) : null,
      etaSeconds: toSeconds(progress.eta),
      clientName: client.name,
      clientType: client.type
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.extractChapters = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    if (!book || !book.filePath) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const { extractChapters } = require('../services/chapterService');
    const chapters = await extractChapters(book.filePath);
    
    await book.update({ chapters });
    res.json({ chapters });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// On by default; Settings → General → "Reading & listening" stores 'false' to turn it off
const autoStarOnStart = async () => {
  const value = await getSetting('auto_star_on_start');
  return value === undefined || value === null || value === '' ? true : value !== 'false';
};

// Has this user already made progress in the book? (Any position saved, by any reader.)
const hasProgress = (userBook) => !!userBook && (
  Number(userBook.lastPosition) > 0 || !!userBook.lastReadingPosition || !!userBook.ttsPosition
);

// Find (or create) this user's row in the User<->Book join table and apply progress to it.
// The two reader endpoints below double as the "you started this book" signal: the reader only
// POSTs after real engagement (>5s of audio, a page turn, or closing the reader), so opening a
// book by accident never stars it. Only the *first* save stars, so un-starring a book afterwards
// sticks even while you keep reading it.
const saveProgress = async (userId, bookId, data) => {
  const [userBook] = await UserBooks.findOrCreate({
    where: { UserId: userId, BookId: bookId },
    defaults: { UserId: userId, BookId: bookId }
  });

  const updates = { ...data };
  let autoStarred = false;
  if (!userBook.starred && !hasProgress(userBook) && await autoStarOnStart()) {
    updates.starred = true;
    autoStarred = true;
  }

  await userBook.update(updates);
  return { userBook, autoStarred };
};

// Audiobooks: listening position (seconds). Also the "started listening" signal.
exports.updateProgress = async (req, res) => {
  try {
    const { position } = req.body;
    const book = await Book.findByPk(req.params.id);
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const { userBook, autoStarred } = await saveProgress(req.user.id, book.id, { lastPosition: position });
    res.json({ success: true, starred: !!userBook.starred, autoStarred });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Ebooks: reading position (EPUB CFI) plus the text-to-speech spot. Also the "started reading" signal.
exports.updateReadingProgress = async (req, res) => {
  try {
    const { position, ttsPosition, ttsCharPosition } = req.body;
    const book = await Book.findByPk(req.params.id);
    
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const updateData = {};
    if (position !== undefined) updateData.lastReadingPosition = position;
    if (ttsPosition !== undefined) updateData.ttsPosition = ttsPosition;
    if (ttsCharPosition !== undefined) updateData.ttsCharPosition = ttsCharPosition;
    
    const { userBook, autoStarred } = await saveProgress(req.user.id, book.id, updateData);
    res.json({ success: true, starred: !!userBook.starred, autoStarred });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
