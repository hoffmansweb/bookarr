// Send an NZB/torrent URL to a configured download client and return its download id.
const axios = require('axios');
const { Op } = require('sequelize');
const logger = require('../config/logger');

const TORRENT_CLIENTS = ['qbittorrent', 'transmission', 'deluge'];
const NZB_CLIENTS = ['sabnzbd', 'nzbget'];

const baseUrlFor = (client) => `${client.useSsl ? 'https' : 'http'}://${client.host}:${client.port}`;

const isTorrentUrl = (url, type) =>
  type === 'torrent' || /^magnet:/.test(url) || /\.torrent(\?|$)/.test(url) || url.includes('/torrent/');

/** Pick the best enabled client for a download (prefers matching mediaType). */
const findClient = async (isTorrent, mediaType) => {
  const { DownloadClient } = require('../models');
  const types = isTorrent ? TORRENT_CLIENTS : NZB_CLIENTS;
  return (await DownloadClient.findOne({ where: { enabled: true, type: { [Op.in]: types }, mediaType: { [Op.in]: [mediaType, 'both'] } } })) ||
    (await DownloadClient.findOne({ where: { enabled: true, type: { [Op.in]: types } } }));
};

const { qbAuthHeaders } = require('./qbittorrentAuth');

const transmissionRequest = async (baseUrl, client, body) => {
  const config = { headers: {}, timeout: 15000 };
  if (client.username || client.password) {
    config.auth = { username: client.username || 'transmission', password: client.password || client.apiKey || '' };
  }
  try {
    return await axios.post(`${baseUrl}/transmission/rpc`, body, config);
  } catch (error) {
    if (error.response?.status !== 409) throw error;
    config.headers['X-Transmission-Session-Id'] = error.response.headers['x-transmission-session-id'];
    return axios.post(`${baseUrl}/transmission/rpc`, body, config);
  }
};

/**
 * @returns {Promise<string|null>} client-specific download id
 */
const sendToClient = async (client, url, title) => {
  const baseUrl = baseUrlFor(client);
  const category = client.category || 'books';

  switch (client.type) {
    case 'sabnzbd': {
      const { data } = await axios.get(`${baseUrl}/api`, {
        params: { mode: 'addurl', name: url, nzbname: title, cat: category, apikey: client.apiKey, output: 'json' },
        timeout: 15000
      });
      if (data?.status === false) throw new Error(`SABnzbd: ${data.error || 'rejected'}`);
      return data?.nzo_ids?.[0] || null;
    }
    case 'nzbget': {
      const { data } = await axios.post(`${baseUrl}/jsonrpc`, {
        method: 'append',
        params: [title, url, category, 0, false, false, '', 0, 'SCORE']
      }, { auth: { username: client.username || 'nzbget', password: client.password || client.apiKey }, timeout: 15000 });
      if (!data?.result || data.result <= 0) throw new Error('NZBGet rejected the download');
      return String(data.result);
    }
    case 'qbittorrent': {
      const auth = await qbAuthHeaders(client, baseUrl); // API key (Bearer) or login cookie
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: baseUrl, ...auth };
      const before = Date.now() / 1000 - 5;
      await axios.post(`${baseUrl}/api/v2/torrents/add`, new URLSearchParams({ urls: url, category }).toString(), { headers, timeout: 20000 });

      // qBittorrent doesn't return the hash; find the torrent that just appeared
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const { data: torrents } = await axios.get(`${baseUrl}/api/v2/torrents/info`, { params: { category, sort: 'added_on', reverse: true }, headers: auth });
        const fresh = torrents.find(t => t.added_on >= before);
        if (fresh) return fresh.hash;
      }
      return null;
    }
    case 'transmission': {
      const { data } = await transmissionRequest(baseUrl, client, {
        method: 'torrent-add',
        arguments: { filename: url, 'download-dir': client.category || undefined }
      });
      if (data?.result && data.result !== 'success') throw new Error(`Transmission: ${data.result}`);
      const added = data?.arguments?.['torrent-added'] || data?.arguments?.['torrent-duplicate'];
      return added?.hashString || (added?.id != null ? String(added.id) : null);
    }
    case 'deluge': {
      const loginRes = await axios.post(`${baseUrl}/json`, { method: 'auth.login', params: [client.password || client.apiKey], id: 1 }, { timeout: 15000 });
      if (!loginRes.data?.result) throw new Error('Deluge login failed');
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
      const method = /^magnet:/.test(url) ? 'core.add_torrent_magnet' : 'core.add_torrent_url';
      const opts = client.category ? { download_location: client.category } : {};
      const { data } = await axios.post(`${baseUrl}/json`, { method, params: [url, opts], id: 2 }, { headers: { Cookie: cookie }, timeout: 20000 });
      if (data?.error) throw new Error(`Deluge: ${data.error.message}`);
      return data?.result || null;
    }
    default:
      throw new Error(`Unsupported client type: ${client.type}`);
  }
};

/**
 * Dispatch a release and record it on the book.
 * @returns {Promise<{client, downloadId}>}
 */
const dispatchRelease = async ({ url, title, type, format, book }) => {
  const isTorrent = isTorrentUrl(url, type);
  const mediaType = format === 'audiobook' ? 'audiobook' : 'ebook';
  const client = await findClient(isTorrent, mediaType);
  if (!client) throw Object.assign(new Error(`No ${isTorrent ? 'torrent' : 'NZB'} client configured`), { status: 400 });

  const downloadId = await sendToClient(client, url, title);
  logger.info(`Sent "${title}" to ${client.name} (${client.type}), id: ${downloadId || 'unknown'}`);

  if (book) {
    const updateData = {
      status: 'downloading',
      downloadName: title,
      downloadId,
      downloadClientId: client.id,
      // Start time lets the stalled-download watchdog retry releases that never finish
      metadata: { ...(book.metadata || {}), downloadStartedAt: new Date().toISOString(), currentRelease: title }
    };
    if (mediaType === 'audiobook') {
      updateData.mediaType = 'audiobook';
      updateData.bookType = 'audiobook';
    }
    await book.update(updateData);
  }
  return { client, downloadId };
};

module.exports = { dispatchRelease, sendToClient, findClient, isTorrentUrl, TORRENT_CLIENTS, NZB_CLIENTS };
