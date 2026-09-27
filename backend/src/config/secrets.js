// Ensure JWT_SECRET exists. If it isn't provided via the environment (the common
// case in Docker), generate one once and keep it in the data volume so sessions
// survive restarts and image updates.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.env.NODE_ENV === 'production' ? '/app/data' : path.join(__dirname, '..', '..');

const ensureJwtSecret = () => {
  // Placeholder values from the example env files are publicly known, so treat them as unset
  const current = process.env.JWT_SECRET || '';
  if (current && !/^(your-secret-key|change-me)/i.test(current)) return;

  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) {
      process.env.JWT_SECRET = existing;
      return;
    }
  } catch (e) { /* not created yet */ }

  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  process.env.JWT_SECRET = secret;
  console.log(`Generated a new JWT secret at ${secretFile}`);
};

module.exports = { ensureJwtSecret };
