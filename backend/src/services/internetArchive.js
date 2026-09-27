const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

class InternetArchiveService {
  constructor() {
    this.searchUrl = 'https://archive.org/advancedsearch.php';
    this.metadataUrl = 'https://archive.org/metadata';
    this.downloadUrl = 'https://archive.org/download';
  }

  async search(title, author) {
    try {
      const titleQuery = title ? `title:(${title})` : '';
      const authorQuery = author ? `creator:(${author})` : '';
      const q = [titleQuery, authorQuery, 'mediatype:audio'].filter(Boolean).join(' AND ');

      const { data } = await axios.get(this.searchUrl, {
        params: {
          q,
          'fl[]': ['identifier', 'title', 'creator', 'description', 'item_size', 'downloads'],
          rows: 15,
          output: 'json'
        },
        timeout: 10000
      });

      const docs = data.response?.docs || [];

      // Filter to likely audiobooks (not podcasts/music)
      return docs
        .filter(d => {
          const t = (d.title || '').toLowerCase();
          return t.includes('audiobook') || t.includes('audio book') || 
                 t.includes('read by') || t.includes('narrated') ||
                 (title && t.includes(title.toLowerCase().split(' ')[0]));
        })
        .map(d => ({
          title: d.title,
          author: d.creator || null,
          identifier: d.identifier,
          size: d.item_size,
          downloads: d.downloads,
          archiveUrl: `https://archive.org/details/${d.identifier}`,
          source: 'archive',
          format: 'audiobook',
          type: 'archive'
        }));
    } catch (error) {
      logger.error('Internet Archive search error:', error.message);
      return [];
    }
  }

  async getFiles(identifier) {
    try {
      const { data } = await axios.get(`${this.metadataUrl}/${encodeURIComponent(identifier)}`, { timeout: 20000 });
      const files = data.files || [];

      // Prefer compact lossy originals; lossless originals (flac/wav) are huge, so use their mp3 derivatives
      const lossy = /\.(mp3|m4a|m4b|ogg|opus)$/i;
      const originals = files.filter(f => lossy.test(f.name) && f.source === 'original');
      const chosen = originals.length ? originals : files.filter(f => /\.(mp3|m4a|m4b)$/i.test(f.name));

      // File names may contain sub-folders; encode each path segment separately
      const fileUrl = (name) => `${this.downloadUrl}/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`;

      return chosen.map(f => ({
        name: f.name,
        url: fileUrl(f.name),
        size: parseInt(f.size) || 0,
        duration: f.length,
        title: f.title || null
      }));
    } catch (error) {
      logger.error('Internet Archive files error:', error.message);
      return [];
    }
  }

  async download(identifier, bookId) {
    const { Book, Author } = require('../models');
    const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
    if (!book) throw new Error('Book not found');

    const audiobooksFolder = await getSetting('audiobooks_folder') || await getSetting('books_folder');
    if (!audiobooksFolder) throw new Error('No audiobooks folder configured');

    const authorName = book.author?.name || 'Unknown';
    const bookTitle = book.title.replace(/[<>:"/\\|?*]/g, '');
    const outputDir = path.join(audiobooksFolder, authorName, bookTitle);
    await fs.mkdir(outputDir, { recursive: true });

    const files = await this.getFiles(identifier);
    if (files.length === 0) throw new Error('No audio files found');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.name);
      const filename = `${String(i + 1).padStart(3, '0')} - ${path.basename(file.name, ext)}${ext}`;
      const filePath = path.join(outputDir, filename);

      logger.info(`Downloading ${i + 1}/${files.length}: ${file.name}`);
      const response = await axios.get(file.url, { responseType: 'stream', timeout: 120000 });
      const writer = require('fs').createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    const chapters = files.map((f, i) => ({
      title: path.basename(f.name, path.extname(f.name)),
      file: `${String(i + 1).padStart(3, '0')} - ${path.basename(f.name)}`
    }));

    await book.update({
      status: 'available',
      filePath: outputDir,
      mediaType: 'audiobook',
      bookType: 'audiobook',
      chapters,
      // Arrival time for the Dashboard's "New Arrivals" row; a re-download keeps the first one
      importedAt: book.importedAt || new Date()
    });

    logger.info(`Internet Archive download complete: ${book.title} (${files.length} files) -> ${outputDir}`);
    return { success: true, path: outputDir, files: files.length };
  }
}

module.exports = new InternetArchiveService();
