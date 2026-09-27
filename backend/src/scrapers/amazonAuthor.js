const browserPool = require('./browserPool');
const logger = require('../config/logger');

// Screenshots were previously written to the working directory on every lookup,
// using the raw author name in the filename. Only take them when debugging, and
// sanitise the name so it can't escape the directory.
const debugScreenshot = async (page, prefix, name) => {
  if (!process.env.SCRAPER_DEBUG) return;
  const safe = String(name).replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80) || 'unknown';
  await page.screenshot({ path: `${prefix}-${safe}.png` }).catch(() => {});
};

class AmazonAuthorScraper {
  async getAuthorInfo(authorName) {
    let page;
    try {
      page = await browserPool.newPage({ light: true }); // images/fonts blocked; metadata only
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(authorName)}&i=stripbooks&rh=p_27:${encodeURIComponent(authorName)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Only follow a link whose text names this author; the first /e/ link on the page can be
      // a co-author or an unrelated author, whose photo and bio would then be attached here
      const authorPageLink = await page.evaluate((searchName) => {
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const want = norm(searchName);
        const links = Array.from(document.querySelectorAll('a[href*="/e/B"]'));
        const hit = links.find(link => norm(link.textContent || link.getAttribute('aria-label')).includes(want));
        return hit?.href || null;
      }, authorName);
      
      if (!authorPageLink) {
        logger.info(`No Amazon author page found for ${authorName}`);
        await debugScreenshot(page, 'amazon-search', authorName);
        return null;
      }
      
      await page.goto(authorPageLink, { waitUntil: 'networkidle2', timeout: 30000 });
      await debugScreenshot(page, 'amazon-author', authorName);
      
      const authorInfo = await page.evaluate(() => {
        const bioSection = document.querySelector('.author-bio-text, .a-section.author-bio, [data-feature-name="authorBio"], .a-section.a-spacing-base');
        const bio = bioSection?.innerText?.trim() || document.querySelector('.author-bio-text')?.innerText?.trim();
        // Real author photos are served from amzn-author-media / images/I; images/G is site chrome
        // (e.g. the "Follow this author" banner, whose alt text also mentions "author")
        const candidates = [
          ...document.querySelectorAll('img[src*="amzn-author-media"], .author-image img, .author-profile-avatar img, [data-testid*="author" i] img, img[alt*="author" i]')
        ].map(img => img.currentSrc || img.src).filter(Boolean);
        const imageUrl = candidates.find(src => /amzn-author-media|\/images\/I\//.test(src) && !/\/images\/G\//.test(src));
        const authorName = document.querySelector('h1, .author-name')?.innerText?.trim();
        
        return {
          bio: bio || null,
          imageUrl: imageUrl || null,
          authorName: authorName || null
        };
      });
      
      logger.info(`Amazon author info for ${authorName}: bio=${!!authorInfo.bio}, image=${!!authorInfo.imageUrl}`);
      
      return {
        name: authorName,
        bio: authorInfo.bio,
        imageUrl: authorInfo.imageUrl
      };
      
    } catch (error) {
      logger.warn(`Amazon author lookup error: ${logger.describeError(error)}`);
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

module.exports = new AmazonAuthorScraper();
