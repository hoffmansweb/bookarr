const jwt = require('jsonwebtoken');
const { User, Setting } = require('../models');
const crypto = require('crypto');

// Cache the API key so we don't query the DB on every request
let cachedApiKey = null;
let apiKeyChecked = false;

const getApiKey = async () => {
  if (apiKeyChecked && cachedApiKey) return cachedApiKey;
  
  const apiKeySetting = await Setting.findOne({ where: { key: 'api_key' } });
  if (apiKeySetting) {
    cachedApiKey = apiKeySetting.value;
  } else {
    // Generate a new 32-character hex API key automatically (Arr-app standard)
    cachedApiKey = crypto.randomBytes(16).toString('hex');
    await Setting.create({ key: 'api_key', value: cachedApiKey });
  }
  
  apiKeyChecked = true;
  return cachedApiKey;
};

const auth = async (req, res, next) => {
  try {
    // 1. API Key Auth (for external integrations like Sonarr/Radarr APIs)
    const reqApiKey = req.header('X-Api-Key') || req.query.apikey;
    if (reqApiKey) {
      const validKey = await getApiKey();
      if (reqApiKey === validKey) {
        // Find an admin user to bind to this request
        const adminUser = await User.findOne({ where: { role: 'admin' } });
        req.user = adminUser || { id: 'api', role: 'admin' }; 
        return next();
      }
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    // 2. JWT Auth (for internal web interface)
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error('No authentication provided');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);

    if (!user) throw new Error('User not found');

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

const adminAuth = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { auth, adminAuth, getApiKey };
