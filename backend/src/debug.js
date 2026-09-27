const { Author, Book } = require('./models');
const sequelize = require('./config/database');

async function debug() {
  try {
    await sequelize.authenticate();
    
    const authors = await Author.findAll({
      include: [{ model: Book, as: 'books' }]
    });
    
    console.log('Authors with books:');
    authors.forEach(author => {
      console.log(`${author.name}: ${author.books.length} books`);
    });
    
    const books = await Book.findAll({ limit: 5 });
    console.log('\nFirst 5 books:');
    books.forEach(book => {
      console.log(`${book.title} - authorId: ${book.authorId}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debug();
