const { Book } = require('../models');
const downloadQueue = require('../utils/downloadQueue');
const logger = require('../config/logger');

const run = async () => {
  const ttsController = require('../controllers/ttsController');
  const books = await Book.findAll({ where: { ttsQueued: true } });
  
  let resumed = 0;
  for (const book of books) {
    if (downloadQueue.isProcessing(book.id)) continue;
    try {
      await ttsController.enqueueNarration(book.id);
      resumed += 1;
      logger.info(`Resuming queued TTS job for: ${book.title}`);
    } catch (error) {
      logger.warn(`Could not resume the queued TTS job for "${book.title}": ${error.message}`);
    }
  }

  // Quiet job: null means "nothing to do", so an idle minute doesn't add a job-history entry
  if (!resumed) return null;
  return `Resumed ${resumed} queued TTS job(s)`;
};

module.exports = { run };
