const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.NODE_ENV === 'production'
  ? '/app/data/database.sqlite'
  : path.join(__dirname, '..', '..', 'database.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

module.exports = sequelize;
