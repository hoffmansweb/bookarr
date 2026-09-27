const { Indexer } = require('../models');

exports.getAll = async (req, res) => {
  try {
    const indexers = await Indexer.findAll({ order: [['priority', 'DESC']] });
    res.json(indexers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.url) data.url = data.url.replace(/\/+$/, '');
    const indexer = await Indexer.create(data);
    res.status(201).json(indexer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const indexer = await Indexer.findByPk(req.params.id);
    if (!indexer) {
      return res.status(404).json({ error: 'Indexer not found' });
    }
    const data = { ...req.body };
    if (data.url) data.url = data.url.replace(/\/+$/, '');
    await indexer.update(data);
    res.json(indexer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const indexer = await Indexer.findByPk(req.params.id);
    if (!indexer) {
      return res.status(404).json({ error: 'Indexer not found' });
    }
    await indexer.destroy();
    res.json({ message: 'Indexer deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// List indexers configured in Prowlarr/Jackett. Body: { kind, url, apiKey } (url/apiKey fall back to saved connection)
exports.discover = async (req, res) => {
  try {
    const { getSetting } = require('./settingsController');
    const kind = req.body.kind;
    const url = req.body.url || await getSetting(`${kind}_url`);
    const apiKey = req.body.apiKey || await getSetting(`${kind}_api_key`);
    const result = await require('../services/indexerSync').discover({ kind, url, apiKey });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Add selected indexers. Body: { kind, url, apiKey, remoteIds?, removeMissing? }
exports.sync = async (req, res) => {
  try {
    const { getSetting } = require('./settingsController');
    const { kind, remoteIds, removeMissing } = req.body;
    const url = req.body.url || await getSetting(`${kind}_url`);
    const apiKey = req.body.apiKey || await getSetting(`${kind}_api_key`);
    const result = await require('../services/indexerSync').sync({ kind, url, apiKey, remoteIds, removeMissing: !!removeMissing });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.test = async (req, res) => {
  try {
    const { type, url, apiKey } = req.body;
    const axios = require('axios');
    const logger = require('../config/logger');
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, message: 'Indexer URL is required' });
    }
    const cleanUrl = url.replace(/\/+$/, '');
    // Never log the API key (previously the full test URL incl. apikey went to combined.log,
    // which admins can read back through /api/system/logs)
    const safeUrl = cleanUrl.replace(/([?&](?:apikey|api_key|key|token)=)[^&]*/gi, '$1***');
    logger.info(`Testing indexer: ${type} - ${safeUrl}`);

    const { apiEndpoint } = require('../services/indexerSearch');
    const response = await axios.get(apiEndpoint({ url: cleanUrl, type }), {
      params: { t: 'caps', apikey: apiKey },
      timeout: 10000,
      responseType: 'text'
    });
    // Newznab/Torznab report bad keys etc. as HTTP 200 with an <error> body
    const body = String(response.data || '');
    const apiError = /<error[^>]*description="([^"]+)"/i.exec(body)?.[1];
    if (apiError) return res.status(400).json({ success: false, message: apiError });
    if (!/<caps/i.test(body)) return res.status(400).json({ success: false, message: 'Not a Newznab/Torznab endpoint (check the URL)' });

    const hasBooks = /id="(3030|70\d\d)"/.test(body);
    logger.info(`Test successful: ${response.status}`);
    res.json({ success: true, message: hasBooks ? 'Connection successful' : 'Connected, but this indexer reports no book/audiobook categories' });
  } catch (error) {
    const logger = require('../config/logger');
    logger.error(`Indexer test failed: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};
