const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Books.lastSearchedAt lets auto-search rotate through wanted books (oldest searched first)
// instead of retrying the same handful every run.
module.exports = async () => {
  try {
    await sequelize.getQueryInterface().addColumn('Books', 'lastSearchedAt', { type: DataTypes.DATE, allowNull: true });
    console.log('✓ Added lastSearchedAt column to Books');
  } catch (error) {
    if (!/duplicate column|already exists/i.test(error.message)) console.error('lastSearchedAt migration error:', error.message);
  }
};
