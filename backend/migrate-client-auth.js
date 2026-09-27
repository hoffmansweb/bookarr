const sequelize = require('./src/config/database');

async function migrate() {
  try {
    await sequelize.query(`ALTER TABLE DownloadClients ADD COLUMN username TEXT;`);
    console.log('✓ Added username column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ Username column already exists');
    }
  }

  try {
    await sequelize.query(`ALTER TABLE DownloadClients ADD COLUMN password TEXT;`);
    console.log('✓ Added password column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ Password column already exists');
    }
  }

  process.exit(0);
}

migrate();
