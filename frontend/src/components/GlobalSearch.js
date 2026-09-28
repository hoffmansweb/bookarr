import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { bookAPI, authorAPI } from '../services/api';
import './GlobalSearch.css';

// Command palette (Cmd+K / Ctrl+K): searches the local catalogue across books and authors and
// jumps to the result. Books deep-link back to the Library via ?open=<id>; authors go to /authors.
const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState([]);
  const [authors, setAuthors] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setBooks([]);
    setAuthors([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setBooks([]);
      setAuthors([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const [b, a] = await Promise.all([
          bookAPI.getAll({ search: q }),
          authorAPI.getAll({ search: q })
        ]);
        setBooks((b.data || []).slice(0, 6));
        setAuthors((a.data || []).slice(0, 6));
      } catch (err) {
        console.error('Global search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  const goBook = (id) => {
    setOpen(false);
    navigate(`/books?open=${id}`);
  };
  const goAuthors = () => {
    setOpen(false);
    navigate('/authors');
  };

  const noResults = !searching && query.trim() && books.length === 0 && authors.length === 0;

  return (
    <div className="modal-overlay global-search-overlay" onClick={() => setOpen(false)}>
      <div className="modal-content global-search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="global-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search books and authors…"
        />
        <div className="global-search-results">
          {searching && <p className="gs-hint">Searching…</p>}
          {noResults && <p className="gs-hint">No results</p>}

          {!searching && books.length > 0 && (
            <>
              <p className="gs-section">Books</p>
              {books.map((b) => (
                <button key={b.id} className="gs-result" onClick={() => goBook(b.id)}>
                  <span className="gs-emoji">📖</span>
                  <span className="gs-title">{b.title}</span>
                  <span className="gs-sub">{b.author?.name || ''}</span>
                </button>
              ))}
            </>
          )}

          {!searching && authors.length > 0 && (
            <>
              <p className="gs-section">Authors</p>
              {authors.map((a) => (
                <button key={a.id} className="gs-result" onClick={goAuthors}>
                  <span className="gs-emoji">✍️</span>
                  <span className="gs-title">{a.name}</span>
                  <span className="gs-sub">{a.books?.length ? `${a.books.length} books` : ''}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
