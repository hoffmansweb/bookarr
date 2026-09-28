const { Author, Book } = require('../models');
const aggregator = require('../services/aggregator');
const { Op } = require('sequelize');
const { getSetting } = require('./settingsController');
const sequelize = require('../config/database');

exports.getAll = async (req, res) => {
  try {
    const { monitored, search } = req.query;
    const where = {};
    
    if (monitored !== undefined) where.monitored = monitored === 'true';
    if (search) {
      // Name *or* any of the author's book titles: searching a book title on the Authors page
      // should find whoever wrote it, not only authors whose own name contains the words.
      // The title match is resolved to author ids first instead of joining with `$books.title$`,
      // because a `where` key pointing at an included association also filters that include - the
      // card would then count only the matching books ("1 books" for an author who has nineteen).
      const booksMatchingTitle = await Book.findAll({
        attributes: ['authorId'],
        where: { title: { [Op.like]: `%${search}%` } },
        group: ['authorId'],
        raw: true
      });
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { id: { [Op.in]: booksMatchingTitle.map((book) => book.authorId).filter(Boolean) } }
      ];
    }

    const authors = await Author.findAll({
      where,
      include: [{ model: Book, as: 'books' }],
      order: [['name', 'ASC']]
    });

    res.json(authors.map((author) => ({
      ...author.toJSON(),
      // Titles behind a book-title match, so a card whose name has nothing to do with the query
      // can say why it is in the results.
      matchedBooks: search ? titlesMatching(author, search) : []
    })));
  } catch (error) {
    console.error('GET /api/authors error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Titles of this author's books that contain the search text. Capped at three because the card
// shows them on a single line - anything past that would never be read.
const titlesMatching = (author, search) => {
  const needle = String(search).toLowerCase();
  return (author.books || [])
    .filter((book) => (book.title || '').toLowerCase().includes(needle))
    .slice(0, 3)
    .map((book) => book.title);
};

exports.getById = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id, {
      include: [{ model: Book, as: 'books' }]
    });
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    res.json(author);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const author = await Author.create(req.body);
    res.status(201).json(author);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    await author.update(req.body);
    res.json(author);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    // Books and the monitored-author join reference the author, so clear those rows first
    const { UserBooks } = require('../models');
    const books = await Book.findAll({ where: { authorId: author.id }, attributes: ['id'] });
    const bookIds = books.map((b) => b.id);
    if (bookIds.length) {
      await UserBooks.destroy({ where: { BookId: bookIds } });
      await Book.destroy({ where: { id: bookIds } });
    }
    await sequelize.query('DELETE FROM UserAuthors WHERE AuthorId = ?', { replacements: [author.id] });

    await author.destroy();
    res.json({ message: 'Author deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.monitor = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    await author.update({ monitored: true });
    await req.user.addMonitoredAuthors(author);
    
    res.json({ message: 'Author monitoring enabled' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.unmonitor = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    await req.user.removeMonitoredAuthors(author);
    
    const followers = await author.getFollowers();
    if (followers.length === 0) {
      await author.update({ monitored: false });
    }
    
    res.json({ message: 'Author monitoring disabled' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getMonitored = async (req, res) => {
  try {
    const authors = await req.user.getMonitoredAuthors({
      include: [{ model: Book, as: 'books' }]
    });
    res.json(authors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.refreshBooks = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    console.log('Refreshing author:', author.name);

    const authorData = await aggregator.getAuthorInfo(author.name);
    if (authorData) {
      const updates = {
        bio: authorData.bio || author.bio,
        website: authorData.website || author.website,
        goodreadsId: authorData.goodreadsId || author.goodreadsId
      };
      const { isLikelyAuthorPhoto } = require('../utils/authorImage');
      if (isLikelyAuthorPhoto(authorData.imageUrl)) {
        updates.imageUrl = authorData.imageUrl;
      } else if (author.imageUrl && !isLikelyAuthorPhoto(author.imageUrl)) {
        updates.imageUrl = null; // drop a previously scraped banner/placeholder
      }
      await author.update(updates);
    }

    const defaultStatus = await getSetting('default_book_status') || 'wanted';
    // Full bibliography from the Goodreads author book list (paginated). The old keyword
    // search returned ~20 results, so every author stopped at about 20 books.
    const knownId = /^d+$/.test(String(author.goodreadsId || '')) ? author.goodreadsId : undefined;
    const { books: grBooks, goodreadsId: grAuthorId } = await aggregator.getAuthorBooks(author.name, { goodreadsId: knownId });
    if (grAuthorId && grAuthorId !== author.goodreadsId) author.goodreadsId = grAuthorId;
    console.log(`Found ${grBooks.length} works for ${author.name}`);
    
    const createdBooks = [];
    for (const bookData of grBooks) {
      try {
        // Look for existing book by goodreadsId or by title and authorId
        const existing = await Book.findOne({
          where: {
            [Op.or]: [
              bookData.goodreadsId ? { goodreadsId: bookData.goodreadsId } : null,
              { title: bookData.title, authorId: author.id }
            ].filter(Boolean)
          }
        });
        
        let book = existing;
        if (!book) {
          book = await Book.create({
            title: bookData.title,
            subtitle: bookData.subtitle,
            description: 'Grabbing data...',
            isbn10: bookData.isbn10,
            isbn13: bookData.isbn13,
            publishedDate: bookData.publishedDate || null,
            publisher: bookData.publisher,
            pageCount: bookData.pageCount,
            language: bookData.language,
            coverUrl: bookData.coverUrl,
            googleBooksId: bookData.googleBooksId,
            goodreadsId: bookData.goodreadsId,
            rating: bookData.rating,
            ratingsCount: bookData.ratingsCount,
            series: bookData.series || null,
            seriesPosition: bookData.seriesPosition ?? null,
            genres: bookData.genres || bookData.categories,
            status: defaultStatus,
            authorId: author.id
          });
          createdBooks.push({ book, bookData });
        } else {
          // Update existing book if missing details
          const updates = {};
          if (!book.goodreadsId && bookData.goodreadsId) updates.goodreadsId = bookData.goodreadsId;
          if (!book.coverUrl && bookData.coverUrl) updates.coverUrl = bookData.coverUrl;
          if (!book.publishedDate && bookData.publishedDate) updates.publishedDate = bookData.publishedDate;
          if (!book.isbn13 && bookData.isbn13) updates.isbn13 = bookData.isbn13;
          if (!book.isbn10 && bookData.isbn10) updates.isbn10 = bookData.isbn10;
          // Series data only became available in search results later; fill it in when missing
          if (!book.series && bookData.series) {
            updates.series = bookData.series;
            updates.seriesPosition = bookData.seriesPosition ?? null;
          }
          if (Object.keys(updates).length > 0) {
            await book.update(updates);
          }
          
          // Re-enrich descriptions if they were marked as placeholder
          if (!book.description || book.description === 'Grabbing data...') {
            createdBooks.push({ book, bookData });
          }
        }
      } catch (error) {
        console.error(`Failed to process book: ${bookData.title}`, error.message);
      }
    }

    author.lastChecked = new Date();
    await author.save();

    // Return immediately
    res.json({ message: 'Author books refreshed', added: createdBooks.length });

    // Enrich metadata in background. Uses the Google Books / Open Library APIs: per-book browser
    // scraping (Z-Library + Goodreads) took hours for large bibliographies and overloaded the
    // headless browser. The scheduled metadata refresh fills in whatever is still missing.
    (async () => {
      const quickMetadata = require('../services/quickMetadata');
      for (const { book } of createdBooks) {
        try {
          const meta = await quickMetadata.lookup(book.title, author.name).catch(() => ({}));
          const patch = {};
          for (const k of ['description', 'isbn13', 'isbn10', 'publisher', 'pageCount', 'language', 'googleBooksId', 'genres']) {
            if (meta[k] && (!book[k] || book[k] === 'Grabbing data...')) patch[k] = meta[k];
          }
          if (!book.coverUrl && meta.coverUrl) patch.coverUrl = meta.coverUrl;
          if (!patch.description && book.description === 'Grabbing data...') patch.description = null;
          if (Object.keys(patch).length) await book.update(patch);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Failed to enrich book: ${book.title}`, error.message);
          if (book.description === 'Grabbing data...') await book.update({ description: null }).catch(() => {});
        }
      }

      console.log('Metadata enrichment complete');
      
      const { syncLibrary } = require('../jobs/librarySync');
      await syncLibrary(author.id);
    })().catch(err => {
      // Fire-and-forget: without this an error here is an unhandled rejection
      console.error(`Background enrichment for ${author.name} failed:`, err.message);
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Search for every "wanted" entry by this author, one at a time in the background, using the
// download source priority (with fallback). Formats come from Settings → General → "When I click
// Get, look for", so a wanted ebook is searched as an audiobook too (and vice versa) and the
// missing entry is created. Progress goes out on the `author:search` socket event.
const authorSearches = new Map(); // authorId -> { total, done, queued, formats }

exports.searchWanted = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id);
    if (!author) return res.status(404).json({ error: 'Author not found' });
    if (authorSearches.has(author.id)) {
      return res.status(409).json({ error: 'Already searching this author', progress: authorSearches.get(author.id) });
    }

    const wanted = await Book.findAll({ where: { authorId: author.id, status: 'wanted' }, order: [['publishedDate', 'DESC']] });
    if (!wanted.length) return res.json({ total: 0, message: 'No wanted books for this author' });

    // Same formats as the one-click "Get" button; the missing entry is created so both can be searched
    const { getFormats, ensureEntries } = require('../services/bookGrabber');
    const formats = await getFormats();
    const queue = [];
    for (const book of wanted) {
      book.author = author; // acquisition uses book.author.name for matching
      for (const entry of await ensureEntries(book, formats)) {
        // Entries the user set to ignored (or that are already downloaded) are not searched
        if (entry.status === 'wanted') queue.push(entry);
      }
    }
    if (!queue.length) return res.json({ total: 0, message: 'No wanted books for this author' });

    const io = req.app.get('io');
    const emit = (payload) => io && io.emit('author:search', { authorId: author.id, ...payload });
    const state = { total: queue.length, done: 0, queued: 0, formats };
    authorSearches.set(author.id, state);
    res.status(202).json({ total: queue.length, formats, message: `Searching ${queue.length} wanted ${queue.length === 1 ? 'entry' : 'entries'} (${formats.join(' + ')})` });

    const { acquireBook } = require('../services/acquisition');
    const logger = require('../config/logger');
    (async () => {
      try {
        for (const entry of queue) {
          // Status may have changed while earlier entries were searched (e.g. user set it to ignored)
          await entry.reload();
          if (entry.status === 'wanted') {
            entry.author = author; // acquisition uses book.author.name for matching
            emit({ ...state, current: formats.length > 1 ? `${entry.title} (${entry.mediaType})` : entry.title });
            try {
              if ((await acquireBook(entry, { userId: req.user?.id })).queued) state.queued++;
            } catch (e) {
              logger.warn(`Author search: "${entry.title}" failed: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 3000)); // be gentle with indexers / Anna's
          }
          state.done++;
          emit({ ...state });
        }
        logger.info(`Author search for ${author.name}: ${state.queued}/${state.total} wanted entries queued (${formats.join(' + ')})`);
      } finally {
        authorSearches.delete(author.id);
        emit({ ...state, finished: true });
      }
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.toggleAllBooks = async (req, res) => {
  try {
    const author = await Author.findByPk(req.params.id, {
      include: [{ model: Book, as: 'books' }]
    });
    
    if (!author) {
      return res.status(404).json({ error: 'Author not found' });
    }

    const { status } = req.body;
    if (!['wanted', 'ignored'].includes(status)) {
      return res.status(400).json({ error: 'Status must be wanted or ignored' });
    }

    await Book.update(
      { status },
      { where: { authorId: author.id } }
    );

    res.json({ message: `All books set to ${status}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
