// Audiobook pipeline: resolve a search result into audio parts -> download ->
// convert into a single chaptered, tagged .m4b (with cover) -> save to library.
//
// Settings:
//   audiobook_format    m4b (default) | original (keep downloaded files, no conversion)
//   audiobook_bitrate   AAC bitrate, default 64k (transparent for speech)
//   audiobook_channels  1 (default, mono) | 2
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const cheerio = require('cheerio');
const ytdlp = require('../utils/ytdlp');
const { ffmpegPath, ffprobePath } = require('../utils/binaries');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { downloadFile, sanitizeFileName, USER_AGENT } = require('../utils/httpDownloader');
const { emit, getLibraryFolder, notifyAudiobookshelf, moveAcrossDevices } = require('./libraryImport');
const { AUDIO_EXT_RE } = require('./webAudiobookSearch');

const execFileP = promisify(execFile);
const MAX_TOTAL_BYTES = 4 * 1024 ** 3;

const progress = (bookId, stage, extra = {}) => {
  emit('download:progress', { bookId, source: 'audiobook', stage, ...extra });
  if (extra.message) logger.info(`[audiobook ${bookId.slice(0, 8)}] ${extra.message}`);
};

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ---------- Resolve: turn a search result into a list of audio parts ----------

const resolveLibrivox = async (result) => {
  const librivox = require('./librivox');
  const chapters = await librivox.getChapters(result.rssUrl || result.downloadUrl);
  return chapters.filter(c => c.url).map(c => ({ url: c.url, title: c.title }));
};

const resolveArchive = async (result) => {
  const internetArchive = require('./internetArchive');
  const identifier = result.identifier || /archive\.org\/details\/([^/?#]+)/.exec(result.downloadUrl || '')?.[1];
  if (!identifier) throw new Error('Missing Internet Archive identifier');
  const files = await internetArchive.getFiles(identifier);
  // Items often carry the same tracks at several bitrates; keep one copy of each (highest bitrate)
  const byTrack = new Map();
  for (const f of files) {
    const key = f.name.replace(/_(64|128|256|vbr)kb(?=\.)/i, '').replace(/\.(mp3|m4a|m4b|ogg|flac)$/i, '').toLowerCase();
    const rank = /_64kb/i.test(f.name) ? 1 : /\.ogg$/i.test(f.name) ? 0 : 2;
    const prev = byTrack.get(key);
    if (!prev || rank > prev.rank) byTrack.set(key, { ...f, rank });
  }
  return [...byTrack.values()].sort((a, b) => naturalSort(a.name, b.name))
    .map(f => ({ url: f.url, title: f.title || path.basename(f.name, path.extname(f.name)) }));
};

const audioLinksFromHtml = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href], audio[src], source[src]').each((i, el) => {
    const raw = $(el).attr('href') || $(el).attr('src');
    if (!raw || !AUDIO_EXT_RE.test(raw)) return;
    try { urls.add(new URL(raw, baseUrl).href); } catch (e) { /* bad URL */ }
  });
  return [...urls].sort(naturalSort).map(u => ({
    url: u,
    title: decodeURIComponent(path.basename(new URL(u).pathname)).replace(/\.[a-z0-9]+$/i, '')
  }));
};

const resolveWebPage = async (url) => {
  if (AUDIO_EXT_RE.test(url)) {
    return { parts: [{ url, title: decodeURIComponent(path.basename(new URL(url).pathname)).replace(/\.[a-z0-9]+$/i, '') }] };
  }

  // Direct audio behind a non-obvious URL, or an HTML page listing audio files
  try {
    const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000, responseType: 'stream', maxRedirects: 10 });
    const ctype = res.headers['content-type'] || '';
    if (/^audio\//i.test(ctype)) {
      res.data.destroy();
      return { parts: [{ url, title: 'Audiobook' }] };
    }
    if (/html/i.test(ctype)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of res.data) {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 5 * 1024 * 1024) break;
      }
      res.data.destroy();
      const parts = audioLinksFromHtml(Buffer.concat(chunks).toString('utf8'), res.request?.res?.responseUrl || url);
      if (parts.length) return { parts };
    } else {
      res.data.destroy();
    }
  } catch (e) {
    logger.debug(`Direct fetch of ${url} failed (${e.message}); trying yt-dlp`);
  }

  // Let yt-dlp handle it (YouTube, SoundCloud, archive.org, and ~1800 other sites)
  return { ytdlp: url };
};

const resolve = async (result) => {
  switch (result.source || result.type) {
    case 'librivox': return { parts: await resolveLibrivox(result) };
    case 'archive': return { parts: await resolveArchive(result) };
    case 'youtube': return { ytdlp: result.downloadUrl || result.url };
    default: return resolveWebPage(result.downloadUrl || result.url);
  }
};

// ---------- Download ----------

const downloadParts = async (bookId, parts, workDir) => {
  const files = [];
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const ext = (path.extname(new URL(part.url).pathname).match(/^\.[a-z0-9]{2,4}$/i)?.[0] || '.mp3').toLowerCase();
    const dest = path.join(workDir, `${String(i + 1).padStart(3, '0')}${ext}`);
    progress(bookId, 'downloading', { part: i + 1, parts: parts.length, percent: Math.round((i / parts.length) * 100), message: `Downloading part ${i + 1}/${parts.length}` });
    const { bytes } = await downloadFile(part.url, dest, { maxBytes: MAX_TOTAL_BYTES - total });
    total += bytes;
    files.push({ path: dest, title: part.title || `Part ${i + 1}` });
  }
  return files;
};

const downloadWithYtdlp = async (bookId, url, workDir) => {
  progress(bookId, 'downloading', { percent: 0, message: `Fetching audio with yt-dlp from ${new URL(url).hostname}` });
  let info = null;
  try {
    info = await ytdlp.run(url, { dumpSingleJson: true, flatPlaylist: true });
  } catch (e) {
    throw new Error(`No downloadable audio found at ${new URL(url).hostname}: ${ytdlp.describeError(e)}`);
  }

  // "Full audiobook" uploads that are really a 2-minute teaser/scam are common; reject them
  const minMinutes = parseInt(await getSetting('audiobook_min_minutes'), 10) || 20;
  const totalSeconds = info?.duration || (info?.entries || []).reduce((s, e) => s + (e?.duration || 0), 0);
  if (totalSeconds && totalSeconds < minMinutes * 60) {
    throw new Error(`Only ${Math.round(totalSeconds / 60)} min long — too short to be the full audiobook (minimum ${minMinutes} min)`);
  }

  try {
    await ytdlp.run(url, {
      format: 'bestaudio/best',
      output: path.join(workDir, '%(playlist_index|1)03d - %(title).120B.%(ext)s'),
      noPart: true,
      restrictFilenames: true,
      yesPlaylist: true,
      maxFilesize: '3G'
    });
  } catch (e) {
    throw new Error(`Download failed: ${ytdlp.describeError(e)}`);
  }

  const files = (await fs.readdir(workDir))
    .filter(f => !/\.(json|part|ytdl|jpg|png|webp)$/i.test(f))
    .sort(naturalSort)
    .map(f => ({ path: path.join(workDir, f), title: f.replace(/^\d{3} - /, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ') }));
  if (!files.length) throw new Error('yt-dlp finished but produced no audio files');

  // Single video with chapter markers -> use them
  const chapters = files.length === 1 && Array.isArray(info?.chapters) && info.chapters.length > 1
    ? info.chapters.map(c => ({ title: c.title, start: c.start_time, end: c.end_time }))
    : null;
  return { files, chapters };
};

// ---------- Convert ----------

const probe = async (file) => {
  const { stdout } = await execFileP(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', file], { maxBuffer: 20 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  return {
    duration: parseFloat(data.format?.duration) || 0,
    chapters: (data.chapters || []).map((c, i) => ({ title: c.tags?.title || `Chapter ${i + 1}`, start: parseFloat(c.start_time), end: parseFloat(c.end_time) }))
  };
};

// Run ffmpeg, reporting progress against an expected output duration (seconds)
const runFfmpeg = (args, totalSeconds, onPercent) => new Promise((resolve, reject) => {
  const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', ...args], { windowsHide: true });
  let stderr = '';
  proc.stdout.on('data', d => {
    const m = /out_time_ms=(\d+)/.exec(d.toString());
    if (m && totalSeconds && onPercent) onPercent(Math.min(99, Math.round((parseInt(m[1], 10) / 1e6 / totalSeconds) * 100)));
  });
  proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4000); });
  proc.on('error', reject);
  proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-4).join(' ')}`))));
});

const escapeMeta = (s = '') => String(s).replace(/([=;#\\\n])/g, '\\$1');

const buildFfmetadata = (meta, chapters) => {
  const lines = [';FFMETADATA1'];
  for (const [k, v] of Object.entries(meta)) if (v) lines.push(`${k}=${escapeMeta(v)}`);
  for (const c of chapters) {
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${escapeMeta(c.title)}`);
  }
  return lines.join('\n') + '\n';
};

const fetchCover = async (coverUrl, workDir) => {
  if (!coverUrl) return null;
  try {
    const dest = path.join(workDir, 'cover.img');
    await downloadFile(coverUrl.replace(/^http:/, 'https:'), dest, { retries: 1, timeoutMs: 15000, maxBytes: 10 * 1024 * 1024 });
    return dest;
  } catch (e) {
    logger.debug(`Cover download failed: ${e.message}`);
    return null;
  }
};

/**
 * Convert audio files into one .m4b.
 * @returns {Promise<{chapters: Array<{id,title,start,end}>, duration: number}>}
 */
const convertToM4b = async ({ bookId, files, chapterOverride, meta, coverPath, outPath, workDir, mergeByTitle = false }) => {
  const bitrate = (await getSetting('audiobook_bitrate')) || '64k';
  const channels = (await getSetting('audiobook_channels')) || '1';

  const probes = [];
  for (const f of files) probes.push(await probe(f.path));
  const totalDuration = probes.reduce((s, p) => s + p.duration, 0);

  let chapters;
  if (chapterOverride?.length) chapters = chapterOverride;
  else if (files.length === 1 && probes[0].chapters.length > 1) chapters = probes[0].chapters;
  else {
    let t = 0;
    chapters = [];
    files.forEach((f, i) => {
      const prev = chapters[chapters.length - 1];
      // mergeByTitle: consecutive parts of the same chapter (e.g. TTS chunks) become one chapter
      if (mergeByTitle && prev && !f.first && prev.title === f.title) prev.end = t + probes[i].duration;
      else chapters.push({ title: f.title || `Chapter ${chapters.length + 1}`, start: t, end: t + probes[i].duration });
      t += probes[i].duration;
    });
  }

  // Step 1: normalise every part to AAC so they can be joined losslessly
  const encoded = [];
  let doneSeconds = 0;
  for (let i = 0; i < files.length; i++) {
    const out = path.join(workDir, `enc_${String(i).padStart(3, '0')}.m4a`);
    await runFfmpeg(['-i', files[i].path, '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', bitrate, '-ac', String(channels), '-ar', '44100', out],
      probes[i].duration,
      pct => progress(bookId, 'converting', { percent: Math.round(((doneSeconds + (pct / 100) * probes[i].duration) / (totalDuration || 1)) * 95) }));
    doneSeconds += probes[i].duration;
    encoded.push(out);
  }

  // Step 2: join, add tags, chapters and cover
  const listPath = path.join(workDir, 'concat.txt');
  await fs.writeFile(listPath, encoded.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const metaPath = path.join(workDir, 'meta.txt');
  await fs.writeFile(metaPath, buildFfmetadata(meta, chapters));

  const joinArgs = (withCover) => {
    const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-i', metaPath];
    if (withCover) args.push('-i', coverPath);
    args.push('-map', '0:a', '-map_metadata', '1', '-map_chapters', '1');
    if (withCover) args.push('-map', '2:v', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic');
    args.push('-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', outPath);
    return args;
  };

  progress(bookId, 'converting', { percent: 96, message: 'Writing chapters and tags' });
  try {
    await runFfmpeg(joinArgs(!!coverPath), totalDuration);
  } catch (e) {
    if (!coverPath) throw e;
    logger.warn(`Cover embed failed, saving without cover: ${e.message}`);
    await runFfmpeg(joinArgs(false), totalDuration);
  }

  return {
    chapters: chapters.map((c, i) => ({ id: i, title: c.title, start: c.start, end: c.end })),
    duration: totalDuration
  };
};

// ---------- Orchestration ----------

const queue = [];
const active = new Set();
let running = false;

const processJob = async ({ bookId, result, userId, onFailed }) => {
  const { Book, Author, Notification } = require('../models');
  const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
  if (!book) return;

  const authorName = sanitizeFileName(book.author?.name || 'Unknown');
  const bookTitle = sanitizeFileName(book.title);
  // BOOKARR_WORK_DIR lets Docker keep multi-GB scratch files on a mounted volume instead of the container layer
  const workDir = path.join(process.env.BOOKARR_WORK_DIR || os.tmpdir(), 'bookarr-audiobook', `${bookId}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    await book.update({ status: 'downloading', downloadName: `Audiobook: ${result.indexer || result.source || 'web'}`, downloadClientId: null, downloadId: null });
    emit('book:updated', { bookId, status: 'downloading' });

    const libraryFolder = await getLibraryFolder('audiobook');
    if (!libraryFolder) throw new Error('No audiobooks folder configured (Settings > General)');

    progress(bookId, 'resolving', { message: `Resolving ${result.indexer || result.source}: ${result.title}` });
    const resolved = await resolve(result);

    let files;
    let chapterOverride = null;
    if (resolved.ytdlp) {
      ({ files, chapters: chapterOverride } = await downloadWithYtdlp(bookId, resolved.ytdlp, workDir));
    } else {
      if (!resolved.parts?.length) throw new Error('No audio files found for this result');
      files = await downloadParts(bookId, resolved.parts, workDir);
    }

    const destDir = path.join(libraryFolder, authorName, bookTitle);
    await fs.mkdir(destDir, { recursive: true });
    const format = (await getSetting('audiobook_format')) || 'm4b';

    let filePath;
    let chapters = null;
    let duration = null;

    if (format === 'original') {
      progress(bookId, 'saving', { message: `Saving ${files.length} file(s)` });
      for (const [i, f] of files.entries()) {
        const name = `${String(i + 1).padStart(3, '0')} - ${sanitizeFileName(f.title, 100)}${path.extname(f.path)}`;
        await moveAcrossDevices(f.path, path.join(destDir, name));
      }
      filePath = files.length === 1 ? path.join(destDir, (await fs.readdir(destDir)).sort(naturalSort)[0]) : destDir;
    } else {
      const coverPath = await fetchCover(book.coverUrl, workDir);
      const tmpOut = path.join(workDir, 'out.m4b');
      progress(bookId, 'converting', { percent: 0, message: `Converting ${files.length} file(s) to M4B` });
      ({ chapters, duration } = await convertToM4b({
        bookId,
        files,
        chapterOverride,
        coverPath,
        outPath: tmpOut,
        workDir,
        meta: {
          title: book.title,
          album: book.title,
          artist: book.author?.name,
          album_artist: book.author?.name,
          composer: book.narrator,
          genre: 'Audiobook',
          date: book.publishedDate?.slice(0, 4),
          comment: book.description?.slice(0, 1000)
        }
      }));
      filePath = path.join(destDir, `${authorName} - ${bookTitle}.m4b`);
      progress(bookId, 'saving', { message: `Saving to ${filePath}` });
      await moveAcrossDevices(tmpOut, filePath);
    }

    await book.update({
      status: 'available',
      filePath,
      mediaType: 'audiobook',
      bookType: 'audiobook',
      audioFormat: format === 'original' ? path.extname(files[0].path).slice(1) : 'm4b',
      chapters,
      duration: duration ? Math.round(duration / 60) : book.duration,
      availableFormats: { ...(book.availableFormats || {}), audiobook: true },
      downloadName: null,
      // Arrival time for the Dashboard's "New Arrivals" row; a re-run keeps the first one
      importedAt: book.importedAt || new Date()
    });
    emit('book:updated', { bookId, status: 'available' });
    progress(bookId, 'done', { percent: 100, path: filePath, message: `Audiobook ready: ${book.title}` });
    notifyAudiobookshelf().catch(() => {});
    
    const { sendWebhook } = require('./webhookService');
    sendWebhook('New Audiobook Downloaded', `${book.title} by ${book.author?.name || 'Unknown'} has been processed and is ready.`, book.coverImage);
    
    if (userId) {
      await Notification.create({ userId, type: 'download_complete', title: 'Audiobook ready', message: `"${book.title}" was added to your library`, metadata: { bookId } }).catch(() => {});
    }
    return { ok: true };
  } catch (error) {
    logger.error(`Audiobook pipeline failed for "${book.title}": ${error.message}`);
    await book.update({ status: 'wanted', downloadName: null });
    emit('book:updated', { bookId, status: 'wanted' });
    // With a fallback, the next source is tried and the final outcome is reported there
    progress(bookId, 'failed', { message: error.message, willRetry: !!onFailed });
    if (userId && !onFailed) {
      await Notification.create({ userId, type: 'download_failed', title: 'Audiobook failed', message: `"${book.title}": ${error.message}`, metadata: { bookId } }).catch(() => {});
    }
    return { ok: false, error: error.message };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

// One job at a time: conversion is CPU-heavy
const pump = async () => {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    let outcome = { ok: false, error: 'crashed' };
    try {
      outcome = (await processJob(job)) || outcome;
    } catch (e) {
      logger.error(`Audiobook job crashed: ${e.message}`);
    }
    active.delete(job.bookId);
    if (!outcome.ok && job.onFailed) {
      Promise.resolve().then(() => job.onFailed(outcome.error)).catch(e => logger.error(`Audiobook fallback failed: ${e.message}`));
    }
  }
  running = false;
};

/**
 * Queue a result from webAudiobookSearch.searchAll for a book.
 * @param {function} [opts.onFailed] called with the error if this attempt fails (source fallback)
 */
const enqueue = (bookId, result, { userId, onFailed } = {}) => {
  if (!result || !(result.downloadUrl || result.url || result.rssUrl || result.identifier)) throw new Error('Invalid audiobook result');
  if (active.has(bookId)) return false;
  active.add(bookId);
  queue.push({ bookId, result, userId, onFailed });
  progress(bookId, 'queued', { position: queue.length });
  pump();
  return true;
};

const isActive = (bookId) => active.has(bookId);

module.exports = { enqueue, isActive, resolve, convertToM4b, audioLinksFromHtml };
