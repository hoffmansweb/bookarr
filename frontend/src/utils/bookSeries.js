// Where does the "book N of the series" number live? The `seriesPosition` column is
// authoritative, but it is often empty, so the number is baked into the series name
// instead. Scraped labels (see backend/src/utils/series.js) are split before they are
// stored, but rows written earlier keep the raw label, so parse those here too:
//   "Society of Villains #1"                 (Goodreads book page)
//   "Black Dagger Brotherhood (Series #3)"   (Goodreads search results)
//   "The Expanse, Book 3" / "Dune, Vol. 2"   (other metadata)
export const SERIES_POSITION_PATTERNS = [
  /^(.*?)[\s,]*\(\s*series\s*#\s*(\d+(?:\.\d+)?)\s*\)\s*$/i,  // "Series (Series #3)"
  /^(.*?)[\s,]*\(\s*book\s*(\d+(?:\.\d+)?)\s*\)\s*$/i,        // "Series (Book 3)"
  /^(.*?)[\s,]*#\s*(\d+(?:\.\d+)?)\s*$/,                      // "Series #3", "Series, #3"
  /^(.*?)[\s,]*\bbook\s*(\d+(?:\.\d+)?)\s*$/i,                // "Series, Book 3"
  /^(.*?)[\s,]*\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?)\s*$/i       // "Series, Vol. 2"
];

const cleanName = (name) => String(name || '')
  .replace(/^[\s,:;-]+/, '')
  .replace(/[\s,:;-]+$/, '')
  .trim();

/**
 * Returns { name, position } for a book that is part of a series, otherwise null.
 * `position` is a display string ("3", "2.5") or null when the source has no number.
 */
export const parseBookSeries = (book) => {
  const raw = typeof book?.series === 'string' ? book.series.trim() : '';
  if (!raw) return null;

  let name = raw;
  let parsed = null;
  for (const pattern of SERIES_POSITION_PATTERNS) {
    const match = raw.match(pattern);
    const candidate = cleanName(match?.[1]);
    const position = Number(match?.[2]);
    if (candidate && Number.isFinite(position) && position > 0) {
      name = candidate; // strip the number so it is not shown twice
      parsed = String(position);
      break;
    }
  }

  // The column wins when it is set, but the name must not repeat the number
  const explicit = Number(book.seriesPosition);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { name, position: String(explicit) };
  }

  return { name, position: parsed };
};
