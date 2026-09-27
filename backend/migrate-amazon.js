const sequelize = require('./src/config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE Users ADD COLUMN amazonCookies TEXT;
    `);
    console.log('✓ Added amazonCookies column');
    process.exit(0);
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ Column already exists');
      process.exit(0);
    }
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
