const { Book } = require('./src/models');

(async () => {
  try {
    const result = await Book.update(
      { filePath: null, bookType: 'ebook' },
      { where: {} }
    );
    console.log(`Cleared filePath from ${result[0]} books`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
