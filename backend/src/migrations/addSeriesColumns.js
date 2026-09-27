const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');
const logger = require('../config/logger');

const addSeriesColumns = async () => {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('Books').catch(() => ({}));
    
    if (Object.keys(tableInfo).length > 0) {
      if (!tableInfo.series) {
        await queryInterface.addColumn('Books', 'series', {
          type: DataTypes.STRING,
          allowNull: true
        });
        logger.info('✓ series column added to Books');
      }
      
      if (!tableInfo.seriesNumber) {
        await queryInterface.addColumn('Books', 'seriesNumber', {
          type: DataTypes.FLOAT,
          allowNull: true
        });
        logger.info('✓ seriesNumber column added to Books');
      }
    }
  } catch (error) {
    logger.error(`Error adding series columns: ${error.message}`);
  }
};

module.exports = addSeriesColumns;
