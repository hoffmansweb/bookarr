const express = require('express');
const router = express.Router();
const { Book, Author } = require('../models');
const { getApiKey } = require('../middleware/auth');
const path = require('path');

// Basic OPDS feed for Ebooks and Audiobooks
router.get('/', async (req, res) => {
  try {
    const providedKey = req.query.apikey || req.header('X-Api-Key');
    const validKey = await getApiKey();
    if (providedKey !== validKey) return res.status(401).send('Unauthorized');

    const books = await Book.findAll({ 
      where: { status: 'available' },
      include: [{ model: Author, as: 'author' }],
      order: [['importedAt', 'DESC']]
    });

    let entries = '';
    books.forEach(b => {
      let downloadLink = '';
      if (b.filePath) {
        // Construct a direct download link using Bookarr's file serving endpoint
        // Or if it's OPDS, we just link to the /api/books/:id/file
        const ext = path.extname(b.filePath).toLowerCase();
        let mime = 'application/epub+zip';
        if (ext === '.m4b' || ext === '.mp3') mime = 'audio/mpeg';
        if (ext === '.pdf') mime = 'application/pdf';
        
        const host = req.get('host');
        const protocol = req.protocol;
        const fileUrl = `${protocol}://${host}/api/books/${b.id}/file?apikey=${validKey}`;
        
        downloadLink = `<link href="${fileUrl}" type="${mime}" rel="http://opds-spec.org/acquisition" />`;
      }

      entries += `
  <entry>
    <title>${b.title}</title>
    <id>urn:bookarr:book:${b.id}</id>
    <updated>${b.updatedAt.toISOString()}</updated>
    <author>
      <name>${b.author?.name || 'Unknown'}</name>
    </author>
    <summary>${b.description || ''}</summary>
    ${downloadLink}
    ${b.coverImage ? `<link href="${b.coverImage}" type="image/jpeg" rel="http://opds-spec.org/image" />` : ''}
  </entry>`;
    });

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:bookarr:library</id>
  <title>Bookarr OPDS Catalog</title>
  <updated>${new Date().toISOString()}</updated>
  <author>
    <name>Bookarr</name>
  </author>
  <link rel="self" href="${req.protocol}://${req.get('host')}/api/opds?apikey=${validKey}" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  ${entries}
</feed>`;

    res.set('Content-Type', 'application/atom+xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('OPDS Error');
  }
});

module.exports = router;
