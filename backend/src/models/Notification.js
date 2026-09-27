const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: DataTypes.TEXT,
  read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  metadata: DataTypes.JSON
});

module.exports = Notification;
