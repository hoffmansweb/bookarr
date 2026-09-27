const logger = require('../config/logger');

class LoyalBooksService {
  async search(title, author) {
    try {
      const q = `${title} ${author || ''}`.trim();
      const { webSearch } = require('./webAudiobookSearch');
      const { results } = await webSearch(`site:loyalbooks.com ${q} audiobook`);
      
      const books = [];
      for (const r of results) {
        if (!r.url.includes('/book/')) continue;
        const rssUrl = r.url + '/feed';
        books.push({
          title: r.title.replace(/ - Free Audio Book \| Loyal Books/i, '').replace(/ - Loyal Books/i, '').trim(),
          author: author || 'Unknown',
          rssUrl,
          url: r.url,
          source: 'loyalbooks',
          format: 'audiobook',
          type: 'loyalbooks',
          description: r.snippet
        });
      }
      return books;
    } catch (error) {
      logger.error('LoyalBooks search error:', error.message);
      return [];
    }
  }
}

module.exports = new LoyalBooksService();
