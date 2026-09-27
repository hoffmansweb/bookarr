const { Op } = require('sequelize');
const { Book, Author } = require('../models');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { acquireBook } = require('../services/acquisition');

const MIN_HOURS_BETWEEN_SEARCHES = 4;

class SearchJob {
  constructor() {
    this.running = false;
  }

  /**
   * Search a batch of wanted books, least-recently-searched first, so every wanted book gets a
   * turn (previously the same first 10 were retried every run and the rest never searched).
   * Batch size: setting `auto_search_batch` (default 20).
   * @returns {Promise<string>} summary
   */
  async searchWantedBooks() {
    if (this.running) return 'Already running';
    this.running = true;
    try {
      const batch = Math.max(1, Math.min(200, parseInt(await getSetting('auto_search_batch'), 10) || 20));
      const cutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_SEARCHES * 3600 * 1000);
      const where = {
        status: 'wanted',
        monitored: true,
        [Op.or]: [{ lastSearchedAt: null }, { lastSearchedAt: { [Op.lt]: cutoff } }]
      };

      const [wantedTotal, dueTotal] = await Promise.all([
        Book.count({ where: { status: 'wanted', monitored: true } }),
        Book.count({ where })
      ]);
      const books = await Book.findAll({
        where,
        include: [{ model: Author, as: 'author' }],
        // Never-searched first, then oldest search
        order: [[Book.sequelize.literal('lastSearchedAt IS NOT NULL'), 'ASC'], ['lastSearchedAt', 'ASC'], ['createdAt', 'DESC']],
        limit: batch
      });

      let queued = 0;
      for (const book of books) {
        if (await this.searchAndDownload(book)) queued++;
        await this.delay(5000);
      }

      const summary = `Searched ${books.length} of ${dueTotal} due (${wantedTotal} wanted in total); ${queued} queued`;
      logger.info(`Auto-search complete: ${summary}`);
      return summary;
    } finally {
      this.running = false;
    }
  }

  // Walks the source priority list for the book's format (Settings → Sources), with fallback
  async searchAndDownload(book) {
    logger.info(`Searching for [${book.mediaType || 'ebook'}]: ${book.title} ${book.author?.name || ''}`.trim());
    try {
      return (await acquireBook(book)).queued;
    } catch (error) {
      logger.error(`Error searching ${book.title}: ${error.message}`);
      return false;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new SearchJob();
