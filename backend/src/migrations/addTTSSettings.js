const sequelize = require('../config/database');

async function addTTSSettings() {
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    await queryInterface.addColumn('Users', 'ttsVoiceName', {
      type: sequelize.Sequelize.STRING,
      defaultValue: 'en-US-Neural2-J'
    });
    console.log('✓ Added ttsVoiceName column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ ttsVoiceName column already exists');
    } else {
      throw error;
    }
  }

  try {
    await queryInterface.addColumn('Users', 'ttsSpeed', {
      type: sequelize.Sequelize.FLOAT,
      defaultValue: 1.0
    });
    console.log('✓ Added ttsSpeed column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ ttsSpeed column already exists');
    } else {
      throw error;
    }
  }

  try {
    await queryInterface.addColumn('Users', 'ttsLanguageCode', {
      type: sequelize.Sequelize.STRING,
      defaultValue: 'en-US'
    });
    console.log('✓ Added ttsLanguageCode column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ ttsLanguageCode column already exists');
    } else {
      throw error;
    }
  }
  try {
    await queryInterface.addColumn('Users', 'ttsProvider', {
      type: sequelize.Sequelize.STRING,
      defaultValue: 'google'
    });
    console.log('✓ Added ttsProvider column');
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log('✓ ttsProvider column already exists');
    } else {
      throw error;
    }
  }
}

module.exports = addTTSSettings;
