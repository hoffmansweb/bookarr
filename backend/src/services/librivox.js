const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

class LibriVoxService {
  constructor() {
    this.apiUrl = 'https://librivox.org/api/feed/audiobooks';
  }

  async search(title, author) {
    try {
      // The LibriVox API answers "no matches" with HTTP 404, which isn't an error for us
      const query = async (params) => {
        const { data } = await axios.get(this.apiUrl, {
          params: { format: 'json', limit: 10, ...params },
          timeout: 30000,
          validateStatus: s => s < 400 || s === 404
        });
        return Array.isArray(data?.books) ? data.books : [];
      };

      const books = title ? await query({ title }) : [];

      // Also search by author if title search returns few results (API matches on last name)
      if (books.length < 3 && author) {
        const lastName = author.trim().split(/\s+/).pop();
        const authorBooks = await query({ author: lastName });
        authorBooks.forEach(b => { if (!books.find(x => x.id === b.id)) books.push(b); });
      }

      return books.map(b => ({
        title: b.title,
        author: b.authors?.map(a => `${a.first_name} ${a.last_name}`).join(', ') || null,
        duration: b.totaltimesecs,
        durationFormatted: b.totaltime,
        chapters: parseInt(b.num_sections) || 0,
        description: b.description,
        year: b.copyright_year,
        language: b.language,
        rssUrl: b.url_rss,
        zipUrl: b.url_zip_file,
        librivoxUrl: b.url_librivox,
        librivoxId: b.id,
        source: 'librivox',
        format: 'audiobook',
        type: 'librivox'
      }));
    } catch (error) {
      logger.error('LibriVox search error:', error.message);
      return [];
    }
  }

  async getChapters(rssUrl) {
    try {
      const { data } = await axios.get(rssUrl, { timeout: 10000 });
      const xml2js = require('xml2js');
      const parsed = await xml2js.parseStringPromise(data);
      const items = parsed.rss?.channel?.[0]?.item || [];

      return items.map(item => ({
        title: item.title?.[0] || '',
        url: item.enclosure?.[0]?.$?.url || '',
        duration: item['itunes:duration']?.[0] || ''
      }));
    } catch (error) {
      logger.error('LibriVox RSS error:', error.message);
      return [];
    }
  }

  async download(rssUrl, bookId) {
    const { Book, Author } = require('../models');
    const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
    if (!book) throw new Error('Book not found');

    const audiobooksFolder = await getSetting('audiobooks_folder') || await getSetting('books_folder');
    if (!audiobooksFolder) throw new Error('No audiobooks folder configured');

    const authorName = book.author?.name || 'Unknown';
    const bookTitle = book.title.replace(/[<>:"/\\|?*]/g, '');
    const outputDir = path.join(audiobooksFolder, authorName, bookTitle);
    await fs.mkdir(outputDir, { recursive: true });

    const chapters = await this.getChapters(rssUrl);
    if (chapters.length === 0) throw new Error('No chapters found in RSS');

    // Download each chapter MP3
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      if (!ch.url) continue;
      const filename = `${String(i + 1).padStart(3, '0')} - ${ch.title.replace(/[<>:"/\\|?*]/g, '')}.mp3`;
      const filePath = path.join(outputDir, filename);

      logger.info(`Downloading chapter ${i + 1}/${chapters.length}: ${ch.title}`);
      const response = await axios.get(ch.url, { responseType: 'stream', timeout: 60000 });
      const writer = require('fs').createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    // Update book record
    const bookChapters = chapters.map((ch, i) => ({
      title: ch.title,
      startTime: 0,
      file: `${String(i + 1).padStart(3, '0')} - ${ch.title.replace(/[<>:"/\\|?*]/g, '')}.mp3`
    }));

    await book.update({
      status: 'available',
      filePath: outputDir,
      mediaType: 'audiobook',
      bookType: 'audiobook',
      chapters: bookChapters,
      // Arrival time for the Dashboard's "New Arrivals" row; a re-download keeps the first one
      importedAt: book.importedAt || new Date()
    });

    logger.info(`LibriVox download complete: ${book.title} (${chapters.length} chapters) -> ${outputDir}`);
    return { success: true, path: outputDir, chapters: chapters.length };
  }
}

module.exports = new LibriVoxService();
