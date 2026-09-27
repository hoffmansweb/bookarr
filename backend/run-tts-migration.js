require('dotenv').config();
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');
    
    const addTTSSettings = require('./src/migrations/addTTSSettings');
    await addTTSSettings();
    
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
