const axios = require('axios');
const logger = require('../config/logger');

// Open Library asks API clients to send an identifying User-Agent.
const HEADERS = { 'User-Agent': 'Bookarr/1.0 (self-hosted book manager)' };
const SEARCH_FIELDS = 'key,title,author_name,author_key,first_publish_year,isbn,cover_i,number_of_pages_median,publisher,first_sentence';

class OpenLibraryService {
  constructor() {
    this.baseUrl = 'https://openlibrary.org';
  }

  async searchBooks(query, limit = 40, offset = 0) {
    if (!query || !String(query).trim()) return [];
    try {
      // search.json no longer returns isbn/publisher/page counts by default;
      // request the fields formatBook() relies on explicitly.
      const params = { q: query, limit, fields: SEARCH_FIELDS };
      if (offset) params.offset = offset;
      const response = await axios.get(`${this.baseUrl}/search.json`, {
        params,
        headers: HEADERS,
        timeout: 30000
      });
      return response.data.docs?.map(doc => this.formatBook(doc)) || [];
    } catch (error) {
      const status = error.response?.status;
      logger.warn(`Open Library search error${status ? ` (HTTP ${status})` : ''}: ${logger.describeError(error)}`);
      return [];
    }
  }

  async getBookByISBN(isbn) {
    try {
      const response = await axios.get(`${this.baseUrl}/isbn/${encodeURIComponent(isbn)}.json`, { headers: HEADERS, timeout: 15000 });
      return this.formatBookDetails(response.data);
    } catch (error) {
      return null;
    }
  }

  async getAuthorWorks(authorId) {
    try {
      const response = await axios.get(`${this.baseUrl}/authors/${authorId}/works.json`, {
        params: { limit: 100 },
        headers: HEADERS,
        timeout: 15000
      });
      return response.data.entries?.map(work => this.formatWork(work)) || [];
    } catch (error) {
      logger.warn(`Open Library author works error: ${logger.describeError(error)}`);
      return [];
    }
  }

  async getAuthorInfo(authorName) {
    try {
      const response = await axios.get(`${this.baseUrl}/search/authors.json`, {
        params: { q: authorName, limit: 1 },
        headers: HEADERS,
        timeout: 15000
      });
      const author = response.data.docs?.[0];
      if (!author) return null;
      
      const authorKey = author.key;
      const authorUrl = `${this.baseUrl}/authors/${authorKey}.json`;
      const authorDetails = await axios.get(authorUrl, { headers: HEADERS, timeout: 15000 });
      const data = authorDetails.data;
      
      const photoId = data.photos?.[0];
      
      return {
        bio: typeof data.bio === 'object' ? data.bio?.value : data.bio,
        imageUrl: photoId ? `https://covers.openlibrary.org/a/id/${photoId}-L.jpg` : null,
        website: data.website || data.links?.[0]?.url,
        goodreadsId: data.remote_ids?.goodreads
      };
    } catch (error) {
      return null;
    }
  }

  formatBook(doc) {
    const isbns = doc.isbn || [];
    const isbn13 = isbns.find(i => i.length === 13);
    const isbn10 = isbns.find(i => i.length === 10);
    
    return {
      openLibraryId: doc.key,
      title: doc.title,
      author: doc.author_name?.[0] || null,
      authors: doc.author_name || [],
      authorKeys: doc.author_key || [],
      publishedDate: doc.first_publish_year?.toString(),
      isbn10: isbn10,
      isbn13: isbn13,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
      pageCount: doc.number_of_pages_median,
      publisher: doc.publisher?.[0],
      description: (Array.isArray(doc.first_sentence) ? doc.first_sentence.join(' ') : doc.first_sentence) || null
    };
  }

  formatBookDetails(data) {
    return {
      openLibraryId: data.key,
      title: data.title,
      subtitle: data.subtitle,
      description: data.description?.value || data.description,
      publishedDate: data.publish_date,
      publisher: data.publishers?.[0],
      pageCount: data.number_of_pages,
      coverUrl: data.covers?.[0] ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg` : null
    };
  }

  formatWork(work) {
    return {
      openLibraryId: work.key,
      title: work.title,
      firstPublishYear: work.first_publish_year
    };
  }
}

module.exports = new OpenLibraryService();
