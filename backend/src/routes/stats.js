const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { Book, UserBooks, Author } = require('../models');

router.get('/', auth, async (req, res) => {
  try {
    const books = await Book.findAll({
      include: [
        { model: UserBooks, as: 'UserBooks', where: { UserId: req.user.id }, required: false },
        { model: Author, as: 'author' }
      ]
    });

    let totalBooks = 0;
    let completedBooks = 0;
    let totalPages = 0;
    let totalAudioHours = 0;
    const genres = {};

    books.forEach(book => {
      const ub = book.UserBooks && book.UserBooks[0];
      if (ub && ub.status !== 'unread') {
        totalBooks++;
        if (ub.status === 'completed') completedBooks++;

        // Add to pages/hours if completed or calculate by progress
        const progress = ub.progress || 0;
        
        if (book.bookType === 'audiobook' && book.duration) {
          totalAudioHours += (book.duration / 3600) * progress;
        } else if (book.pageCount) {
          totalPages += book.pageCount * progress;
        }

        if (book.genres) {
          try {
            const parsed = JSON.parse(book.genres);
            parsed.forEach(g => {
              genres[g] = (genres[g] || 0) + 1;
            });
          } catch(e) {}
        }
      }
    });

    const topGenres = Object.entries(genres).sort((a,b) => b[1]-a[1]).slice(0, 5).map(g => ({ name: g[0], count: g[1] }));

    res.json({
      totalBooks,
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
