const axios = require('axios');
const xml2js = require('xml2js');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { Book, Author } = require('../models');
const { getBookDetails } = require('../services/openLibrary'); // Reuse openLibrary or GoogleBooks for metadata

const runGoodreadsSync = async () => {
  try {
    const rssUrl = await getSetting('goodreads_rss_url');
    if (!rssUrl) return;

    logger.info('Starting Goodreads RSS Sync...');
    const { data } = await axios.get(rssUrl, { timeout: 15000 });
    const parsed = await xml2js.parseStringPromise(data);
    const items = parsed.rss?.channel?.[0]?.item || [];

    for (const item of items) {
      const title = item.title?.[0] || '';
      const authorName = item.author_name?.[0] || '';
      if (!title) continue;

      // Check if we already have this book
      const existing = await Book.findOne({ where: { title } });
      if (existing) continue;

      let author = await Author.findOne({ where: { name: authorName } });
      if (!author && authorName) {
        author = await Author.create({ name: authorName });
      }

      const book = await Book.create({
        title,
        authorId: author?.id,
        status: 'wanted', // Auto-search picks it up later
        mediaType: 'ebook', // Default to ebook, user can change later
        description: item.description?.[0] || '',
        coverImage: item.book_large_image_url?.[0] || item.book_image_url?.[0] || ''
      });

      logger.info(`Goodreads Sync: Added "${title}" to wanted list`);
    }
  } catch (error) {
    logger.error(`Goodreads Sync error: ${error.message}`);
  }
};

module.exports = runGoodreadsSync;
