const { Author, Book } = require('./models');
const sequelize = require('./config/database');
const googleBooks = require('./services/googleBooks');

async function linkAuthors() {
  try {
    await sequelize.authenticate();
    
    const books = await Book.findAll({ where: { authorId: null } });
    console.log(`Processing ${books.length} books without authors`);
    
    let linked = 0;
    for (const book of books) {
      try {
        if (book.googleBooksId) {
          const gbData = await googleBooks.getBookById(book.googleBooksId);
          if (gbData && gbData.author) {
            const [author] = await Author.findOrCreate({
              where: { name: gbData.author },
              defaults: { name: gbData.author }
            });
            await book.update({ authorId: author.id });
            console.log(`Linked "${book.title}" to ${gbData.author}`);
            linked++;
          }
        } else if (book.isbn13 || book.isbn10) {
          const results = await googleBooks.searchByISBN(book.isbn13 || book.isbn10);
          if (results[0] && results[0].author) {
            const [author] = await Author.findOrCreate({
              where: { name: results[0].author },
              defaults: { name: results[0].author }
            });
            await book.update({ authorId: author.id });
            console.log(`Linked "${book.title}" to ${results[0].author}`);
            linked++;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed for "${book.title}":`, error.message);
      }
    }
    
    console.log(`\nLinked ${linked} books`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

linkAuthors();
