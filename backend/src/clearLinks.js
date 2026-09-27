const { Book } = require('./models');

const clearFileLinks = async () => {
  try {
    const result = await Book.update(
      { filePath: null, status: 'wanted' },
      { where: { filePath: { [require('sequelize').Op.ne]: null } } }
    );
    console.log(`✓ Cleared ${result[0]} file links`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

clearFileLinks();
