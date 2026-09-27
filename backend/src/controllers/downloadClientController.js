const { DownloadClient } = require('../models');

exports.getAll = async (req, res) => {
  try {
    const clients = await DownloadClient.findAll();
    res.json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const client = await DownloadClient.create(req.body);
    res.status(201).json(client);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const client = await DownloadClient.findByPk(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    await client.update(req.body);
    res.json(client);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const client = await DownloadClient.findByPk(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    await client.destroy();
    res.json({ message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.test = async (req, res) => {
  try {
    const { type, host, port, apiKey, username, password, useSsl } = req.body;
    const axios = require('axios');
    
    const protocol = useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}:${port}`;
    
    if (type === 'sabnzbd') {
      const url = `${baseUrl}/api`;
      await axios.get(url, { params: { mode: 'version', apikey: apiKey, output: 'json' }, timeout: 5000 });
    } else if (type === 'nzbget') {
      const url = `${baseUrl}/jsonrpc`;
      await axios.post(url, { method: 'version' }, {
        auth: { username: 'nzbget', password: apiKey },
        timeout: 5000
      });
    } else if (type === 'qbittorrent') {
      // API key (qbt_…, qBittorrent 5.2+) or username/password, then a real authenticated call
      const qb = require('../services/qbittorrentAuth');
      const client = { host, port, useSsl, apiKey, username, password };
      const version = await qb.testConnection(client);
      return res.json({ success: true, message: `qBittorrent ${version} connected (${qb.usesApiKey(client) ? 'API key' : 'username/password'})` });
    } else if (type === 'transmission') {
      const url = `${baseUrl}/transmission/rpc`;
      const credentials = username || password ? {
        username: username || 'transmission',
        password: password || apiKey
      } : null;

      let sessionId = '';
      try {
        const config = { headers: {}, timeout: 5000 };
        if (credentials) config.auth = credentials;
        await axios.post(url, { method: 'session-get' }, config);
      } catch (error) {
        if (error.response && error.response.status === 409) {
          sessionId = error.response.headers['x-transmission-session-id'];
        } else {
          throw error;
        }
      }
      
      const config = { headers: { 'X-Transmission-Session-Id': sessionId }, timeout: 5000 };
      if (credentials) config.auth = credentials;
      await axios.post(url, { method: 'session-get' }, config);
    } else if (type === 'deluge') {
      const url = `${baseUrl}/json`;
      const pass = password || apiKey;
      const response = await axios.post(url, {
        method: 'auth.login',
        params: [pass],
        id: 1
      }, { timeout: 5000 });
      if (!response.data?.result) {
        throw new Error('Login failed. Check password.');
      }
    } else if (type === 'jdownloader2') {
      const JDownloader2Service = require('../services/jdownloader2Service');
      const jd2 = new JDownloader2Service({ host, port, username, password, useSsl });
      const result = await jd2.testConnection();
      if (!result.success) {
        throw new Error(result.error);
      }
    } else if (type === 'aria2') {
      const Aria2Service = require('../services/aria2Service');
      const aria2 = new Aria2Service({ host, port, apiKey, useSsl });
      const result = await aria2.testConnection();
      if (!result.success) {
        throw new Error(result.error);
      }
      return res.json({ success: true, message: result.message });
    }
    
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.clearAria2 = async (req, res) => {
  try {
    const client = await DownloadClient.findOne({ where: { type: 'aria2', enabled: true } });
    if (!client) {
      return res.status(404).json({ error: 'No aria2 client configured' });
    }
    
    const Aria2Service = require('../services/aria2Service');
    const aria2 = new Aria2Service(client);
    const result = await aria2.purgeAll();
    
    if (result.success) {
      res.json({ message: 'aria2 download history cleared' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
