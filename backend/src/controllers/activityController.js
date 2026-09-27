const { Book, Author, DownloadClient } = require('../models');
const { getProgress } = require('../services/downloadProgressService');
const { deleteFromHistory } = require('../services/downloadClientService');

exports.getQueue = async (req, res) => {
  try {
    const books = await Book.findAll({
      where: { status: 'downloading' },
      include: [{ model: Author, as: 'author' }]
    });

    const queueItems = [];
    for (const book of books) {
      let progress = { percentage: 0, status: 'downloading', eta: null, speed: 0 };
      
      if (book.downloadClientId && book.downloadId) {
        try {
          const client = await DownloadClient.findByPk(book.downloadClientId);
          if (client) {
            progress = await getProgress(client, book.downloadId);
          }
        } catch (err) {
          console.error(`Failed to get progress for book ${book.title}:`, err.message);
        }
      }

      queueItems.push({
        id: book.id,
        title: book.title,
        author: book.author?.name || 'Unknown Author',
        coverUrl: book.coverUrl,
        downloadId: book.downloadId,
        downloadName: book.downloadName,
        mediaType: book.mediaType,
        progress: progress.percentage || 0,
        status: progress.status || 'downloading',
        speed: progress.speed || 0,
        eta: progress.eta || null
      });
    }

    res.json(queueItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getHistory = async (req, res) => {
  try {
    // Show recently available / imported books as history
    const books = await Book.findAll({
      where: { status: 'available' },
      include: [{ model: Author, as: 'author' }],
      order: [['updatedAt', 'DESC']],
      limit: 50
    });

    const historyItems = books.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author?.name || 'Unknown Author',
      coverUrl: book.coverUrl,
      mediaType: book.mediaType,
      filePath: book.filePath,
      importedAt: book.updatedAt
    }));

    res.json(historyItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.cancelQueueItem = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const { downloadClientId, downloadId } = book;

    // Delete/cancel from download client if configured
    if (downloadClientId && downloadId) {
      try {
        const client = await DownloadClient.findByPk(downloadClientId);
        if (client) {
          await deleteFromHistory(client, {
            id: downloadId,
            hash: downloadId,
            nzo_id: downloadId,
            nzbid: downloadId,
            name: book.downloadName || book.title
          });
        }
      } catch (err) {
        console.error(`Failed to delete download from client for book ${book.title}:`, err.message);
      }
    }

    // Reset book status back to wanted
    await book.update({
      status: 'wanted',
      downloadId: null,
      downloadName: null,
      downloadClientId: null
    });

    // Notify client via sockets
    const io = req.app.get('io');
    if (io) {
      io.emit('book:updated', { bookId: book.id, status: 'wanted' });
    }

    res.json({ success: true, message: 'Download cancelled and book status reset.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
