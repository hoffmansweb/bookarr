const openLibrary = require('./openLibrary');
const googleBooks = require('./googleBooks');
const goodreads = require('../scrapers/goodreads');
const amazon = require('../scrapers/amazon');
const logger = require('../config/logger');

class BookAggregatorService {
  /**
   * Every source, in parallel. `skip` drops sources the caller already queried: the metadata
   * refresh looks Google/Open Library up itself first, and asking them a second time per book is
   * what burned through Google's daily quota (and its search results are the same anyway).
   */
  async searchAllSources(query, { skip = [] } = {}) {
    try {
      const thriftbooks = require('../scrapers/thriftbooks');
      const zlibrary = require('../scrapers/zlibrary');
      const sources = [
        ['google', () => googleBooks.searchBooks(query)],
        ['openlibrary', () => openLibrary.searchBooks(query)],
        ['goodreads', () => goodreads.searchBooks(query)],
        ['amazon', () => amazon.searchBooks(query)],
        ['thriftbooks', () => thriftbooks.searchBooks(query)],
        ['zlibrary', () => zlibrary.searchBooks(query)]
      ].filter(([name]) => !skip.includes(name));

      const results = await Promise.allSettled(sources.map(([, search]) => search()));

      const combined = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value?.length) {
          combined.push(...result.value.map(book => ({
            ...book,
            author: book.author || book.authors?.[0] || null,
            source: sources[index][0]
          })));
        }
      });

      return this.deduplicateBooks(combined);
    } catch (error) {
      logger.error('Search all sources error:', error);
      return [];
    }
  }

  async enrichBookData(book) {
    const enriched = { ...book };

    // Each source is best-effort: one failing (e.g. Z-Library timing out) must not
    // prevent the others from contributing, nor abort the caller.
    if (book.zlibUrl) {
      try {
        const zlibrary = require('../scrapers/zlibrary');
        if (zlibrary.isAvailable()) {
          logger.debug(`Enriching from Z-Library: ${book.title}`);
          const zlibData = await zlibrary.getBookDetails(book.zlibUrl);
          if (zlibData) enriched.zlibData = zlibData;
        }
      } catch (error) {
        logger.warn(`Z-Library enrichment skipped for "${book.title}": ${logger.describeError(error)}`);
      }
    }

    try {
      if (book.isbn13 || book.isbn10) {
        const isbn = book.isbn13 || book.isbn10;
        logger.debug(`Enriching book with ISBN: ${isbn}`);
        const openLibData = await openLibrary.getBookByISBN(isbn);
        if (openLibData) enriched.openLibraryData = openLibData;
      } else if (book.title) {
        logger.debug(`Enriching book by title: ${book.title}`);
        const searchQuery = book.author ? `${book.title} ${book.author}` : book.title;
        const results = await openLibrary.searchBooks(searchQuery, 5);
        if (results[0]) enriched.openLibraryData = results[0];
      }
    } catch (error) {
      logger.warn(`Open Library enrichment skipped for "${book.title}": ${logger.describeError(error)}`);
    }

    if (book.goodreadsId) {
      try {
        logger.debug(`Fetching Goodreads details for ID: ${book.goodreadsId}`);
        const goodreadsData = await goodreads.getBookDetails(book.goodreadsId);
        if (goodreadsData) enriched.goodreadsData = goodreadsData;
      } catch (error) {
        logger.warn(`Goodreads enrichment skipped for "${book.title}": ${logger.describeError(error)}`);
      }
    }

    return this.mergeBookData(enriched);
  }

  /**
   * The author's full bibliography. Goodreads' author book list is paginated and complete
   * (the old book *search* returned ~20 results, capping every author at 20 books). Open
   * Library's author search is the fallback when Goodreads is unavailable.
   * @param {string} authorName
   * @param {object} [opts] { goodreadsId } known Goodreads author id (skips the lookup)
   */
  /**
   * A Goodreads author list includes far more than the author's books: translations, combined
   * "A / B" editions, box sets, format-tagged duplicates, Reader's Digest volumes and
   * anthologies (Nicholas Sparks: 393 entries for ~30 real books). Keep the real works.
   */
  cleanBibliography(books, authorName) {
    const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Combined editions ("A / B", "A/B"), format tags ("[Paperback]"), sets, compilations ("#1-3"),
    // translated volume labels ("Band Eins", "Tome 2") and other non-book entries
    const JUNK = /\/|\[[^\]]*\]|box(ed)?\s*set|books?\s*set|series set|\bset\s*$|\bset\b.*\bbooks?\b|collection|omnibus|bundle|reader'?s digest|select editions|sampler|excerpt|preview|summary of|study guide|coloring book|journal\b|boxset|#\s*\d+\s*[-–]\s*\d+|\b(band|tome|libro|livre|teil|deel)\s+(\d+|eins|zwei|drei|vier|un|deux|trois|uno|dos|tres)\b/i;
    const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/;
    const thisYear = new Date().getFullYear();

    // 1) pattern filters; the author must be the (first) credited author
    const kept = books.filter(b => {
      if (!b.title || JUNK.test(b.title) || NON_LATIN.test(b.title)) return false;
      if (b.authors?.length && norm(b.authors[0]) !== norm(authorName)) return false;
      return true;
    });

    // 2) merge duplicate editions ("The Best of Me (Movie Tie-In)" / "Best Of Me"), keep the most rated
    const byTitle = new Map();
    for (const b of kept) {
      const key = norm(b.title.replace(/\((movie|tv)[^)]*\)|\b(movie|tv)\s*tie[- ]?in\b/gi, '').replace(/^(the|a|an)\s+/i, ''));
      const prev = byTitle.get(key);
      if (!prev || (b.ratingsCount || 0) > (prev.ratingsCount || 0)) byTitle.set(key, b);
    }
    let unique = [...byTitle.values()];

    // Two-in-one editions: "The Last Song and A Walk to Remember" where both halves are other works
    const titleKeys = new Set(unique.map(b => norm(b.title)));
    unique = unique.filter(b => {
      const parts = b.title.split(/\s+(?:and|&)\s+/i);
      return !(parts.length === 2 && parts.every(p => titleKeys.has(norm(p))));
    });

    // 3) popularity floor relative to this author's own popularity; recent/upcoming books are exempt
    const counts = unique.map(b => b.ratingsCount || 0).sort((a, b) => b - a);
    const reference = counts[Math.min(4, counts.length - 1)] || 0;
    const floor = Math.min(1000, Math.max(3, Math.round(reference * 0.01)));
    const result = unique.filter(b => {
      const year = parseInt(b.publishedDate, 10);
      if (year && year >= thisYear - 1) return true;
      return (b.ratingsCount || 0) >= floor;
    });

    logger.info(`Bibliography for ${authorName}: kept ${result.length} of ${books.length} Goodreads entries (rating floor ${floor})`);
    return result;
  }

  async getAuthorBooks(authorName, { goodreadsId } = {}) {
    const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(authorName);

    const authorId = goodreadsId || await goodreads.findAuthorId(authorName).catch(() => null);
    let books = authorId ? await goodreads.getAuthorBooks(authorId, { authorName }) : [];
    books = this.cleanBibliography(books.map(b => ({ ...b, source: 'goodreads' })), authorName);

    if (books.length === 0) {
      // Fallback: Open Library, paged, only works credited to this exact author
      const seen = new Set();
      for (let offset = 0; offset < 500; offset += 100) {
        const page = await openLibrary.searchBooks(`author:"${authorName.replace(/"/g, '')}"`, 100, offset).catch(() => []);
        for (const b of page) {
          const key = norm(b.title);
          if (!key || seen.has(key) || !(b.authors || []).some(a => norm(a) === target)) continue;
          seen.add(key);
          books.push({ ...b, source: 'openlibrary' });
        }
        if (page.length < 100) break;
      }
      if (books.length === 0) {
        // Last resort: the old keyword search
        books = (await goodreads.searchBooks(authorName).catch(() => [])).map(b => ({ ...b, source: 'goodreads' }));
      }
    }
    return { books, goodreadsId: authorId || null };
  }

  async getAuthorInfo(authorName) {
    // Rejects site graphics (e.g. Amazon's "Follow" banner) and "no photo" placeholders
    const { isLikelyAuthorPhoto } = require('../utils/authorImage');
    const authorInfo = { name: authorName, bio: null, imageUrl: null, website: null, goodreadsId: null };
    try {
      // 1. Try Goodreads
      try {
        const grData = await goodreads.getAuthorInfo(authorName);
        if (grData) {
          if (grData.bio) authorInfo.bio = grData.bio;
          if (isLikelyAuthorPhoto(grData.imageUrl)) authorInfo.imageUrl = grData.imageUrl;
          if (grData.website) authorInfo.website = grData.website;
        }
      } catch (grErr) {
        logger.error('Goodreads author fetch error:', grErr.message);
      }
      
      // 2. If we are missing imageUrl or bio, try Amazon
      if (!authorInfo.imageUrl || !authorInfo.bio) {
        try {
          const amazonAuthor = require('../scrapers/amazonAuthor');
          const amzData = await amazonAuthor.getAuthorInfo(authorName);
          if (amzData) {
            if (!authorInfo.bio && amzData.bio) authorInfo.bio = amzData.bio;
            if (!authorInfo.imageUrl && isLikelyAuthorPhoto(amzData.imageUrl)) authorInfo.imageUrl = amzData.imageUrl;
          }
        } catch (amzErr) {
          logger.error('Amazon author fetch error:', amzErr.message);
        }
      }
      
      // 3. If we are still missing imageUrl or bio or website, try Open Library
      if (!authorInfo.imageUrl || !authorInfo.bio || !authorInfo.website || !authorInfo.goodreadsId) {
        try {
          const olData = await openLibrary.getAuthorInfo(authorName);
          if (olData) {
            if (!authorInfo.bio && olData.bio) authorInfo.bio = olData.bio;
            if (!authorInfo.imageUrl && isLikelyAuthorPhoto(olData.imageUrl)) authorInfo.imageUrl = olData.imageUrl;
            if (!authorInfo.website && olData.website) authorInfo.website = olData.website;
            if (!authorInfo.goodreadsId && olData.goodreadsId) authorInfo.goodreadsId = olData.goodreadsId;
          }
        } catch (olErr) {
          logger.error('Open Library author fetch error:', olErr.message);
        }
      }
      
      if (authorInfo.bio || authorInfo.imageUrl || authorInfo.website || authorInfo.goodreadsId) {
        return authorInfo;
      }
      return null;
    } catch (error) {
      logger.error('Author info error:', error);
      return null;
    }
  }

  mergeBookData(enriched) {
    const merged = {};
    const sources = [enriched, enriched.zlibData, enriched.openLibraryData, enriched.goodreadsData];

    sources.forEach(source => {
      if (source) {
        Object.keys(source).forEach(key => {
          if (!merged[key] && source[key]) {
            merged[key] = source[key];
          }
        });
      }
    });

    // Normalise source-specific field names onto the Book model's fields
    if (!merged.genres && Array.isArray(merged.categories) && merged.categories.length) merged.genres = merged.categories;
    if (merged.isbn && !merged.isbn13 && !merged.isbn10) {
      const digits = String(merged.isbn).replace(/[^0-9Xx]/g, '');
      if (digits.length === 13) merged.isbn13 = digits;
      else if (digits.length === 10) merged.isbn10 = digits;
    }
    if (merged.pageCount && typeof merged.pageCount === 'string') {
      const n = parseInt(merged.pageCount, 10);
      merged.pageCount = Number.isFinite(n) ? n : undefined;
    }
    delete merged.zlibData;
    delete merged.openLibraryData;
    delete merged.goodreadsData;

    return merged;
  }

  deduplicateBooks(books) {
    const entries = []; // Array of merged book objects
    const keyIndex = new Map(); // Maps any key -> index in entries array

    const normalizeTitle = (title) => (title || '').toLowerCase()
      .replace(/\(.*?\)/g, '') // remove parenthetical
      .replace(/[:\-\u2013\u2014\[\]{}#,.!?'"\/]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const getKeys = (book) => {
      const keys = [];
      if (book.amazonAsin) keys.push('asin:' + book.amazonAsin);
      if (book.googleBooksId) keys.push('gb:' + book.googleBooksId);
      if (book.goodreadsId) keys.push('gr:' + book.goodreadsId);
      // Title-based key (primary dedup - merges editions)
      const nt = normalizeTitle(book.title);
      if (nt) keys.push('t:' + nt);
      return keys;
    };

    books.forEach(book => {
      const keys = getKeys(book);
      let matchIdx = null;

      for (const k of keys) {
        if (keyIndex.has(k)) {
          matchIdx = keyIndex.get(k);
          break;
        }
      }

      if (matchIdx == null) {
        // New unique book
        const idx = entries.length;
        entries.push({ ...book });
        keys.forEach(k => keyIndex.set(k, idx));
      } else {
        // Merge into existing
        const existing = entries[matchIdx];
        // Fill missing fields from new source
        Object.keys(book).forEach(k => {
          if ((existing[k] == null || existing[k] === '') && book[k] != null && book[k] !== '') {
            existing[k] = book[k];
          }
        });
        // Prefer longer description
        if (book.description && (!existing.description || book.description.length > existing.description.length)) {
          existing.description = book.description;
        }
        // Prefer coverUrl
        if (book.coverUrl && !existing.coverUrl) existing.coverUrl = book.coverUrl;
        // Keep zlibUrl
        if (book.zlibUrl) existing.zlibUrl = book.zlibUrl;
        // Register new keys
        keys.forEach(k => { if (!keyIndex.has(k)) keyIndex.set(k, matchIdx); });
      }
    });

    return entries;
  }
}

module.exports = new BookAggregatorService();
