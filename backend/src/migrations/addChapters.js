const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const migrate = async () => {
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    await queryInterface.addColumn('Books', 'chapters', {
      type: DataTypes.JSONB,
      allowNull: true
    });
    console.log('Added chapters column');
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error('Error adding chapters:', error.message);
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
