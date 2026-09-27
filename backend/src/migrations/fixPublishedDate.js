const sequelize = require('../config/database');

async function migrate() {
  try {
    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    await sequelize.query(`
      CREATE TABLE Books_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        description TEXT,
        isbn10 TEXT,
        isbn13 TEXT,
        publishedDate TEXT,
        publisher TEXT,
        pageCount INTEGER,
        language TEXT,
        coverUrl TEXT,
        bookType TEXT DEFAULT 'ebook',
        duration INTEGER,
        narrator TEXT,
        audioFormat TEXT,
        googleBooksId TEXT,
        goodreadsId TEXT,
        rating REAL,
        ratingsCount INTEGER,
        status TEXT DEFAULT 'wanted',
        monitored INTEGER DEFAULT 0,
        series TEXT,
        seriesPosition REAL,
        genres TEXT,
        metadata TEXT,
        downloadName TEXT,
        createdAt TEXT,
        updatedAt TEXT,
        authorId TEXT
      );
    `);
    console.log('Created new Books table');

    await sequelize.query(`
      INSERT INTO Books_new SELECT * FROM Books;
    `);
    console.log('Copied data');

    await sequelize.query(`DROP TABLE Books;`);
    console.log('Dropped old table');

    await sequelize.query(`ALTER TABLE Books_new RENAME TO Books;`);
    console.log('Renamed table');

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
