const logger = require('../config/logger');

class SpotifyService {
  async search(title, author) {
    try {
      const q = `${title} ${author || ''}`.trim();
      const { webSearch } = require('./webAudiobookSearch');
      // Spotify audiobooks are sometimes under /show/ or /episode/, or specifically 'audiobook' keyword
      const { results } = await webSearch(`site:open.spotify.com ${q} audiobook`);
      
      const books = [];
      for (const r of results) {
        if (!r.url.includes('/show/') && !r.url.includes('/episode/') && !r.url.includes('/track/')) continue;
        books.push({
          title: r.title.replace(/ \| Spotify/i, '').replace(/ - Podcast/i, '').trim(),
          author: author || 'Unknown',
          url: r.url,
          source: 'spotify',
          format: 'audiobook',
          type: 'spotify',
          description: r.snippet
        });
      }
      return books;
    } catch (error) {
      logger.error('Spotify search error:', error.message);
      return [];
    }
  }
}

module.exports = new SpotifyService();
