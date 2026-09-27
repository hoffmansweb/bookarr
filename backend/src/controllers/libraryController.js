const fs = require('fs').promises;
const path = require('path');
const { Author, Book } = require('../models');
const { getSetting } = require('./settingsController');
const aggregator = require('../services/aggregator');
const { Op } = require('sequelize');

exports.scanLibrary = async (req, res) => {
  try {
    const ebooksFolder = await getSetting('ebooks_folder');
    const audiobooksFolder = await getSetting('audiobooks_folder');
    const legacyFolder = await getSetting('books_folder');
    
    const foldersToScan = [];
    if (ebooksFolder) foldersToScan.push({ folderPath: ebooksFolder, mediaType: 'ebook' });
    if (audiobooksFolder) foldersToScan.push({ folderPath: audiobooksFolder, mediaType: 'audiobook' });
    if (!ebooksFolder && !audiobooksFolder && legacyFolder) {
      foldersToScan.push({ folderPath: legacyFolder, mediaType: null });
    }
    
    if (foldersToScan.length === 0) {
      return res.status(400).json({ error: 'No library folders configured (set ebooks_folder and/or audiobooks_folder in settings)' });
    }

    const io = req.app.get('io');
    const skipFolders = ['$recycle.bin', 'system volume information', '.', '..', 'lost+found', 'temp', 'tmp'];
    let imported = 0;

    for (const { folderPath: booksFolder, mediaType: folderMediaType } of foldersToScan) {
      console.log(`Scanning folder: ${booksFolder} [${folderMediaType || 'auto-detect'}]`);
      const authorFolders = await fs.readdir(booksFolder, { withFileTypes: true });

      // Handle loose files in root (format: "Author - Title.ext")
      for (const item of authorFolders) {
        if (item.isDirectory()) continue;
        const ext = path.extname(item.name).toLowerCase();
        if (!['.epub', '.mobi', '.pdf', '.azw3', '.m4b', '.mp3', '.m4a'].includes(ext)) continue;
        
        const basename = path.basename(item.name, ext);
        const parts = basename.split(' - ');
        let authorName, bookTitle;
        if (parts.length >= 2) {
          // Try "Author - [Series] - Title" or "Author - Title"
          authorName = parts[0].trim();
          bookTitle = parts[parts.length - 1].replace(/\s*[\(\[].*?[\)\]]\s*/g, '').trim();
        } else {
          authorName = 'Unknown';
          bookTitle = basename;
        }

        const filePath = path.join(booksFolder, item.name);
        const detectedType = ['.m4b', '.mp3', '.m4a'].includes(ext) ? 'audiobook' : 'ebook';
        const mediaType = folderMediaType || detectedType;

        let [author] = await Author.findOrCreate({ where: { name: authorName }, defaults: { name: authorName } });
        const existing = await Book.findOne({ where: { filePath } });
        if (!existing) {
          await Book.create({
            title: bookTitle,
            authorId: author.id,
            status: 'available',
            filePath,
            mediaType,
            bookType: mediaType,
            // The scan just placed this file in the library
            importedAt: new Date()
          });
          imported++;
        }
      }

      for (const folder of authorFolders) {
        if (!folder.isDirectory()) continue;
        if (skipFolders.includes(folder.name.toLowerCase())) continue;
        if (folder.name.startsWith('.')) continue;

        const authorName = folder.name;
        const nameParts = authorName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        
        let author = await Author.findOne({
          where: {
            [Op.or]: [
              { name: authorName },
              { name: { [Op.like]: `${firstName}%${lastName}` } }
            ]
          }
        });
        
        if (!author) {
          [author] = await Author.findOrCreate({
            where: { name: authorName },
            defaults: { name: authorName }
          });
        }

        // Fetch author info in background
        try {
          const authorInfo = await aggregator.getAuthorInfo(authorName);
          if (authorInfo && !author.imageUrl) {
            await author.update({
              bio: authorInfo.bio,
              imageUrl: authorInfo.imageUrl,
              website: authorInfo.website
            });
          }
        } catch (error) {
          console.log(`Failed to fetch author info for ${authorName}`);
        }

        const authorPath = path.join(booksFolder, authorName);
        let items;
        try {
          items = await fs.readdir(authorPath, { withFileTypes: true });
        } catch (err) {
          // One unreadable folder must not abort the whole scan
          console.log(`Skipping unreadable folder ${authorPath}: ${err.message}`);
          continue;
        }
        
        const bookFiles = [];
        for (const item of items) {
          if (item.isDirectory()) {
            const subFiles = await fs.readdir(path.join(authorPath, item.name)).catch(() => []);
            subFiles.forEach(f => {
              const ext = path.extname(f).toLowerCase();
              if (['.epub', '.mobi', '.pdf', '.azw3', '.m4b', '.mp3', '.m4a'].includes(ext)) {
                bookFiles.push({ file: f, folder: item.name });
              }
            });
          } else {
            const ext = path.extname(item.name).toLowerCase();
            if (['.epub', '.mobi', '.pdf', '.azw3', '.m4b', '.mp3', '.m4a'].includes(ext)) {
              bookFiles.push({ file: item.name, folder: null });
            }
          }
        }

        let authorImported = 0;
        for (const { file, folder: subFolder } of bookFiles) {
          const filePath = subFolder ? path.join(authorPath, subFolder, file) : path.join(authorPath, file);
          
          const ext = path.extname(file).toLowerCase();
          const detectedType = ['.m4b', '.mp3', '.m4a'].includes(ext) ? 'audiobook' : 'ebook';
          const mediaType = folderMediaType || detectedType;
          
          // Parse title from filename
          let parsedTitle = path.basename(file, path.extname(file));
          // Common patterns: "Title - Author", "Author - Title", "Author - [Series] - Title"
          const dashParts = parsedTitle.split(/\s*-\s*/);
          if (dashParts.length >= 2) {
            // If first part matches author name, title is the last non-bracket part
            const firstPartLower = dashParts[0].toLowerCase();
            const authorLower = authorName.toLowerCase();
            if (firstPartLower === authorLower || authorLower.includes(firstPartLower.split(' ').pop())) {
              // Author - [Series] - Title format
              parsedTitle = dashParts[dashParts.length - 1];
            } else {
              // Title - Author format
              parsedTitle = dashParts[0];
            }
          }
          // Remove series indicators, format tags like (retail), (epub), etc
          const cleanTitle = parsedTitle
            .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
            .trim() || path.basename(file, path.extname(file)).trim();
          if (!cleanTitle) continue;
          
          let book = await Book.findOne({
            where: {
              [Op.or]: [
                { title: { [Op.like]: `%${cleanTitle}%` } },
                { filePath }
              ],
              authorId: author.id,
              mediaType
            }
          });
          
          if (!book) {
            book = await Book.create({
              title: cleanTitle,
              authorId: author.id,
              status: 'available',
              filePath,
              mediaType,
              bookType: mediaType,
              // The scan just placed this file in the library
              importedAt: new Date()
            });
            authorImported++;
          } else if (book.status !== 'available') {
            await book.update({
              status: 'available',
              filePath,
              mediaType,
              bookType: mediaType,
              // The file was already on disk but only now became this book's copy
              importedAt: book.importedAt || new Date()
            });
            authorImported++;
          } else {
            await book.update({ filePath });
          }
        }
        
        imported += authorImported;
        if (io) io.emit('library-scan-progress', { author: authorName });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (io) io.emit('library-scan-complete');
    res.json({ message: `Scanned library, marked ${imported} books as available` });
  } catch (error) {
    console.error('Library scan error:', error);
    res.status(500).json({ error: error.message });
  }
};
