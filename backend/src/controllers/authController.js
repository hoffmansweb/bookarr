const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');

// /register stores the email through express-validator's normalizeEmail()
// (lower-cases, strips gmail dots/+tags), but /login looked up the raw input,
// so e.g. "John.Doe@Gmail.com" could register but never log in.
let normalizeEmail;
try {
  normalizeEmail = require('validator').normalizeEmail; // dependency of express-validator
} catch (e) {
  normalizeEmail = (email) => String(email).trim().toLowerCase();
}

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;
    
    // The first account becomes the admin: without this a fresh install (and a new Docker
    // container) has no way into Settings, because those routes are admin-only.
    const isFirstUser = (await User.count()) === 0;
    const user = await User.create({ username, email, password, ...(isFirstUser ? { role: 'admin' } : {}) });
    if (isFirstUser) console.log(`First account "${user.username}" created as admin`);
    const token = generateToken(user.id);

    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
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
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(400).json({ error: 'Login failed' });
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
