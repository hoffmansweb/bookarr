// Where Bookarr keeps mutable state (the database, the nightly/auto snapshots and the JWT secret).
// Docker/production keeps all of it in the /app/data volume; a native install writes into the backend
// folder. The database, the secret helper and the backup controller all import this module so those
// paths can never drift apart.
require('dotenv').config(); // NODE_ENV may come from a native install's .env

const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? '/app/data' : path.join(__dirname, '..', '..');
const dbPath = path.join(dataDir, 'database.sqlite');
const backupDir = path.join(dataDir, 'backups');

module.exports = { isProduction, dataDir, dbPath, backupDir };
