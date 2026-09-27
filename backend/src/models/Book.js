const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Book = sequelize.define('Book', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  subtitle: DataTypes.STRING,
  description: DataTypes.TEXT,
  isbn10: DataTypes.STRING,
  isbn13: DataTypes.STRING,
  publishedDate: DataTypes.STRING,
  publisher: DataTypes.STRING,
  pageCount: DataTypes.INTEGER,
  language: DataTypes.STRING,
  coverUrl: DataTypes.STRING,
  filePath: DataTypes.STRING,
  series: DataTypes.STRING,
  seriesNumber: DataTypes.FLOAT,
  mediaType: {
    type: DataTypes.STRING,
    defaultValue: 'ebook',
    allowNull: false
  }, // 'ebook' or 'audiobook' - determines which library this belongs to
  bookType: {
    type: DataTypes.STRING,
    defaultValue: 'ebook'
  }, // legacy compat
  duration: DataTypes.INTEGER,
  narrator: DataTypes.STRING,
  audioFormat: DataTypes.STRING,
  googleBooksId: DataTypes.STRING,
  goodreadsId: DataTypes.STRING,
  rating: DataTypes.FLOAT,
  ratingsCount: DataTypes.INTEGER,
  status: {
    type: DataTypes.STRING,
    defaultValue: 'wanted'
  }, // wanted, downloading, available, reading, completed, ignored
  monitored: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  series: DataTypes.STRING,
  seriesPosition: DataTypes.FLOAT,
  genres: DataTypes.JSON,
  metadata: DataTypes.JSON,
  amazonAsin: DataTypes.STRING,
  amazonUrl: DataTypes.STRING,
  downloadName: DataTypes.STRING,
  downloadId: DataTypes.STRING,
  downloadClientId: DataTypes.UUID,
  chapters: DataTypes.JSON,
  lastSearchedAt: DataTypes.DATE,
  // When a file actually landed in the library. Set by the import paths (never by later edits),
  // because the two automatic timestamps cannot stand in for it: createdAt is the "wanted" date
  // for books that were searched for first, and updatedAt moves on every metadata refresh,
  // chapter extraction or status change.
  importedAt: DataTypes.DATE,
  lastPosition: DataTypes.FLOAT,
  lastReadingPosition: DataTypes.STRING,
  lastPositionUpdated: DataTypes.DATE,
  availableFormats: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  ttsQueued: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  hooks: {
    // Keep ISBN columns clean no matter which scraper wrote them. Kindle editions report their
    // Amazon ASIN ("B09P1HMR9W") as the ISBN; stripped to digits that became junk searches ("09").
    beforeValidate: (book) => {
      const ASIN = /^B0[A-Z0-9]{8}$/;
      for (const [field, valid] of [['isbn13', /^97[89]\d{10}$/], ['isbn10', /^\d{9}[\dX]$/]]) {
        const raw = book.getDataValue(field);
        if (raw == null || raw === '') continue;
        const value = String(raw).replace(/[\s-]/g, '').toUpperCase();
        if (valid.test(value)) {
          if (value !== raw) book.setDataValue(field, value);
          continue;
        }
        if (ASIN.test(value) && !book.getDataValue('amazonAsin')) book.setDataValue('amazonAsin', value);
        book.setDataValue(field, null);
      }
    }
  }
});

module.exports = Book;
