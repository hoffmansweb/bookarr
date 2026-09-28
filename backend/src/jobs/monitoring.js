const { Author, Book, Notification, User } = require('../models');
const aggregator = require('../services/aggregator');
const logger = require('../config/logger');
const { Op } = require('sequelize');
const { normalizeTitle } = require('../utils/titles');

class MonitoringJob {
  hasCompleteMetadata(book) {
    return book.description && book.coverUrl && book.rating && book.genres && book.pageCount && book.publisher;
  }

  async checkMonitoredAuthors() {
    try {
      const authors = await Author.findAll({
        where: { monitored: true },
        include: [{ model: Book, as: 'books' }]
      });

      // Respect Settings → General → "Status for books added by author monitoring"
      const { getSetting } = require('../controllers/settingsController');
      this.newBookStatus = (await getSetting('default_book_status')) || 'wanted';

      let found = 0;
      for (const author of authors) {
        found += (await this.checkAuthorNewReleases(author)) || 0;
        await this.delay(3000);
      }

      logger.info(`Checked ${authors.length} monitored authors`);
      return { summary: `Checked ${authors.length} monitored author(s); ${found} new book(s) added as "${this.newBookStatus}"`, found, status: this.newBookStatus };
    } catch (error) {
      logger.error('Monitoring job error:', error);
      throw error;
    }
  }

  async checkAuthorNewReleases(author) {
    try {
      // Full bibliography (Goodreads author book list), not a ~20-result keyword search
      const knownId = /^d+$/.test(String(author.goodreadsId || '')) ? author.goodreadsId : undefined;
      const { books, goodreadsId } = await aggregator.getAuthorBooks(author.name, { goodreadsId: knownId });
      if (goodreadsId && goodreadsId !== author.goodreadsId) author.goodreadsId = goodreadsId;

      const existingBooks = author.books || [];
      const existingIsbns = new Set();
      existingBooks.forEach(b => { if (b.isbn13) existingIsbns.add(b.isbn13); if (b.isbn10) existingIsbns.add(b.isbn10); });
      const existingGrIds = new Set(existingBooks.map(b => b.goodreadsId).filter(Boolean));
      // Most catalogue entries have no ISBN, so titles (minus series/subtitle noise) are the main key
      const existingTitles = new Set(existingBooks.map(b => normalizeTitle(b.title)).filter(Boolean));
      const normName = (n) => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const authorKey = normName(author.name);

      const newBooks = [];
      for (const book of books) {
        const isbn = book.isbn13 || book.isbn10;
        const titleKey = normalizeTitle(book.title);
        if (!titleKey) continue;
        if ((isbn && existingIsbns.has(isbn)) || (book.goodreadsId && existingGrIds.has(book.goodreadsId)) || existingTitles.has(titleKey)) continue;
        const credited = [book.author, ...(book.authors || [])].filter(Boolean);
        if (credited.length > 0 && !credited.some(a => normName(a) === authorKey)) continue;
        existingTitles.add(titleKey); // de-dupe within this run as well
        newBooks.push(book);
      }

      if (newBooks.length > 0) {
        logger.info(`Found ${newBooks.length} new books for ${author.name}`);
        const quickMetadata = require('../services/quickMetadata');

        for (const bookData of newBooks) {
          // Fast API lookup for description/ISBN; the metadata refresh job fills anything still missing
          const extra = this.hasCompleteMetadata(bookData) ? {} : await quickMetadata.lookup(bookData.title, author.name).catch(() => ({}));
          const book = await Book.create({
            title: bookData.title,
            subtitle: bookData.subtitle,
            description: bookData.description || extra.description,
            isbn10: bookData.isbn10 || extra.isbn10,
            isbn13: bookData.isbn13 || extra.isbn13,
            publishedDate: bookData.publishedDate || extra.publishedDate,
            publisher: bookData.publisher || extra.publisher,
            pageCount: bookData.pageCount || extra.pageCount,
            language: bookData.language || extra.language,
            coverUrl: bookData.coverUrl || extra.coverUrl,
            googleBooksId: bookData.googleBooksId || extra.googleBooksId,
            goodreadsId: bookData.goodreadsId,
            rating: bookData.rating || extra.rating,
            ratingsCount: bookData.ratingsCount || extra.ratingsCount,
            genres: bookData.genres || extra.genres,
            series: bookData.series || null,
            seriesPosition: bookData.seriesPosition ?? null,
            authorId: author.id,
            monitored: true,
            status: this.newBookStatus || 'wanted'
          });
          await this.createNotifications(author, book);
        }
      }

      author.lastChecked = new Date();
      await author.save();
      return newBooks.length;
    } catch (error) {
      logger.error(`Error checking author ${author.name}:`, error);
      return 0;
    }
  }

  async createNotifications(author, book) {
    const users = await author.getFollowers();
    
    for (const user of users) {
      await Notification.create({
        userId: user.id,
        type: 'new_book',
        title: `New book by ${author.name}`,
        message: `"${book.title}" is now available`,
        metadata: { bookId: book.id, authorId: author.id }
      });
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new MonitoringJob();
