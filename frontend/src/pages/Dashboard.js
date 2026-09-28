import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { bookAPI, statsAPI, calendarAPI, authorAPI } from '../services/api';
import BookCard from '../components/BookCard';
import BookModal from '../components/BookModal';
import AuthorModal from '../components/AuthorModal';
import { useSocket } from '../context/SocketContext';
import './Dashboard.css';

const ARRIVALS_LIMIT = 12;
const ARRIVAL_WINDOW_DAYS = 60;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_DAYS = 90;
const UPCOMING_LIMIT = 8;

const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// "28 Sep" (or "28 Sep 2027" when the year differs from this one)
const releaseDay = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('default', opts);
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [starredBooks, setStarredBooks] = useState([]);
  const [continueReading, setContinueReading] = useState([]);
  const [continueListening, setContinueListening] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const socket = useSocket();

  const handleAuthorClick = async (author) => {
    if (author?.id) {
      try {
        const { data } = await authorAPI.getAll({ search: author.name });
        const matched = data.find((a) => a.id === author.id);
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
      const today = toDateKey(new Date());
      const horizon = toDateKey(new Date(Date.now() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const [starredRes, readingRes, listeningRes, arrivalsRes, statsRes, upcomingRes] = await Promise.all([
        bookAPI.getStarred(),
        bookAPI.getContinueReading(),
        bookAPI.getContinueListening(),
        bookAPI.getRecentArrivals({ limit: ARRIVALS_LIMIT, days: ARRIVAL_WINDOW_DAYS }).catch(() => ({ data: [] })),
        statsAPI.get().catch(() => ({ data: null })),
        calendarAPI.getEvents({ start: today, end: horizon }).catch(() => ({ data: [] }))
      ]);

      setStarredBooks(starredRes.data);
      setContinueReading(readingRes.data);
      setContinueListening(listeningRes.data);
      setNewArrivals(arrivalsRes.data);
      setStats(statsRes.data);

      const releases = (upcomingRes.data || [])
        .filter((e) => e.date && e.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, UPCOMING_LIMIT);
      setUpcoming(releases);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!socket) return;
    const onBookUpdated = (payload) => {
      if (payload?.status === 'available') loadDashboard();
    };
    socket.on('book:updated', onBookUpdated);
    return () => socket.off('book:updated', onBookUpdated);
  }, [socket, loadDashboard]);

  if (loading) return <div className="loading">Loading...</div>;

  const statCards = stats
    ? [
        { label: 'Books', value: stats.catalogueBooks ?? 0 },
        { label: 'In library', value: stats.availableBooks ?? 0 },
        { label: 'Ebooks', value: stats.ebooks ?? 0 },
        { label: 'Audiobooks', value: stats.audiobooks ?? 0 },
        { label: 'Pages read', value: (stats.totalPages ?? 0).toLocaleString() },
        { label: 'Hours listened', value: (stats.totalAudioHours ?? 0).toLocaleString() }
      ]
    : [];

  const hasAny = continueReading.length || continueListening.length || newArrivals.length || starredBooks.length || upcoming.length;

  return (
    <div className="dashboard">
      <h1>Home</h1>

      {stats && (
        <section className="stats-section">
          <div className="stats-grid">
            {statCards.map((card) => (
              <div key={card.label} className="stat-card">
                <span className="stat-value">{card.value}</span>
                <span className="stat-label">{card.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {continueReading.length > 0 && (
        <section>
          <h2>Continue Reading</h2>
          <div className="books-grid">
            {continueReading.map((book) => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {continueListening.length > 0 && (
        <section>
          <h2>Continue Listening</h2>
          <div className="books-grid">
            {continueListening.map((book) => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {newArrivals.length > 0 && (
        <section>
          <div className="section-header">
            <h2>New Arrivals</h2>
            <Link className="section-link" to="/books">See all →</Link>
          </div>
          <div className="books-grid">
            {newArrivals.map((book) => (
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

      {upcoming.length > 0 && (
        <section>
          <div className="section-header">
            <h2>Upcoming Releases</h2>
          </div>
          <div className="releases-list">
            {upcoming.map((event) => (
              <div key={event.id} className="release-item">
                {event.coverUrl
                  ? <img src={event.coverUrl} alt="" className="release-cover" />
                  : <div className="release-cover-placeholder">📚</div>}
                <div className="release-info">
                  <strong className="release-title">{event.title}</strong>
                  <span className="release-meta">{event.author}</span>
                </div>
                <span className="release-date">{releaseDay(event.date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {starredBooks.length > 0 && (
        <section>
          <h2>Starred Books</h2>
          <div className="books-grid">
            {starredBooks.map((book) => (
              <BookCard key={book.id} book={book} onUpdate={loadDashboard} onClick={setSelectedBook} onAuthorClick={handleAuthorClick} />
            ))}
          </div>
        </section>
      )}

      {!hasAny && (
        <div className="empty-state">
          <p>No books to display. Star some books or start reading to see them here!</p>
        </div>
      )}

      {selectedBook && (
        <BookModal book={selectedBook} onClose={() => setSelectedBook(null)} onUpdate={loadDashboard} />
      )}
      {selectedAuthor && (
        <AuthorModal author={selectedAuthor} onClose={() => setSelectedAuthor(null)} onUpdate={loadDashboard} />
      )}
    </div>
  );
};

export default Dashboard;
