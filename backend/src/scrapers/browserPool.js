const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('../config/logger');

puppeteer.use(StealthPlugin());

const PROTOCOL_TIMEOUT = 45000;   // default is 180s; a wedged browser should be noticed quickly
const NEW_PAGE_TIMEOUT = 30000;
const RECYCLE_AFTER_PAGES = 150;  // Chromium slowly bloats; replace long-lived browsers
const STALE_GRACE_MS = 60000;     // let in-flight pages on a retired browser finish

const withTimeout = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms); })
  ]).finally(() => clearTimeout(timer));
};

// Metadata scrapers don't need images, fonts or media; skipping them keeps pages light
// (ad-heavy sites like Z-Library otherwise spawn dozens of frames and wedge the browser).
const HEAVY = new Set(['image', 'media', 'font']);

class BrowserPool {
  constructor() {
    this.entries = [];          // { browser, active, total, stale }
    this.maxBrowsers = 3;
    this.maxPagesPerBrowser = 5;
    this.launching = null;
  }

  async launch() {
    const browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: PROTOCOL_TIMEOUT,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--mute-audio'
      ]
    });
    const entry = { browser, active: 0, total: 0, stale: false };

    // Track pages ourselves: asking a wedged browser for browser.pages() hangs too
    const originalNewPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
      entry.active++;
      entry.total++;
      try {
        const page = await withTimeout(originalNewPage(), NEW_PAGE_TIMEOUT, 'Opening a browser page');
        page.once('close', () => { entry.active = Math.max(0, entry.active - 1); this.maybeRetire(entry); });
        return page;
      } catch (e) {
        entry.active = Math.max(0, entry.active - 1);
        this.markStale(entry, e.message);
        throw e;
      }
    };

    browser.on('disconnected', () => {
      this.entries = this.entries.filter(x => x !== entry);
    });
    this.entries.push(entry);
    logger.info(`Created browser ${this.entries.filter(x => !x.stale).length}/${this.maxBrowsers}`);
    return entry;
  }

  // Retire a browser: no new pages go to it; it's closed once idle (or after a grace period)
  markStale(entry, reason) {
    if (entry.stale) return;
    entry.stale = true;
    logger.warn(`Retiring headless browser (${reason}); a fresh one will be started`);
    const close = () => entry.browser.close().catch(() => entry.browser.process()?.kill('SIGKILL'));
    if (entry.active === 0) close();
    else setTimeout(close, STALE_GRACE_MS).unref();
  }

  maybeRetire(entry) {
    if (entry.stale && entry.active === 0) entry.browser.close().catch(() => {});
    else if (!entry.stale && entry.total >= RECYCLE_AFTER_PAGES && entry.active === 0) this.markStale(entry, `recycling after ${entry.total} pages`);
  }

  async getEntry(waitMs = 120000) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const live = this.entries.filter(x => !x.stale && x.browser.isConnected());
      const free = live.sort((a, b) => a.active - b.active).find(x => x.active < this.maxPagesPerBrowser);
      if (free) return free;

      if (live.length < this.maxBrowsers) {
        // Serialize launches so concurrent callers don't overshoot the limit
        if (!this.launching) this.launching = this.launch().finally(() => { this.launching = null; });
        return this.launching;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for a free browser');
  }

  /** Kept for existing callers; prefer newPage(). */
  async getBrowser(waitMs) {
    return (await this.getEntry(waitMs)).browser;
  }

  /**
   * Open a page on a healthy browser.
   * @param {object} [opts] { light: block images/fonts/media (for metadata scrapers) }
   */
  async newPage({ light = false } = {}) {
    let page;
    try {
      page = await (await this.getEntry()).browser.newPage();
    } catch (e) {
      // The browser died or hung (it has now been retired): retry once on a fresh one
      logger.warn(`Opening a page failed (${e.message.split('\n')[0]}); retrying on a fresh browser`);
      page = await (await this.getEntry()).browser.newPage();
    }
    if (light) {
      try {
        await page.setRequestInterception(true);
        page.on('request', req => {
          if (req.isInterceptResolutionHandled?.()) return;
          (HEAVY.has(req.resourceType()) ? req.abort() : req.continue()).catch(() => {});
        });
      } catch (e) {
        // Interception is an optimisation only
      }
    }
    return page;
  }

  /**
   * Called when Puppeteer reports protocol timeouts we couldn't catch (they fire inside
   * Puppeteer's own frame setup): the browsers are wedged, so replace them all.
   */
  onProtocolFailure(reason = 'protocol timeout') {
    for (const entry of this.entries) this.markStale(entry, reason);
  }

  async closeBrowser() {
    await Promise.all(this.entries.map(x => x.browser.close().catch(() => {})));
    this.entries = [];
  }
}

module.exports = new BrowserPool();
