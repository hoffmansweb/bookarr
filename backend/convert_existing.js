const { Book } = require('./src/models');
const ebookConverter = require('./src/utils/ebookConverter');
const { Op } = require('sequelize');

(async () => {
  try {
    const books = await Book.findAll({ 
      where: { 
        filePath: { [Op.or]: [{ [Op.like]: '%.mobi' }, { [Op.like]: '%.azw3' }] } 
      } 
    });
    
    console.log(`Found ${books.length} existing books to convert`);
    
    for (const b of books) {
      try {
        console.log(`Converting: ${b.title}...`);
        const newPath = await ebookConverter.convertToEpub(b.filePath);
        await b.update({ filePath: newPath });
        console.log(`Successfully converted: ${b.title}`);
      } catch (err) {
        console.error(`Failed to convert ${b.title}:`, err.message);
      }
    }
    
    console.log('Finished converting existing books.');
  } catch (err) {
    console.error(err);
  }
})();
