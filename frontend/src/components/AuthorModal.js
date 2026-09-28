import React, { useState, useEffect } from 'react';
import AuthorAvatar from './AuthorAvatar';
import { authorAPI, nzbAPI, bookAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { toast } from 'react-toastify';
import SearchResultsModal from './SearchResultsModal';
import BookDetailsModal from './BookDetailsModal';
import Reader from './Reader';
import PdfReader from './PdfReader';
import { parseBookSeries } from '../utils/bookSeries';
import { extractYear } from '../utils/dates';
import './AuthorModal.css';

// Formats searched by "Search all wanted" come from Settings → General ("When I click Get, look for")
const formatNames = (formats) => (formats || []).map(f => (f === 'audiobook' ? '🎧 audiobook' : '📖 ebook')).join(' + ');
const formatSuffix = (formats) => ((formats || []).length > 1 ? ` (${formatNames(formats)})` : '');

const AuthorModal = ({ author, onClose, onUpdate }) => {
  const [searchingBook, setSearchingBook] = useState(null);
  const [searchType, setSearchType] = useState(null); // 'auto' or 'manual'
  // book.id -> 'auto' | 'search' while that book's search is in flight. Mirrors
  // BookCard's downloadingType pattern so only the clicked button shows "Searching...".
  const [searchingBooks, setSearchingBooks] = useState(new Map());
  const [hasClients, setHasClients] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [detailsBook, setDetailsBook] = useState(null);
  const [readerBook, setReaderBook] = useState(null);
  const [pdfBook, setPdfBook] = useState(null);
  const [localAuthor, setLocalAuthor] = useState(author);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [starredBooks, setStarredBooks] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [wantedSearch, setWantedSearch] = useState(null); // { total, done, queued, current } while running
  const socket = useSocket();

  // Live progress for "Search all wanted"
  useEffect(() => {
    if (!socket) return undefined;
    const onProgress = (p) => {
      if (p.authorId !== author.id) return;
      if (p.finished) {
        setWantedSearch(null);
        toast.success(`Searched ${p.total} wanted ${p.total === 1 ? 'entry' : 'entries'}${formatSuffix(p.formats)}: ${p.queued} found and queued${p.total - p.queued ? `, ${p.total - p.queued} not found yet (auto-search will keep trying)` : ''}`);
        refreshAuthorData();
        onUpdate();
      } else {
        setWantedSearch(p);
      }
    };
    socket.on('author:search', onProgress);
    return () => socket.off('author:search', onProgress);
  }, [socket, author.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchWanted = async () => {
    try {
      const { data } = await authorAPI.searchWanted(author.id);
      if (!data.total) {
        toast.info(data.message || 'No wanted books for this author');
        return;
      }
      setWantedSearch({ total: data.total, done: 0, queued: 0, formats: data.formats });
      toast.info(`Searching ${data.total} wanted ${data.total === 1 ? 'entry' : 'entries'}${formatSuffix(data.formats)} using your download priority…`);
    } catch (error) {
      if (error.response?.status === 409) {
        setWantedSearch(error.response.data.progress);
        toast.info('Already searching this author');
      } else {
        toast.error(error.response?.data?.error || 'Failed to start search');
      }
    }
  };

  useEffect(() => {
    setHasClients(true);
    loadStarredBooks();
    const interval = setInterval(refreshAuthorData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStarredBooks = async () => {
    try {
      const { data } = await bookAPI.getStarred();
      const starred = {};
      data.forEach(book => {
        starred[book.id] = true;
      });
      setStarredBooks(starred);
    } catch (error) {
      console.error('Failed to load starred books');
    }
  };

  useEffect(() => {
    const downloadingBooks = localAuthor.books?.filter(b => b.status === 'downloading') || [];
    if (downloadingBooks.length === 0) return;

    const fetchProgress = async () => {
      const progress = {};
      for (const book of downloadingBooks) {
        try {
          const { data } = await bookAPI.getProgress(book.id);
          progress[book.id] = data;
        } catch (error) {
          progress[book.id] = { percentage: 0, status: 'unknown' };
        }
      }
      setDownloadProgress(progress);
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 3000);
    return () => clearInterval(interval);
  }, [localAuthor.books]);

  const refreshAuthorData = async () => {
    try {
      const { data } = await authorAPI.getById(author.id);
      setLocalAuthor(data);
    } catch (error) {
      console.error('Failed to refresh author data');
    }
  };

  const handleAutoSearch = async (book) => {
    setSearchingBooks(prev => new Map(prev).set(book.id, 'auto'));
    try {
      const { data } = await nzbAPI.search(book.title, author.name);
      const results = data?.results || [];
      
      if (results.length === 0) {
        toast.info('No results found');
      } else {
        // The backend already sorts by your source priority (Settings → Download priority);
        // take the best clear match, ebook first, then audiobook (e.g. YouTube)
        const matches = results.filter(r => r.matched !== false);
        const best = matches.find(r => r.format !== 'audiobook') || matches[0];
        if (!best) {
          toast.info('No result clearly matches this book and author — use Search to pick one');
          return;
        }
        await nzbAPI.startDownload(best, book.id);
        await handleBookStatusChange(book.id, 'downloading');
        toast.success(`${best.type === 'youtube' ? 'YouTube download' : 'Download'} started: ${best.title}`);
      }
    } catch (error) {
      console.error('Auto-search error:', error);
      toast.error(error.response?.data?.error || 'Auto-search failed');
    } finally {
      setSearchingBooks(prev => {
        const next = new Map(prev);
        next.delete(book.id);
        return next;
      });
    }
  };

  const handleSearchBook = async (book) => {
    setSearchingBooks(prev => new Map(prev).set(book.id, 'search'));
    try {
      const { data } = await nzbAPI.search(book.title, author.name);
      if (!data?.results?.length) {
        toast.info('No results found');
      } else {
        setSearchResults(data.results);
        setSelectedBook(book);
      }
    } catch (error) {
      toast.error('Search failed');
    } finally {
      setSearchingBooks(prev => {
        const next = new Map(prev);
        next.delete(book.id);
        return next;
      });
    }
  };

  const handleCloseSearchResults = () => {
    setSearchResults(null);
    setSelectedBook(null);
  };
  const handleDelete = async () => {
    if (!window.confirm(`Delete ${author.name}? This will also delete all their books.`)) {
      return;
    }
    
    try {
      await authorAPI.delete(author.id);
      toast.success('Author deleted');
      onUpdate();
      onClose();
    } catch (error) {
      toast.error('Failed to delete author');
    }
  };

  const handleMonitor = async () => {
    try {
      // Use local state: the `author` prop is the snapshot from when the modal
      // opened, so toggling twice called monitor() again instead of unmonitor().
      if (localAuthor.monitored) {
        await authorAPI.unmonitor(author.id);
        toast.success('Author unmonitored');
      } else {
        await authorAPI.monitor(author.id);
        toast.success('Author monitored');
      }
      setLocalAuthor(prev => ({ ...prev, monitored: !prev.monitored }));
      onUpdate();
    } catch (error) {
      toast.error('Failed to update monitoring');
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await authorAPI.refresh(author.id);
      toast.success('Author books refreshed');
      await refreshAuthorData();
      onUpdate();
    } catch (error) {
      toast.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleAllBooks = async (status) => {
    try {
      await authorAPI.toggleAllBooks(author.id, status);
      toast.success(`All books set to ${status}`);
      setLocalAuthor(prev => ({ ...prev, books: (prev.books || []).map(book => ({ ...book, status })) }));
      onUpdate();
    } catch (error) {
      toast.error('Failed to update books');
    }
  };

  const handleBookStatusChange = async (bookId, status) => {
    try {
      await bookAPI.update(bookId, { status });
      // Functional update: this is also called from async handlers holding a stale localAuthor
      setLocalAuthor(prev => ({
        ...prev,
        books: (prev.books || []).map(book => book.id === bookId ? { ...book, status } : book)
      }));
      onUpdate();
    } catch (error) {
      toast.error('Failed to update book');
    }
  };

  const handleToggleStar = async (bookId, e) => {
    e.stopPropagation();
    try {
      const res = await bookAPI.toggleStar(bookId);
      setStarredBooks(prev => ({ ...prev, [bookId]: res.data.starred }));
      toast.success(res.data.starred ? 'Starred' : 'Unstarred');
    } catch (error) {
      toast.error('Failed to toggle star');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content author-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        
        <div className="modal-header">
          <AuthorAvatar name={localAuthor.name} imageUrl={localAuthor.imageUrl} className="author-modal-avatar" />
          <div className="modal-header-content">
            <h2>{localAuthor.name}</h2>
            {localAuthor.bio && (
              <p className="bio">{localAuthor.bio}</p>
            )}
          </div>
        </div>

        <div className="modal-body">
          <div className="modal-stats">
            <div className="modal-stats-left">
              <div className="stat">
                <strong>{localAuthor.books?.length || 0}</strong>
                <span>Books</span>
              </div>
              <div className="stat">
                <strong>{localAuthor.books?.filter(b => b.status === 'wanted').length || 0}</strong>
                <span>Wanted</span>
              </div>
              <div className="stat">
                <strong>{localAuthor.books?.filter(b => b.status === 'ignored').length || 0}</strong>
                <span>Ignored</span>
              </div>
            </div>
            <div className="book-toggle-actions">
              <label>Set all:</label>
              <select onChange={(e) => { if(e.target.value) { handleToggleAllBooks(e.target.value); e.target.value = ''; } }} defaultValue="">
                <option value="">Select...</option>
                <option value="wanted">Wanted</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
          </div>

          {localAuthor.books && localAuthor.books.length > 0 && (
            <div className="books-list">
              <h3>Books</h3>
              {[...localAuthor.books]
                .sort((a, b) => new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0))
                .map(book => {
                  const series = parseBookSeries(book);
                  const searching = searchingBooks.get(book.id);
                  return (
                <div key={book.id} className="book-item">
                  <button 
                    className="book-star-btn"
                    onClick={(e) => handleToggleStar(book.id, e)}
                  >
                    {starredBooks[book.id] ? '⭐' : '☆'}
                  </button>
                  <select 
                    value={book.status} 
                    onChange={(e) => handleBookStatusChange(book.id, e.target.value)}
                    className={`book-status-select status-${book.status}`}
                  >
                    <option value="wanted">Wanted</option>
                    <option value="ignored">Ignored</option>
                    <option value="downloading">Downloading</option>
                    <option value="available">Available</option>
                    <option value="reading">Reading</option>
                    <option value="completed">Completed</option>
                  </select>
                  {book.coverUrl && <img src={book.coverUrl} alt={book.title} onClick={() => setDetailsBook(book)} style={{cursor: 'pointer'}} />}
                  <div className="book-item-center" onClick={() => setDetailsBook(book)} style={{cursor: 'pointer'}}>
                    <strong>{book.title}</strong>
                    <span>📅 {extractYear(book.publishedDate) || 'Unknown'}</span>
                    {series && (
                      <span
                        className="book-series"
                        title={series.position ? `Book ${series.position} in the ${series.name} series` : `Part of the ${series.name} series`}
                      >
                        📚 {series.name}{series.position ? ` · Book ${series.position}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="book-item-right">
                    {book.status === 'downloading' && downloadProgress[book.id] && (
                      <div className="download-progress">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${downloadProgress[book.id].percentage}%` }}></div>
                        </div>
                        <span className="progress-text">{downloadProgress[book.id].percentage}%</span>
                      </div>
                    )}
                    {book.status === 'available' && book.filePath && (
                      <button 
                        onClick={() => (book.bookType !== 'audiobook' && book.filePath.toLowerCase().endsWith('.pdf') ? setPdfBook(book) : setReaderBook(book))}
                        className="play-btn"
                      >
                        {book.bookType === 'audiobook' ? '▶️ Play' : '📖 Read'}
                      </button>
                    )}
                    {hasClients && (
                      <div className="book-actions">
                        <button 
                          onClick={() => handleAutoSearch(book)} 
                          disabled={!!searching}
                          className="auto-search-btn"
                        >
                          {searching === 'auto' ? (
                            <>
                              <span className="spinner"></span>
                              Searching...
                            </>
                          ) : 'Auto'}
                        </button>
                        <button 
                          onClick={() => handleSearchBook(book)} 
                          disabled={!!searching}
                          className="search-btn"
                        >
                          {searching === 'search' ? (
                            <>
                              <span className="spinner"></span>
                              Searching...
                            </>
                          ) : 'Search'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          {/* Always-visible footer: the book list below the header scrolls, this strip does not */}
          <div className="modal-actions-info">
            <span className="modal-actions-time">
              🕘 {localAuthor.lastChecked ? `Last checked: ${new Date(localAuthor.lastChecked).toLocaleString()}` : 'Not checked yet'}
            </span>
            {wantedSearch?.current && (
              <span className="modal-actions-progress" aria-live="polite">
                🔎 Searching {wantedSearch.done + 1}/{wantedSearch.total}{formatSuffix(wantedSearch.formats)}: <strong>{wantedSearch.current}</strong>
              </span>
            )}
          </div>

          <div className="modal-actions-buttons">
            {(() => {
              const wantedCount = localAuthor.books?.filter(b => b.status === 'wanted').length || 0;
              return (
                <button
                  onClick={handleSearchWanted}
                  disabled={!!wantedSearch || wantedCount === 0}
                  className="search-wanted-btn"
                  aria-live="polite"
                  title={wantedCount === 0 ? 'No wanted books' : 'Search every wanted book in the formats you chose in Settings ("When I click Get, look for"), using your download source priority'}
                >
                  {wantedSearch ? (
                    <>
                      <span className="spinner"></span>
                      {` ${wantedSearch.done}/${wantedSearch.total} searched · ${wantedSearch.queued} queued`}
                    </>
                  ) : `🔎 Search all wanted (${wantedCount})`}
                </button>
              );
            })()}
            <button onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? (
                <>
                  <span className="spin-icon">🔄</span> Refreshing...
                </>
              ) : (
                '🔄 Refresh'
              )}
            </button>
            <button onClick={handleMonitor} className={localAuthor.monitored ? 'monitored' : ''}>
              {localAuthor.monitored ? '✓ Monitored' : 'Monitor'}
            </button>
            <button onClick={handleDelete} className="delete-btn">
              Delete Author
            </button>
          </div>
        </div>
      </div>

      {searchResults && selectedBook && (
        <SearchResultsModal
          book={selectedBook}
          results={searchResults}
          onClose={handleCloseSearchResults}
          onUpdate={onUpdate}
          onStatusChange={handleBookStatusChange}
        />
      )}

      {detailsBook && (
        <BookDetailsModal
          book={detailsBook}
          onClose={() => setDetailsBook(null)}
          onStarredChange={loadStarredBooks}
        />
      )}

      {readerBook && (
        <Reader
          book={readerBook}
          onClose={() => setReaderBook(null)}
          onStarredChange={loadStarredBooks}
        />
      )}
      {pdfBook && (
        <PdfReader
          book={pdfBook}
          onClose={() => setPdfBook(null)}
          onStarredChange={loadStarredBooks}
        />
      )}
    </div>
  );
};

export default AuthorModal;
