const sequelize = require('../config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE Books ADD COLUMN bookType TEXT DEFAULT 'ebook';
    `);
    console.log('Added bookType column');

    await sequelize.query(`
      ALTER TABLE Books ADD COLUMN duration INTEGER;
    `);
    console.log('Added duration column');

    await sequelize.query(`
      ALTER TABLE Books ADD COLUMN narrator TEXT;
    `);
    console.log('Added narrator column');

    await sequelize.query(`
      ALTER TABLE Books ADD COLUMN audioFormat TEXT;
    `);
    console.log('Added audioFormat column');

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
