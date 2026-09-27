// Per-format download source order (Settings → Sources → Download source priority).
// Stored as JSON in settings `source_order_ebook` / `source_order_audiobook`:
//   [{ "id": "youtube", "enabled": true }, ...]   (first = tried first)
const { getSetting } = require('../controllers/settingsController');

const SOURCES = {
  annas: { label: "Anna's Archive", help: 'Direct ebook downloads', formats: ['ebook'] },
  usenet: { label: 'Usenet indexers', help: 'NZB releases via SABnzbd/NZBGet', formats: ['ebook', 'audiobook'] },
  torrent: { label: 'Torrent indexers', help: 'Torrents via qBittorrent/Transmission/Deluge', formats: ['ebook', 'audiobook'] },
  youtube: { label: 'YouTube', help: 'Full-length audiobook uploads (fast, quality varies)', formats: ['audiobook'] },
  librivox: { label: 'LibriVox', help: 'Free public-domain recordings', formats: ['audiobook'] },
  loyalbooks: { label: 'Loyal Books', help: 'Free public-domain recordings (LibriVox mirror)', formats: ['audiobook'] },
  gutenberg: { label: 'Project Gutenberg', help: 'Free public-domain recordings', formats: ['audiobook'] },
  spotify: { label: 'Spotify (Free Tier)', help: 'Spotify audiobooks and public domain books', formats: ['audiobook'] },
  archive: { label: 'Internet Archive', help: 'archive.org audio collections', formats: ['audiobook'] },
  web: { label: 'Web search', help: 'Google/SearXNG/DuckDuckGo results (audio files, folders, pages)', formats: ['audiobook'] }
};

const DEFAULT_ORDER = {
  ebook: ['annas', 'usenet', 'torrent'],
  audiobook: ['usenet', 'torrent', 'librivox', 'loyalbooks', 'gutenberg', 'spotify', 'archive', 'youtube', 'web']
};

/**
 * Resolved order for a format: saved choices first, then any sources added since (enabled).
 * @returns {Promise<Array<{id, label, help, enabled}>>}
 */
const getOrder = async (format) => {
  const valid = Object.keys(SOURCES).filter(id => SOURCES[id].formats.includes(format));
  let saved = [];
  try {
    saved = JSON.parse((await getSetting(`source_order_${format}`)) || '[]');
  } catch (e) { /* bad JSON: fall back to defaults */ }

  const seen = new Set();
  const list = [];
  for (const s of Array.isArray(saved) ? saved : []) {
    if (!valid.includes(s?.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    list.push({ id: s.id, enabled: s.enabled !== false });
  }
  for (const id of DEFAULT_ORDER[format]) {
    if (!seen.has(id)) list.push({ id, enabled: true });
  }
  return list.map(s => ({ ...s, label: SOURCES[s.id].label, help: SOURCES[s.id].help }));
};

/** Enabled source ids in priority order. */
const getEnabledOrder = async (format) => {
  const annasOff = (await getSetting('annas_archive_enabled')) === 'false';
  return (await getOrder(format)).filter(s => s.enabled && !(s.id === 'annas' && annasOff)).map(s => s.id);
};

module.exports = { getOrder, getEnabledOrder, SOURCES, DEFAULT_ORDER };
