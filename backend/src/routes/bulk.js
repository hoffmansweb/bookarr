const express = require('express');
const router = express.Router();
const { Book } = require('../models');
const { auth } = require('../middleware/auth');

router.use(auth);

const ALLOWED_STATUSES = ['wanted', 'downloading', 'available', 'reading', 'completed', 'ignored'];

router.put('/bulk-update', async (req, res) => {
  try {
    const { bookIds, status } = req.body;
    
    if (!Array.isArray(bookIds) || bookIds.length === 0 || !bookIds.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'bookIds must be a non-empty array of ids' });
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }
    
    await Book.update(
      { status },
      { where: { id: bookIds } }
    );
    
    res.json({ message: `${bookIds.length} books updated` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
