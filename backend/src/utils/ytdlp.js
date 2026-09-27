// yt-dlp wrapper.
// - Always passes Node as the JavaScript runtime: YouTube needs one to solve its player
//   challenges; without it yt-dlp falls back to limited clients whose streams often 403.
// - YouTube breaks old yt-dlp versions regularly, so on a 403 / bot-check error it updates
//   yt-dlp once and retries; the daily update job lives in jobs/index.js.
const { execFile } = require('child_process');
const { promisify } = require('util');
const ytdlpExec = require('yt-dlp-exec');
const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
const logger = require('../config/logger');
const { ffmpegPath, pythonPath } = require('./binaries');

const execFileP = promisify(execFile);
const JS_RUNTIME = `node:${process.execPath}`;
const RETRYABLE = /HTTP Error 403|Sign in to confirm|nsig extraction failed|Requested format is not available|Precondition check failed|n challenge/i;

let lastUpdate = 0;
let updating = null;

/** Update yt-dlp (standalone binary self-update, or pip in Docker). At most every 6 hours. */
const update = async ({ force = false } = {}) => {
  if (updating) return updating;
  if (!force && Date.now() - lastUpdate < 6 * 60 * 60 * 1000) return false;
  lastUpdate = Date.now();
  updating = (async () => {
    try {
      // Docker installs yt-dlp with pip (YOUTUBE_DL_SKIP_DOWNLOAD set); a pip install can't self-update
      const { stdout } = process.env.YOUTUBE_DL_SKIP_DOWNLOAD
        ? await execFileP(pythonPath, ['-m', 'pip', 'install', '--no-cache-dir', '--quiet', '--upgrade', 'yt-dlp[default]'], { timeout: 180000 })
        : await execFileP(YOUTUBE_DL_PATH, ['-U'], { timeout: 180000, windowsHide: true });
      const { stdout: version } = await execFileP(YOUTUBE_DL_PATH, ['--version'], { timeout: 30000, windowsHide: true });
      logger.info(`yt-dlp is at ${version.trim()}${/Updated yt-dlp to/i.test(stdout) ? ' (just updated)' : ''}`);
      return true;
    } catch (e) {
      logger.warn(`yt-dlp update failed: ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
      return false;
    } finally {
      updating = null;
    }
  })();
  return updating;
};

/**
 * Run yt-dlp with Bookarr defaults. Same signature as yt-dlp-exec: (url, flags).
 */
const run = async (url, flags = {}) => {
  const opts = { jsRuntimes: JS_RUNTIME, ffmpegLocation: ffmpegPath, noWarnings: true, ...flags };
  try {
    return await ytdlpExec(url, opts);
  } catch (error) {
    const text = `${error.stderr || ''} ${error.message || ''}`;
    if (!RETRYABLE.test(text)) throw error;
    logger.warn('yt-dlp was blocked by the site; updating yt-dlp and retrying once');
    await update({ force: true });
    return ytdlpExec(url, opts);
  }
};

// Short, readable error for UI/logs instead of the full command line
const describeError = (error) => {
  const text = `${error.stderr || ''}\n${error.message || ''}`;
  const line = text.split('\n').find(l => /^ERROR:/.test(l.trim()));
  return (line || text.split('\n')[0] || 'yt-dlp failed').replace(/^\s*ERROR:\s*/, '').trim().slice(0, 300);
};

// Daily update is scheduled by jobs/index.js
module.exports = { run, update, describeError };
