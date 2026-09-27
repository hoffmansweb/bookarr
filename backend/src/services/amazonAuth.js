const puppeteer = require('puppeteer');
const logger = require('../config/logger');

// `scrapeMyBooks` accepts an optional progress listener so callers can stream what
// the scrape is doing (launching → navigating → login → logged-in → scraping →
// scanned / error) to the UI instead of leaving the user staring at a spinner.
const NO_PROGRESS = () => {};

// Reads the library entries currently in the DOM of amazon.com/your-books.
// Library books render as #book-view-<ASIN> with #book_info-title-<ASIN> / #book_info-author-<ASIN>.
// <bds-unified-book-faceout> elements on the same page are mostly *recommendations*
// (slot id contains "recommendedItem"), so they're only used as a fallback and never when marked as recs.
const readLibraryDom = () => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  document.querySelectorAll('[id^="book_info-title-"]').forEach(el => {
    const asin = el.id.slice('book_info-title-'.length);
    if (!/^[A-Z0-9]{10}$/.test(asin)) return;
    const card = document.getElementById(`book-view-${asin}`) || el.closest('[id^="book-view-"]') || el.parentElement;
    const author = clean(document.getElementById(`book_info-author-${asin}`)?.textContent).replace(/^by\s+/i, '');
    const img = card?.querySelector('img');
    out.push({
      amazonAsin: asin,
      title: clean(el.textContent),
      author,
      coverUrl: img?.currentSrc || img?.src || '',
      amazonUrl: `https://www.amazon.com/dp/${asin}`,
      format: 'Kindle'
    });
  });

  if (out.length === 0) {
    document.querySelectorAll('bds-unified-book-faceout[asin]').forEach(el => {
      const slot = el.getAttribute('data-csa-c-data-csa-c-slot-id') || '';
      if (/recommend/i.test(slot) || el.getAttribute('issponsored') === 'true') return;
      const asin = el.getAttribute('asin');
      const physicalId = el.getAttribute('coverimagephysicalid');
      out.push({
        amazonAsin: asin,
        title: clean(el.getAttribute('coverimagealttext')),
        author: '',
        coverUrl: physicalId ? `https://m.media-amazon.com/images/I/${physicalId}.${el.getAttribute('coverimageextension') || 'jpg'}` : '',
        amazonUrl: `https://www.amazon.com/dp/${asin}`,
        format: el.getAttribute('format') || ''
      });
    });
  }
  return out;
};

class AmazonAuthService {
  /**
   * Scroll the library until no new books appear (the page lazy-loads / virtualises the grid),
   * clicking any "show more" button along the way. Entries are accumulated by ASIN.
   */
  async collectLibrary(page, onCount = () => {}) {
    const byAsin = new Map();
    let idleRounds = 0;
    const deadline = Date.now() + 8 * 60 * 1000;

    while (idleRounds < 4 && Date.now() < deadline) {
      const before = byAsin.size;
      const found = await page.evaluate(readLibraryDom).catch(() => []);
      for (const b of found) {
        const prev = byAsin.get(b.amazonAsin);
        // Keep the most complete record seen for each ASIN
        byAsin.set(b.amazonAsin, prev ? { ...prev, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v)) } : b);
      }
      if (byAsin.size > before) {
        idleRounds = 0;
        onCount(byAsin.size);
      } else {
        idleRounds++;
      }

      await page.evaluate(() => {
        const more = [...document.querySelectorAll('button, a[role="button"], span[role="button"]')]
          .find(b => /^(show|load|see)\s+more/i.test((b.textContent || '').trim()));
        if (more) more.click();
        window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
    }
    return [...byAsin.values()].filter(b => b.title);
  }

  async scrapeMyBooks(onProgress = NO_PROGRESS) {
    const report = (event) => {
      // Reporting progress must never be able to break a scrape.
      try {
        onProgress(event);
      } catch (err) {
        logger.warn(`Amazon progress listener failed: ${err.message}`);
      }
    };

    let browser;
    try {
      report({ stage: 'launching', message: 'Launching a Chromium browser window…' });

      browser = await puppeteer.launch({ 
        headless: false,
        args: ['--no-sandbox']
      });
      
      const page = await browser.newPage();

      report({ stage: 'navigating', message: 'Opening amazon.com/your-books…' });
      await page.goto('https://www.amazon.com/your-books?tabView=library', { waitUntil: 'networkidle0', timeout: 60000 });
      
      logger.info('Browser opened. Please log in to Amazon manually...');
      report({ stage: 'login', message: 'Waiting for you to log in to Amazon in the browser window…' });
      
      // Wait for user to log in
      await page.waitForFunction(
        () => document.title.includes('Your Books') || document.querySelector('#kindle-reader-api'),
        { timeout: 300000 }
      );

      report({ stage: 'logged-in', message: 'Login detected — reading your library…' });
      
      // Wait additional time for dynamic content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      logger.info('Logged in, scraping books...');
      
      // Page contains the user's personal library; only dump it when explicitly debugging.
      if (process.env.SCRAPER_DEBUG) {
        require('fs').writeFileSync('amazon-mybooks-debug.html', await page.content());
      }

      report({ stage: 'scraping', message: 'Scanning your library (scrolling to load every book)…' });

      const books = await this.collectLibrary(page, (count) =>
        report({ stage: 'scraping', message: `Scanning your library… ${count} books so far` }));

      await browser.close();
      logger.info(`Scraped ${books.length} books`);

      report({ stage: 'scanned', total: books.length, books });
      
      return { success: true, books };
    } catch (error) {
      if (browser) await browser.close().catch(() => {});
      logger.error(`Amazon scrape error: ${logger.describeError(error)}`);
      report({ stage: 'error', message: error.message });
      return { success: false, error: error.message, books: [] };
    }
  }
}

module.exports = new AmazonAuthService();
