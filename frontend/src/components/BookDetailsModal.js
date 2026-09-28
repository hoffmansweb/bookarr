import React, { useState, useEffect } from 'react';
import './BookDetailsModal.css';
import Reader from './Reader';
import { bookAPI } from '../services/api';
import { parseBookSeries } from '../utils/bookSeries';
import { extractYear } from '../utils/dates';

const BookDetailsModal = ({ book, onClose, onStarredChange }) => {
  const [showReader, setShowReader] = useState(false);
  const [bookWithUserData, setBookWithUserData] = useState(book);

  useEffect(() => {
    // Shared API client: correct host (was hard-coded localhost) and errors throw
    // instead of an error payload replacing the book object passed to the Reader.
    const fetchBookWithUserData = async () => {
      try {
        const { data } = await bookAPI.getById(book.id);
        setBookWithUserData(data);
      } catch (err) {
        console.error('Failed to fetch book data:', err);
      }
    };
    fetchBookWithUserData();
  }, [book.id]);

  // Series line, e.g. "📚 Society of Villains · Book 1"; null when the book isn't in one
  const series = parseBookSeries(book);

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="book-details-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        
        <div className="book-details-header">
          {book.coverUrl && <img src={book.coverUrl} alt={book.title} />}
          <div>
            <h2>{book.title}</h2>
            {book.subtitle && <h3>{book.subtitle}</h3>}
            {book.author && <p className="author-name">{book.author.name}</p>}
          </div>
        </div>

        <div className="book-details-body">
          {book.publishedDate && (
            <div className="detail-row">
              <strong>Published:</strong>
              <span>{extractYear(book.publishedDate) || book.publishedDate || 'Unknown'}</span>
            </div>
          )}

          {series && (
            <div className="detail-row">
              <strong>Series:</strong>
              <span
                className="detail-series"
                title={series.position ? `Book ${series.position} in the ${series.name} series` : `Part of the ${series.name} series`}
              >
                📚 {series.name}{series.position ? ` · Book ${series.position}` : ''}
              </span>
            </div>
          )}
          
          {book.publisher && (
            <div className="detail-row">
              <strong>Publisher:</strong>
              <span>{book.publisher}</span>
            </div>
          )}
          
          {book.pageCount && (
            <div className="detail-row">
              <strong>Pages:</strong>
              <span>{book.pageCount}</span>
            </div>
          )}
          
          {book.language && (
            <div className="detail-row">
              <strong>Language:</strong>
              <span>{book.language}</span>
            </div>
          )}
          
          {(book.isbn10 || book.isbn13) && (
            <div className="detail-row">
              <strong>ISBN:</strong>
              <span>{book.isbn13 || book.isbn10}</span>
            </div>
          )}
          
          {book.rating && (
            <div className="detail-row">
              <strong>Rating:</strong>
              <span>⭐ {Number(book.rating).toFixed(1)}{book.ratingsCount ? ` (${book.ratingsCount} ratings)` : ''}</span>
            </div>
          )}
          
          {book.genres && Array.isArray(book.genres) && book.genres.length > 0 && (
            <div className="detail-row">
              <strong>Genres:</strong>
              <span>{book.genres.join(', ')}</span>
            </div>
          )}
          
          {book.importedAt && (
            <div className="detail-row">
              <strong>Added:</strong>
              <span title={new Date(book.importedAt).toLocaleString()}>
                {new Date(book.importedAt).toLocaleDateString()}
              </span>
            </div>
          )}

          {book.description && (
            <div className="description">
              <strong>Description:</strong>
              <p>{book.description}</p>
            </div>
          )}
        </div>
        
        <div className="book-details-actions">
          {book.status === 'available' && book.filePath && (
            <button onClick={() => setShowReader(true)} className="read-btn">
              {book.bookType === 'audiobook' ? '▶️ Play' : '📖 Read'}
            </button>
          )}
        </div>
      </div>
    </div>
    
    {showReader && (
      <Reader
        book={bookWithUserData}
        onClose={() => setShowReader(false)}
        onStarredChange={onStarredChange}
      />
    )}
    </>
  );
};

export default BookDetailsModal;
