const { Author, Book } = require('./models');
const sequelize = require('./config/database');

async function fixAuthorLinks() {
  try {
    await sequelize.authenticate();
    
    const authors = await Author.findAll();
    const books = await Book.findAll({ where: { authorId: null } });
    
    console.log(`Found ${books.length} books without authorId`);
    console.log(`Found ${authors.length} authors`);
    
    let fixed = 0;
    for (const book of books) {
      for (const author of authors) {
        if (book.title.toLowerCase().includes(author.name.toLowerCase())) {
          await book.update({ authorId: author.id });
          console.log(`Linked "${book.title}" to ${author.name}`);
          fixed++;
          break;
        }
      }
    }
    
    console.log(`\nFixed ${fixed} books`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAuthorLinks();
