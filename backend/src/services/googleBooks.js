const axios = require('axios');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

// Google Books is a best-effort metadata source: user searches and the library-wide metadata
// refresh both come through here. Google answers 429 ("Quota exceeded ... Queries per day") once
// the free daily quota is used up, and it sometimes stalls the connection instead, so a call can
// burn the whole timeout. The old code waited out that timeout and logged a warning on *every*
// call, which meant one Google outage stalled the refresh by 10 s per book and filled the log.
// Now a failure starts a cooldown: calls are skipped without a request until it expires, an outage
// logs one warning per window (with a count of the calls it swallowed), and the first success
// clears it. Same approach as FlareSolverr (scrapers/antiBot.js) and the indexers
// (services/indexerSearch.js).
const DEFAULT_TIMEOUT_MS = 10000;
const UNREACHABLE_COOLDOWN_MS = 10 * 60 * 1000;   // timeout, DNS failure, reset connection, ...
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;    // HTTP 429/403 without a Retry-After header
const MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000;       // never trust an implausible Retry-After
// The free tier allows ~100 queries per minute; pacing calls keeps bulk refreshes inside it
// (the old code slept a flat 2 s before every search, which stacked on top of slow responses)
const MIN_INTERVAL_MS = 2000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// `.env` files often still carry the placeholder, and a placeholder is rejected like an invalid
// key - worse than sending no key at all, since Google then applies the anonymous quota
const isRealKey = (value) => !!value && !/[<>]|your[-_]|example/i.test(value);

class GoogleBooksService {
  constructor() {
    this.baseUrl = 'https://www.googleapis.com/books/v1';
    this.downUntil = 0;    // while in the future every call is skipped without a request
    this.lastError = null; // last reported failure, so one outage doesn't log per call
    this.lastWarnedAt = 0;
    this.suppressed = 0;   // failures not logged since the last warning
    this.lastRequestAt = 0;
  }

  /** Settings → General → Metadata: `google_books_enabled` = 'false' switches the source off. */
  async enabled() {
    const value = await getSetting('google_books_enabled');
    return value === undefined || value === null || value === '' ? true : value !== 'false';
  }

  /** False while the source is in a failure cooldown (no request is being made). */
  isAvailable() {
    return Date.now() >= this.downUntil;
  }

  async apiKey() {
    const key = await getSetting('google_books_api_key');
    if (isRealKey(key)) return String(key).trim();
    if (key) logger.debug('Google Books API key looks like a placeholder; using the anonymous quota');
    return null;
  }

  async timeoutMs() {
    const ms = parseInt(await getSetting('google_books_timeout_ms'), 10);
    return Number.isFinite(ms) && ms >= 1000 ? Math.min(ms, 60000) : DEFAULT_TIMEOUT_MS;
  }

  /** Keep at least MIN_INTERVAL_MS between requests. */
  async throttle() {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  /** The cooldown a failed call deserves, or null when retrying straight away is fine. */
  cooldownFor(error, apiKey) {
    const status = error.response?.status;
    if (status === 429 || status === 403) {
      const retryAfter = parseInt(error.response.headers?.['retry-after'], 10);
      const ms = retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_COOLDOWN_MS) : RATE_LIMIT_COOLDOWN_MS;
      const hint = apiKey ? '' : ' — set a Google Books API key (Settings → General → Metadata) to raise the limit';
      return { ms, reason: `is rate limiting (HTTP ${status})`, hint };
    }
    if (!error.response) return { ms: UNREACHABLE_COOLDOWN_MS, reason: 'unreachable', hint: '' };
    return null; // a plain 4xx (unknown volume id, ...) is no reason to stop calling Google
  }

  /** Record a failure: start the cooldown and warn once per window instead of once per call. */
  warnFailure(error, apiKey) {
    const message = logger.describeError(error);
    const cooldown = this.cooldownFor(error, apiKey);
    if (cooldown) this.downUntil = Date.now() + cooldown.ms;

    const window = cooldown?.ms || UNREACHABLE_COOLDOWN_MS;
    const sameOutage = message === this.lastError && Date.now() - this.lastWarnedAt < window;
    this.lastError = message;
    if (sameOutage) {
      this.suppressed++;
      return;
    }

    const skipped = this.suppressed
      ? ` (${this.suppressed} further call${this.suppressed > 1 ? 's' : ''} returned nothing since the last warning)`
      : '';
    const until = this.downUntil ? ` — skipping it until ${new Date(this.downUntil).toLocaleTimeString()}` : '';
    logger.warn(`Google Books ${cooldown ? cooldown.reason : 'request failed'}: ${message}${skipped}${until}${cooldown?.hint || ''}`);
    this.lastWarnedAt = Date.now();
    this.suppressed = 0;
  }

  /**
   * GET a Books API path (without the base URL). Returns the parsed body, or null while the source
   * is switched off, cooling down after a failure, or when the request itself failed.
   */
  async request(path, params = {}) {
    if (!(await this.enabled())) {
      logger.debug('Google Books is switched off (Settings → General → Metadata)');
      return null;
    }
    if (!this.isAvailable()) {
      this.suppressed++; // reported by the next warning, so an outage says how many calls it cost
      logger.debug(`Google Books skipped (${this.lastError}) until ${new Date(this.downUntil).toLocaleTimeString()}`);
      return null;
    }

    const apiKey = await this.apiKey();
    const query = { ...params };
    if (apiKey) query.key = apiKey;

    try {
      await this.throttle();
      const response = await axios.get(`${this.baseUrl}/${path}`, { params: query, timeout: await this.timeoutMs() });
      this.downUntil = 0;
      this.lastError = null;
      this.suppressed = 0;
      return response.data;
    } catch (error) {
      this.warnFailure(error, apiKey);
      return null;
    }
  }

  async searchBooks(query, maxResults = 40) {
    const data = await this.request('volumes', { q: query, maxResults });
    return data?.items?.map(item => this.formatBook(item)) || [];
  }

  // Used by the linkAuthors maintenance script. Returns null instead of throwing: an outage (or the
  // source being switched off) is expected here and warnFailure has already reported it once.
  async getBookById(id) {
    const data = await this.request(`volumes/${encodeURIComponent(id)}`);
    return data ? this.formatBook(data) : null;
  }

  async searchByAuthor(authorName) {
    return this.searchBooks(`inauthor:${authorName}`);
  }

  async searchByISBN(isbn) {
    return this.searchBooks(`isbn:${isbn}`);
  }

  formatBook(item) {
    const info = item.volumeInfo || {};
    return {
      googleBooksId: item.id,
      title: info.title,
      subtitle: info.subtitle,
      author: info.authors?.[0] || null,
      authors: info.authors || [],
      description: info.description,
      isbn10: info.industryIdentifiers?.find(i => i.type === 'ISBN_10')?.identifier,
      isbn13: info.industryIdentifiers?.find(i => i.type === 'ISBN_13')?.identifier,
      publishedDate: info.publishedDate,
      publisher: info.publisher,
      pageCount: info.pageCount,
      language: info.language,
      coverUrl: info.imageLinks?.thumbnail?.replace('http:', 'https:'),
      rating: info.averageRating,
      ratingsCount: info.ratingsCount,
      genres: info.categories
    };
  }
}

module.exports = new GoogleBooksService();
