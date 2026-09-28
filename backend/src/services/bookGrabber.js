// One-click "Get": add a search result to the library and immediately start looking for it
// in the formats chosen by the `auto_get_formats` setting (ebook | audiobook | both).
// "both" creates one Book per format, since each Book row holds a single file.
const { Op, fn, col, where } = require('sequelize');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

// Metadata a search result may carry; anything else in the request is ignored
const COPY_FIELDS = ['title', 'subtitle', 'description', 'isbn10', 'isbn13', 'publishedDate', 'publisher', 'pageCount',
  'language', 'coverUrl', 'googleBooksId', 'goodreadsId', 'rating', 'ratingsCount', 'genres', 'series',
  'seriesPosition', 'amazonAsin', 'amazonUrl', 'narrator'];

const getFormats = async (override) => {
  const choice = override || (await getSetting('auto_get_formats')) || 'both';
  if (choice === 'ebook') return ['ebook'];
  if (choice === 'audiobook') return ['audiobook'];
  return ['ebook', 'audiobook'];
};

const findOrCreateAuthor = async (name) => {
  const { Author } = require('../models');
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = await Author.findOne({ where: where(fn('lower', col('name')), clean.toLowerCase()) });
  return existing || Author.create({ name: clean });
};

// Reuse an existing entry for this title/author/format instead of duplicating it. The title is
// compared case/leading-article/punctuation-insensitively, so "The Russian Cage" reuses an
// existing "Russian Cage" instead of adding a second row.
const findEntry = async (title, authorId, mediaType) => {
  const { Book } = require('../models');
  const { normalizeTitle } = require('../utils/titles');
  const key = normalizeTitle(title);
  if (!key) return null;
  const candidates = await Book.findAll({
    where: {
      authorId: authorId || null,
      [Op.or]: [{ mediaType }, ...(mediaType === 'ebook' ? [{ mediaType: null }] : [])]
    }
  });
  return candidates.find((b) => normalizeTitle(b.title) === key) || null;
};

// Metadata a book row carries; anything else (status, file, download ids...) is not copied
const copyMeta = (source) => {
  const data = {};
  for (const k of COPY_FIELDS) if (source[k] !== undefined && source[k] !== null && source[k] !== '') data[k] = source[k];
  return data;
};

// Look for a book: sources are tried in the user's priority order (Settings → Sources),
// falling through to the next one when a source finds nothing or its download fails
const acquire = async (book, { userId } = {}) => {
  try {
    const { acquireBook } = require('./acquisition');
    return (await acquireBook(book, { userId })).queued;
  } catch (e) {
    logger.error(`Get: search failed for "${book.title}": ${e.message}`);
    return false;
  }
};

/**
 * Add a book (from search results) and start acquiring it.
 * @returns {Promise<{books: Book[], formats: string[]}>}
 */
const grab = async (input, { userId, formats: formatOverride } = {}) => {
  const { Book, Author } = require('../models');
  const title = String(input?.title || '').trim();
  if (!title) throw Object.assign(new Error('title is required'), { status: 400 });

  const authorName = input.author?.name || (typeof input.author === 'string' ? input.author : null) || input.authors?.[0];
  const author = await findOrCreateAuthor(authorName);
  const formats = await getFormats(formatOverride);

  const data = copyMeta(input);
  data.title = title;
  if (data.pageCount != null) data.pageCount = parseInt(data.pageCount, 10) || null;

  const books = [];
  for (const mediaType of formats) {
    // Reuse an existing entry for this title/author/format instead of duplicating it
    let book = await findEntry(title, author ? author.id : null, mediaType);
    if (!book) {
      book = await Book.create({ ...data, authorId: author?.id || null, mediaType, bookType: mediaType, status: 'wanted', monitored: true });
    } else if (book.status === 'ignored') {
      await book.update({ status: 'wanted', monitored: true });
    }
    book = await Book.findByPk(book.id, { include: [{ model: Author, as: 'author' }] });
    books.push(book);
  }

  // Search in the background; the UI gets progress via socket events
  for (const book of books) {
    if (['available', 'downloading', 'reading', 'completed'].includes(book.status)) continue;
    acquire(book, { userId }).catch(() => {});
  }

  logger.info(`Get: "${title}"${author ? ` by ${author.name}` : ''} -> ${formats.join(' + ')}`);
  return { books, formats };
};

/**
 * Make sure an existing book has a row for every format from the `auto_get_formats` setting,
 * creating the missing entry when needed. Used by "Search all wanted", which reuses the entries
 * author monitoring already created: an entry the user set to ignored stays ignored (only the
 * one-click "Get" flow re-enables it, because there the user asked for that exact title).
 * @returns {Promise<Book[]>} one row per format, each with `author` included
 */
const ensureEntries = async (book, formats) => {
  const { Book, Author } = require('../models');
  const entries = [];
  for (const mediaType of formats) {
    if ((book.mediaType || 'ebook') === mediaType) {
      entries.push(book);
      continue;
    }
    let entry = await findEntry(book.title, book.authorId, mediaType);
    if (!entry) {
      entry = await Book.create({
        ...copyMeta(book),
        title: book.title,
        authorId: book.authorId,
        mediaType,
        bookType: mediaType,
        status: 'wanted',
        monitored: true
      });
      logger.info(`Search all wanted: added missing ${mediaType} entry for "${book.title}"`);
    }
    entries.push(await Book.findByPk(entry.id, { include: [{ model: Author, as: 'author' }] }));
  }
  return entries;
};

module.exports = { grab, acquire, getFormats, ensureEntries };
