const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../config/logger');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

class AmazonScraper {
  constructor() {
    this.baseUrl = 'https://www.amazon.com';
    this.headers = {
      'User-Agent': process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
  }

  async getBestsellerList(category = 'books') {
    try {
      await this.delay();
      const response = await axios.get(`${this.baseUrl}/Best-Sellers-Books/zgbs/books`, {
        headers: this.headers
      });
      return this.parseBookList(response.data);
    } catch (error) {
      logger.error('Amazon bestseller error:', error.message);
      return [];
    }
  }

  async getNewReleases(category = 'books') {
    try {
      await this.delay();
      const response = await axios.get(`${this.baseUrl}/gp/new-releases/books`, {
        headers: this.headers
      });
      return this.parseBookList(response.data);
    } catch (error) {
      logger.error('Amazon new releases error:', error.message);
      return [];
    }
  }

  /**
   * @param {string} query
   * @param {object} [opts] { store: 'stripbooks' (print/all books, default) | 'digital-text' (Kindle) }
   */
  async searchBooks(query, { store = 'stripbooks' } = {}) {
    let page;
    try {
      const browserPool = require('./browserPool');
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent(this.headers['User-Agent']);

      await page.goto(`${this.baseUrl}/s?k=${encodeURIComponent(query)}&i=${store}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 }).catch(() => {});

      const books = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[data-component-type="s-search-result"]').forEach(elem => {
          // Amazon moved the title out of the <a>; try the current layout first, then older ones
          const title = (elem.querySelector('[data-cy="title-recipe"] h2 span') || elem.querySelector('h2 span') || elem.querySelector('h2 a span'))?.textContent?.trim();
          const author = (elem.querySelector('[data-cy="title-recipe"] .a-row .a-size-base+.a-size-base') ||
            elem.querySelector('.a-color-secondary .a-size-base.s-underline-text') ||
            elem.querySelector('.a-color-secondary .a-size-base'))?.textContent?.trim();
          const rating = elem.querySelector('.a-icon-alt')?.textContent?.match(/[\d.]+/)?.[0];
          const coverUrl = elem.querySelector('img.s-image')?.src;
          const description = elem.querySelector('.a-size-base.a-link-normal.s-underline-text.s-underline-link-text.s-link-style')?.textContent?.trim();
          const asin = elem.getAttribute('data-asin');

          if (title && asin) {
            results.push({
              title,
              author: author?.replace(/^by\s+/i, '').split('|')[0].trim(),
              rating: rating ? parseFloat(rating) : null,
              coverUrl,
              description: description || null,
              amazonAsin: asin,
              amazonUrl: `https://www.amazon.com/dp/${asin}`
            });
          }
        });
        return results;
      });
      
      logger.info(`Amazon found ${books.length} results for ${query}`);
      
      return books;
    } catch (error) {
      logger.warn(`Amazon search error: ${logger.describeError(error)}`);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async getAuthorInfo(authorName) {
    try {
      await this.delay();
      const searchUrl = `${this.baseUrl}/s?k=${encodeURIComponent(authorName)}&i=stripbooks&rh=p_27:${encodeURIComponent(authorName)}`;
      const response = await axios.get(searchUrl, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const authorPageLink = $('a[href*="/e/B"]').first().attr('href');
      if (!authorPageLink) return null;
      
      await this.delay();
      const authorUrl = authorPageLink.startsWith('http') ? authorPageLink : `${this.baseUrl}${authorPageLink}`;
      const authorResponse = await axios.get(authorUrl, { headers: this.headers });
      const $author = cheerio.load(authorResponse.data);
      
      const bio = $author('.author-bio-text, .a-section.author-bio, [data-feature-name="authorBio"]').text().trim();
      const imageUrl = $author('img[src*="amzn-author-media"], .author-image img, .author-profile-avatar img')
        .map((i, el) => $author(el).attr('src')).get()
        .find(src => require('../utils/authorImage').isLikelyAuthorPhoto(src));
      const bookCount = $author('.a-size-base.a-color-secondary').text().match(/(\d+)\s+books?/i)?.[1];
      
      return {
        name: authorName,
        bio: bio || null,
        imageUrl: imageUrl || null,
        bookCount: bookCount ? parseInt(bookCount) : null
      };
    } catch (error) {
      logger.error('Amazon author info error:', error.message);
      return null;
    }
  }

  parseBookList(html) {
    const $ = cheerio.load(html);
    const books = [];

    $('.zg-grid-general-faceout, .a-carousel-card').each((i, elem) => {
      const title = $(elem).find('.p13n-sc-truncate, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1').text().trim();
      const author = $(elem).find('.a-size-small.a-link-child, .a-row.a-size-small').first().text().trim();
      const rating = $(elem).find('.a-icon-alt').text().match(/[\d.]+/)?.[0];
      const coverUrl = $(elem).find('img').attr('src');
      const asin = $(elem).find('a').attr('href')?.match(/\/dp\/([A-Z0-9]{10})/)?.[1];

      if (title && asin) {
        books.push({
          title,
          author: this.cleanAuthor(author),
          rating: rating ? parseFloat(rating) : null,
          coverUrl,
          amazonAsin: asin,
          amazonUrl: `${this.baseUrl}/dp/${asin}`
        });
      }
    });

    return books;
  }

  parseSearchResults(html) {
    const $ = cheerio.load(html);
    const books = [];

    $('[data-component-type="s-search-result"]').each((i, elem) => {
      const title = $(elem).find('h2 a span').text().trim();
      const author = $(elem).find('.a-color-secondary .a-size-base').first().text().trim();
      const rating = $(elem).find('.a-icon-alt').text().match(/[\d.]+/)?.[0];
      const coverUrl = $(elem).find('img.s-image').attr('src');
      const asin = $(elem).attr('data-asin');

      if (title && asin) {
        books.push({
          title,
          author: this.cleanAuthor(author),
          rating: rating ? parseFloat(rating) : null,
          coverUrl,
          amazonAsin: asin,
          amazonUrl: `${this.baseUrl}/dp/${asin}`
        });
      }
    });

    return books;
  }

  cleanAuthor(author) {
    return (author || '').replace(/^by\s+/i, '').split('|')[0].trim();
  }

  async getMyBooks(cookies) {
    try {
      const jar = new tough.CookieJar();
      const client = wrapper(axios.create({ jar }));
      
      if (cookies) {
        const cookieStr = typeof cookies === 'string' ? cookies : JSON.stringify(cookies);
        cookieStr.split('; ').forEach(cookie => {
          try {
            jar.setCookieSync(cookie, this.baseUrl);
          } catch (e) {
            logger.warn('Invalid Amazon cookie entry skipped');
          }
        });
      }

      await this.delay();
      const response = await client.get(`${this.baseUrl}/your-books`, {
        params: { tabView: 'library' },
        headers: this.headers,
        maxRedirects: 0,
        validateStatus: (status) => status < 400
      });
      
      if (response.request.path.includes('/ap/signin')) {
        logger.error('Redirected to login - cookies invalid or expired');
        return [];
      }
      
      logger.info('Successfully fetched Amazon My Books page');
      // Page contains the user's personal library; only dump it when explicitly debugging.
      if (process.env.SCRAPER_DEBUG) {
        require('fs').writeFileSync('amazon-debug.html', response.data);
      }
      return this.parseMyBooks(response.data);
    } catch (error) {
      if (error.response?.status === 302 || error.response?.headers?.location?.includes('/ap/')) {
        logger.error('Amazon cookies expired or invalid');
      } else {
        logger.error('Amazon My Books error:', error.message);
      }
      return [];
    }
  }

  parseMyBooks(html) {
    const $ = cheerio.load(html);
    const books = [];

    logger.info('Parsing Amazon My Books page...');
    logger.debug(`Page title: ${$('title').text()}`);
    
    // Try multiple selectors
    const selectors = [
      '[data-testid="book-card"]',
      '.book-item',
      '[data-asin]',
      '.a-section.a-spacing-base'
    ];
    
    selectors.forEach(selector => {
      const count = $(selector).length;
      if (count > 0) logger.info(`Found ${count} elements with selector: ${selector}`);
    });

    $('[data-testid="book-card"], .book-item, [data-asin]').each((i, elem) => {
      const title = $(elem).find('[data-testid="book-title"], .book-title, h2, .a-size-base-plus').text().trim();
      const author = $(elem).find('[data-testid="book-author"], .book-author, .a-color-secondary').text().trim();
      const coverUrl = $(elem).find('img').attr('src');
      const asin = $(elem).attr('data-asin') || $(elem).find('a').attr('href')?.match(/\/dp\/([A-Z0-9]{10})/)?.[1];

      if (title && asin) {
        logger.info(`Found book: ${title} (${asin})`);
        books.push({
          title,
          author: this.cleanAuthor(author),
          coverUrl,
          amazonAsin: asin,
          amazonUrl: `${this.baseUrl}/dp/${asin}`,
          source: 'amazon_mybooks'
        });
      }
    });

    logger.info(`Parsed ${books.length} books from Amazon My Books`);
    return books;
  }

  delay() {
    const ms = parseInt(process.env.SCRAPER_DELAY) || 2000;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AmazonScraper();
