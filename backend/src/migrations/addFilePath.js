const { Book } = require('../models');
const { QueryInterface } = require('sequelize');

const addFilePath = async () => {
  try {
    const queryInterface = Book.sequelize.getQueryInterface();
    
    await queryInterface.addColumn('Books', 'filePath', {
      type: require('sequelize').DataTypes.STRING,
      allowNull: true
    });
    
    console.log('✓ Added filePath column to Books table');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('filePath column already exists');
    } else {
      console.error('Migration failed:', error);
    }
  }
};

module.exports = addFilePath;
