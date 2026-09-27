/**
 * Clears library data out of the Bookarr database while leaving everything else
 * (users, settings, indexers, download clients, TTS config) untouched.
 *
 *   node clearBookData.js                    dry run: report only, writes nothing
 *   node clearBookData.js --yes              delete every book + its UserBooks rows
 *
 * Options (combine as needed):
 *   --keep-wanted       keep books with status 'wanted' (your download queue)
 *   --file-backed-only  only delete books that have a filePath set
 *   --authors           also delete Authors (and UserAuthors follows)
 *   --notifications     also delete book notifications
 *   --vacuum            VACUUM afterwards, shrinking the database file
 *   --no-backup         skip the automatic backup taken before deleting
 *
 * A backup snapshot is written to backend/backups/ unless --no-backup is given.
 */
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const sequelize = require('./src/config/database');
const { Book, Author, UserBooks, Notification, User, Setting, Indexer, DownloadClient } = require('./src/models');

// Sequelize's own registry keys are singular; the association join table is registered by its table name
const followModel = () => sequelize.models.UserAuthors || null;
const countFollows = async () => (followModel() ? followModel().count() : 0);

const USAGE = fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, '');

const args = new Set(process.argv.slice(2));
const has = (name) => args.has(`--${name}`);

if (has('help')) {
  console.log(USAGE);
  process.exit(0);
}

const APPLY = has('yes');
const KEEP_WANTED = has('keep-wanted');
const FILE_BACKED_ONLY = has('file-backed-only');
const DELETE_AUTHORS = has('authors');
const DELETE_NOTIFICATIONS = has('notifications');
const VACUUM = has('vacuum');
const BACKUP = !has('no-backup');

// Every notification the app creates refers back to a book or an author
const NOTIFICATION_TYPES = ['new_book', 'download_complete', 'download_failed'];

const num = (n) => String(n).padStart(5);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const backupDatabase = async () => {
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
  const target = path.join(dir, `database-before-book-cleanup-${stamp}.sqlite`);
  try {
    // Works even while the backend holds the database open
    await sequelize.query(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    fs.copyFileSync(sequelize.options.storage, target);
    console.log(`  (VACUUM INTO failed: ${err.message} - plain file copy used)`);
  }
  return target;
};

(async () => {
  const dbFile = sequelize.options.storage;
  const sizeBefore = fs.statSync(dbFile).size;

  const totalBooks = await Book.count();
  const booksWithFile = await Book.count({ where: { filePath: { [Op.ne]: null } } });
  const audiobooks = await Book.count({ where: { mediaType: 'audiobook' } });
  const totalAuthors = await Author.count();
  const monitoredAuthors = await Author.count({ where: { monitored: true } });
  const totalUserBooks = await UserBooks.count();
  const totalNotifications = await Notification.count();

  // What the flags select for deletion
  const conditions = [];
  if (KEEP_WANTED) {
    // SQL: status <> 'wanted', plus the legacy rows where status is NULL
    conditions.push({ [Op.or]: [{ status: { [Op.ne]: 'wanted' } }, { status: null }] });
  }
  if (FILE_BACKED_ONLY) conditions.push({ filePath: { [Op.ne]: null } });
  const bookWhere = conditions.length ? { [Op.and]: conditions } : {};

  const targets = await Book.findAll({
    where: bookWhere,
    attributes: ['id', 'status', 'mediaType', 'filePath']
  });
  const targetIds = targets.map(b => b.id);
  const targetUserBooks = targetIds.length
    ? await UserBooks.count({ where: { BookId: { [Op.in]: targetIds } } })
    : 0;

  const byStatus = targets.reduce((acc, b) => {
    const key = b.status || '(none)';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log('=== Database now ===');
  console.log(`  ${num(totalBooks)} books            (${booksWithFile} with a filePath, ${audiobooks} audiobooks)`);
  console.log(`  ${num(totalUserBooks)} UserBooks rows   (per-user library / progress / starred)`);
  console.log(`  ${num(totalAuthors)} authors          (${monitoredAuthors} monitored)`);
  console.log(`  ${num(totalNotifications)} notifications`);
  console.log(`  ${num(await User.count())} users, ${await Setting.count()} settings, ${await Indexer.count()} indexers, ${await DownloadClient.count()} download clients, ${await countFollows()} author follows  <- kept`);
  console.log(`  database file: ${dbFile} (${mb(sizeBefore)})`);

  const scope = [KEEP_WANTED ? '--keep-wanted' : null, FILE_BACKED_ONLY ? '--file-backed-only' : null]
    .filter(Boolean).join(' + ');

  console.log(`\n=== ${APPLY ? 'WILL DELETE' : 'DRY RUN - would delete'} ===`);
  console.log(`  ${num(targetIds.length)} books` + (scope ? `  (filtered by ${scope})` : '  (all books)'));
  Object.entries(byStatus).sort((a, b) => b[1] - a[1])
    .forEach(([status, n]) => console.log(`        status ${status.padEnd(12)} ${n}`));
  console.log(`  ${num(targetUserBooks)} UserBooks rows`);
  console.log(`  ${num(DELETE_AUTHORS ? totalAuthors : 0)} authors` + (DELETE_AUTHORS ? ' (+ all UserAuthors follows)' : '   (add --authors to delete them)'));
  console.log(`  ${num(DELETE_NOTIFICATIONS ? totalNotifications : 0)} book notifications` + (DELETE_NOTIFICATIONS ? '' : '   (add --notifications to delete them)'));

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --yes to apply.');
    await sequelize.close();
    process.exit(0);
  }

  if (BACKUP) {
    console.log('\nBacking up the database first...');
    console.log('  saved:', await backupDatabase());
  }

  const removed = await sequelize.transaction(async (t) => {
    const result = { userBooks: 0, books: 0, authors: 0, follows: 0, notifications: 0 };

    if (targetIds.length) {
      result.userBooks = await UserBooks.destroy({ where: { BookId: { [Op.in]: targetIds } }, transaction: t });
      result.books = await Book.destroy({ where: bookWhere, transaction: t });
    }

    if (DELETE_AUTHORS) {
      result.follows = followModel() ? await followModel().destroy({ where: {}, transaction: t }) : 0;
      result.authors = await Author.destroy({ where: {}, transaction: t });
    }

    if (DELETE_NOTIFICATIONS) {
      result.notifications = await Notification.destroy({
        where: { type: { [Op.in]: NOTIFICATION_TYPES } },
        transaction: t
      });
    }

    return result;
  });

  if (VACUUM) await sequelize.query('VACUUM');

  console.log('\n=== Removed ===');
  console.log(`  ${num(removed.books)} books`);
  console.log(`  ${num(removed.userBooks)} UserBooks rows`);
  console.log(`  ${num(removed.authors)} authors, ${num(removed.follows)} follows`);
  console.log(`  ${num(removed.notifications)} notifications`);

  console.log('\n=== Database after ===');
  console.log(`  ${num(await Book.count())} books`);
  console.log(`  ${num(await UserBooks.count())} UserBooks rows`);
  console.log(`  ${num(await Author.count())} authors`);
  console.log(`  ${num(await Notification.count())} notifications`);
  console.log(`  ${num(await User.count())} users, ${await Setting.count()} settings, ${await Indexer.count()} indexers, ${await DownloadClient.count()} download clients, ${await countFollows()} author follows`);
  console.log(`  database file: ${mb(fs.statSync(dbFile).size)}` + (VACUUM ? '' : ' (run with --vacuum to shrink it)'));

  console.log('\nDone. Restart the backend so it picks up the empty library.');
  await sequelize.close();
  process.exit(0);
})().catch(async (error) => {
  console.error('Error:', error);
  try { await sequelize.close(); } catch { /* already closed */ }
  process.exit(1);
});

