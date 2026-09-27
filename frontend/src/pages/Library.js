import React, { useState, useEffect } from 'react';
import { bookAPI } from '../services/api';
import BookCard from '../components/BookCard';
import './Library.css';

const Library = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const { data } = await bookAPI.getLibrary();
      setBooks(data);
    } catch (error) {
      console.error('Failed to load library:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredBooks = books.filter(book => {
    if (filter === 'all') return true;
    return book.bookType === filter;
  });

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="library-page">
      <h1>My Library</h1>
      <div className="filter-buttons">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'ebook' ? 'active' : ''} onClick={() => setFilter('ebook')}>eBooks</button>
        <button className={filter === 'audiobook' ? 'active' : ''} onClick={() => setFilter('audiobook')}>Audiobooks</button>
        <button className={filter === 'physical' ? 'active' : ''} onClick={() => setFilter('physical')}>Physical</button>
      </div>
      <div className="books-grid">
        {filteredBooks.map(book => (
          <BookCard key={book.id} book={book} onUpdate={loadLibrary} />
        ))}
        {filteredBooks.length === 0 && <p>No books found</p>}
      </div>
    </div>
  );
};

export default Library;
