const sequelize = require('./src/config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE books ADD COLUMN lastReadingPosition TEXT;
    `);
    console.log('✓ Added lastReadingPosition column');
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      console.log('✓ Column already exists');
    } else {
      console.error('Migration error:', error.message);
    }
  }
  process.exit(0);
}

migrate();
