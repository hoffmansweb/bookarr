const browserPool = require('./browserPool');
const logger = require('../config/logger');

const LIBGEN_MIRRORS = ['https://libgen.is', 'https://libgen.rs'];

const searchBooks = async (query, author = '') => {
  let page;
  try {
    page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const searchQuery = author ? `${query} ${author}` : query;
    const url = `${LIBGEN_MIRRORS[0]}/search.php?req=${encodeURIComponent(searchQuery)}&res=100`;
    
    logger.info(`LibGen searching: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (process.env.SCRAPER_DEBUG) {
      require('fs').writeFileSync('libgen-debug.html', await page.content());
    }
    
    const books = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('table.c tr').forEach(row => {
        const link = row.querySelector('a[href*="book/index.php?md5="]');
        if (!link) return;
        
        const md5 = link.href.match(/md5=([a-f0-9]{32})/)?.[1];
        const cells = row.querySelectorAll('td');
        
        if (md5 && cells.length > 2) {
          results.push({
            title: cells[2]?.textContent?.trim(),
            author: cells[1]?.textContent?.trim(),
            md5,
            libgenUrl: link.href
          });
        }
      });
      return results.slice(0, 20);
    });
    
    logger.info(`LibGen found ${books.length} results`);
    if (books.length > 0) logger.info(`First result: ${books[0].title}`);
    return books;
  } catch (error) {
    logger.warn(`LibGen search error: ${logger.describeError(error)}`);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
};

const getBookDetails = async (md5) => {
  let page;
  try {
    page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const url = `${LIBGEN_MIRRORS[0]}/book/index.php?md5=${md5}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const details = await page.evaluate(() => {
      const downloadLinks = [];
      document.querySelectorAll('a[href*="download"], a[href*="get.php"]').forEach(link => {
        downloadLinks.push({ url: link.href, source: 'LibGen' });
      });
      
      return {
        downloadLinks: downloadLinks.slice(0, 3)
      };
    });
    
    return details;
  } catch (error) {
    logger.warn(`LibGen details error: ${logger.describeError(error)}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
};

module.exports = { searchBooks, getBookDetails };
