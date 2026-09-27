// Fetches pages that sit behind bot protection (DDoS-Guard / Cloudflare).
// Uses FlareSolverr when `flaresolverr_url` is configured, and falls back to the
// local stealth Puppeteer pool otherwise (or if FlareSolverr fails). A FlareSolverr
// that cannot be reached, or that hands back the interstitial unsolved, is skipped
// for a cooldown period instead of being retried on every fetch, so a useless URL
// costs one warning per cooldown instead of one round-trip per scrape.
const axios = require('axios');
const browserPool = require('./browserPool');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// Includes DDoS-Guard's "Redirecting..." stub (served before the check page): returning it as the
// finished page made every Anna's mirror look parked
const CHALLENGE_RE = /DDoS-Guard|ddg-captcha|Just a moment|Checking your browser|Attention Required|cf-browser-verification|<title>\s*Redirecting\.\.\.\s*<\/title>/i;
const FS_SESSION = 'bookarr';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isChallenge = (html = '') => CHALLENGE_RE.test(html.slice(0, 5000));

const FS_COOLDOWN_MS = 10 * 60 * 1000;

let fsSessionReady = false;
let fsDownUntil = 0;      // while in the future, FlareSolverr is skipped entirely
let fsLastError = null;   // last reported failure, so one outage logs one warning

const fsFail = (endpoint, err) => {
  fsSessionReady = false;
  fsDownUntil = Date.now() + FS_COOLDOWN_MS;
  if (err.message === fsLastError) return;
  fsLastError = err.message;
  logger.warn(`FlareSolverr unavailable at ${endpoint} (${err.message}), using the built-in browser for ${FS_COOLDOWN_MS / 60000} min`);
};

const fsOk = () => {
  fsDownUntil = 0;
  fsLastError = null;
};

// FlareSolverr can answer `ok` / "Challenge solved!" while still returning the
// interstitial itself (DDoS-Guard's manual CAPTCHA, for instance). That is as useless
// as being down, so it shares the cooldown - otherwise every Anna's Archive fetch pays
// the round-trip once more before the built-in browser steps in.
// A CAPTCHA served to FlareSolverr's IP/fingerprint doesn't clear in minutes, so wait longer
const FS_CHALLENGE_COOLDOWN_MS = 60 * 60 * 1000;
const fsChallenged = (host) => {
  fsDownUntil = Date.now() + FS_CHALLENGE_COOLDOWN_MS;
  const reason = `challenge:${host}`;
  if (reason === fsLastError) return;
  fsLastError = reason;
  logger.warn(`FlareSolverr got a CAPTCHA page for ${host}; using the built-in browser for ${FS_CHALLENGE_COOLDOWN_MS / 60000} min`);
};

const flareSolverrUrl = async () => {
  if (Date.now() < fsDownUntil) return null;
  const url = await getSetting('flaresolverr_url');
  if (!url) return null;
  return url.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
};

// A FlareSolverr session is a single browser tab: two requests at once overwrite each other
// (Anna's Archive searches came back with the DuckDuckGo audiobook search page). Requests on the
// session are queued one at a time. One shared session, since each session is a whole Chrome
// instance on the FlareSolverr host and several at once made it time out.
const sessionQueues = new Map(); // session -> promise tail
const readySessions = new Set();
const sessionFor = () => FS_SESSION;
const sameSite = (a, b) => {
  try {
    const host = (u) => new URL(u).hostname.replace(/^www\./, '');
    return host(a) === host(b) || host(a).endsWith(`.${host(b)}`) || host(b).endsWith(`.${host(a)}`);
  } catch (e) {
    return true; // unparsable final URL: don't reject on that alone
  }
};

const flareSolverrRequest = (endpoint, url, opts = {}) => {
  const session = sessionFor(url);
  const run = (sessionQueues.get(session) || Promise.resolve()).catch(() => {}).then(() => flareSolverrRequestNow(endpoint, url, session, opts));
  sessionQueues.set(session, run.catch(() => {}));
  return run;
};

const flareSolverrRequestNow = async (endpoint, url, session, { waitSeconds = 0, timeoutMs = 60000 } = {}) => {
  if (!fsSessionReady) readySessions.clear(); // FlareSolverr restarted or failed: recreate sessions
  if (!readySessions.has(session)) {
    try {
      await axios.post(endpoint, { cmd: 'sessions.create', session }, { timeout: 30000 });
    } catch (e) {
      // Session may already exist; FlareSolverr returns an error in that case, which is fine
    }
    readySessions.add(session);
    fsSessionReady = true;
  }

  const body = { cmd: 'request.get', url, session, maxTimeout: timeoutMs };
  if (waitSeconds) body.waitInSeconds = waitSeconds; // honoured by FlareSolverr >= 3.3.22, ignored before
  const { data } = await axios.post(endpoint, body, { timeout: timeoutMs + 30000 });

  if (data.status !== 'ok' || !data.solution) {
    if (/session/i.test(data.message || '')) readySessions.delete(session);
    throw new Error(`FlareSolverr: ${data.message || data.status}`);
  }
  // Never hand back another site's page as this one
  if (data.solution.url && !sameSite(data.solution.url, url)) {
    throw new Error(`FlareSolverr returned a page from ${new URL(data.solution.url).hostname} for ${new URL(url).hostname}`);
  }
  return {
    url: data.solution.url,
    status: data.solution.status,
    html: data.solution.response || '',
    userAgent: data.solution.userAgent,
    cookies: data.solution.cookies || []
  };
};

// Navigate a page and wait until any bot-protection interstitial has cleared.
// Tolerates the navigations the challenge itself triggers.
const gotoPastChallenge = async (page, url, { timeoutMs = 60000, waitForSelector } = {}) => {
  const deadline = Date.now() + timeoutMs;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (e) {
    if (!/context was destroyed|ERR_ABORTED/i.test(e.message)) throw e;
  }

  while (Date.now() < deadline) {
    try {
      const html = await page.content();
      if (!isChallenge(html)) {
        if (!waitForSelector) return html;
        const found = await page.$(waitForSelector);
        if (found) return html;
      }
    } catch (e) {
      // Page is mid-navigation; try again shortly
    }
    await sleep(1500);
  }
  const html = await page.content().catch(() => '');
  if (isChallenge(html)) throw new Error('Timed out waiting for bot-protection challenge');
  return html;
};

const newPage = async () => {
  const page = await browserPool.newPage(); // full page: bot checks may need every resource
  await page.setUserAgent(USER_AGENT);
  return page;
};

/**
 * Fetch a page's HTML, solving bot protection if needed.
 * @returns {Promise<{html: string, url: string, via: string}>}
 */
const fetchHtml = async (url, { timeoutMs = 60000, waitForSelector, flaresolverr = true } = {}) => {
  // `flaresolverr: false` for sites without bot protection (search engines): keeps them off the slow, shared session
  const endpoint = flaresolverr ? await flareSolverrUrl() : null;
  if (endpoint) {
    try {
      const res = await flareSolverrRequest(endpoint, url, { timeoutMs });
      if (!isChallenge(res.html)) {
        fsOk();
        return { html: res.html, url: res.url, via: 'flaresolverr' };
      }
      fsChallenged(new URL(url).host);
    } catch (e) {
      fsFail(endpoint, e);
    }
  }

  const page = await newPage();
  try {
    const html = await gotoPastChallenge(page, url, { timeoutMs, waitForSelector });
    return { html, url: page.url(), via: 'puppeteer' };
  } finally {
    await page.close().catch(() => {});
  }
};

/**
 * Repeatedly load a page until `extract(html)` returns a truthy value.
 * Used for pages with a server-enforced countdown (e.g. Anna's slow downloads).
 * `extract` may throw to abort early (e.g. "no slots available").
 */
const pollHtml = async (url, extract, { timeoutMs = 240000, intervalMs = 3000 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  const endpoint = await flareSolverrUrl();

  if (endpoint) {
    try {
      while (Date.now() < deadline) {
        const res = await flareSolverrRequest(endpoint, url, { waitSeconds: 5 });
        if (isChallenge(res.html)) {
          // It could not clear the interstitial; retrying would just eat the whole budget
          fsChallenged(new URL(url).host);
          break;
        }
        const found = extract(res.html);
        if (found) {
          fsOk();
          return found;
        }
        // Countdown pages need real wall-clock time to pass before a reload yields the link
        await sleep(Math.max(intervalMs, 15000));
      }
      if (Date.now() >= deadline) return null;
    } catch (e) {
      if (e.abort) throw e;
      fsFail(endpoint, e);
    }
  }

  // The browser gets its own budget, since the FlareSolverr attempt above may have spent some
  const browserDeadline = Date.now() + timeoutMs;
  const page = await newPage();
  try {
    await gotoPastChallenge(page, url, { timeoutMs: Math.min(90000, timeoutMs) });
    while (Date.now() < browserDeadline) {
      let html = '';
      try {
        html = await page.content();
      } catch (e) {
        // Page reloading itself after countdown
      }
      if (html && !isChallenge(html)) {
        const found = extract(html);
        if (found) return found;
      }
      await sleep(intervalMs);
    }
    return null;
  } finally {
    await page.close().catch(() => {});
  }
};

module.exports = { fetchHtml, pollHtml, isChallenge, USER_AGENT };
