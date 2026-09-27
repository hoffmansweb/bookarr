const addFilePath = require('../migrations/addFilePath');

async function initializeDatabase() {
  console.log('Using SQLite - database file will be created automatically');
  await addFilePath();
  return Promise.resolve();
}

module.exports = initializeDatabase;
