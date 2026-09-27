const sequelize = require('../config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE Books ADD COLUMN availableFormats TEXT DEFAULT '{}';
    `);
    console.log('Added availableFormats column');
    
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
