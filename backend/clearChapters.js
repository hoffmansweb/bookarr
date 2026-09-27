const { Book } = require('./src/models');

(async () => {
  try {
    const book = await Book.findByPk('2d9ff190-c369-4007-b860-2dcfcc3a78ab');
    if (book) {
      await book.update({ chapters: null });
      console.log('Chapters cleared - will re-extract on next play');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
