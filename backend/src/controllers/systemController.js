const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3');
const AdmZip = require('adm-zip');
const sequelize = require('../config/database');
const { dataDir, dbPath, backupDir } = require('../config/paths');
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
const CORE_TABLES = ['Users', 'Books', 'Settings'];

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

// Thrown for anything the user uploaded that is not a usable Bookarr backup (-> HTTP 400)
class InvalidBackupError extends Error {}

// Accepts a raw .sqlite/.sqlite3/.db (older exports) or the .zip bundle this controller writes
function extractDatabaseFromUpload(uploadPath, uploadName) {
  if (/\.(sqlite3?|db)$/i.test(uploadName || '')) {
    assertSqliteHeader(uploadPath);
    return uploadPath;
  }

  let zip;
  try {
    zip = new AdmZip(uploadPath);
  } catch (e) {
    throw new InvalidBackupError('That file is neither a SQLite database nor a readable .zip archive');
  }

  const entries = zip.getEntries();
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
    '  settings.json    A readable copy of the settings table (handy for a diff).',
    '  metadata.json    The same facts as above, machine readable.',
    '',
    'Not inside (by design)',
    '----------------------',
    '  - Your ebooks and audiobooks. They live in the library folders; back those up',
    '    with the filesystem (rsync, NAS snapshots, ...).',
    '  - Logs, caches (synthesised TTS audio, downloaded tools) and the JWT secret.',
    '',
    'Restoring',
    '---------',
    '  Settings -> System -> Backup & Restore -> "Restore backup", then pick this file.',
    '  A .zip behaves exactly like a raw .sqlite exported by an older Bookarr.',
    '  Bookarr copies the current database into its backups folder before swapping, so',
    '  a restore can always be undone by hand.',
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
      database: path.basename(dbPath),
      databaseBytes: bytes,
      tables: await inspectDatabase(snapshot),
      includes: [
        'database.sqlite (settings, users, books, reading/listening progress, notifications, indexers, download clients)',
        'settings.json (readable copy of the settings table)',
        'metadata.json (version, row counts, sizes)',
        'RESTORE.txt (what is inside, what is not)'
      ],
      excludes: [
        'library media files (ebooks/audiobooks) - back up the library and download folders separately',
        'logs, caches and the JWT signing secret'
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

// POST /api/system/backup/restore - swap the live database for an uploaded backup
exports.restoreBackup = async (req, res) => {
  const upload = req.files && (req.files.dbFile || req.files.backup);
  if (!upload) {
    return res.status(400).json({ error: 'No backup file uploaded (send it as the "dbFile" form field)' });
  }

  const uploadPath = upload.tempFilePath || upload.path;
  const uploadName = upload.name || 'backup';
  let candidate = null;
  let extracted = false;

  try {
    candidate = extractDatabaseFromUpload(uploadPath, uploadName);
    extracted = candidate !== uploadPath;

    const tables = await inspectDatabase(candidate);
    const missing = CORE_TABLES.filter((table) => !(table in tables));
    if (missing.length) {
      throw new InvalidBackupError(`Not a Bookarr database - the ${missing.join(' / ')} table(s) are missing`);
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

    console.log(`Database restored from ${uploadName} (safety copy: ${path.basename(safetySnapshot)})`);
    return res.json({
      message: 'Backup restored. You have been signed out, so please sign in again.',
      restoredFrom: uploadName,
      safetySnapshot: path.basename(safetySnapshot),
      tables: restored
    });
  } catch (error) {
    const rejected = error instanceof InvalidBackupError
      || /not a database|integrity|SQLite file header|missing/i.test(error.message);
    if (!rejected) console.error('Backup restore error:', error);
    return res.status(rejected ? 400 : 500).json({ error: error.message });
  } finally {
    if (extracted && candidate) removeQuietly(candidate);
  }
};


