const axios = require('axios');

const HTTP_TIMEOUT = 10000;

const getProgress = async (client, downloadId) => {
  try {
    const protocol = client.useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${client.host}:${client.port}`;
    
    if (client.type === 'aria2') {
      const Aria2Service = require('./aria2Service');
      const aria2 = new Aria2Service(client);
      const result = await aria2.tellStatus(downloadId);
      
      if (result.success) {
        return {
          percentage: parseFloat(result.percentage),
          status: result.status === 'complete' ? 'completed' : 'downloading',
          speed: result.downloadSpeed,
          downloaded: result.completedLength,
          total: result.totalLength
        };
      }
      return { percentage: 0, status: 'unknown' };
    } else if (client.type === 'sabnzbd') {
      const { data } = await axios.get(`${baseUrl}/api`, {
        params: { mode: 'queue', apikey: client.apiKey, output: 'json' },
        timeout: HTTP_TIMEOUT
      });
      const item = data.queue?.slots?.find(s => s.nzo_id === downloadId);
      if (item) {
        // item.mb is the job size, not a speed; SABnzbd only reports speed for the whole queue
        return {
          percentage: parseFloat(item.percentage) || 0,
          status: String(item.status || '').toLowerCase() === 'paused' ? 'paused' : 'downloading',
          eta: item.timeleft,
          speed: Math.round((parseFloat(data.queue?.kbpersec) || 0) * 1024)
        };
      }
      const histData = await axios.get(`${baseUrl}/api`, {
        params: { mode: 'history', apikey: client.apiKey, output: 'json', limit: 10 },
        timeout: HTTP_TIMEOUT
      });
      const histItem = histData.data.history?.slots?.find(s => s.nzo_id === downloadId);
      if (histItem?.status === 'Completed') {
        return { percentage: 100, status: 'completed' };
      }
      return { percentage: 0, status: 'unknown' };
    } else if (client.type === 'nzbget') {
      const { data } = await axios.post(`${baseUrl}/jsonrpc`, {
        method: 'listgroups',
        params: []
      }, {
        auth: { username: 'nzbget', password: client.apiKey },
        timeout: HTTP_TIMEOUT
      });
      const item = data.result?.find(g => g.NZBID === parseInt(downloadId));
      if (item) {
        const total = item.FileSizeMB;
        const remaining = item.RemainingSizeMB;
        const percentage = total > 0 ? ((total - remaining) / total) * 100 : 0;
        return {
          percentage: Math.round(percentage),
          status: 'downloading',
          eta: null,
          speed: item.DownloadRate
        };
      }
      return { percentage: 100, status: 'completed' };
    } else if (client.type === 'qbittorrent') {
      const { qbAuthHeaders } = require('./qbittorrentAuth');
      const auth = await qbAuthHeaders(client, baseUrl); // API key (Bearer) or login cookie
      const category = client.category || '';
      const { data } = await axios.get(`${baseUrl}/api/v2/torrents/info?category=${encodeURIComponent(category)}`, {
        headers: auth,
        timeout: HTTP_TIMEOUT
      });
      const wanted = String(downloadId).toLowerCase();
      const item = (Array.isArray(data) ? data : []).find(t => t.hash?.toLowerCase().startsWith(wanted));
      if (item) {
        return {
          percentage: Math.round(item.progress * 100),
          // qBittorrent states: uploading, stalledUP, pausedUP, queuedUP, forcedUP, ...
          status: String(item.state || '').toLowerCase().includes('up') ? 'seeding' : 'downloading',
          eta: item.eta,
          speed: item.dlspeed
        };
      }
      return { percentage: 100, status: 'completed' };
    } else if (client.type === 'transmission') {
      const credentials = client.username || client.password ? {
        username: client.username || 'transmission',
        password: client.password || client.apiKey
      } : null;
      let sessionId = '';
      try {
        const config = { headers: {}, timeout: HTTP_TIMEOUT };
        if (credentials) config.auth = credentials;
        await axios.post(`${baseUrl}/transmission/rpc`, { method: 'session-get' }, config);
      } catch (error) {
        if (error.response && error.response.status === 409) {
          sessionId = error.response.headers['x-transmission-session-id'];
        }
      }
      const config = { headers: { 'X-Transmission-Session-Id': sessionId }, timeout: HTTP_TIMEOUT };
      if (credentials) config.auth = credentials;
      const { data } = await axios.post(`${baseUrl}/transmission/rpc`, {
        method: 'torrent-get',
        arguments: {
          fields: ['id', 'name', 'status', 'percentDone', 'rateDownload', 'hashString']
        }
      }, config);
      const torrents = data.arguments?.torrents || [];
      const wantedId = String(downloadId).toLowerCase();
      const item = torrents.find(t => t.id === parseInt(downloadId) || t.hashString?.toLowerCase().startsWith(wantedId));
      if (item) {
        return {
          percentage: Math.round(item.percentDone * 100),
          status: item.percentDone === 1 ? 'completed' : 'downloading',
          speed: item.rateDownload
        };
      }
      return { percentage: 100, status: 'completed' };
    } else if (client.type === 'deluge') {
      const pass = client.password || client.apiKey;
      const loginRes = await axios.post(`${baseUrl}/json`, {
        method: 'auth.login',
        params: [pass],
        id: 1
      }, { timeout: HTTP_TIMEOUT });
      const cookie = loginRes.headers['set-cookie']?.[0];
      const config = cookie ? { headers: { 'Cookie': cookie }, timeout: HTTP_TIMEOUT } : { timeout: HTTP_TIMEOUT };
      
      const { data } = await axios.post(`${baseUrl}/json`, {
        method: 'web.update_ui',
        params: [['name', 'progress', 'state', 'download_payload_rate'], {}],
        id: 2
      }, config);
      
      const torrents = data.result?.torrents || {};
      const item = torrents[downloadId] || Object.values(torrents).find(t => t.name === downloadId);
      if (item) {
        return {
          percentage: Math.round(item.progress),
          status: item.progress === 100 ? 'completed' : 'downloading',
          speed: item.download_payload_rate
        };
      }
      return { percentage: 100, status: 'completed' };
    }
    
    return { percentage: 0, status: 'unknown' };
  } catch (error) {
    return { percentage: 0, status: 'error' };
  }
};

module.exports = { getProgress };
