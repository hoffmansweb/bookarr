const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Author = sequelize.define('Author', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  bio: DataTypes.TEXT,
  imageUrl: DataTypes.STRING,
  goodreadsId: DataTypes.STRING,
  googleBooksId: DataTypes.STRING,
  website: DataTypes.STRING,
  monitored: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastChecked: DataTypes.DATE,
  metadata: DataTypes.JSON
});

module.exports = Author;
