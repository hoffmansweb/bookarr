import React, { useState } from 'react';
import { bookAPI } from '../services/api';
import { toast } from 'react-toastify';
import './BookSearchModal.css';

// Search results come from the online aggregator (Google Books, Open Library,
// Goodreads, Amazon, ...) and are not yet in the catalogue, so "Add" uses the
// one-click grab endpoint (add + start acquiring) and "Add Series" grabs the lot.
const BookSearchModal = ({ onClose, onAdded }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  // key -> 'book' | 'series' while a request is in flight
  const [busy, setBusy] = useState({});
  // key -> 'book' | 'series' once added, so the button can turn into a checkmark
  const [done, setDone] = useState({});

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    setDone({});
    try {
      const { data } = await bookAPI.search(q);
      setResults(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error('Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const keyOf = (book, i) => `${book.source || 'src'}-${book.goodreadsId || book.googleBooksId || book.amazonAsin || ''}-${i}`;

  const handleAddBook = async (book, i) => {
    const key = keyOf(book, i);
    setBusy((p) => ({ ...p, [key]: 'book' }));
    try {
      await bookAPI.grab(book);
      toast.success(`Added "${book.title}"`);
      setDone((p) => ({ ...p, [key]: 'book' }));
      onAdded?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add book');
    } finally {
      setBusy((p) => { const n = { ...p }; delete n[key]; return n; });
    }
  };

  const handleAddSeries = async (book, i) => {
    const key = keyOf(book, i);
    setBusy((p) => ({ ...p, [key]: 'series' }));
    try {
      const { data } = await bookAPI.addSeries(book.series, book.author);
      toast.success(`Added ${data.added} book${data.added === 1 ? '' : 's'} from "${book.series}"`);
      setDone((p) => ({ ...p, [key]: 'series' }));
      onAdded?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add series');
    } finally {
      setBusy((p) => { const n = { ...p }; delete n[key]; return n; });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content book-search-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          <h2>Add Book</h2>
          <p className="search-query">Search the web and add a book or a whole series.</p>
        </div>

        <form className="book-search-form" onSubmit={handleSearch}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a book or series..."
            autoFocus
          />
          <button type="submit" disabled={searching || !query.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="book-search-body">
          {searching && (
            <div className="loading-inline">Searching Google Books, Open Library, Goodreads, Amazon…</div>
          )}

          {!searching && searched && results.length === 0 && (
            <p className="no-results">No results found</p>
          )}

          {!searching && results.length > 0 && (
            <div className="results-list">
              {results.map((book, i) => {
                const key = keyOf(book, i);
                const isBusy = busy[key];
                const isDone = done[key];
                return (
                  <div key={key} className="result-item">
                    <div className="result-info">
                      <div className="result-title-row">
                        {book.coverUrl && <img src={book.coverUrl} alt="" className="result-cover" />}
                        <strong>{book.title}</strong>
                      </div>
                      <div className="result-meta">
                        {book.source && <span className="indexer">{book.source}</span>}
                        {book.author && <span>{book.author}</span>}
                        {book.publishedDate && <span>{String(book.publishedDate).slice(0, 4)}</span>}
                        {book.series && (
                          <span className="type-badge" title={book.series}>
                            Series: {book.series}{book.seriesPosition ? ` #${book.seriesPosition}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="result-actions">
                      {book.series && (
                        <button
                          className="series-btn"
                          onClick={() => handleAddSeries(book, i)}
                          disabled={!!isBusy || isDone === 'series'}
                        >
                          {isBusy === 'series' ? 'Adding…' : isDone === 'series' ? '✓ Series added' : 'Add Series'}
                        </button>
                      )}
                      <button
                        className="add-btn"
                        onClick={() => handleAddBook(book, i)}
                        disabled={!!isBusy || isDone === 'book'}
                      >
                        {isBusy === 'book' ? 'Adding…' : isDone === 'book' ? '✓ Added' : 'Add'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookSearchModal;
