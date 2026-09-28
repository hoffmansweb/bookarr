import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bookAPI, bulkAPI, authorAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import BookCard from '../components/BookCard';
import BookModal from '../components/BookModal';
import AuthorModal from '../components/AuthorModal';
import SearchBar from '../components/SearchBar';
import BookSearchModal from '../components/BookSearchModal';
import DuplicatesModal from '../components/DuplicatesModal';
import './Books.css';

const Books = () => {
  const { user } = useAuth();
  const [books, setBooks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('title');
  const [view, setView] = useState('grid');
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [selectedBooks, setSelectedBooks] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link from the global search (Cmd+K): open one book, then clear the param so a refresh
  // does not reopen it.
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId) return;
    bookAPI.getById(openId)
      .then(({ data }) => setSelectedBook(data))
      .catch(() => {});
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, mediaFilter, searchQuery]);

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

  const loadBooks = async () => {
    try {
      const params = {};
      if (filter !== 'all') params.status = filter;
      if (mediaFilter !== 'all') params.mediaType = mediaFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const { data } = await bookAPI.getAll(params);
      setBooks(data);
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter the local catalogue (not the online aggregator): searching on the Library
  // page finds only books already in the app. Online lookup is per-book (BookModal).
  const handleSearch = (query) => {
    setSearchQuery(query || '');
  };

  const sortedBooks = useMemo(() => {
    const arr = [...books];
    switch (sortBy) {
      case 'author':
        arr.sort((a, b) => (a.author?.name || '').localeCompare(b.author?.name || ''));
        break;
      case 'recent':
        arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        break;
      case 'year':
        arr.sort((a, b) => (a.publishedDate || '').localeCompare(b.publishedDate || ''));
        break;
      case 'title':
      default:
        arr.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return arr;
  }, [books, sortBy]);

  const seriesGroups = useMemo(() => {
    if (!groupBySeries) return null;
    const map = new Map();
    const ungrouped = [];
    for (const book of sortedBooks) {
      const series = (book.series || '').trim();
      if (series) {
        if (!map.has(series)) map.set(series, []);
        map.get(series).push(book);
      } else {
        ungrouped.push(book);
      }
    }
    const series = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, list]) => ({
        name,
        books: list.sort(
          (a, b) => (Number(a.seriesPosition) || 0) - (Number(b.seriesPosition) || 0) || a.title.localeCompare(b.title)
        )
      }));
    return { series, ungrouped };
  }, [sortedBooks, groupBySeries]);

  const toggleBookSelection = (bookId) => {
    setSelectedBooks((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
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

  const renderCard = (book) => (
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
        onClick={bulkMode ? null : setSelectedBook}
        onAuthorClick={handleAuthorClick}
      />
    </div>
  );

  const renderRow = (book) => (
    <div
      key={book.id}
      className={`book-list-row${bulkMode ? ' bulk' : ''}`}
      onClick={bulkMode ? undefined : () => setSelectedBook(book)}
    >
      {bulkMode && (
        <input
          type="checkbox"
          className="list-checkbox"
          checked={selectedBooks.includes(book.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleBookSelection(book.id)}
        />
      )}
      {book.coverUrl
        ? <img src={book.coverUrl} alt="" className="list-cover" />
        : <div className="list-cover list-cover-fallback">{book.mediaType === 'audiobook' ? '🎧' : '📖'}</div>}
      <div className="list-main">
        <strong className="list-title">{book.title}</strong>
        <span className="list-author">{book.author?.name || book.author || ''}</span>
      </div>
      {book.series && (
        <span className="list-series">{book.series}{book.seriesNumber ? ` #${book.seriesNumber}` : ''}</span>
      )}
      {book.status && <span className={`list-status status-${book.status}`}>{book.status}</span>}
      {book.publishedDate && <span className="list-year">{String(book.publishedDate).slice(0, 4)}</span>}
    </div>
  );

  const renderGroup = (title, list) => (
    <div className="series-group" key={title}>
      <h2 className="series-group-title">{title}</h2>
      {view === 'grid'
        ? <div className="books-grid">{list.map(renderCard)}</div>
        : <div className="book-list">{list.map(renderRow)}</div>}
    </div>
  );

  const flatBooks = view === 'grid'
    ? <div className="books-grid">{sortedBooks.map(renderCard)}</div>
    : <div className="book-list">{sortedBooks.map(renderRow)}</div>;

  return (
    <div className="books-page">
      <div className="page-header">
        <h1>Library</h1>
        <div className="header-actions">
          <SearchBar onSearch={handleSearch} placeholder="Search library..." />
          {user?.role === 'admin' && (
            <>
              <button onClick={() => setShowAddModal(true)}>+ Add Book</button>
              <button onClick={() => setShowDuplicates(true)}>Duplicates</button>
              <button onClick={() => setBulkMode(!bulkMode)}>
                {bulkMode ? 'Cancel' : 'Bulk Edit'}
              </button>
            </>
          )}
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

      <div className="view-toolbar">
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="title">Sort: Title</option>
          <option value="author">Sort: Author</option>
          <option value="recent">Sort: Recently added</option>
          <option value="year">Sort: Year</option>
        </select>
        <button className={groupBySeries ? 'active' : ''} onClick={() => setGroupBySeries((v) => !v)}>
          Group by series
        </button>
        <div className="view-toggle" role="group" aria-label="View">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Grid</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {searchQuery.trim() && !loading && sortedBooks.length > 0 && (
        <p className="search-summary" role="status">
          {`${sortedBooks.length} ${sortedBooks.length === 1 ? 'book' : 'books'} matching "${searchQuery}"`}
        </p>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : groupBySeries && seriesGroups ? (
        <div className="grouped-library">
          {seriesGroups.series.map((g) => renderGroup(g.name, g.books))}
          {seriesGroups.ungrouped.length > 0 && renderGroup('Other books', seriesGroups.ungrouped)}
          {seriesGroups.series.length === 0 && seriesGroups.ungrouped.length === 0 && <p>No books found</p>}
        </div>
      ) : (
        <div className="flat-library">
          {flatBooks}
          {sortedBooks.length === 0 && <p>No books found</p>}
        </div>
      )}

      {selectedBook && (
        <BookModal book={selectedBook} onClose={() => setSelectedBook(null)} onUpdate={loadBooks} />
      )}
      {selectedAuthor && (
        <AuthorModal author={selectedAuthor} onClose={() => setSelectedAuthor(null)} onUpdate={loadBooks} />
      )}
      {showAddModal && (
        <BookSearchModal onClose={() => setShowAddModal(false)} onAdded={loadBooks} />
      )}
      {showDuplicates && (
        <DuplicatesModal onClose={() => setShowDuplicates(false)} onChanged={loadBooks} />
      )}

      {user?.role === 'admin' && (
        <button className="fab" onClick={() => setShowAddModal(true)} title="Add book" aria-label="Add book">＋</button>
      )}
    </div>
  );
};

export default Books;
