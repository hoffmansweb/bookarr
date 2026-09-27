const { Book, Author } = require('../models');
const { getSetting } = require('../controllers/settingsController');
const logger = require('../config/logger');
const fs = require('fs').promises;
const path = require('path');

let io;
let isRunning = false;

const setIO = (socketIO) => { io = socketIO; };

const syncLibrary = async (specificAuthorId = null) => {
  if (isRunning) return 'Already running';
  isRunning = true;
  if (io) io.emit('job:status', { job: 'librarySync', status: 'running' });
  
  try {
    logger.info('Starting library sync...');
    const ebooksFolder = await getSetting('ebooks_folder');
    const audiobooksFolder = await getSetting('audiobooks_folder');
    const legacyFolder = await getSetting('books_folder');
    
    const foldersToScan = [];
    if (ebooksFolder) foldersToScan.push({ path: ebooksFolder, mediaType: 'ebook' });
    if (audiobooksFolder) foldersToScan.push({ path: audiobooksFolder, mediaType: 'audiobook' });
    if (!ebooksFolder && !audiobooksFolder && legacyFolder) {
      foldersToScan.push({ path: legacyFolder, mediaType: null }); // auto-detect
    }
    
    if (foldersToScan.length === 0) {
      logger.warn('No library folders configured');
      isRunning = false;
      if (io) io.emit('job:status', { job: 'librarySync', status: 'idle' });
      return;
    }

    const where = specificAuthorId ? { id: specificAuthorId } : {};
    const authors = await Author.findAll({ where, include: [{ model: Book, as: 'books' }] });
    let synced = 0;
    const usedFiles = new Set();

    const getAllFiles = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await getAllFiles(fullPath));
        } else if (/\.(epub|pdf|mobi|azw3|m4b|mp3)$/i.test(entry.name)) {
          files.push(fullPath);
        }
      }
      return files;
    };

    for (const { path: booksFolder, mediaType: folderMediaType } of foldersToScan) {
      logger.info(`Scanning folder: ${booksFolder} (mediaType: ${folderMediaType || 'auto-detect'})`);
      
      for (const author of authors) {
        const authorFolder = path.join(booksFolder, author.name);
        
        try {
          const bookFiles = await getAllFiles(authorFolder);
          if (bookFiles.length === 0) continue;
          logger.info(`Scanning ${author.name} in ${booksFolder}: found ${bookFiles.length} files`);

          for (const book of author.books) {
            // Update bookType/mediaType for existing files
            if (book.filePath) {
              const ext = path.extname(book.filePath).toLowerCase();
              const correctType = ['.m4b', '.mp3'].includes(ext) ? 'audiobook' : 'ebook';
              const updates = {};
              if (book.mediaType !== correctType) updates.mediaType = correctType;
              if (book.bookType !== correctType) updates.bookType = correctType;
              if (Object.keys(updates).length > 0) {
                await book.update(updates);
                logger.info(`Updated mediaType for "${book.title}" to ${correctType}`);
              }
              usedFiles.add(book.filePath);
              continue;
            }
            
            // When separate ebook and audiobook entries exist for this title ("Get" with both formats),
            // each may only take a file of its own type. Lone legacy entries can still match either.
            const sameTitle = (b) => b.id !== book.id && b.title.toLowerCase().trim() === book.title.toLowerCase().trim();
            const hasTwin = (type) => author.books.some(b => sameTitle(b) && b.mediaType === type);
            const match = bookFiles.find(f => {
              if (usedFiles.has(f)) return false;
              const fileType = /\.(m4b|mp3|m4a)$/i.test(f) ? 'audiobook' : 'ebook';
              if (fileType !== book.mediaType && hasTwin(fileType)) return false;

              const fileName = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
              const titleLower = book.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
              const authorLower = author.name.toLowerCase();
              
              const hasAuthorInFile = authorLower.split(/\s+/).some(w => w.length > 2 && fileName.includes(w));
              
              const commonWords = ['the', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'book', 'series', 'complete', 'collection', 'novel', 'volume', 'vol', 'edition'];
              const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));
              
              if (titleWords.length === 0) return false;
              
              const matchCount = titleWords.filter(word => fileName.includes(word)).length;
              const matchPercent = matchCount / titleWords.length;
              
              const threshold = hasAuthorInFile ? 0.6 : 0.7;
              return matchPercent >= threshold && matchCount >= 2;
            });

            if (match) {
              usedFiles.add(match);
              
              const ext = path.extname(match).toLowerCase();
              const detectedType = ['.m4b', '.mp3'].includes(ext) ? 'audiobook' : 'ebook';
              const mediaType = folderMediaType || detectedType;
              
              logger.info(`Found file: "${path.basename(match)}" -> "${book.title}" [${mediaType}]`);
              await book.update({
                status: 'available',
                filePath: match,
                mediaType,
                bookType: mediaType,
                // The sync just linked a real file to this book, so this is its arrival
                importedAt: book.importedAt || new Date()
              });
              synced++;
            }
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            logger.error(`Error scanning ${author.name}:`, error.message);
          }
        }
      }
    }

    logger.info(`Library sync complete. Synced: ${synced}`);
    return `Matched ${synced} file(s) to books`;
  } catch (error) {
    logger.error('Library sync error:', error);
  } finally {
    isRunning = false;
    if (io) io.emit('job:status', { job: 'librarySync', status: 'idle' });
  }
};

const getStatus = () => ({ job: 'librarySync', status: isRunning ? 'running' : 'idle' });

// Scheduled by jobs/index.js
module.exports = { syncLibrary, setIO, getStatus };
