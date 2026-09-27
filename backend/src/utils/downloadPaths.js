// Working out where a finished download actually lives.
//
// Download clients report paths on *their* filesystem, which is not always the
// machine Bookarr runs on: a container sees /data/downloads/Downloads/books,
// Windows sees \\server\Downloads\Downloads\books. On top of that the name the
// client knows ("Bad Bishop (Society of Villains, Book 1) - L.J. Shen") is the
// release name, not the name of the file inside the torrent, and with a
// category folder the content sits one level deeper than the download folder.
//
// Guessing a single path therefore fails with ENOENT even though the file is
// sitting right there. So instead: build every plausible candidate and use the
// first one that exists on disk.
const fs = require('fs');

const normalizeForCompare = (value) => String(value).replace(/\//g, '\\').toLowerCase();

// Turns "/data/downloads/" into "/data/downloads" and "\\nas\books\" into "\\nas\books"
const stripTrailingSeparators = (value) => String(value).trim().replace(/[\\/]+$/, '');

// Paths reported by clients arrive with either separator, and path.join/basename
// only understand the separator of the machine Bookarr runs on, so split on both.
const baseName = (value) => String(value).split(/[\\/]/).filter(Boolean).pop() || '';

/**
 * Join path parts, keeping the separator style of the first part.
 * @returns {string|null} null when there is nothing to join
 */
const joinPath = (...parts) => {
  const [first, ...rest] = parts.filter(part => part !== null && part !== undefined && part !== '');
  if (!first) return null;

  const head = stripTrailingSeparators(first);
  // "\\server\share", "D:\downloads" -> backslashes; "/data/downloads" -> forward slashes
  const separator = /^[a-zA-Z]:/.test(head) || (head.includes('\\') && !head.startsWith('/')) ? '\\' : '/';

  return rest.reduce((acc, part) => `${acc}${separator}${String(part).replace(/^[\\/]+/, '')}`, head);
};

// Client setups sometimes store "\server\share" instead of "\\server\share"
const fixUncPath = (value) => (value.startsWith('\\') && !value.startsWith('\\\\') ? `\\${value}` : value);

// DOWNLOAD_PATH_REMAP=/data/downloads=\\192.168.1.76\Downloads;/downloads=\\nas\complete
// The same idea as LIBRARY_PATH_REMAP (bookController.js), for paths coming from download clients.
const PATH_REMAP = (process.env.DOWNLOAD_PATH_REMAP || '')
  .split(';')
  .map(entry => entry.split('='))
  .filter(parts => parts.length === 2 && parts[0].trim() && parts[1].trim())
  .map(([from, to]) => ({ from: stripTrailingSeparators(normalizeForCompare(from)), to: stripTrailingSeparators(to) }));

/**
 * Re-point a client path at the machine Bookarr runs on, when a mapping is configured.
 * @param {string} value path as reported by the download client
 * @returns {string|null} mapped path, or the original (UNC-normalised) path
 */
const remapClientPath = (value) => {
  if (!value) return null;
  const source = String(value);

  // Separators are 1:1 replacements, so offsets line up with the original string;
  // slice the original to keep the real casing (matters on Linux/Docker paths).
  const comparable = normalizeForCompare(source).replace(/[\\/]+$/, '');
  for (const { from, to } of PATH_REMAP) {
    if (comparable === from || comparable.startsWith(`${from}\\`)) {
      const suffix = source.slice(0, comparable.length).slice(from.length).replace(/^[\\/]+/, '');
      return joinPath(to, suffix);
    }
  }
  return fixUncPath(source);
};

/**
 * Every path a completed download could be at, best guess first.
 * @param {object} item client-reported item: name, category, content_path, save_path
 * @param {string} [downloadFolder] the download_folder setting (top of the download root, as Bookarr sees it)
 * @returns {string[]} de-duplicated candidate paths
 */
const downloadPathCandidates = (item = {}, downloadFolder) => {
  const candidates = [];
  const add = (value) => {
    if (!value) return;
    const clean = fixUncPath(String(value));
    if (!candidates.some(existing => normalizeForCompare(existing) === normalizeForCompare(clean))) candidates.push(clean);
  };

  const releaseName = item.name ? String(item.name) : null;
  const contentPath = item.content_path ? remapClientPath(item.content_path) : null;
  const contentName = contentPath ? baseName(contentPath) : null;
  const category = item.category && String(item.category).toLowerCase() !== 'default' ? baseName(item.category) : null;
  const savePath = item.save_path ? remapClientPath(item.save_path) : null;

  // What the client itself points at (already local for eg. a Windows client)
  add(contentPath);

  // ...then the same thing underneath the download folder as Bookarr sees it. The
  // category folder is included because that is where clients with categories put it.
  if (downloadFolder) {
    add(category && contentName ? joinPath(downloadFolder, category, contentName) : null);
    add(category && releaseName ? joinPath(downloadFolder, category, releaseName) : null);
    add(contentName ? joinPath(downloadFolder, contentName) : null);
    add(releaseName ? joinPath(downloadFolder, releaseName) : null); // legacy guess: download folder + release name
  }

  // Last resort: the client's own save path, holding either the real file or the release name
  if (savePath) {
    add(joinPath(savePath, contentName || releaseName));
  }

  return candidates;
};

/**
 * Pick the path a completed download is most likely sitting at.
 * @param {object} item client-reported item: name, category, content_path, save_path
 * @param {string} [downloadFolder] the download_folder setting
 * @returns {{path: string|null, candidates: string[], exists: boolean}}
 *   `path` is the first existing candidate, or the best guess when none exist (so the
 *   importer can still report what it tried); `candidates` keeps the full ordered list.
 */
const resolveDownloadPath = (item, downloadFolder) => {
  const candidates = downloadPathCandidates(item, downloadFolder);
  const existing = candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch (error) {
      return false;
    }
  });
  return { path: existing || candidates[0] || null, candidates, exists: Boolean(existing) };
};

module.exports = { downloadPathCandidates, resolveDownloadPath, remapClientPath, joinPath, baseName };
