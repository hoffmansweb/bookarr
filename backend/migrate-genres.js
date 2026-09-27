const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.run(`ALTER TABLE Books ADD COLUMN genres TEXT`, (err) => {
  if (err) {
    console.error('Migration error:', err.message);
  } else {
    console.log('Successfully added genres column');
  }
  db.close();
});
