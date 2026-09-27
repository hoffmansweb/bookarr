const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const migrate = async () => {
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    await queryInterface.addColumn('Books', 'lastPosition', {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0
    });
    console.log('Added lastPosition column');
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error('Error adding lastPosition:', error.message);
    }
  }
  
  try {
    await queryInterface.addColumn('Books', 'lastPositionUpdated', {
      type: DataTypes.DATE,
      allowNull: true
    });
    console.log('Added lastPositionUpdated column');
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error('Error adding lastPositionUpdated:', error.message);
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
