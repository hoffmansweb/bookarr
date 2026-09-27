// One-pass repair of ISBN columns holding ASINs or junk (the Book model's beforeValidate hook
// does the cleaning; saving each affected row applies it). Safe to run on every start.
const logger = require('../config/logger');

module.exports = async () => {
  try {
    const { Book } = require('../models');
    const { Op } = require('sequelize');
    const rows = await Book.findAll({
      where: { [Op.or]: [{ isbn13: { [Op.ne]: null } }, { isbn10: { [Op.ne]: null } }] },
      attributes: ['id', 'title', 'isbn13', 'isbn10', 'amazonAsin']
    });
    const bad = rows.filter(b =>
      (b.isbn13 && !/^97[89]\d{10}$/.test(String(b.isbn13))) || (b.isbn10 && !/^\d{9}[\dX]$/.test(String(b.isbn10))));
    let movedToAsin = 0;
    for (const b of bad) {
      const hadAsin = !!b.amazonAsin;
      b.changed('isbn13', true); // force the hook to run on save
      await b.save({ fields: ['isbn13', 'isbn10', 'amazonAsin'] });
      if (!hadAsin && b.amazonAsin) movedToAsin++;
    }
    if (bad.length) logger.info(`Cleaned ${bad.length} malformed ISBN value(s) (${movedToAsin} were Amazon ASINs, moved to amazonAsin)`);
  } catch (e) {
    logger.warn(`ISBN cleanup skipped: ${e.message}`);
  }
};
