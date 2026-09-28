const path = require('path');
const ebookToAudiobookService = require('../services/ebookToAudiobookService');
const ttsService = require('../services/ttsService');
const openaiTts = require('../services/openaiTts');
const { Book, Author } = require('../models');
const downloadQueue = require('../utils/downloadQueue');
const { getLibraryFolder, emit, notifyAudiobookshelf } = require('../services/libraryImport');
const { sanitizeFileName } = require('../utils/httpDownloader');
const { getSetting } = require('./settingsController');
const logger = require('../config/logger');

exports.enqueueNarration = async (bookId, overrideOptions = {}) => {
  const book = await Book.findByPk(bookId, { include: [{ model: Author, as: 'author' }] });
  if (!book || !book.filePath || !book.filePath.toLowerCase().endsWith('.epub')) return;
  if (downloadQueue.isProcessing(bookId)) return;

  const libraryFolder = await getLibraryFolder('audiobook');
  if (!libraryFolder) return;

  const authorName = sanitizeFileName(book.author?.name || 'Unknown');
  const title = sanitizeFileName(book.title);
  const outputDir = path.join(libraryFolder, authorName, title);

  const options = {
    voiceName: overrideOptions.voiceName || await getSetting('tts_voice_default') || 'oai:af_sky',
    speed: overrideOptions.speed || parseFloat(await getSetting('tts_speed_default')) || 1.0,
    languageCode: overrideOptions.languageCode || 'en-US',
    provider: overrideOptions.provider || 'local',
    onProgress: (p) => emit('download:progress', { bookId, source: 'tts', stage: 'converting', percent: p.percent, message: `Narrating chapter ${p.chapter}/${p.chapters}` })
  };

  downloadQueue.add({
    bookId,
    title: book.title,
    handler: async () => {
      const result = await ebookToAudiobookService.convertToAudiobook(book.filePath, outputDir, options);
      if (!result.success) {
        await book.update({ ttsQueued: false });
        emit('download:progress', { bookId, source: 'tts', stage: 'failed', message: result.error });
        return;
      }

      const meta = book.metadata || {};
      let audiobook = meta.audiobookBookId ? await Book.findByPk(meta.audiobookBookId) : null;
      const fields = {
        title: book.title,
        authorId: book.authorId,
        description: book.description,
        coverUrl: book.coverUrl,
        publishedDate: book.publishedDate,
        genres: book.genres,
        series: book.series,
        seriesNumber: book.seriesNumber,
        status: 'available',
        monitored: false,
        filePath: result.path,
        mediaType: 'audiobook',
        bookType: 'audiobook',
        audioFormat: 'm4b',
        narrator: `TTS (${String(options.voiceName || 'default').replace(/^oai:/, 'Kokoro ')})`,
        chapters: result.chapters,
        duration: Math.round(result.duration / 60),
        metadata: { ttsSourceBookId: book.id },
        importedAt: audiobook?.importedAt || new Date()
      };

      if (audiobook) {
        await audiobook.update(fields);
      } else {
        audiobook = await Book.create(fields);
        await book.update({
          availableFormats: { ...(book.availableFormats || {}), audiobook: true },
          metadata: { ...meta, audiobookBookId: audiobook.id },
          ttsQueued: false
        });
      }

      // Also ensure it is unset if it was already updated without audiobook creation branch
      if (audiobook) {
        await book.update({ ttsQueued: false });
      }

      emit('book:updated', { bookId: book.id, status: 'available' });
      emit('download:progress', { bookId, source: 'tts', stage: 'done', message: 'Conversion complete' });
      notifyAudiobookshelf().catch(() => {});
      
      const { sendWebhook } = require('../services/webhookService');
      sendWebhook('Audiobook Narrated', `${book.title} by ${book.author?.name || 'Unknown'} has been converted to an Audiobook.`, book.coverUrl);
    }
  });

  await book.update({ ttsQueued: true });
  emit('download:progress', { bookId, source: 'tts', stage: 'queued', percent: 0, message: 'Added to background queue...' });
};

exports.convertToAudiobook = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { voiceName, speed, languageCode, provider } = req.body;

    const book = await Book.findByPk(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (!book.filePath || !book.filePath.toLowerCase().endsWith('.epub')) {
      return res.status(400).json({ error: 'Book must be an EPUB file' });
    }
    if (downloadQueue.isProcessing(bookId)) return res.status(409).json({ error: 'Already converting' });

    await exports.enqueueNarration(bookId, { voiceName, speed, languageCode, provider });
    res.json({ message: 'Conversion queued' });
  } catch (err) {
    logger.error('Failed to queue conversion:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getConversionStatus = async (req, res) => {
  try {
    const book = await Book.findByPk(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const audiobookId = book.metadata?.audiobookBookId;
    const audiobook = audiobookId ? await Book.findByPk(audiobookId) : null;
    res.json({
      hasAudiobook: !!audiobook,
      audiobookBookId: audiobook?.id || null,
      audiobookPath: audiobook?.filePath || null,
      queueStatus: downloadQueue.getStatus(),
      isQueued: downloadQueue.isProcessing(req.params.bookId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getVoices = async (req, res) => {
  try {
    const voices = await ttsService.getVoices(req.query.provider || 'google');
    res.json({ voices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.testLocalServer = async (req, res) => {
  res.json(await openaiTts.test());
};
