const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Books.importedAt records when a file arrived in the library: the Dashboard's "New Arrivals"
// row and (later) the Activity history sort on it. It is only set at arrival, so a metadata
// refresh or chapter extraction cannot promote an old book back into that row.
//
// Books imported before the column existed have no arrival time recorded; updatedAt is the
// closest thing available (the import itself wrote the row, even if a later job touched it),
// so it is used once as an estimate. The UPDATE only looks at rows that still have no
// importedAt, which makes it a no-op on every boot after the first.
module.exports = async () => {
  try {
    await sequelize.getQueryInterface().addColumn('Books', 'importedAt', { type: DataTypes.DATE, allowNull: true });
    console.log('✓ Added importedAt column to Books');
  } catch (error) {
    if (!/duplicate column|already exists/i.test(error.message)) console.error('importedAt migration error:', error.message);
  }

  try {
    // Rows imported by the old code (file on disk, no arrival time). Rows without a filePath
    // are still "wanted"/"ignored" and must stay unset.
    const [, meta] = await sequelize.query(
      'UPDATE Books SET importedAt = updatedAt WHERE importedAt IS NULL AND filePath IS NOT NULL'
    );
    const backfilled = typeof meta === 'number' ? meta : (meta?.changes || 0);
    if (backfilled) console.log(`✓ Backfilled importedAt for ${backfilled} book(s) from updatedAt (estimate)`);
  } catch (error) {
    console.error('importedAt backfill error:', error.message);
  }
};