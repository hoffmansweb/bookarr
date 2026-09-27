// Nightly housekeeping and database backups.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

const DAY = 24 * 3600 * 1000;

// Remove entries older than maxAgeMs inside dir (not the dir itself); returns count removed
const pruneDir = async (dir, maxAgeMs) => {
  let removed = 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      const st = await fs.stat(full);
      if (Date.now() - st.mtimeMs < maxAgeMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed++;
    } catch (e) { /* in use or already gone */ }
  }
  return removed;
};

/**
 * Leftovers from interrupted jobs: Anna's staging files, audiobook work folders,
 * and old notifications.
 */
const housekeeping = async () => {
  const dirs = new Set([
    path.join(os.tmpdir(), 'bookarr-incoming'),
    path.join(process.env.BOOKARR_WORK_DIR || os.tmpdir(), 'bookarr-audiobook')
  ]);
  for (const key of ['ebooks_folder', 'audiobooks_folder', 'books_folder']) {
    const lib = await getSetting(key);
    if (lib) dirs.add(path.join(lib, '.bookarr-incoming'));
  }
  let files = 0;
  for (const dir of dirs) files += await pruneDir(dir, DAY); // jobs never run a day, so older = abandoned

  // Notifications: read ones after 30 days, anything after 90
  let notifications = 0;
  try {
    const { Notification } = require('../models');
    notifications += await Notification.destroy({ where: { read: true, createdAt: { [Op.lt]: new Date(Date.now() - 30 * DAY) } } });
    notifications += await Notification.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - 90 * DAY) } } });
  } catch (e) {
    logger.warn(`Notification cleanup failed: ${e.message}`);
  }
  return `Removed ${files} leftover temp item(s) and ${notifications} old notification(s)`;
};

/**
 * Consistent SQLite snapshot (VACUUM INTO) next to the database, keeping the newest
 * `db_backup_keep` (default 7). Docker: lands in the data volume under /app/data/backups.
 */
const backupDatabase = async () => {
  const sequelize = require('../config/database');
  const dbPath = sequelize.options.storage;
  if (!dbPath) throw new Error('Database path unknown');
  const dir = path.join(path.dirname(dbPath), 'backups');
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = path.join(dir, `bookarr-${stamp}.sqlite`);
  // SQL string literal: escape single quotes in the path
  await sequelize.query(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const keep = Math.max(1, parseInt(await getSetting('db_backup_keep'), 10) || 7);
  const backups = (await fs.readdir(dir)).filter(f => /^bookarr-.*\.sqlite$/.test(f)).sort().reverse();
  for (const old of backups.slice(keep)) await fs.unlink(path.join(dir, old)).catch(() => {});

  const size = (await fs.stat(target)).size;
  return `Saved ${path.basename(target)} (${(size / 1048576).toFixed(1)} MB); keeping ${Math.min(keep, backups.length)} backup(s)`;
};

module.exports = { housekeeping, backupDatabase };
