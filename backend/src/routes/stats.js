const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { Book, UserBooks, Author } = require('../models');

// Stats for the Home page: catalogue totals (books, ebooks vs audiobooks, how many are actually
// on disk) plus the reader's running totals (pages read, hours listened, top genres). The
// per-user progress lives in UserBooks, which is only reachable through the User<->Book join, so
// it is fetched separately and merged in JS rather than through a Book include.
router.get('/', auth, async (req, res) => {
  try {
    const [books, userRows] = await Promise.all([
      Book.findAll({ include: [{ model: Author, as: 'author' }] }),
      UserBooks.findAll({ where: { UserId: req.user.id } })
    ]);
    const userBookByBook = new Map(userRows.map((row) => [row.BookId, row]));

    let catalogueBooks = 0;
    let ebooks = 0;
    let audiobooks = 0;
    let availableBooks = 0;

    let startedBooks = 0;
    let completedBooks = 0;
    let totalPages = 0;
    let totalAudioHours = 0;
    const genres = {};

    books.forEach((book) => {
      catalogueBooks++;
      const type = book.mediaType || book.bookType;
      if (type === 'audiobook') audiobooks++;
      else ebooks++;
      if (book.filePath) availableBooks++;

      const ub = userBookByBook.get(book.id);
      if (ub && ub.status !== 'unread') {
        startedBooks++;
        if (ub.status === 'completed') completedBooks++;

        // progress is a 0-100 percentage; scale before multiplying the totals
        const progress = Math.max(0, Math.min(100, Number(ub.progress) || 0)) / 100;

        if (type === 'audiobook' && book.duration) {
          totalAudioHours += (book.duration / 3600) * progress;
        } else if (book.pageCount) {
          totalPages += book.pageCount * progress;
        }

        if (book.genres) {
          try {
            JSON.parse(book.genres).forEach((g) => {
              genres[g] = (genres[g] || 0) + 1;
            });
          } catch (e) { /* a malformed genres blob must not fail the whole call */ }
        }
      }
    });

    const topGenres = Object.entries(genres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((g) => ({ name: g[0], count: g[1] }));

    res.json({
      catalogueBooks,
      ebooks,
      audiobooks,
      availableBooks,
      startedBooks,
      completedBooks,
      totalPages: Math.round(totalPages),
      totalAudioHours: Math.round(totalAudioHours),
      topGenres
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
