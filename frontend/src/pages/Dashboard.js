import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { bookAPI } from '../services/api';
import BookCard from '../components/BookCard';
import BookModal from '../components/BookModal';
import AuthorModal from '../components/AuthorModal';
import { authorAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import './Dashboard.css';

// "New Arrivals" shows the books whose files landed most recently
const ARRIVALS_LIMIT = 12;
const ARRIVAL_WINDOW_DAYS = 60;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

// "just now" / "3 hours ago" / "yesterday" / "2 weeks ago" for the arrival row
const timeAgo = (date) => {
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? 'last week' : `${weeks} weeks ago`;

  return new Date(then).toLocaleDateString();
};

const isFresh = (date) => Date.now() - new Date(date).getTime() < FRESH_MS;

const Dashboard = () => {
  const [starredBooks, setStarredBooks] = useState([]);
  const [continueReading, setContinueReading] = useState([]);
  const [continueListening, setContinueListening] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const socket = useSocket();

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

  const loadDashboard = useCallback(async () => {
    try {
      const [starredRes, readingRes, listeningRes, arrivalsRes] = await Promise.all([
        bookAPI.getStarred(),
        bookAPI.getContinueReading(),
        bookAPI.getContinueListening(),
        // The arrival row is the newest endpoint; if it is unavailable (older backend that has
        // not run the importedAt migration yet) the rest of the dashboard must still render.
        bookAPI.getRecentArrivals({ limit: ARRIVALS_LIMIT, days: ARRIVAL_WINDOW_DAYS })
          .catch(() => ({ data: [] }))
      ]);

      setStarredBooks(starredRes.data);
      setContinueReading(readingRes.data);
      setContinueListening(listeningRes.data);
      setNewArrivals(arrivalsRes.data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // An import finishing on the server makes a book available (see the emit in downloadCheck and
  // the pipelines): refresh the row instead of waiting for a manual reload.
  useEffect(() => {
    if (!socket) return;
    const onBookUpdated = (payload) => {
      if (payload?.status === 'available') loadDashboard();
    };
    socket.on('book:updated', onBookUpdated);
    return () => socket.off('book:updated', onBookUpdated);
  }, [socket, loadDashboard]);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      {newArrivals.length > 0 && (
        <section>
          <div className="section-header">
            <h2>New Arrivals</h2>
            <Link className="section-link" to="/books">See all →</Link>
          </div>
          <div className="books-grid">
            {newArrivals.map(book => (
              <div className="arrival-item" key={book.id}>
                <BookCard book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
                {book.importedAt && (
                  <p className={`arrival-age${isFresh(book.importedAt) ? ' fresh' : ''}`}>
                    Added {timeAgo(book.importedAt)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {continueReading.length > 0 && (
        <section>
          <h2>Continue Reading</h2>
          <div className="books-grid">
            {continueReading.map(book => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {continueListening.length > 0 && (
        <section>
          <h2>Continue Listening</h2>
          <div className="books-grid">
            {continueListening.map(book => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {starredBooks.length > 0 && (
        <section>
          <h2>Starred Books</h2>
          <div className="books-grid">
            {starredBooks.map(book => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {starredBooks.length === 0 && continueReading.length === 0 && continueListening.length === 0 && newArrivals.length === 0 && (
        <div className="empty-state">
          <p>No books to display. Star some books or start reading to see them here!</p>
        </div>
      )}
      {selectedBook && (
        <BookModal 
          book={selectedBook} 
          onClose={() => setSelectedBook(null)} 
          onUpdate={loadDashboard} 
        />
      )}
      {selectedAuthor && (
        <AuthorModal
          author={selectedAuthor}
          onClose={() => setSelectedAuthor(null)}
          onUpdate={loadDashboard}
        />
      )}
    </div>
  );
};

export default Dashboard;
