const browserPool = require('./browserPool');
const logger = require('../config/logger');
const { parseSeriesText } = require('../utils/series');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// page.close() can reject if the browser crashed; never let that mask the result.
const closePage = async (page) => {
  if (page) await page.close().catch(() => {});
};

// Goodreads serves an AWS WAF JS challenge first; 'networkidle2' frequently never
// settles because of ads/trackers. Load the DOM, then wait for real content.
const gotoAndWait = async (page, url, selector) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (selector) {
    await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
  }
};

class GoodreadsScraper {
  constructor() {
    this.baseUrl = 'https://www.goodreads.com';
  }

  async searchBooks(query) {
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent(USER_AGENT);
      
      await gotoAndWait(page, `${this.baseUrl}/search?q=${encodeURIComponent(query)}&search_type=books`, 'div.Book, a.bookTitle, .searchSubNavContainer');
      
      const results = await page.evaluate(() => {
        const books = [];
        const seen = new Set();

        // Current layout: one div.Book per result row
        document.querySelectorAll('div.Book').forEach(bookEl => {
          const row = bookEl.parentElement || bookEl;
          const link = row.querySelector('a[href*="/book/show/"]:not(.BookCard__stretchedLink)')
            || row.querySelector('a[href*="/book/show/"]');
          const bookId = link?.getAttribute('href')?.match(/\/show\/(\d+)/)?.[1];
          if (!bookId || seen.has(bookId)) return;
          const title = (link.textContent || '').trim() || link.getAttribute('aria-label') || '';
          if (!title) return;
          seen.add(bookId);
          const ratingText = row.querySelector('.u-sr-only')?.textContent || row.querySelector('strong')?.textContent || '';
          const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
          const year = row.querySelector('[data-testid="book-item-publication-year"]')?.textContent?.match(/\d{4}/)?.[0];
          books.push({
            goodreadsId: bookId,
            title,
            author: row.querySelector('[data-testid="name"]')?.textContent?.trim() || null,
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
            coverUrl: row.querySelector('img')?.src || null,
            publishedDate: year || null,
            // Search cards name the series, e.g. "Black Dagger Brotherhood (Series #3)"
            seriesLabel: row.querySelector('a[href*="/series/"]')?.textContent || null
          });
        });

        // Legacy table layout
        document.querySelectorAll('.bookTitle').forEach(elem => {
          const title = elem.textContent.trim();
          const url = elem.href;
          const bookId = url?.match(/\/show\/(\d+)/)?.[1];
          
          if (bookId && !seen.has(bookId)) {
            seen.add(bookId);
            const row = elem.closest('tr');
            const author = row?.querySelector('.authorName')?.textContent.trim();
            const rating = row?.querySelector('.minirating')?.textContent.trim();
            const cover = row?.querySelector('img')?.src;
            const ratingMatch = rating?.match(/(\d+\.\d+)/);

            books.push({
              goodreadsId: bookId,
              title,
              author,
              rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
              coverUrl: cover,
              seriesLabel: row?.querySelector('a[href*="/series/"]')?.textContent || null
            });
          }
        });
        return books;
      });
      
      return results.map(({ seriesLabel, ...book }) => ({ ...book, ...parseSeriesText(seriesLabel) }));
    } catch (error) {
      logger.warn(`Goodreads search error: ${logger.describeError(error)}`);
      return [];
    } finally {
      await closePage(page);
    }
  }

  async getAuthorInfo(authorName) {
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent(USER_AGENT);
      
      await gotoAndWait(page, `${this.baseUrl}/search?q=${encodeURIComponent(authorName)}&search_type=authors`, 'a[href*="/author/show/"], .searchSubNavContainer');
      
      // Only an author whose name matches; the first result can be someone else entirely
      const authorLink = await page.evaluate((wanted) => {
        const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const links = Array.from(document.querySelectorAll('a.authorName, a[href*="/author/show/"]'));
        const exact = links.find(a => norm(a.textContent) === norm(wanted));
        return exact ? exact.href : null;
      }, authorName);
      
      if (!authorLink) return null;
      
      await gotoAndWait(page, authorLink, '.aboutAuthorInfo, .authorLeftContainer, h1');
      
      const authorInfo = await page.evaluate(() => {
        const bio = document.querySelector('.aboutAuthorInfo')?.innerText?.replace(/^\s*edit data\s*/i, '').trim() || null;
        const img = document.querySelector('.authorLeftContainer img');
        let imageUrl = img?.src || null;
        
        if (imageUrl && (imageUrl.includes('nophoto') || imageUrl.includes('no-photo') || imageUrl.includes('member_photo'))) {
          imageUrl = null;
        }
        
        const website = document.querySelector('.dataItem[itemprop="url"]')?.href;
        
        return { bio, imageUrl, website };
      });
      
      return authorInfo;
    } catch (error) {
      logger.warn(`Goodreads author info error: ${logger.describeError(error)}`);
      return null;
    } finally {
      await closePage(page);
    }
  }

  /**
   * Goodreads author id for an exact name match (e.g. "J.R. Ward" -> "20248"), or null.
   */
  async findAuthorId(authorName) {
    let page;
    try {
      page = await browserPool.newPage({ light: true });
      await page.setUserAgent(USER_AGENT);
      await gotoAndWait(page, `${this.baseUrl}/search?q=${encodeURIComponent(authorName)}&search_type=authors`, 'a[href*="/author/show/"], .searchSubNavContainer');
      return await page.evaluate((wanted) => {
        const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const hit = Array.from(document.querySelectorAll('a.authorName, a[href*="/author/show/"]'))
          .find(a => norm(a.textContent) === norm(wanted));
        return hit?.getAttribute('href')?.match(/author\/show\/(\d+)/)?.[1] || null;
      }, authorName);
    } catch (error) {
      logger.warn(`Goodreads author lookup error: ${logger.describeError(error)}`);
      return null;
    } finally {
      await closePage(page);
    }
  }

  /**
   * Every work on the author's Goodreads book list (/author/list/<id>, 100 per page).
   * The book *search* only returns ~20 results, which capped authors at 20 books.
   * Skips box sets / omnibus editions and "Untitled" placeholders.
   */
  async getAuthorBooks(authorId, { authorName, maxPages = 15 } = {}) {
    let page;
    const books = [];
    const seen = new Set();
    try {
      page = await browserPool.newPage({ light: true });
      await page.setUserAgent(USER_AGENT);
      for (let p = 1; p <= maxPages; p++) {
        await gotoAndWait(page, `${this.baseUrl}/author/list/${authorId}?page=${p}&per_page=100`, 'tr[itemtype*="Book"], .leftContainer');
        const { rows, hasNext } = await page.evaluate(() => ({
          hasNext: !!document.querySelector('a.next_page'),
          rows: [...document.querySelectorAll('tr[itemtype*="Book"]')].map(r => {
            const a = r.querySelector('a.bookTitle');
            const info = (r.querySelector('.greyText.smallText, .uitext')?.textContent || '').replace(/\s+/g, ' ');
            return {
              rawTitle: (a?.textContent || '').replace(/\s+/g, ' ').trim(),
              goodreadsId: a?.getAttribute('href')?.match(/\/show\/(\d+)/)?.[1] || null,
              authors: [...r.querySelectorAll('a.authorName')].map(x => x.textContent.trim()),
              rating: parseFloat((info.match(/([\d.]+)\s+avg rating/) || [])[1]) || null,
              ratingsCount: parseInt(((info.match(/([\d,]+)\s+ratings?/) || [])[1] || '').replace(/,/g, ''), 10) || null,
              // "published 2005" or, for upcoming books, "expected publication 2027"
              year: (info.match(/(?:published|expected publication)\s+(\d{4})/) || [])[1] || null,
              cover: r.querySelector('img')?.getAttribute('src') || null
            };
          })
        }));

        for (const row of rows) {
          if (!row.goodreadsId || seen.has(row.goodreadsId) || !row.rawTitle) continue;
          seen.add(row.goodreadsId);
          if (authorName) {
            const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (row.authors.length && !row.authors.some(a => norm(a) === norm(authorName))) continue;
          }
          // "Dark Lover (Black Dagger Brotherhood, #1)" -> title + series
          const m = row.rawTitle.match(/^(.*?)\s*\(([^()]+?),?\s*#(\d+(?:\.\d+)?)\)\s*$/);
          const title = (m ? m[1] : row.rawTitle.replace(/\s*\([^()]*\)\s*$/, '')).trim();
          if (!title || /^untitled\b/i.test(title) || /box(ed)? ?set|omnibus|bundle|collection:|books?\s+\d+\s*[-–]\s*\d+/i.test(row.rawTitle)) continue;
          books.push({
            title,
            goodreadsId: row.goodreadsId,
            author: row.authors[0] || authorName || null,
            authors: row.authors,
            series: m ? m[2].trim() : null,
            seriesPosition: m ? Number(m[3]) : null,
            rating: row.rating,
            ratingsCount: row.ratingsCount,
            publishedDate: row.year,
            // Thumbnails end in ._SY75_.jpg; drop the size suffix for the full cover
            coverUrl: row.cover && !/nophoto/i.test(row.cover) ? row.cover.replace(/\._S[XY]\d+_(?=\.)/, '') : null
          });
        }
        if (!hasNext || rows.length === 0) break;
        await new Promise(r => setTimeout(r, 1500)); // be polite between pages
      }
      logger.info(`Goodreads: ${books.length} works for author ${authorName || authorId}`);
      return books;
    } catch (error) {
      logger.warn(`Goodreads author books error: ${logger.describeError(error)}`);
      return books;
    } finally {
      await closePage(page);
    }
  }

  async getBookDetails(bookId) {
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent(USER_AGENT);
      
      await gotoAndWait(page, `${this.baseUrl}/book/show/${encodeURIComponent(bookId)}`, '[data-testid="bookTitle"], #bookTitle, h1');
      
      const bookDetails = await page.evaluate(() => {
        const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        // Current Goodreads pages embed schema.org JSON-LD; the old itemprop markup is gone.
        let ld = {};
        try {
          const node = document.querySelector('script[type="application/ld+json"]');
          if (node) ld = JSON.parse(node.textContent) || {};
        } catch (e) { ld = {}; }
        const ldAuthor = Array.isArray(ld.author) ? ld.author[0]?.name : ld.author?.name;
        const ratingsText = text('[data-testid="ratingsCount"]');
        const pagesText = text('[data-testid="pagesFormat"]') || text('[itemprop="numberOfPages"]');
        const pubText = text('[data-testid="publicationInfo"]');
        const rating = parseFloat(ld.aggregateRating?.ratingValue ?? text('.RatingStatistics__rating') ?? text('[itemprop="ratingValue"]'));
        const ratingsCount = parseInt(
          ld.aggregateRating?.ratingCount ??
          (ratingsText ? ratingsText.replace(/[^\d]/g, '') : document.querySelector('[itemprop="ratingCount"]')?.getAttribute('content')),
          10
        );
        const pageCount = ld.numberOfPages || (pagesText?.match(/\d+/)?.[0] ? parseInt(pagesText.match(/\d+/)[0], 10) : null);
        return {
          title: ld.name || text('[data-testid="bookTitle"]') || text('#bookTitle'),
          author: ldAuthor || text('.ContributorLink__name') || text('.authorName'),
          rating: Number.isFinite(rating) ? rating : null,
          ratingsCount: Number.isFinite(ratingsCount) ? ratingsCount : null,
          description: text('[data-testid="description"] .Formatted') || text('[data-testid="description"]') || text('#description'),
          isbn: ld.isbn || text('[itemprop="isbn"]'),
          pageCount,
          publishedDate: (pubText ? pubText.replace(/^(First\s+)?published\s+/i, '') : null) || text('[itemprop="datePublished"]'),
          publisher: text('[itemprop="publisher"]'),
          coverUrl: (typeof ld.image === 'string' ? ld.image : null) || document.querySelector('.BookCover__image img')?.src || document.querySelector('.bookCoverImage')?.src || null,
          seriesLabel: text('h3.Text__title3 a[href*="/series/"]') || text('.bookSeries')
        };
      });
      
      // The page labels the series, e.g. "Society of Villains #1"; the Book model keeps the
      // name and the number in separate columns, so split it here — page.evaluate() runs in
      // the browser, where parseSeriesText does not exist.
      if (!bookDetails) return null;
      const { seriesLabel, ...rest } = bookDetails;
      return { ...rest, ...parseSeriesText(seriesLabel) };
    } catch (error) {
      logger.warn(`Goodreads book details error: ${logger.describeError(error)}`);
      return null;
    } finally {
      await closePage(page);
    }
  }
}

module.exports = new GoodreadsScraper();
