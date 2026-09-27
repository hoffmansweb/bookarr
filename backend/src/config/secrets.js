// Ensure JWT_SECRET exists. If it isn't provided via the environment (the common
// case in Docker), generate one once and keep it in the data volume so sessions
// survive restarts and image updates. The placeholder values that ship in the example
// env files are treated as "not set": they are public knowledge, and signing tokens with
// one would let anybody mint a valid token for any account.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./paths');

// Values that ship in the example env files are public knowledge, so they must never be used as a
// signing key. Covers every variant found in the repo:
//   backend/.env          "<your-secure-random-secret-here>"
//   backend/.env.example  "your-secret-key-change-in-production"
//   INSTALL.md            "your-secret-key-here"
//   .env.docker           ""                       (already blank)
// plus the usual "change-me" / "changeme" forms. A generated secret is 96 hex characters and can
// never start with one of these words.
const PLACEHOLDER = /^(your[-_ ]|change[-_ ]?(this|me|it)|changeme|placeholder|secret|password)/i;

const isPlaceholder = (value) => {
  const trimmed = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (trimmed === '') return true;           // nothing set (the .env.docker default)
  if (/^<.+>$/.test(trimmed)) return true;   // "<...>" is always an example value, never a secret
  return PLACEHOLDER.test(trimmed);
};

const ensureJwtSecret = () => {
  const current = String(process.env.JWT_SECRET || '').trim();

  // A real secret is already in place: keep it, so existing sessions stay valid. A hand-picked one
  // that is too short only gets a warning — silently replacing it would sign everybody out.
  if (current && !isPlaceholder(current)) {
    if (current.length < 32) {
      console.warn('JWT_SECRET is shorter than 32 characters — consider replacing it with a longer random value');
    }
    return;
  }

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
