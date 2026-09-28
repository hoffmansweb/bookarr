const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Author } = require('../models');
const { auth, adminAuth } = require('../middleware/auth');

router.get('/search-external', auth, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.json([]);
    }
    
    console.log('Searching for author:', query);
    const openLibrary = require('../services/openLibrary');
    const goodreads = require('../scrapers/goodreads');
    
    const [olResults, grResults] = await Promise.allSettled([
      openLibrary.searchBooks(query, 100),
      goodreads.searchBooks(query)
    ]);
    
    const results = [];
    if (olResults.status === 'fulfilled') results.push(...olResults.value);
    if (grResults.status === 'fulfilled') results.push(...grResults.value);
    
    console.log('Found results:', results.length);
    
    const authorsMap = new Map();
    
    results.forEach(item => {
      const authorName = item.author || (item.authors && item.authors[0]);
      if (authorName) {
        if (!authorsMap.has(authorName)) {
          authorsMap.set(authorName, {
            name: authorName,
            imageUrl: item.coverUrl,
            bookCount: 1
          });
        } else {
          authorsMap.get(authorName).bookCount++;
        }
      }
    });
    
    const authors = Array.from(authorsMap.values());
    
    console.log('Returning authors:', authors.length);
    res.json(authors);
  } catch (error) {
    console.error('Search error:', error.message);
    res.json([]);
  }
});

router.post('/add', adminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Author name is required' });
    }

    // The search preview image is one of the author's book covers, not a photo of them,
    // so don't store it; look up a real photo/bio in the background instead.
    const [author, created] = await Author.findOrCreate({
      where: { name },
      defaults: { name, monitored: false }
    });

    if (created) {
      require('../services/aggregator').getAuthorInfo(name)
        .then(info => info && author.update({
          bio: info.bio || null,
          imageUrl: info.imageUrl || null,
          website: info.website || null,
          goodreadsId: info.goodreadsId || null
        }))
        .catch(() => {});
      const openLibrary = require('../services/openLibrary');
      const { Book } = require('../models');
      
      let totalFetched = 0;
      const maxBooks = 500;
      
      const normName = (n) => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const target = normName(name);
      
      while (totalFetched < maxBooks) {
        // Page through results; previously the same first page was re-fetched every iteration
        const page = await openLibrary.searchBooks(`author:"${name.replace(/"/g, '')}"`, 100, totalFetched);
        console.log(`Fetched ${page.length} books for ${name}, total: ${totalFetched}`);
        if (page.length === 0) break;
        
        // Only keep works actually credited to this author
        const books = page.filter(b => b.title && (b.authors || []).some(a => normName(a) === target));
        for (const bookData of books) {
          const [book, created] = await Book.findOrCreate({
            where: { 
              title: bookData.title,
              authorId: author.id
            },
            defaults: {
              title: bookData.title,
              isbn10: bookData.isbn10,
              isbn13: bookData.isbn13,
              publishedDate: bookData.publishedDate,
              publisher: bookData.publisher,
              pageCount: bookData.pageCount,
              coverUrl: bookData.coverUrl,
              authorId: author.id,
              status: 'wanted'
            }
          });
          if (created) console.log('Created:', book.title);
        }
        
        totalFetched += page.length;
        if (page.length < 100) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log(`Finished creating books for ${name}, total: ${totalFetched}`);
      
      const authorController = require('../controllers/authorController');
      const mockReq = { params: { id: author.id } };
      // refreshBooks may call res.status(...).json(...) on error paths
      const mockRes = { json: () => mockRes, status: () => mockRes };
      
      console.log('Starting author refresh...');
      await authorController.refreshBooks(mockReq, mockRes).catch(err => {
        console.error('Auto-refresh failed:', err.message);
      });
      console.log('Author refresh completed');
    }
    
    res.json(author);
  } catch (error) {
    console.error('Add author error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
