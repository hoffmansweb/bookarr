const logger = require('../config/logger');

class GutenbergService {
  async search(title, author) {
    try {
      const q = `${title} ${author || ''}`.trim();
      const { webSearch } = require('./webAudiobookSearch');
      const { results } = await webSearch(`site:gutenberg.org ${q} (audio OR audiobook)`);
      
      const books = [];
      for (const r of results) {
        if (!r.url.includes('/ebooks/')) continue;
        books.push({
          title: r.title.replace(/ - Project Gutenberg/i, '').trim(),
          author: author || 'Unknown',
          url: r.url,
          source: 'gutenberg',
          format: 'audiobook',
          type: 'gutenberg',
          description: r.snippet
        });
      }
      return books;
    } catch (error) {
      logger.error('Gutenberg search error:', error.message);
      return [];
    }
  }
}

module.exports = new GutenbergService();
