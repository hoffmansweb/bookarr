const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { getSetting } = require('../controllers/settingsController');
const JDownloader2Service = require('./jdownloader2Service');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const HTTP_TIMEOUT = 15000;

// qBittorrent auth (API key or URL-encoded login) is shared across all callers
const { qbAuthHeaders } = require('./qbittorrentAuth');
// Clients report paths on their own filesystem (container paths, release names
// instead of file names): resolve every plausible location instead of guessing one
const { resolveDownloadPath } = require('../utils/downloadPaths');

// Authenticate to a Windows share. Uses execFile with an argument array so that
// usernames/passwords/paths are never interpreted by a shell (previously these
// were interpolated into an exec() command line: command injection, and the
// password was echoed in logged error messages).
const connectNetworkShare = async (sharePath, username, password, label) => {
  if (process.platform !== 'win32') return;
  if (!/^\\\\[^\\]+\\[^\\]+$/.test(sharePath)) {
    console.log(`[${label}] Skipping network auth, unexpected share path format`);
    return;
  }
  try {
    await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { windowsHide: true, timeout: 30000 });
  } catch (e) { /* not connected */ }
  try {
    await execFileAsync('net', ['use', sharePath, `/user:${username}`, password], { windowsHide: true, timeout: 30000 });
    console.log(`[${label}] Authenticated to ${sharePath}`);
  } catch (error) {
    // Don't log error.message: it echoes the command line, which includes the password.
    console.log(`[${label}] Network share auth failed for ${sharePath} (exit code ${error.code ?? 'unknown'})`);
  }
};

const checkSABnzbd = async (client) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const bookCategory = client.category || 'books';
  const url = `${protocol}://${client.host}:${client.port}/api`;

  // Never log the full URL: it would contain the API key
  console.log(`[SABnzbd] Fetching history from: ${protocol}://${client.host}:${client.port}/api?mode=history`);
  const { data } = await axios.get(url, {
    params: { mode: 'history', apikey: client.apiKey, output: 'json', limit: 100 },
    timeout: HTTP_TIMEOUT
  });
  const slots = data?.history?.slots || [];
  console.log(`[SABnzbd] Total items in history: ${slots.length}`);

  const downloadFolder = await getSetting('download_folder');
  const allItems = slots.map(slot => {
    // SAB's storage is the finished folder as SAB sees it, which may not be a path
    // this machine can read (Docker: /downloads/...). Keep every candidate.
    const resolved = slot.status === 'Completed'
      ? resolveDownloadPath({ name: slot.name, category: slot.category, content_path: slot.storage }, downloadFolder)
      : { path: null, candidates: [] };

    return {
      name: slot.name,
      status: slot.status,
      category: slot.category,
      path: resolved.path,
      altPaths: resolved.candidates.filter(candidate => candidate !== resolved.path),
      nzo_id: slot.nzo_id
    };
  });
  
  console.log(`[SABnzbd] Categories found:`, [...new Set(allItems.map(i => i.category))]);
  console.log(`[SABnzbd] Looking for category: "${bookCategory}"`);
  
  const filtered = allItems.filter(item => {
    const cat = item.category?.toLowerCase();
    const target = bookCategory.toLowerCase();
    // SABnzbd uses '*' for Default category
    return cat === target || (cat === '*' && target === 'default');
  });
  console.log(`[SABnzbd] Items matching category "${bookCategory}": ${filtered.length}`);
  
  return filtered;
};

const deleteSABnzbdHistory = async (client, nzo_id) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const url = `${protocol}://${client.host}:${client.port}/api`;
  await axios.get(url, {
    params: { mode: 'history', name: 'delete', value: nzo_id, apikey: client.apiKey },
    timeout: HTTP_TIMEOUT
  });
};

const checkNZBGet = async (client) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const url = `${protocol}://${client.host}:${client.port}/jsonrpc`;
  
  const { data } = await axios.post(url, {
    method: 'history',
    params: [false]
  }, {
    auth: { username: 'nzbget', password: client.apiKey },
    timeout: HTTP_TIMEOUT
  });

  const downloadFolder = await getSetting('download_folder');

  return (data?.result || []).map(item => {
    // DestDir is the finished folder as NZBGet sees it; it may be a container path
    const resolved = resolveDownloadPath({ name: item.Name, category: item.Category, content_path: item.DestDir }, downloadFolder);

    return {
      name: item.Name,
      status: item.Status,
      category: item.Category,
      path: resolved.path,
      altPaths: resolved.candidates.filter(candidate => candidate !== resolved.path),
      nzbid: item.NZBID
    };
  });
};

const deleteNZBGetHistory = async (client, nzbid) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const url = `${protocol}://${client.host}:${client.port}/jsonrpc`;
  
  await axios.post(url, {
    method: 'editqueue',
    params: ['HistoryDelete', 0, '', [nzbid]]
  }, {
    auth: { username: 'nzbget', password: client.apiKey },
    timeout: HTTP_TIMEOUT
  });
};

const checkqBittorrent = async (client) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${client.host}:${client.port}`;
  
  const auth = await qbAuthHeaders(client, baseUrl); // API key (Bearer) or login cookie

  const bookCategory = client.category || 'books';
  const { data } = await axios.get(`${baseUrl}/api/v2/torrents/info`, {
    params: { filter: 'completed', category: bookCategory },
    headers: auth,
    timeout: HTTP_TIMEOUT
  });
  
  const downloadFolder = await getSetting('download_folder');
  
  return (Array.isArray(data) ? data : []).map(torrent => {
    // content_path is the one path qBittorrent knows for certain: it includes the
    // category folder and the real file name inside the torrent, which is often
    // not the release name Bookarr sees ("Bad Bishop (Society of Villains…)")
    const resolved = resolveDownloadPath(torrent, downloadFolder);

    return {
      name: torrent.name,
      status: 'Completed',
      category: torrent.category,
      path: resolved.path,
      altPaths: resolved.candidates.filter(candidate => candidate !== resolved.path),
      hash: torrent.hash
    };
  });
};

const deleteqBittorrentTorrent = async (client, hash) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${client.host}:${client.port}`;
  
  const auth = await qbAuthHeaders(client, baseUrl);

  await axios.post(`${baseUrl}/api/v2/torrents/delete`, new URLSearchParams({ hashes: String(hash), deleteFiles: 'false' }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: baseUrl,
      ...auth
    },
    timeout: HTTP_TIMEOUT
  });
};

const checkTransmission = async (client) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${client.host}:${client.port}/transmission/rpc`;
  const credentials = client.username || client.password ? {
    username: client.username || 'transmission',
    password: client.password || client.apiKey
  } : null;

  let sessionId = '';
  try {
    const config = { headers: {}, timeout: HTTP_TIMEOUT };
    if (credentials) config.auth = credentials;
    await axios.post(baseUrl, { method: 'session-get' }, config);
  } catch (error) {
    if (error.response && error.response.status === 409) {
      sessionId = error.response.headers['x-transmission-session-id'];
    } else {
      throw error;
    }
  }

  const config = { headers: { 'X-Transmission-Session-Id': sessionId }, timeout: HTTP_TIMEOUT };
  if (credentials) config.auth = credentials;

  const { data } = await axios.post(baseUrl, {
    method: 'torrent-get',
    arguments: {
      fields: ['id', 'name', 'status', 'percentDone', 'downloadDir', 'hashString']
    }
  }, config);

  const bookCategory = (client.category || 'books').toLowerCase();
  const torrents = data.arguments?.torrents || [];
  const downloadFolder = await getSetting('download_folder');
  
  return torrents
    .filter(torrent => {
      const dir = (torrent.downloadDir || '').toLowerCase();
      return dir.includes(bookCategory) || bookCategory === 'default';
    })
    .map(torrent => {
      const resolved = torrent.percentDone === 1
        ? resolveDownloadPath({ name: torrent.name, category: client.category, save_path: torrent.downloadDir }, downloadFolder)
        : { path: null, candidates: [] };

      return {
        name: torrent.name,
        status: torrent.percentDone === 1 ? 'Completed' : 'Downloading',
        category: client.category,
        path: resolved.path,
        altPaths: resolved.candidates.filter(candidate => candidate !== resolved.path),
        id: torrent.id,
        hash: torrent.hashString
      };
    });
};

const deleteTransmissionTorrent = async (client, id) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${client.host}:${client.port}/transmission/rpc`;
  const credentials = client.username || client.password ? {
    username: client.username || 'transmission',
    password: client.password || client.apiKey
  } : null;

  let sessionId = '';
  try {
    const config = { headers: {}, timeout: HTTP_TIMEOUT };
    if (credentials) config.auth = credentials;
    await axios.post(baseUrl, { method: 'session-get' }, config);
  } catch (error) {
    if (error.response && error.response.status === 409) {
      sessionId = error.response.headers['x-transmission-session-id'];
    }
  }

  const config = { headers: { 'X-Transmission-Session-Id': sessionId }, timeout: HTTP_TIMEOUT };
  if (credentials) config.auth = credentials;

  await axios.post(baseUrl, {
    method: 'torrent-remove',
    arguments: {
      ids: [parseInt(id)],
      'delete-local-data': false
    }
  }, config);
};

const delugeCall = async (client, method, params = []) => {
  const protocol = client.useSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${client.host}:${client.port}/json`;
  const password = client.password || client.apiKey;

  const loginRes = await axios.post(baseUrl, {
    method: 'auth.login',
    params: [password],
    id: 1
  }, { timeout: HTTP_TIMEOUT });

  const cookie = loginRes.headers['set-cookie']?.[0];
  const config = cookie ? { headers: { 'Cookie': cookie }, timeout: HTTP_TIMEOUT } : { timeout: HTTP_TIMEOUT };

  const res = await axios.post(baseUrl, {
    method: method,
    params: params,
    id: 2
  }, config);

  if (res.data?.error) {
    throw new Error(res.data.error.message || 'Deluge RPC error');
  }
  return res.data?.result;
};

const checkDeluge = async (client) => {
  const torrentsObj = await delugeCall(client, 'web.update_ui', [
    ['name', 'progress', 'save_path', 'state'],
    {}
  ]);

  const torrents = torrentsObj?.torrents || {};
  const bookCategory = (client.category || 'books').toLowerCase();
  const downloadFolder = await getSetting('download_folder');

  return Object.entries(torrents)
    .filter(([hash, t]) => {
      const dir = (t.save_path || '').toLowerCase();
      return dir.includes(bookCategory) || bookCategory === 'default';
    })
    .map(([hash, t]) => {
      const resolved = t.progress === 100
        ? resolveDownloadPath({ name: t.name, category: client.category, save_path: t.save_path }, downloadFolder)
        : { path: null, candidates: [] };

      return {
        name: t.name,
        status: t.progress === 100 ? 'Completed' : 'Downloading',
        category: client.category,
        path: resolved.path,
        altPaths: resolved.candidates.filter(candidate => candidate !== resolved.path),
        hash: hash
      };
    });
};

const deleteDelugeTorrent = async (client, hash) => {
  await delugeCall(client, 'core.remove_torrent', [hash, false]);
};

const getCompletedDownloads = async (client) => {
  try {
    if (client.type === 'sabnzbd') {
      const downloads = await checkSABnzbd(client);
      console.log(`[${client.name}] Found ${downloads.length} items in history`);
      return downloads;
    } else if (client.type === 'nzbget') {
      const downloads = await checkNZBGet(client);
      console.log(`[${client.name}] Found ${downloads.length} items in history`);
      return downloads;
    } else if (client.type === 'qbittorrent') {
      const downloads = await checkqBittorrent(client);
      console.log(`[${client.name}] Found ${downloads.length} completed torrents`);
      return downloads;
    } else if (client.type === 'transmission') {
      const downloads = await checkTransmission(client);
      console.log(`[${client.name}] Found ${downloads.length} completed torrents`);
      return downloads;
    } else if (client.type === 'deluge') {
      const downloads = await checkDeluge(client);
      console.log(`[${client.name}] Found ${downloads.length} completed torrents`);
      return downloads;
    } else if (client.type === 'jdownloader2') {
      const jd2 = new JDownloader2Service(client);
      const downloads = await jd2.getDownloads();
      console.log(`[${client.name}] Found ${downloads.length} downloads`);
      return downloads;
    }
    return [];
  } catch (error) {
    console.error(`[${client.name}] Failed to check:`, error.message);
    return [];
  }
};

// Book files the importer understands
const BOOK_FILE_RE = /\.(epub|mobi|pdf|azw3|m4b|mp3|m4a)$/i;
const AUDIO_FILE_RE = /\.(mp3|m4a)$/i;

/**
 * Work out what should be moved for one path a client reported.
 * The path can be the book file itself, a folder holding it, or a name that does
 * not exist at all (clients hand over the release name, while the file inside the
 * torrent is named after the book).
 * @returns {Promise<{filePath?: string, wholeFolder?: string, deleteSourceDir?: string}|null>}
 */
const resolveSourcePath = async (candidate, bookTitle) => {
  const stats = await fs.stat(candidate).catch(() => null);
  if (stats) {
    if (!stats.isDirectory()) return { filePath: candidate };

    console.log(`[${bookTitle}] Path is directory, searching for book files`);
    const files = await fs.readdir(candidate).catch(() => []);
    const bookFiles = files.filter(f => BOOK_FILE_RE.test(f));
    if (bookFiles.length === 0) {
      console.log(`[${bookTitle}] No book files found in directory`);
      return null;
    }

    // If multiple audio files (audiobook with chapters), move entire folder
    if (bookFiles.length > 1 && bookFiles.some(f => AUDIO_FILE_RE.test(f))) {
      console.log(`[${bookTitle}] Found ${bookFiles.length} audio files, moving entire folder`);
      return { wholeFolder: candidate };
    }

    const filePath = path.join(candidate, bookFiles[0]);
    console.log(`[${bookTitle}] Found book file: ${filePath}`);
    return { filePath, deleteSourceDir: candidate };
  }

  // Not on disk: the client used a release name, so look for what is really there
  const parentDir = path.dirname(candidate);
  const fileName = path.basename(candidate);
  console.log(`[${bookTitle}] Original path failed, checking parent directory: ${parentDir}`);
  try {
    const files = await fs.readdir(parentDir);
    const bookFile = files.find(f => BOOK_FILE_RE.test(f));
    if (bookFile) {
      const newPath = path.join(parentDir, bookFile);
      console.log(`[${bookTitle}] Found file in parent directory: ${newPath}`);
      return { filePath: newPath };
    }
    if (files.includes(fileName)) {
      const subfolderPath = path.join(parentDir, fileName);
      const subFiles = await fs.readdir(subfolderPath);
      const subBookFile = subFiles.find(f => BOOK_FILE_RE.test(f));
      if (subBookFile) {
        const newPath = path.join(subfolderPath, subBookFile);
        console.log(`[${bookTitle}] Found file in subfolder: ${newPath}`);
        return { filePath: newPath };
      }
    }
  } catch (e) {
    console.log(`[${bookTitle}] Directory check failed: ${e.message}`);
  }
  return null;
};

const moveFile = async (sourcePath, destFolder, bookTitle, authorName, altPaths = []) => {
  bookTitle = bookTitle || 'Unknown Title';
  authorName = authorName || 'Unknown Author';
  try {
    if (!sourcePath || !destFolder) {
      console.error(`[${bookTitle}] Failed to move file: missing ${!sourcePath ? 'source path' : 'destination folder'}`);
      return null;
    }
    console.log(`[${bookTitle}] Source path from client: ${JSON.stringify(sourcePath)}`);
    
    // The client's paths can live on a share that needs a login. Candidates are not
    // always on the same share as the first path, so authenticate to each one.
    const candidates = [sourcePath, ...altPaths].filter(Boolean);
    const downloadShares = new Set(candidates
      .filter(candidate => candidate.startsWith('\\\\'))
      .map(candidate => candidate.split('\\').slice(0, 4).join('\\'))); // \\server\share
    if (downloadShares.size) {
      const { getSetting } = require('../controllers/settingsController');
      const username = await getSetting('download_network_username');
      const password = await getSetting('download_network_password');
      if (username && password) {
        for (const sharePath of downloadShares) await connectNetworkShare(sharePath, username, password, bookTitle);
      }
    }
    
    // Use the first path that actually holds the book: the client's own guess is
    // often the release name (not the file name), misses the category folder, or
    // points at a filesystem only the client can see.
    let source = null;
    let sourceFoundAt = null;
    for (const candidate of candidates) {
      if (candidate !== sourcePath) console.log(`[${bookTitle}] Trying alternate path: ${candidate}`);
      source = await resolveSourcePath(candidate, bookTitle);
      if (source) {
        sourceFoundAt = candidate;
        break;
      }
    }
    if (!source) {
      console.error(`[${bookTitle}] Failed to move file: no book found at ${candidates.join(' | ')}`);
      return null;
    }
    if (sourceFoundAt !== sourcePath) console.log(`[${bookTitle}] Using download at: ${sourceFoundAt}`);

    // Audiobook split into chapters: move the whole folder so the chapters stay together
    if (source.wholeFolder) {
      const cleanTitle = bookTitle.replace(/[<>:"\/\\|?*]/g, '');
      const destPath = path.join(destFolder, cleanTitle);

      console.log(`[${bookTitle}] Moving folder to: ${destPath}`);
      await fs.mkdir(destFolder, { recursive: true });

      // Copy entire directory
      await fs.cp(source.wholeFolder, destPath, { recursive: true });

      // Delete source directory
      await fs.rm(source.wholeFolder, { recursive: true, force: true });

      console.log(`[${bookTitle}] Folder moved successfully`);
      return destPath;
    }

    const filePath = source.filePath;
    
    // Authenticate to destination share if needed
    if (destFolder.startsWith('\\\\')) {
      const { getSetting } = require('../controllers/settingsController');
      const username = await getSetting('network_username');
      const password = await getSetting('network_password');
      
      if (username && password) {
        const sharePath = destFolder.split('\\').slice(0, 4).join('\\');
        await connectNetworkShare(sharePath, username, password, bookTitle);
      }
    }
    
    const ext = path.extname(filePath);
    const cleanTitle = bookTitle.replace(/[<>:"\/\\|?*]/g, '');
    const cleanAuthor = authorName.replace(/[<>:"\/\\|?*]/g, '');
    const fileName = `${cleanAuthor} - ${cleanTitle}${ext}`;
    const destPath = path.join(destFolder, fileName);
    
    console.log(`[${bookTitle}] Moving to: ${destPath}`);
    await fs.mkdir(destFolder, { recursive: true });
    
    try {
      await fs.rename(filePath, destPath);
    } catch (error) {
      if (error.code === 'EXDEV') {
        console.log(`[${bookTitle}] Cross-device move, using copy+delete`);
        await fs.copyFile(filePath, destPath);
        await fs.unlink(filePath);
      } else {
        throw error;
      }
    }
    
    // Delete the source folder when the book was extracted out of it
    if (source.deleteSourceDir) {
      try {
        await fs.rm(source.deleteSourceDir, { recursive: true, force: true });
        console.log(`[${bookTitle}] Deleted source directory: ${source.deleteSourceDir}`);
      } catch (err) {
        console.log(`[${bookTitle}] Failed to delete source directory: ${err.message}`);
      }
    }
    
    console.log(`[${bookTitle}] File moved successfully`);
    return destPath;
  } catch (error) {
    console.error(`[${bookTitle}] Failed to move file:`, error.code, error.message);
    return null;
  }
};

const deleteFromHistory = async (client, item) => {
  try {
    if (client.type === 'sabnzbd' && item.nzo_id) {
      await deleteSABnzbdHistory(client, item.nzo_id);
      console.log(`[${client.name}] Deleted from history: ${item.name}`);
    } else if (client.type === 'nzbget' && item.nzbid) {
      await deleteNZBGetHistory(client, item.nzbid);
      console.log(`[${client.name}] Deleted from history: ${item.name}`);
    } else if (client.type === 'qbittorrent' && (item.hash || item.id)) {
      await deleteqBittorrentTorrent(client, item.hash || item.id);
      console.log(`[${client.name}] Deleted torrent: ${item.name}`);
    } else if (client.type === 'transmission' && (item.id || item.hash)) {
      await deleteTransmissionTorrent(client, item.id || item.hash);
      console.log(`[${client.name}] Deleted transmission torrent: ${item.name}`);
    } else if (client.type === 'deluge' && (item.hash || item.id)) {
      await deleteDelugeTorrent(client, item.hash || item.id);
      console.log(`[${client.name}] Deleted deluge torrent: ${item.name}`);
    }
  } catch (error) {
    console.error(`[${client.name}] Failed to delete from history:`, error.message);
  }
};

const sendToJDownloader2 = async (client, downloadUrl, bookTitle) => {
  try {
    const jd2 = new JDownloader2Service(client);
    const result = await jd2.addLinks(downloadUrl, `Bookarr - ${bookTitle}`);
    if (result.success) {
      console.log(`[${client.name}] Added download: ${bookTitle}`);
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error(`[${client.name}] Failed to add download:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { getCompletedDownloads, moveFile, deleteFromHistory, sendToJDownloader2 };
