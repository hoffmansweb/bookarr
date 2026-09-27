const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserBooks = sequelize.define('UserBooks', {
  status: {
    type: DataTypes.STRING,
    defaultValue: 'unread'
  },
  starred: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  progress: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  lastRead: DataTypes.DATE,
  lastPosition: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  lastReadingPosition: DataTypes.STRING,
  ttsPosition: DataTypes.STRING,
  ttsCharPosition: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'UserBooks'
});

module.exports = UserBooks;
