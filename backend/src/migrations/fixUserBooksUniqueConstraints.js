// UserBooks is the User<->Book join table (User.belongsToMany(Book, { through: UserBooks })).
// An older schema gave UserId and BookId their own UNIQUE constraints, which means a user could
// only ever own ONE row and a book could only ever be in ONE user's library. Saving progress for
// a second book then failed with "SQLITE_CONSTRAINT: UNIQUE constraint failed: UserBooks.UserId",
// so the reader's 10-second progress POST answered 500 forever.
//
// The constraints were created by UserBooks.sync({ alter: true }), which ran on every boot:
// Sequelize's SQLite alter reads PRAGMA INDEX_LIST, finds the composite primary key's autoindex,
// and concludes that each key column is individually UNIQUE - then rebuilds the table that way.
// With 0 or 1 rows that copy succeeds silently, which is why the broken schema kept coming back;
// with 2+ rows it aborts (UNIQUE constraint failed: UserBooks_backup.UserId) and leaves an empty
// UserBooks_backup behind. server.js now calls plain sync() for this table instead.
//
// This migration undoes the damage: it drops an empty leftover backup table and rebuilds UserBooks
// with the composite primary key the model actually describes, copying every row over.
// Idempotent: it no-ops once the table has no column-level UNIQUE left.
const sequelize = require('../config/database');
const logger = require('../config/logger');

const TABLE = 'UserBooks';
const REBUILT = 'UserBooks_rebuilt';
const LEFTOVER = 'UserBooks_backup';
const COLUMNS = [
  'starred', 'progress', 'lastRead', 'lastPosition', 'lastReadingPosition',
  'ttsPosition', 'createdAt', 'updatedAt', 'UserId', 'BookId', 'ttsCharPosition'
];

const CREATE_REBUILT = `
  CREATE TABLE \`${REBUILT}\` (
    \`starred\` TINYINT(1) DEFAULT 0,
    \`progress\` FLOAT DEFAULT '0',
    \`lastRead\` DATETIME,
    \`lastPosition\` FLOAT DEFAULT '0',
    \`lastReadingPosition\` VARCHAR(255),
    \`ttsPosition\` VARCHAR(255),
    \`createdAt\` DATETIME NOT NULL,
    \`updatedAt\` DATETIME NOT NULL,
    \`UserId\` UUID NOT NULL REFERENCES \`Users\` (\`id\`),
    \`BookId\` UUID NOT NULL REFERENCES \`Books\` (\`id\`),
    \`ttsCharPosition\` INTEGER DEFAULT 0,
    PRIMARY KEY (\`UserId\`, \`BookId\`)
  )`;

const tableExists = async (name) => !!(
  await sequelize.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`)
)[0][0];

module.exports = async () => {
  try {
    let changed = false;

    // An aborted Sequelize alter leaves an empty UserBooks_backup behind; it is never read and
    // only confuses later migrations, so drop it. Refuse to touch it if it somehow holds rows.
    if (await tableExists(LEFTOVER)) {
      const [[{ stale }]] = await sequelize.query(`SELECT COUNT(*) AS stale FROM \`${LEFTOVER}\``);
      if (stale === 0) {
        await sequelize.query(`DROP TABLE \`${LEFTOVER}\``);
        logger.info(`Dropped empty ${LEFTOVER} left behind by a failed schema sync`);
        changed = true;
      } else {
        logger.warn(`${LEFTOVER} holds ${stale} row(s); leaving it alone`);
      }
    }

    const [rows] = await sequelize.query(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${TABLE}'`
    );
    const ddl = rows[0] && rows[0].sql;

    // Fresh install: sequelize.sync() creates the table correctly, nothing to repair.
    if (!ddl) return changed;
    // A UNIQUE on the composite pair is fine; only per-column UNIQUE breaks multi-book users.
    if (!/UNIQUE/i.test(ddl.replace(/UNIQUE\s*\(\s*`?\w+`?\s*,[\s\S]*?\)/gi, ''))) return changed;

    const [[{ kept }]] = await sequelize.query(`SELECT COUNT(*) AS kept FROM \`${TABLE}\``);

    await sequelize.query(`DROP TABLE IF EXISTS \`${REBUILT}\``);
    await sequelize.query(CREATE_REBUILT);

    const cols = COLUMNS.map(c => `\`${c}\``).join(', ');
    await sequelize.query(`INSERT INTO \`${REBUILT}\` (${cols}) SELECT ${cols} FROM \`${TABLE}\``);

    await sequelize.query(`DROP TABLE \`${TABLE}\``);
    await sequelize.query(`ALTER TABLE \`${REBUILT}\` RENAME TO \`${TABLE}\``);

    logger.info(`Rebuilt ${TABLE} with a composite primary key only (removed per-column UNIQUE, ${kept} row${kept === 1 ? '' : 's'} kept)`);
    return true;
  } catch (error) {
    logger.warn(`UserBooks constraint migration skipped: ${error.message}`);
    return false;
  }
};
