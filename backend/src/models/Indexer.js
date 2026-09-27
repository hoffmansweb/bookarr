const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Indexer = sequelize.define('Indexer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'newznab'
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  apiKey: {
    type: DataTypes.STRING,
    allowNull: false
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  priority: {
    type: DataTypes.INTEGER,
    defaultValue: 50
  },
  categories: DataTypes.STRING
});

module.exports = Indexer;
