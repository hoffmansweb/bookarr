// Series labels scraped from Goodreads come in a few shapes:
//   "Black Dagger Brotherhood (Series #3)"   (search results)
//   "Society of Villains #1"                 (book page / older layouts)
//   "The Expanse, Book 3" / "Dune, Vol. 2"   (publisher wordings)
// The Book model keeps the name and the number in separate columns (series,
// seriesPosition), so split the label here rather than storing it verbatim — the UI
// would otherwise render "📚 Black Dagger Brotherhood (Series #3)".
const POSITION_PATTERNS = [
  /^(.*?)[\s,]*\(\s*series\s*#\s*(\d+(?:\.\d+)?)\s*\)\s*$/i,  // "Name (Series #3)"
  /^(.*?)[\s,]*\(\s*book\s*(\d+(?:\.\d+)?)\s*\)\s*$/i,        // "Name (Book 3)"
  /^(.*?)[\s,]*#\s*(\d+(?:\.\d+)?)\s*$/,                      // "Name #3", "Name, #3"
  /^(.*?)[\s,]*\bbook\s*(\d+(?:\.\d+)?)\s*$/i,                // "Name, Book 3"
  /^(.*?)[\s,]*\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?)\s*$/i       // "Name, Vol. 2"
];

const cleanName = (name) => String(name || '')
  .replace(/^[\s,:;-]+/, '')
  .replace(/[\s,:;-]+$/, '')
  .trim();

/**
 * Split a scraped series label into the Book model's columns.
 * @param {string|null} label e.g. "Black Dagger Brotherhood (Series #3)"
 * @returns {{series: string|null, seriesPosition: number|null}} series name without the
 *   number; both null when there is nothing usable to store.
 */
const parseSeriesText = (label) => {
  const raw = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return { series: null, seriesPosition: null };

  for (const pattern of POSITION_PATTERNS) {
    const match = raw.match(pattern);
    const name = cleanName(match?.[1]);
    const position = Number(match?.[2]);
    if (name && Number.isFinite(position) && position > 0) {
      return { series: name, seriesPosition: position };
    }
  }

  // Series with no number on the page (e.g. a standalone entry in a series)
  return { series: cleanName(raw) || null, seriesPosition: null };
};

module.exports = { parseSeriesText };
