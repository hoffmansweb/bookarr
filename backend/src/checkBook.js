const { Book } = require('./models');
const sequelize = require('./config/database');

async function checkBookData() {
  try {
    await sequelize.authenticate();
    
    const book = await Book.findOne();
    
    console.log('Sample book data:');
    console.log(JSON.stringify(book, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBookData();
