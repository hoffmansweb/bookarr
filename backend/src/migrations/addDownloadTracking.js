const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const migrate = async () => {
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    await queryInterface.addColumn('Books', 'downloadId', {
      type: DataTypes.STRING,
      allowNull: true
    });
    console.log('Added downloadId column');
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error('Error adding downloadId:', error.message);
    }
  }
  
  try {
    await queryInterface.addColumn('Books', 'downloadClientId', {
      type: DataTypes.UUID,
      allowNull: true
    });
    console.log('Added downloadClientId column');
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error('Error adding downloadClientId:', error.message);
    }
  }
};

migrate().then(() => {
  console.log('Migration complete');
  process.exit(0);
}).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
