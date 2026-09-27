const { Book } = require('./src/models');

(async () => {
  try {
    const book = await Book.findByPk('2d9ff190-c369-4007-b860-2dcfcc3a78ab');
    if (book) {
      console.log('Current path:', book.filePath);
      const correctPath = '\\\\Desktop-6m9k4qs\\h\\Calibre\\Navessa Allen\\Navessa Allen - Lights Out (Into Darkness, #1).mp3';
      await book.update({ filePath: correctPath });
      console.log('Fixed path:', correctPath);
    } else {
      console.log('Book not found');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
