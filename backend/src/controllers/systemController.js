const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const sequelize = require('../config/database');
const { dataDir, dbPath, backupDir } = require('../config/paths');
const logger = require('../config/logger');
const axios = require('axios');

const { getSetting } = require('./settingsController');

// Version reported to the UI (About tab / System status). The Docker build passes
// BOOKARR_VERSION, a native checkout falls back to package.json.
const APP_VERSION = process.env.BOOKARR_VERSION || require('../../package.json').version;

function getDiskSpace(folderPath) {
  try {
    if (!folderPath) return null;
    
    // Resolve absolute path
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath)) {
      return {
        path: resolvedPath,
        error: 'Path does not exist',
        free: 0,
        total: 0,
        used: 0,
        percentage: 0
      };
    }

    // Node v18.9+ has statfsSync
    if (fs.statfsSync) {
      const stats = fs.statfsSync(resolvedPath);
      const free = stats.bfree * stats.bsize;
      const total = stats.blocks * stats.bsize;
      const used = total - free;
      return {
        path: resolvedPath,
        free,
        total,
        used,
        percentage: total > 0 ? Math.round((used / total) * 100) : 0
      };
    }

    return null;
  } catch (err) {
    console.error(`Disk space check failed for ${folderPath}:`, err.message);
    return {
      path: folderPath,
      error: err.message,
      free: 0,
      total: 0,
      used: 0,
      percentage: 0
    };
  }
}

exports.getStatus = async (req, res) => {
  try {
    // 1. Check Database connection
    let dbConnected = false;
    try {
      await sequelize.authenticate();
      dbConnected = true;
    } catch (e) {
      console.error('Sequelize connection failed:', e.message);
    }

    // 2. Read folder paths from settings
    const ebooksFolder = await getSetting('ebooks_folder');
    const audiobooksFolder = await getSetting('audiobooks_folder');
    const downloadFolder = await getSetting('download_folder');

    const disks = [];
    if (ebooksFolder) {
      const info = getDiskSpace(ebooksFolder);
      if (info) disks.push({ name: 'Ebooks Library', ...info });
    }
    if (audiobooksFolder) {
      const info = getDiskSpace(audiobooksFolder);
      if (info) disks.push({ name: 'Audiobooks Library', ...info });
    }
    if (downloadFolder) {
      const info = getDiskSpace(downloadFolder);
      if (info) disks.push({ name: 'Downloads Folder', ...info });
    }

    // 3. Gather OS and process stats
    const memory = process.memoryUsage();
    const systemInfo = {
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      version: APP_VERSION,
      dbStatus: dbConnected ? 'connected' : 'disconnected'
    };

    res.json({
      system: systemInfo,
      disks,
      processMemory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// ---------------------------------------------------------------------------------------------
// Updates (Settings -> System -> Updates)
//
// The tab used to call api.github.com from the browser, so a repository without a *published*
// release left a 404 in the console - GitHub answers 404 for /releases/latest while the only release
// is a draft, which is exactly the state Release Drafter leaves behind - and the page could say no
// more than "Could not fetch update data". Asking from here keeps that failure out of the user's
// console, turns it into a sentence, gets the request off the browser's 60-an-hour anonymous limit,
// and lets GITHUB_TOKEN raise it to 5000.
// ---------------------------------------------------------------------------------------------
const UPDATE_API_BASE = (process.env.BOOKARR_UPDATE_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const UPDATE_REPO = process.env.BOOKARR_UPDATE_REPO || 'hoffmansweb/bookarr';
const UPDATE_PAGE = `https://github.com/${UPDATE_REPO}/releases`;
const UPDATE_CACHE_MS = 5 * 60 * 1000;

let updateCache = { at: 0, payload: null };

// "1.2.3", "v1.2.3" and "1.2" come back as [1,2,3] / [1,2]. "master" and "develop" come back as null:
// a branch name is not older or newer than a release, and claiming otherwise is a lie the Updates tab
// used to tell on every branch build ("v0.1.0" !== "master" is just a string comparison).
function parseVersion(value) {
  const match = String(value == null ? '' : value).trim().match(/^v?(\d+(?:\.\d+)*)/i);
  return match ? match[1].split('.').map(Number) : null;
}

// true / false when both sides are versions, null when they cannot be ordered.
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left !== right) return left > right;
  }
  return false;
}

function githubHeaders() {
  const headers = {
    // GitHub refuses requests without a User-Agent, and asks API clients to identify themselves
    'User-Agent': `Bookarr/${APP_VERSION}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  // Optional: a token with public read access. Raises the limit from 60 requests an hour to 5000.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function rateLimitMessage(headers) {
  const reset = Number(headers && headers['x-ratelimit-reset']);
  const when = reset ? new Date(reset * 1000).toLocaleTimeString() : null;
  return `GitHub is rate-limiting the check (60 requests an hour without a token${when ? `; the window resets at ${when}` : ''}). A GITHUB_TOKEN in the container environment raises that to 5000.`;
}

const releasePayload = (release) => ({
  version: String(release.tag_name || release.name || '').replace(/^v/i, ''),
  tag: release.tag_name || null,
  name: release.name || release.tag_name || null,
  url: release.html_url || UPDATE_PAGE,
  publishedAt: release.published_at || null,
  prerelease: Boolean(release.prerelease),
  notes: (release.body || '').slice(0, 4000)
});



// GET /api/system/updates - the newest release GitHub has published, or the sentence explaining why
// there is nothing to compare with. Always 200: `message` is what the UI shows, so "no releases
// published yet" never arrives in the browser as a failed request. `?refresh=1` skips the cache.
exports.checkForUpdates = async (req, res) => {
  const refresh = Boolean(req.query && req.query.refresh);
  if (!refresh && updateCache.payload && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
    return res.json({ ...updateCache.payload, cached: true });
  }

  const answer = {
    current: APP_VERSION,
    canCompare: Boolean(parseVersion(APP_VERSION)),
    checked: false, // true once GitHub answered, even if the answer was 404 or a rate limit
    published: false,
    updateAvailable: null,
    latest: null,
    releasesUrl: UPDATE_PAGE,
    message: '',
    checkedAt: new Date().toISOString()
  };

  try {
    const latest = await axios.get(`${UPDATE_API_BASE}/repos/${UPDATE_REPO}/releases/latest`, {
      headers: githubHeaders(),
      timeout: 15000,
      // 404 means "nothing published yet" here, which is a normal answer rather than an exception
      validateStatus: () => true
    });

    answer.checked = true;
    if (latest.status === 200 && latest.data) {
      answer.published = true;
      answer.latest = releasePayload(latest.data);
      answer.updateAvailable = isNewerVersion(answer.latest.version, APP_VERSION);
      if (answer.updateAvailable === null) {
        answer.message = `This build reports its version as "${APP_VERSION}" (a branch or source build), so it cannot be ordered against release ${answer.latest.tag}. Compare the dates below, or run the ghcr.io image tagged "latest".`;
      } else if (answer.updateAvailable) {
        answer.message = `Bookarr ${answer.latest.tag} is available; you are running ${APP_VERSION}.`;
      } else {
        answer.message = `Bookarr ${answer.latest.tag} is the newest release and you are running ${APP_VERSION}.`;
      }
      logger.info(`Update check: newest release ${answer.latest.tag}, running ${APP_VERSION}, update available: ${answer.updateAvailable}`);
      updateCache = { at: Date.now(), payload: answer };
      return res.json(answer);
    }

    if (latest.status === 404) {
      // Drafts are invisible to this endpoint, and to an anonymous caller in the list as well, so an
      // empty list means the workflow has drafted a release that nobody published yet.
      const list = await axios.get(`${UPDATE_API_BASE}/repos/${UPDATE_REPO}/releases`, {
        headers: githubHeaders(),
        params: { per_page: 5 },
        timeout: 15000,
        validateStatus: () => true
      });
      const releases = Array.isArray(list.data) ? list.data : [];
      const newest = releases.find((entry) => !entry.draft);

      if (newest) {
        // Only reachable when the newest published release is a prerelease: /releases/latest skips those
        answer.published = true;
        answer.latest = releasePayload(newest);
        answer.updateAvailable = isNewerVersion(answer.latest.version, APP_VERSION);
        answer.message = `The newest published release is ${answer.latest.tag}, and it is marked as a prerelease (which /releases/latest skips). Updates are judged against the newest stable release.`;
        logger.info(`Update check: newest published release ${answer.latest.tag} is a prerelease`);
        updateCache = { at: Date.now(), payload: answer };
        return res.json(answer);
      }

      answer.message = `No Bookarr release has been published yet, so there is nothing to compare with. The release workflow drafts them and a person publishes them ("gh release edit <tag> --draft=false") - until then every entry on the releases page is a draft, and GitHub answers 404 for "the latest release".`;
      logger.info('Update check: no published release yet (drafts do not count for /releases/latest)');
      updateCache = { at: Date.now(), payload: answer };
      return res.json(answer);
    }

    if (latest.status === 403 || latest.status === 429) {
      answer.message = rateLimitMessage(latest.headers);
      logger.warn(`Update check refused by GitHub (${latest.status}): ${answer.message}`);
      // A failure is never cached, and it also drops any good answer from earlier: otherwise the tab
      // would keep showing "up to date" for five minutes while the check is actually being refused.
      updateCache = { at: 0, payload: null };
      return res.json(answer);
    }

    answer.message = `GitHub answered ${latest.status}${latest.statusText ? ` ${latest.statusText}` : ''} for the release list, so Bookarr cannot tell whether there is an update. Try again later, or look at ${UPDATE_PAGE}.`;
    logger.warn(`Update check: GitHub answered ${latest.status}`);
    updateCache = { at: Date.now(), payload: answer };
    return res.json(answer);
  } catch (error) {
    // No route to GitHub at all: offline container, DNS, proxy, timeout
    answer.message = `GitHub could not be reached from the Bookarr server (${error.message}), so Bookarr cannot tell whether there is an update. On an install without internet access this is expected.`;
    logger.warn(`Update check failed: ${error.message}`);
    updateCache = { at: 0, payload: null };
    return res.json(answer);
  }
};

exports.getLogs = async (req, res) => {
  try {
    const logFilePath = require('path').join(require('../config/logger').LOG_DIR, 'combined.log');
    
    if (!fs.existsSync(logFilePath)) {
      return res.json({ logs: [] });
    }

    const data = await fs.promises.readFile(logFilePath, 'utf8');
    const lines = data.split('\n').filter(line => line.trim());
    
    // Get last 200 lines
    const lastLines = lines.slice(-200).reverse(); // Reverse so latest logs are on top

    res.json({ logs: lastLines });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Backup & Restore
//
// The SQLite file *is* Bookarr's data: settings, users, books, reading and
// listening progress, notifications, indexers and download clients all live in
// it. The media itself (the ebook/audiobook files) stays in the library folders
// and is deliberately not part of the download - that is what a filesystem
// backup is for. Snapshots go through SQLite's online backup API, so they are
// consistent even while Bookarr is writing.
// ---------------------------------------------------------------------------

const BACKUP_ZIP_LIMIT = 256 * 1024 * 1024; // larger snapshots are sent as a raw .sqlite
const SQLITE_MAGIC = 'SQLite format 3\0';
// Users is the one table a restore cannot invent for itself (no Users table means no accounts at
// all); Books and Settings are recreated empty by Sequelize on the next start-up, so they only warn.
const CORE_TABLES = ['Users', 'Books', 'Settings'];

// Config and secret state that lives in the data directory instead of the database: a native
// install keeps .env (API keys, JWT secret) next to database.sqlite, and Bookarr writes a
// generated session secret to .jwt_secret when the environment has none. Both are tiny, so a
// complete backup carries them; the download is admin-only and RESTORE.txt says plainly that the
// archive holds credentials.
const CONFIG_FILES = [
  { name: '.env', entry: 'config/env.txt' },
  { name: '.jwt_secret', entry: 'config/jwt_secret.txt' }
];

const PLACEHOLDER_SECRET = /^(your-secret-key|change-me)/i;

function uniqueTempPath(label) {
  return path.join(os.tmpdir(), `bookarr-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}.tmp`);
}

function fileStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // already gone, or held open elsewhere - neither is worth failing a backup over
  }
}

function openReadOnly(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(db)));
  });
}

// Consistent copy of the live database. VACUUM INTO writes a compacted, fully synced copy
// and works while the app is running; node-sqlite3's own backup() API returns an empty file
// in this build, so it is deliberately not used. busyTimeout rides out a concurrent write.
function snapshotDatabase(target) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 10000);
    db.run(`VACUUM INTO '${String(target).replace(/'/g, "''")}'`, (err) => {
      db.close(() => (err ? reject(err) : resolve()));
    });
  });
}

function assertSqliteHeader(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(16);
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString('latin1') !== SQLITE_MAGIC) {
    throw new Error('That file is not a SQLite database (the SQLite file header is missing)');
  }
}

// Runs SQLite's own integrity check and returns a row count per table
async function inspectDatabase(file) {
  const db = await openReadOnly(file);
  try {
    const integrity = await new Promise((resolve, reject) => {
      db.get('PRAGMA integrity_check', (err, row) => {
        if (err) return reject(err);
        resolve(row ? Object.values(row)[0] : null);
      });
    });
    if (integrity !== 'ok') {
      throw new Error(`The database failed SQLite's integrity check (${integrity})`);
    }

    const tables = await new Promise((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type = 'table'", (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).map((row) => row.name).filter((name) => !name.startsWith('sqlite_')));
      });
    });

    const counts = {};
    for (const table of tables) {
      counts[table] = await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS total FROM "${table}"`, (err, row) => resolve(err ? null : row.total));
      });
    }
    return counts;
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

async function readSettingsTable(file) {
  const db = await openReadOnly(file);
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT key, value FROM Settings', (err, result) => (err ? reject(err) : resolve(result || [])));
    });
    return rows.reduce((acc, row) => Object.assign(acc, { [row.key]: row.value }), {});
  } catch (e) {
    return {}; // no Settings table: the database itself still carries everything
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Everything a restore needs that SQLite does not hold, as [{ name, entry, data }]
function collectConfigFiles() {
  const found = [];
  for (const { name, entry } of CONFIG_FILES) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) {
      found.push({ name, entry, data: fs.readFileSync(file) });
    } else if (name === '.jwt_secret' && process.env.JWT_SECRET && !PLACEHOLDER_SECRET.test(process.env.JWT_SECRET)) {
      // Docker hands the secret over in the environment instead of a file - carry it too
      found.push({ name, entry, data: Buffer.from(process.env.JWT_SECRET, 'utf8') });
    }
  }
  return found;
}

// The database stores file paths, never file contents, so a backup can tell a user how many media
// files are meant to be on disk and in which folders - that is the half rsync has to cover.
async function libraryInventory(file) {
  const db = await openReadOnly(file);
  try {
    const byType = await new Promise((resolve) => {
      db.all("SELECT mediaType AS type, COUNT(*) AS total FROM Books WHERE filePath IS NOT NULL AND filePath <> '' GROUP BY mediaType", (err, rows) => resolve(err ? [] : (rows || [])));
    });
    const folders = await new Promise((resolve) => {
      db.all("SELECT key, value FROM Settings WHERE key IN ('ebooks_folder', 'audiobooks_folder', 'download_folder')", (err, rows) => resolve(err ? [] : (rows || [])));
    });
    return {
      files: byType.reduce((acc, row) => Object.assign(acc, { [row.type || 'ebook']: row.total }), {}),
      folders: folders.reduce((acc, row) => Object.assign(acc, { [row.key]: row.value }), {})
    };
  } catch (error) {
    return { files: {}, folders: {} };
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

// metadata.json and config/*.txt out of a bundle. A raw .sqlite export (older Bookarr) has neither.
function readBundleExtras(uploadPath, uploadName) {
  const empty = { config: [], expectedSha256: null };
  if (/\.(sqlite3?|db)$/i.test(uploadName || '')) return empty;

  let entries;
  try {
    entries = new AdmZip(uploadPath).getEntries();
  } catch (error) {
    return empty; // a truncated/corrupt archive: extractDatabaseFromUpload rejects it a moment later
  }

  const byName = new Map(entries.map((entry) => [entry.entryName, entry]));
  const extras = { config: [], expectedSha256: null };

  // metadata.json carries a sha256 of the snapshot it shipped with, so a damaged download is caught
  const metadataEntry = byName.get('metadata.json');
  if (metadataEntry) {
    try {
      const sha = JSON.parse(metadataEntry.getData().toString('utf8'))?.database?.sha256;
      if (typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha)) extras.expectedSha256 = sha;
    } catch (error) { /* metadata is advisory */ }
  }

  for (const { name, entry } of CONFIG_FILES) {
    const zipEntry = byName.get(entry);
    if (!zipEntry) continue;
    const data = zipEntry.getData();
    // Refuse to write junk over a working .env or session secret
    const usable = name === '.env'
      ? /^[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(data.toString('utf8'))
      : data.toString('utf8').trim().length >= 32 && !PLACEHOLDER_SECRET.test(data.toString('utf8'));
    if (usable) extras.config.push({ name, data });
  }

  return extras;
}

// Thrown for anything the user uploaded that is not a usable Bookarr backup (-> HTTP 400)
class InvalidBackupError extends Error {}

// Accepts a raw .sqlite/.sqlite3/.db (older exports) or the .zip bundle this controller writes
function extractDatabaseFromUpload(uploadPath, uploadName) {
  if (/\.(sqlite3?|db)$/i.test(uploadName || '')) {
    assertSqliteHeader(uploadPath);
    return uploadPath;
  }

  let entries;
  try {
    // AdmZip only complains about a truncated file once the entries are read
    entries = new AdmZip(uploadPath).getEntries();
  } catch (e) {
    throw new InvalidBackupError('That file is neither a SQLite database nor a readable .zip archive');
  }
  const dbEntry = entries.find((entry) => /(^|\/)database\.sqlite$/i.test(entry.entryName))
    || entries.find((entry) => /\.(sqlite3?|db)$/i.test(entry.entryName));

  if (!dbEntry) {
    throw new InvalidBackupError('The archive contains no .sqlite database (a Bookarr backup holds database.sqlite)');
  }

  const extracted = uniqueTempPath('restore');
  fs.writeFileSync(extracted, dbEntry.getData());
  assertSqliteHeader(extracted);
  return extracted;
}

function backupNotes(metadata) {
  return [
    'Bookarr backup',
    '==============',
    '',
    `Created:  ${metadata.createdAt}`,
    `Bookarr:  ${metadata.version}`,
    `Node:     ${metadata.nodeVersion} (${metadata.platform})`,
    '',
    'Inside this archive',
    '-------------------',
    '  database.sqlite  Everything Bookarr knows: settings, users, books, reading and',
    '                   listening progress, notifications, indexers, download clients.',
    '                   Passwords are stored as bcrypt hashes, never as plain text.',
    '  settings.json    A readable copy of the settings table (handy for a diff).',
    '  config/env.txt   Your .env (API keys, JWT secret) - only when the install has one.',
    '  config/jwt_secret.txt  The generated session secret, when Bookarr made one.',
    '  metadata.json    Version, row counts, database checksum and a library inventory.',
    '',
    'This archive contains credentials, so keep it somewhere safe.',
    '',
    'Not inside (by design)',
    '----------------------',
    '  - Your ebooks and audiobooks. The database stores their paths, not their bytes, so',
    '    back the library and download folders up with the filesystem (rsync, NAS snapshots).',
    '    metadata.json lists how many files to expect and which folders they live in.',
    '  - Logs and caches (synthesised TTS audio, downloaded tools and voices).',
    '',
    'Restoring',
    '---------',
    '  Settings -> System -> Backup & Restore -> "Restore backup", then pick this file.',
    '  A .zip behaves exactly like a raw .sqlite exported by an older Bookarr.',
    '  Bookarr copies the current database into its backups folder before swapping, and renames',
    '  a replaced .env / .jwt_secret to *.backup-<timestamp>, so a restore can be undone by hand.',
    '  A restored .env or JWT secret only takes effect after Bookarr is restarted.',
    ''
  ].join('\n');
}

// GET /api/system/backup/download - a complete, consistent snapshot of Bookarr's data
exports.downloadBackup = async (req, res) => {
  let snapshot = null;
  let handedToClient = false;

  try {
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    const created = fileStamp();
    const configFiles = collectConfigFiles();
    snapshot = uniqueTempPath('snapshot');
    await snapshotDatabase(snapshot);

    const bytes = fs.statSync(snapshot).size;
    const metadata = {
      app: 'Bookarr',
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      dataDirectory: dataDir,
      database: {
        file: path.basename(dbPath),
        bytes,
        sha256: sha256File(snapshot),
        tables: await inspectDatabase(snapshot)
      },
      library: await libraryInventory(snapshot),
      secrets: configFiles.map((item) => item.entry),
      includes: [
        'database.sqlite (settings, users, books, reading/listening progress, notifications, indexers, download clients)',
        'settings.json (readable copy of the settings table)',
        'metadata.json (version, row counts, database checksum, library inventory)',
        'config/env.txt and config/jwt_secret.txt when this install has them (API keys, session secret)',
        'RESTORE.txt (what is inside, what is not)'
      ],
      excludes: [
        'library media files (ebooks/audiobooks) - back up the library and download folders separately',
        'logs and caches (synthesised TTS audio, downloaded tools and voices)'
      ]
    };

    if (bytes > BACKUP_ZIP_LIMIT) {
      // Far too big to keep a second copy in memory: hand over the snapshot itself
      res.setHeader('X-Bookarr-Backup-Format', 'sqlite');
      handedToClient = true;
      return res.download(snapshot, `bookarr-backup-${created}.sqlite`, () => removeQuietly(snapshot));
    }

    const zip = new AdmZip();
    zip.addFile('database.sqlite', fs.readFileSync(snapshot));
    zip.addFile('settings.json', Buffer.from(JSON.stringify(await readSettingsTable(snapshot), null, 2)));
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
    for (const item of configFiles) zip.addFile(item.entry, item.data);
    zip.addFile('RESTORE.txt', Buffer.from(backupNotes(metadata)));
    const archive = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="bookarr-backup-${created}.zip"`);
    res.setHeader('X-Bookarr-Backup-Format', 'zip');
    res.setHeader('Content-Length', archive.length);
    return res.send(archive);
  } catch (error) {
    console.error('Backup download error:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (snapshot && !handedToClient) removeQuietly(snapshot);
  }
};

// The field name differs between clients: the interface sends "dbFile", older scripts send "backup",
// and one file in any field is still worth trying. A name that looks like a Bookarr backup wins over
// a stray extra field.
function pickUpload(files) {
  if (!files) return null;
  const uploaded = [];
  for (const value of Object.values(files)) {
    if (Array.isArray(value)) uploaded.push(...value);
    else if (value) uploaded.push(value);
  }
  return uploaded.find((file) => /\.(zip|sqlite3?|db)$/i.test(file.name || '')) || uploaded[0] || null;
}

// "No file" is not one problem. A body that never arrived as multipart, a multipart header with no
// boundary (express-fileupload ignores those requests entirely) and an upload that died halfway all
// reach the controller as "no file", and the browser only shows "400 Bad Request" - so say which it
// was, and how to get past it.
function describeMissingUpload(req) {
  const contentType = String(req.headers?.['content-type'] || '');
  const announced = Number(req.headers?.['content-length'] || 0);

  if (!contentType.includes('multipart/form-data')) {
    return `No backup file arrived: the request body was sent as "${contentType || 'an unknown content type'}", but a restore uploads the file as multipart/form-data in a field named "dbFile".`;
  }
  if (!/boundary=/i.test(contentType)) {
    return 'No backup file arrived: the request was multipart/form-data with no boundary, so the server could not tell where the file starts and ends. Reload the page so the current interface is loaded, or upload from a client that sets the header itself, e.g. curl -H "Authorization: Bearer <token>" -F "dbFile=@bookarr-backup.zip" http://<bookarr>/api/system/backup/restore';
  }
  return `No backup file arrived: the upload ended after ${announced} bytes. It was refused before it finished - usually because the file is larger than the 8 GB one restore accepts, or the connection dropped. The container log names the reason.`;
}

// POST /api/system/backup/restore - swap the live database for an uploaded backup
exports.restoreBackup = async (req, res) => {
  // express-fileupload answers some refused uploads on its own (a file over the size limit closes the
  // connection with 413), so the response must never be written twice.
  if (res.headersSent) {
    logger.warn('Backup restore: the upload was refused before it reached the controller');
    return undefined;
  }

  const upload = pickUpload(req.files);
  if (!upload) {
    const reason = describeMissingUpload(req);
    logger.warn(`Backup restore refused: ${reason}`);
    return res.status(400).json({ error: reason });
  }

  const uploadPath = upload.tempFilePath || upload.path;
  const uploadName = upload.name || 'backup';
  const uploadBytes = Number(upload.size) || (uploadPath && fs.existsSync(uploadPath) ? fs.statSync(uploadPath).size : 0);

  if (!uploadBytes) {
    removeQuietly(uploadPath);
    const empty = `"${uploadName}" arrived empty (0 bytes), so there was nothing to restore. Download the backup again and retry.`;
    logger.warn(`Backup restore refused: ${empty}`);
    return res.status(400).json({ error: empty });
  }

  logger.info(`Backup restore started: "${uploadName}" (${uploadBytes} bytes) from ${req.user?.username || req.user?.id || 'an admin'}`);
  const extras = readBundleExtras(uploadPath, uploadName);
  let candidate = null;
  let extracted = false;

  try {
    candidate = extractDatabaseFromUpload(uploadPath, uploadName);
    extracted = candidate !== uploadPath;

    const tables = await inspectDatabase(candidate);
    if (!('Users' in tables)) {
      const found = Object.keys(tables).slice(0, 12).join(', ') || 'no tables at all';
      throw new InvalidBackupError(`This file is not a Bookarr database: it has no Users table, so restoring it would leave the install with no accounts. The database you uploaded contains: ${found}.`);
    }
    const missing = CORE_TABLES.filter((table) => !(table in tables));
    const warnings = missing.map((table) => `The uploaded database had no ${table} table, so Bookarr has created an empty one - check your ${table === 'Books' ? 'library' : 'settings'} after restarting.`);
    if (missing.length) {
      logger.warn(`Backup restore: "${uploadName}" has no ${missing.join(', ')} table - recreated empty`);
    }

    // metadata.json carries the sha256 of the snapshot it was written with
    if (extras.expectedSha256 && sha256File(candidate) !== extras.expectedSha256) {
      throw new InvalidBackupError('The database inside this archive does not match the checksum its own metadata.json recorded, so nothing was restored. That happens when the .zip was re-packed, edited or damaged. Unzip the archive and upload the database.sqlite inside it instead - a raw .sqlite file is checked on its own and skips this comparison.');
    }

    // Keep a consistent copy of what we are replacing, so a wrong file is always reversible
    fs.mkdirSync(backupDir, { recursive: true });
    const safetySnapshot = path.join(backupDir, `database-before-restore-${fileStamp()}.sqlite`);
    await snapshotDatabase(safetySnapshot);

    // Close every handle before swapping: an open handle blocks the replace on Windows, and a
    // stale -wal/-shm sidecar would otherwise be replayed into the restored database.
    // Release the open handles without killing the connection manager: sequelize.close() swaps
    // getConnection() for a throwing stub, so the process could never use the database again.
    // drain + destroyAllNow is what Sequelize itself does on process exit, and the pool then
    // reconnects lazily - to whatever file now sits at dbPath.
    await sequelize.connectionManager.pool.drain();
    await sequelize.connectionManager.pool.destroyAllNow();
    removeQuietly(`${dbPath}-wal`);
    removeQuietly(`${dbPath}-shm`);
    fs.copyFileSync(candidate, dbPath);

    // Sequelize opens a fresh connection on the next query - against the restored file
    await sequelize.query('SELECT 1');
    const restored = await inspectDatabase(dbPath);

    // .env / .jwt_secret from the archive. Both are read once at start-up, so a restored secret
    // only applies after a restart; the files they replace are kept as *.backup-<timestamp>.
    const replaced = [];
    for (const item of extras.config) {
      const target = path.join(dataDir, item.name);
      if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.backup-${fileStamp()}`);
      fs.writeFileSync(target, item.data, { mode: 0o600 });
      replaced.push(item.name);
    }

    console.log(`Database restored from ${uploadName} (safety copy: ${path.basename(safetySnapshot)})`);
    return res.json({
      message: replaced.length
        ? `Backup restored, including ${replaced.join(' and ')}. You have been signed out, so please sign in again, and restart Bookarr to load the restored settings.`
        : 'Backup restored. You have been signed out, so please sign in again.',
      restoredFrom: uploadName,
      safetySnapshot: path.basename(safetySnapshot),
      configFiles: replaced,
      tables: restored,
      warnings
    });
  } catch (error) {
    const rejected = error instanceof InvalidBackupError
      || /not a database|integrity|SQLite file header|missing|invalid|central directory|zipper/i.test(error.message);
    // A refusal is about the file the user picked, not a bug in Bookarr: log it as a warning with the
    // reason, so a "400 Bad Request" in the browser can be explained from the container log alone.
    if (rejected) logger.warn(`Backup restore refused ("${uploadName}"): ${error.message}`);
    else logger.error(`Backup restore failed ("${uploadName}"):`, error);
    if (res.headersSent) return undefined;
    return res.status(rejected ? 400 : 500).json({ error: error.message });
  } finally {
    if (extracted && candidate) removeQuietly(candidate);
    // express-fileupload leaves its own copy of the upload in os.tmpdir(); a backup is a whole
    // database, so it must not stay in /tmp once the request that needed it is over.
    if (uploadPath) removeQuietly(uploadPath);
  }
};


