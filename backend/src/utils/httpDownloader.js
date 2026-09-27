// Minimal built-in download manager: streams a URL to disk with retries,
// resume (HTTP Range) and throttled progress callbacks.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const sanitizeFileName = (name, maxLen = 150) =>
  String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, maxLen) || 'untitled';

/**
 * Download `url` to `destPath`.
 * @returns {Promise<{path: string, bytes: number, contentType: string}>}
 */
const downloadFile = async (url, destPath, { headers = {}, onProgress, retries = 3, timeoutMs = 60000, maxBytes } = {}) => {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const partPath = `${destPath}.part`;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let existing = 0;
    try {
      existing = (await fs.promises.stat(partPath)).size;
    } catch (e) { /* no partial file */ }

    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: timeoutMs,
        maxRedirects: 10,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          ...(existing ? { Range: `bytes=${existing}-` } : {}),
          ...headers
        },
        validateStatus: s => s >= 200 && s < 300
      });

      const resumed = response.status === 206;
      if (!resumed) existing = 0;
      const total = parseInt(response.headers['content-length'] || '0', 10) + existing;
      const contentType = response.headers['content-type'] || '';

      if (/text\/html/i.test(contentType)) {
        response.data.destroy();
        throw Object.assign(new Error('Server returned an HTML page instead of a file (link expired or blocked)'), { fatal: true });
      }

      let received = existing;
      let lastEmit = 0;
      const writer = fs.createWriteStream(partPath, { flags: resumed ? 'a' : 'w' });

      await new Promise((resolve, reject) => {
        response.data.on('data', chunk => {
          received += chunk.length;
          if (maxBytes && received > maxBytes) {
            response.data.destroy(new Error(`File exceeds size limit (${Math.round(maxBytes / 1048576)} MB)`));
            return;
          }
          if (onProgress && Date.now() - lastEmit > 1000) {
            lastEmit = Date.now();
            onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null });
          }
        });
        response.data.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
        response.data.pipe(writer);
      });

      if (total && received < total) throw new Error(`Incomplete download (${received}/${total} bytes)`);
      await fs.promises.rename(partPath, destPath);
      if (onProgress) onProgress({ received, total: total || received, percent: 100 });
      return { path: destPath, bytes: received, contentType };
    } catch (error) {
      lastError = error;
      if (error.fatal || error.response?.status === 404 || error.response?.status === 403) break;
      if (error.response?.status === 416) {
        // Bad resume offset — start over
        await fs.promises.unlink(partPath).catch(() => {});
      }
      logger.warn(`Download attempt ${attempt}/${retries} failed for ${new URL(url).host}: ${error.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  await fs.promises.unlink(partPath).catch(() => {});
  throw lastError;
};

module.exports = { downloadFile, sanitizeFileName, USER_AGENT };
