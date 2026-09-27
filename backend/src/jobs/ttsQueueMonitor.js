const { Book } = require('../models');
const downloadQueue = require('../utils/downloadQueue');
const logger = require('../config/logger');

const run = async () => {
  const ttsController = require('../controllers/ttsController');
  const books = await Book.findAll({ where: { ttsQueued: true } });
  
  for (const book of books) {
    if (!downloadQueue.isProcessing(book.id)) {
      logger.info(`Resuming queued TTS job for: ${book.title}`);
      await ttsController.enqueueNarration(book.id).catch(() => {});
    }
  }
};

module.exports = { run };
