const { Book } = require('./models');
const sequelize = require('./config/database');

async function checkDates() {
  try {
    await sequelize.authenticate();
    
    const books = await Book.findAll({ limit: 10 });
    
    console.log('Sample book dates:');
    books.forEach(book => {
      console.log(`${book.title}: publishedDate="${book.publishedDate}"`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDates();
