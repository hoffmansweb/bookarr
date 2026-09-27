const browserPool = require('./browserPool');
const logger = require('../config/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const NAV_TIMEOUT_MS = 15000;
// Circuit breaker: Z-Library is frequently unreachable/blocked. After a few
// consecutive failures stop hammering it (and spamming the logs) for a while.
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30 * 60 * 1000;

const breaker = { failures: 0, disabledUntil: 0 };

const isAvailable = () => {
  if (breaker.disabledUntil && Date.now() < breaker.disabledUntil) return false;
  if (breaker.disabledUntil) {
    // cooldown elapsed: allow a trial request
    breaker.disabledUntil = 0;
    breaker.failures = FAILURE_THRESHOLD - 1;
  }
  return true;
};

const recordSuccess = () => {
  breaker.failures = 0;
  breaker.disabledUntil = 0;
};

const recordFailure = (context, error) => {
  breaker.failures++;
  const reason = logger.describeError(error);
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.disabledUntil = Date.now() + COOLDOWN_MS;
    logger.warn(`Z-Library ${context} failed (${reason}); ${breaker.failures} consecutive failures, skipping Z-Library for ${COOLDOWN_MS / 60000} minutes`);
  } else {
    logger.warn(`Z-Library ${context} failed: ${reason}`);
  }
};

const closePage = async (page) => {
  if (page) await page.close().catch(() => {});
};

class ZLibraryScraper {
  constructor() {
    this.baseUrl = 'https://z-library.sk';
  }

  isAvailable() {
    return isAvailable();
  }

  async searchBooks(query, author = null) {
    if (!query || !isAvailable()) return [];
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
      });
      await page.setUserAgent(USER_AGENT);
      
      const searchQuery = author ? `${query} ${author}` : query;
      const url = `https://en.z-library.sk/s/${encodeURIComponent(searchQuery)}?order=bestmatch`;
      logger.debug(`Z-Library URL: ${url}`);
      
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        logger.debug(`Z-Library loaded: ${page.url()}`);
      } catch (navError) {
        recordFailure('search navigation', navError);
        return [];
      }
      
      // Results are rendered as <z-bookcard> custom elements
      await page.waitForSelector('z-bookcard', { timeout: 5000 }).catch(() => {});
      
      if (process.env.ZLIB_DEBUG) {
        const html = await page.content();
        require('fs').writeFileSync('zlibrary-debug.html', html);
        logger.debug('Saved zlibrary-debug.html');
      }
      
      const books = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('z-bookcard').forEach(card => {
          const title = card.querySelector('[slot="title"]')?.textContent?.trim();
          if (title) {
            const bookUrl = card.getAttribute('href');
            results.push({
              title,
              author: card.querySelector('[slot="author"]')?.textContent?.trim(),
              coverUrl: card.querySelector('img[data-src]')?.getAttribute('data-src'),
              publishedDate: card.getAttribute('year'),
              publisher: card.getAttribute('publisher'),
              isbn13: card.getAttribute('isbn'),
              zlibUrl: bookUrl
            });
          }
        });
        return results;
      });
      
      recordSuccess();
      logger.info(`Z-Library found ${books.length} results`);
      return books;
    } catch (error) {
      recordFailure('search', error);
      return [];
    } finally {
      await closePage(page);
    }
  }

  async getBookDetails(bookUrl) {
    if (!bookUrl || !isAvailable()) return null;
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.setUserAgent(USER_AGENT);
      
      const fullUrl = bookUrl.startsWith('http') ? bookUrl : `https://en.z-library.sk${bookUrl}`;
      logger.debug(`Z-Library fetching details: ${fullUrl}`);
      
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForSelector('#bookDescriptionBox, .book-title', { timeout: 5000 }).catch(() => {});
      
      const details = await page.evaluate(() => {
        const descBox = document.querySelector('#bookDescriptionBox');
        let description = '';
        if (descBox) {
          description = descBox.innerText?.trim() || descBox.textContent?.trim();
        }
        
        return {
          title: document.querySelector('.book-title')?.textContent?.trim(),
          author: document.querySelector('a[href*="/author/"]')?.textContent?.trim(),
          coverUrl: document.querySelector('img.cover')?.src,
          description,
          publishedDate: document.querySelector('.property_year .property_value')?.textContent?.trim(),
          categories: Array.from(document.querySelectorAll('.property_categories a')).map(a => a.textContent.trim())
        };
      });
      
      recordSuccess();
      logger.debug(`Z-Library details: Desc ${details.description ? 'YES' : 'NO'}, Cover ${details.coverUrl ? 'YES' : 'NO'}`);
      return details;
    } catch (error) {
      recordFailure('book details', error);
      return null;
    } finally {
      await closePage(page);
    }
  }
}

module.exports = new ZLibraryScraper();
