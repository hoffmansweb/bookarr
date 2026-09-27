const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DownloadClient = sequelize.define('DownloadClient', {
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
    allowNull: false
  }, // sabnzbd, nzbget, qbittorrent, transmission, deluge, jdownloader2, aria2
  host: {
    type: DataTypes.STRING,
    allowNull: false
  },
  port: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  apiKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true
  },
  useSsl: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  category: DataTypes.STRING,
  mediaType: {
    type: DataTypes.STRING,
    defaultValue: 'both'
  } // 'ebook', 'audiobook', or 'both' - which type this client handles
});

module.exports = DownloadClient;
