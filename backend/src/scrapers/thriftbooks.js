const browserPool = require('./browserPool');
const logger = require('../config/logger');

class ThriftBooksScraper {
  constructor() {
    this.baseUrl = 'https://www.thriftbooks.com';
  }

  async searchBooks(query) {
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto(`${this.baseUrl}/search/?term=${encodeURIComponent(query)}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      const books = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.SearchResults-tile').forEach(elem => {
          const title = elem.querySelector('.SearchResults-tile-title')?.textContent?.trim();
          const author = elem.querySelector('.SearchResults-tile-author')?.textContent?.trim();
          const coverUrl = elem.querySelector('img')?.src;
          const description = elem.querySelector('.SearchResults-tile-description')?.textContent?.trim();
          const link = elem.querySelector('a')?.href;
          const isbn = link?.match(/isbn\/(\d+)/)?.[1];
          
          if (title && author) {
            results.push({
              title,
              author: author.replace(/^by\s+/i, '').trim(),
              coverUrl,
              description: description || null,
              isbn13: isbn,
              thriftbooksUrl: link
            });
          }
        });
        return results;
      });
      
      logger.info(`ThriftBooks found ${books.length} results for ${query}`);
      return books;
    } catch (error) {
      logger.warn(`ThriftBooks search error: ${logger.describeError(error)}`);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

module.exports = new ThriftBooksScraper();
