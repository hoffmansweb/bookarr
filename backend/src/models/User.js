const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcrypt');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    defaultValue: 'user'
  },
  amazonCookies: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ttsVoiceName: {
    type: DataTypes.STRING,
    defaultValue: 'en-US-Neural2-J'
  },
  ttsSpeed: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0
  },
  ttsLanguageCode: {
    type: DataTypes.STRING,
    defaultValue: 'en-US'
  },
  ttsProvider: {
    type: DataTypes.STRING,
    defaultValue: 'google'
  }
}, {
  hooks: {
    beforeCreate: async (user) => {
      user.password = await bcrypt.hash(user.password, 10);
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

User.prototype.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = User;
