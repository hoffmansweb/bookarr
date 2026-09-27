const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const logger = require('../config/logger');
// A fresh Docker container has no JWT secret at all: docker-compose.yml passes an empty
// JWT_SECRET (see .env.docker), and an unset secret makes jsonwebtoken throw
// "secretOrPrivateKey must have a value" — which the catch blocks below turned into a 400 on
// the very first registration. ensureJwtSecret() generates one into the data volume instead.
const { ensureJwtSecret } = require('../config/secrets');

// /register stores the email through express-validator's normalizeEmail()
// (lower-cases, strips gmail dots/+tags), but /login looked up the raw input,
// so e.g. "John.Doe@Gmail.com" could register but never log in.
let normalizeEmail;
try {
  normalizeEmail = require('validator').normalizeEmail; // dependency of express-validator
} catch (e) {
  normalizeEmail = (email) => String(email).trim().toLowerCase();
}

const DEFAULT_EXPIRE = '7d';

// Signing with an empty secret throws, and an unparseable JWT_EXPIRE (e.g. "7 days") throws too.
// Both are configuration mistakes rather than failed logins, so repair the secret, fall back to a
// sane lifetime and say so in the log instead of failing every sign-in with an opaque error.
const generateToken = (userId) => {
  ensureJwtSecret(); // no-op once JWT_SECRET is set (or already generated into the data folder)
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('No JWT secret available — check that the Bookarr data folder is writable');
  }

  const expiresIn = process.env.JWT_EXPIRE;
  if (!expiresIn) return jwt.sign({ id: userId }, secret, { expiresIn: DEFAULT_EXPIRE });

  try {
    return jwt.sign({ id: userId }, secret, { expiresIn });
  } catch (error) {
    if (!/expiresIn/i.test(error.message)) throw error;
    logger.warn(`JWT_EXPIRE="${expiresIn}" is not a valid duration (e.g. 7d, 12h) — using ${DEFAULT_EXPIRE}`);
    return jwt.sign({ id: userId }, secret, { expiresIn: DEFAULT_EXPIRE });
  }
};

exports.register = async (req, res) => {
  const who = req.body?.email || req.body?.username || 'unknown';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Always send a readable `error` next to the raw array: the register form shows that
      // string, so a rejected password never surfaces as a bare "400 Bad Request".
      const first = errors.array()[0];
      logger.warn(`Registration rejected for "${who}": ${first.msg}`);
      return res.status(400).json({ error: first.msg, errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // The first account becomes the admin: without this a fresh install (and a new Docker
    // container) has no way into Settings, because those routes are admin-only.
    const isFirstUser = (await User.count()) === 0;
    const user = await User.create({ username, email, password, ...(isFirstUser ? { role: 'admin' } : {}) });
    if (isFirstUser) logger.info(`First account "${user.username}" created as admin`);
    const token = generateToken(user.id);
    logger.info(`Account "${user.username}" registered`);

    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      // Two people can race for the same name; name the field that collided, never raw SQL
      const field = String(error.errors?.[0]?.path || '').toLowerCase();
      const message = field.includes('email')
        ? 'That email address is already registered'
        : 'That username is already taken';
      logger.warn(`Registration conflict for "${who}": ${message}`);
      return res.status(409).json({ error: message });
    }

    // The User model validates the email as well (it is the backstop for writes that never go
    // through this route), so a value express-validator accepts can still come back as a
    // SequelizeValidationError. Strip Sequelize's "Validation error: ... on email failed"
    // wrapper and answer 400, because the cause is the submitted input.
    if (error.name === 'SequelizeValidationError') {
      const message = String(error.errors?.[0]?.message || error.message)
        .replace(/^Validation error:\s*/i, '')
        .replace(/\s+on \w+ failed$/i, '');
      logger.warn(`Registration rejected for "${who}": ${message}`);
      return res.status(400).json({ error: message });
    }

    // Configuration problems (an unwritable data folder, a broken JWT secret) are ours, not the
    // user's: report them as 500 and keep the real message, which is what makes them fixable.
    logger.error(`Registration failed for "${who}":`, error);
    res.status(500).json({ error: `Could not create the account: ${error.message}` });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const rawEmail = String(email).trim();
    const candidates = [...new Set([rawEmail, normalizeEmail(rawEmail)].filter(Boolean))];
    const user = await User.findOne({ where: { email: { [Op.in]: candidates } } });
    if (!user) {
      logger.warn(`Login failed for "${rawEmail}" (no such account)`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (!(await user.comparePassword(password))) {
      logger.warn(`Login failed for "${rawEmail}" (wrong password)`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    logger.info(`"${user.username}" signed in`);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token
    });
  } catch (error) {
    logger.error(`Login error for "${req.body?.email || 'unknown'}":`, error);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.getProfile = async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      ttsSettings: {
        provider: req.user.ttsProvider,
        voiceName: req.user.ttsVoiceName,
        speed: req.user.ttsSpeed,
        languageCode: req.user.ttsLanguageCode
      }
    }
  });
};

exports.updateTTSSettings = async (req, res) => {
  try {
    const { voiceName, speed, languageCode, provider } = req.body;
    
    const updateData = {};
    if (voiceName !== undefined) updateData.ttsVoiceName = voiceName;
    if (speed !== undefined) updateData.ttsSpeed = speed;
    if (languageCode !== undefined) updateData.ttsLanguageCode = languageCode;
    if (provider !== undefined) updateData.ttsProvider = provider;
    
    await req.user.update(updateData);
    
    res.json({
      message: 'TTS settings updated',
      ttsSettings: {
        provider: req.user.ttsProvider,
        voiceName: req.user.ttsVoiceName,
        speed: req.user.ttsSpeed,
        languageCode: req.user.ttsLanguageCode
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    // Same minimum as /register (express-validator isLength({ min: 6 }))
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findByPk(req.user.id);
    if (!(await user.comparePassword(currentPassword))) {
      // 400, not 401: the frontend treats any 401 as an expired session and logs out
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    await user.update({ password: newPassword });
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
