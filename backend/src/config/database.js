require('dotenv').config();

const { Sequelize } = require('sequelize');
const { dbPath } = require('./paths');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

module.exports = sequelize;
