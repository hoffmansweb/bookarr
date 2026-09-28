// Canonical title key: two strings that differ only by case, punctuation, a leading
// article, or a parenthetical should be treated as the same book.
//   "The Russian Cage"    -> "russiancage"
//   "Russian Cage"        -> "russiancage"
//   "A Bone to Pick"      -> "bonetopick"
//   "Dead in Dallas (Sookie #2)" -> "deadindallas"
const normalizeTitle = (title) => {
  return String(title || '')
    .toLowerCase()
    .replace(/^[\s(\[{]*((the|a|an)\b\s*)/i, '') // strip a leading article
    .replace(/\(.*?\)|\[.*?\]/g, ' ')            // drop parentheticals and brackets
    .replace(/[^a-z0-9]/g, '')                   // drop punctuation/whitespace
    .trim();
};

module.exports = { normalizeTitle };
