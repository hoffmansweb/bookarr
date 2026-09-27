// Fast metadata lookup via the Google Books + Open Library APIs (no browser scraping),
// for bulk imports. Only returns a match whose title and author both line up.
const googleBooks = require('./googleBooks');
const openLibrary = require('./openLibrary');

const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "Stone Cold Bad (Stone Brothers Book 1)" / "Vicious Secret: The Obsidian Order, Book 1" -> core title
const coreTitle = (t) => normalize(String(t ?? '').replace(/\s*[([].*?[)\]]\s*/g, ' ').split(/:\s| - /)[0]);

const matches = (candidate, title, author) => {
  const want = coreTitle(title);
  const got = coreTitle(candidate.title || '');
  if (!want || !got) return false;
  const titleOk = got === want || got.startsWith(want) || want.startsWith(got);
  if (!titleOk) return false;
  if (!author) return true;
  const surname = normalize(author).split(' ').pop();
  const authors = normalize([candidate.author, ...(candidate.authors || [])].filter(Boolean).join(' '));
  return !surname || authors.includes(surname);
};

const FIELDS = ['description', 'isbn13', 'isbn10', 'publishedDate', 'publisher', 'pageCount', 'language', 'googleBooksId', 'rating', 'ratingsCount', 'genres', 'coverUrl'];

/**
 * @returns {Promise<object>} Book fields found (may be empty)
 */
const lookup = async (title, author) => {
  const q = author ? `intitle:${coreTitle(title)} inauthor:${author}` : title;
  const [g, o] = await Promise.allSettled([
    googleBooks.searchBooks(q, 10),
    openLibrary.searchBooks(author ? `${coreTitle(title)} ${author}` : title, 10)
  ]);
  const google = (g.status === 'fulfilled' ? g.value : []).find(c => matches(c, title, author));
  const ol = (o.status === 'fulfilled' ? o.value : []).find(c => matches(c, title, author));

  // Google has better descriptions/ratings; Open Library fills ISBN/page gaps
  const merged = {};
  for (const src of [google, ol]) {
    if (!src) continue;
    for (const k of FIELDS) {
      const v = src[k];
      if (merged[k] == null && v != null && v !== '' && !(Array.isArray(v) && !v.length)) merged[k] = v;
    }
  }
  return merged;
};

module.exports = { lookup, matches, coreTitle };
