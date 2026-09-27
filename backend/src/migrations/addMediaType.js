const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

async function addMediaType() {
  const queryInterface = sequelize.getQueryInterface();
  
  // Add mediaType to Books
  try {
    await queryInterface.addColumn('Books', 'mediaType', {
      type: DataTypes.STRING,
      defaultValue: 'ebook',
      allowNull: false
    });
    console.log('✓ Added mediaType column to Books');
  } catch (error) {
    if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
      console.log('✓ mediaType column already exists on Books');
    } else {
      console.error('Books mediaType migration error:', error.message);
    }
  }

  // Add mediaType to DownloadClients
  try {
    await queryInterface.addColumn('DownloadClients', 'mediaType', {
      type: DataTypes.STRING,
      defaultValue: 'both'
    });
    console.log('✓ Added mediaType column to DownloadClients');
  } catch (error) {
    if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
      console.log('✓ mediaType column already exists on DownloadClients');
    } else {
      console.error('DownloadClients mediaType migration error:', error.message);
    }
  }

  // Backfill: set mediaType based on existing bookType or file extension
  try {
    const [books] = await sequelize.query(
      `SELECT id, filePath, bookType FROM Books WHERE mediaType IS NULL OR mediaType = ''`
    );
    for (const book of books) {
      let mediaType = 'ebook';
      if (book.bookType === 'audiobook') {
        mediaType = 'audiobook';
      } else if (book.filePath) {
        const ext = book.filePath.split('.').pop().toLowerCase();
        if (['m4b', 'mp3', 'm4a'].includes(ext)) {
          mediaType = 'audiobook';
        }
      }
      await sequelize.query(
        `UPDATE Books SET mediaType = '${mediaType}' WHERE id = '${book.id}'`
      );
    }
    console.log('✓ Backfilled mediaType for existing books');
  } catch (error) {
    console.log('Backfill skipped:', error.message);
  }
}

module.exports = addMediaType;
