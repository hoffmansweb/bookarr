// Clears author images that aren't photos of the author (e.g. Amazon's "Follow this author"
// store banner, "no photo" placeholders). Safe to run on every start; the next author
// refresh looks for a real photo.
const logger = require('../config/logger');

module.exports = async () => {
  try {
    const { Author } = require('../models');
    const { Op } = require('sequelize');
    const { isLikelyAuthorPhoto } = require('../utils/authorImage');
    const authors = await Author.findAll({ where: { imageUrl: { [Op.ne]: null } }, attributes: ['id', 'name', 'imageUrl'] });
    const bad = authors.filter(a => !isLikelyAuthorPhoto(a.imageUrl));
    for (const a of bad) await a.update({ imageUrl: null });
    if (bad.length) logger.info(`Cleared ${bad.length} author image(s) that weren't author photos (${bad.map(a => a.name).join(', ')})`);
  } catch (e) {
    logger.warn(`Author image cleanup skipped: ${e.message}`);
  }
};
