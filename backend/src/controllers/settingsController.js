const { Setting } = require('../models');

// Keys the container can supply through the environment (docker-compose sets the folder
// paths to the mounted volumes). getSetting() already falls back to process.env, so the
// backend is using these defaults - this list only makes them visible on the Settings page,
// where a fresh container would otherwise show them as unset.
const ENV_PROVIDED_KEYS = [
  'ebooks_folder',
  'audiobooks_folder',
  'books_folder',
  'download_folder',
  'flaresolverr_url',
  'searxng_url',
  'tts_openai_base_url',
  'google_books_api_key',
  'annas_archive_domains'
];

const withEnvDefaults = (settingsObj) => {
  for (const key of ENV_PROVIDED_KEYS) {
    const fromEnv = process.env[key.toUpperCase()];
    if (fromEnv && !settingsObj[key]) settingsObj[key] = fromEnv;
  }
  return settingsObj;
};

exports.getAll = async (req, res) => {
  try {
    const settings = await Setting.findAll();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(withEnvDefaults(settingsObj));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const updates = req.body;
    
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) continue;
      // An empty value clears the setting (e.g. removing a FlareSolverr/SearXNG URL)
      if (value === '') await Setting.destroy({ where: { key } });
      else await Setting.upsert({ key, value });
    }
    
    res.json({ message: 'Settings updated' });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.getSetting = async (key) => {
  try {
    const setting = await Setting.findOne({ where: { key } });
    return setting?.value || process.env[key.toUpperCase()];
  } catch (error) {
    return process.env[key.toUpperCase()];
  }
};

exports.exportSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="bookarr-settings.json"');
    res.send(JSON.stringify(settingsObj, null, 2));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.importSettings = async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await Setting.upsert({ key, value });
    }
    res.json({ message: 'Settings imported' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
