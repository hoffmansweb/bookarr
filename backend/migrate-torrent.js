const sequelize = require('./src/config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE Indexers ADD COLUMN type VARCHAR(255) DEFAULT 'newznab';
    `);
    console.log('✓ Added type column to Indexers');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ Indexers type column already exists');
    } else {
      console.error('Indexers migration failed:', error.message);
    }
  }

  try {
    await sequelize.query(`
      CREATE TABLE DownloadClients_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        apiKey TEXT NOT NULL,
        useSsl INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        category TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);
    await sequelize.query(`INSERT INTO DownloadClients_new SELECT * FROM DownloadClients;`);
    await sequelize.query(`DROP TABLE DownloadClients;`);
    await sequelize.query(`ALTER TABLE DownloadClients_new RENAME TO DownloadClients;`);
    console.log('✓ Updated DownloadClients type enum');
  } catch (error) {
    console.error('DownloadClients migration failed:', error.message);
  }

  process.exit(0);
}

migrate();
