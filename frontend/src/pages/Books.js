import React, { useState, useEffect } from 'react';
import { bookAPI, bulkAPI } from '../services/api';
import { toast } from 'react-toastify';
import BookCard from '../components/BookCard';
import BookModal from '../components/BookModal';
import AuthorModal from '../components/AuthorModal';
import { authorAPI } from '../services/api';
import SearchBar from '../components/SearchBar';
import BookSearchModal from '../components/BookSearchModal';
import './Books.css';

const Books = () => {
  const [books, setBooks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [selectedBooks, setSelectedBooks] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, mediaFilter, searchQuery]);

  const handleAuthorClick = async (author) => {
    if (author?.id) {
      try {
        const { data } = await authorAPI.getAll({ search: author.name });
        const matched = data.find(a => a.id === author.id);
        if (matched) setSelectedAuthor(matched);
      } catch (err) { console.error(err); }
    } else if (typeof author === 'string' || author?.name) {
      try {
        const { data } = await authorAPI.getAll({ search: typeof author === 'string' ? author : author.name });
        if (data && data[0]) setSelectedAuthor(data[0]);
      } catch (err) { console.error(err); }
    }
  };

  const loadBooks = async () => {
    try {
      const params = {};
      if (filter !== 'all') params.status = filter;
      if (mediaFilter !== 'all') params.mediaType = mediaFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const { data } = await bookAPI.getAll(params);
      setBooks(data.sort((a, b) => a.title.localeCompare(b.title)));
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter the local catalogue (not the online aggregator): searching on the Books
  // page finds only books already in the app. Online lookup is per-book (BookModal).
  const handleSearch = (query) => {
    setSearchQuery(query || '');
  };

  const toggleBookSelection = (bookId) => {
    setSelectedBooks(prev => 
      prev.includes(bookId) 
        ? prev.filter(id => id !== bookId)
        : [...prev, bookId]
    );
  };

  const handleBulkUpdate = async (status) => {
    if (selectedBooks.length === 0) return;
    try {
      await bulkAPI.updateBooks(selectedBooks, status);
      toast.success(`${selectedBooks.length} books updated`);
      setSelectedBooks([]);
      setBulkMode(false);
      loadBooks();
    } catch (error) {
      toast.error('Bulk update failed');
    }
  };

  return (
    <div className="books-page">
      <div className="page-header">
        <h1>Books</h1>
        <div className="header-actions">
          <SearchBar onSearch={handleSearch} placeholder="Search books..." />
          <button onClick={() => setShowAddModal(true)}>+ Add Book</button>
          <button onClick={() => setBulkMode(!bulkMode)}>
            {bulkMode ? 'Cancel' : 'Bulk Edit'}
          </button>
        </div>
      </div>

      {bulkMode && selectedBooks.length > 0 && (
        <div className="bulk-actions">
          <span>{selectedBooks.length} selected</span>
          <select onChange={(e) => e.target.value && handleBulkUpdate(e.target.value)} defaultValue="">
            <option value="">Change status to...</option>
            <option value="wanted">Wanted</option>
            <option value="downloading">Downloading</option>
            <option value="available">Available</option>
            <option value="reading">Reading</option>
            <option value="completed">Completed</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
      )}

      <div className="filters">
        <div className="media-filters">
          <button className={mediaFilter === 'all' ? 'active' : ''} onClick={() => setMediaFilter('all')}>All</button>
          <button className={mediaFilter === 'ebook' ? 'active' : ''} onClick={() => setMediaFilter('ebook')}>📖 Ebooks</button>
          <button className={mediaFilter === 'audiobook' ? 'active' : ''} onClick={() => setMediaFilter('audiobook')}>🎧 Audiobooks</button>
        </div>
        <div className="status-filters">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'wanted' ? 'active' : ''} onClick={() => setFilter('wanted')}>Wanted</button>
          <button className={filter === 'downloading' ? 'active' : ''} onClick={() => setFilter('downloading')}>Downloading</button>
          <button className={filter === 'available' ? 'active' : ''} onClick={() => setFilter('available')}>Available</button>
          <button className={filter === 'reading' ? 'active' : ''} onClick={() => setFilter('reading')}>Reading</button>
          <button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>Completed</button>
        </div>
      </div>

      {searchQuery.trim() && !loading && books.length > 0 && (
        <p className="search-summary" role="status">
          {`${books.length} ${books.length === 1 ? 'book' : 'books'} matching "${searchQuery}"`}
        </p>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="books-grid">
          {books.map(book => (
            <div key={book.id} className="book-wrapper">
              {bulkMode && (
                <input 
                  type="checkbox" 
                  className="book-checkbox"
                  checked={selectedBooks.includes(book.id)}
                  onChange={() => toggleBookSelection(book.id)}
                />
              )}
              <BookCard 
                book={book} 
                onUpdate={loadBooks} 
                onClick={bulkMode ? null : setSelectedBook} onAuthorClick={handleAuthorClick}
              />
            </div>
          ))}
          {books.length === 0 && <p>No books found</p>}
        </div>
      )}

      {selectedBook && (
        <BookModal
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onUpdate={loadBooks}
        />
      )}
      {selectedAuthor && (
        <AuthorModal
          author={selectedAuthor}
          onClose={() => setSelectedAuthor(null)}
          onUpdate={loadBooks}
        />
      )}
      {showAddModal && (
        <BookSearchModal
          onClose={() => setShowAddModal(false)}
          onAdded={loadBooks}
        />
      )}
    </div>
  );
};

export default Books;
