import React, { useState, useEffect, useRef } from 'react';
import { authorAPI } from '../services/api';
import AuthorCard from '../components/AuthorCard';
import AuthorModal from '../components/AuthorModal';
import AuthorSearchModal from '../components/AuthorSearchModal';
import SearchBar from '../components/SearchBar';
import { useSocket } from '../context/SocketContext';
import './Authors.css';

const Authors = () => {
  const [authors, setAuthors] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  // Mirrored into state (not just the ref) so the result summary can name the query currently
  // in effect; the ref stays the source the poll reads.
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const socket = useSocket();
  // The 5s poll and socket handler are registered once; read the current filter
  // and search query through refs so they don't reset the view to the initial
  // "All" filter (stale closure) or wipe out search results.
  const filterRef = useRef(filter);
  const searchQueryRef = useRef('');

  useEffect(() => {
    filterRef.current = filter;
    loadAuthors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    const interval = setInterval(() => loadAuthors(), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!socket) return;
    
    const handleScanComplete = () => loadAuthors();
    socket.on('library-scan-complete', handleScanComplete);

    return () => {
      socket.off('library-scan-complete', handleScanComplete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const loadAuthors = async () => {
    try {
      const params = searchQueryRef.current
        ? { search: searchQueryRef.current }
        : (filterRef.current === 'monitored' ? { monitored: true } : {});
      const { data } = await authorAPI.getAll(params);
      setAuthors(data);
    } catch (error) {
      console.error('Failed to load authors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLocalSearch = async (query) => {
    searchQueryRef.current = query || '';
    setSearchQuery(query || '');
    await loadAuthors();
  };

  const handleExternalSearch = async () => {
    const query = prompt('Search for new authors to add:');
    if (!query) return;
    try {
      console.log('Searching for:', query);
      setSearching(true);
      const { data } = await authorAPI.searchExternal(query);
      console.log('Search results:', data);
      setSearchResults(data);
      setShowSearchModal(true);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleAuthorAdded = () => {
    setShowSearchModal(false);
    loadAuthors();
  };

  return (
    <div className="authors-page">
      <div className="page-header">
        <h1>Authors</h1>
        <div className="header-actions">
          <SearchBar onSearch={handleLocalSearch} placeholder="Search authors or book titles..." />
          <button onClick={handleExternalSearch} className="add-author-btn">+ Add New Author</button>
        </div>
      </div>

      <div className="filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'monitored' ? 'active' : ''} onClick={() => setFilter('monitored')}>Monitored</button>
      </div>

      {/* The authors list can also be reached by a book title (the API matches both), so the
          count line spells that out instead of leaving it to the per-card hint. */}
      {searchQuery && !loading && authors.length > 0 && (
        <p className="search-summary" role="status">
          {`${authors.length} ${authors.length === 1 ? 'author' : 'authors'} matching "${searchQuery}" by name or book title`}
        </p>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="authors-grid">
          {authors.map((author) => (
            <AuthorCard 
              key={author.id} 
              author={author} 
              onUpdate={setSelectedAuthor}
              isSearchResult={false}
            />
          ))}
          {authors.length === 0 && (
            <p>{searchQuery
              ? `No authors or book titles match "${searchQuery}"`
              : 'No authors found'}</p>
          )}
        </div>
      )}

      {searching && (
        <div className="modal-overlay">
          <div className="searching-modal">
            <div className="spinner"></div>
            <p>Searching for authors...</p>
          </div>
        </div>
      )}

      {showSearchModal && (
        <AuthorSearchModal
          authors={searchResults}
          onClose={() => setShowSearchModal(false)}
          onAuthorAdded={handleAuthorAdded}
        />
      )}

      {selectedAuthor && (
        <AuthorModal
          author={selectedAuthor}
          onClose={() => setSelectedAuthor(null)}
          onUpdate={loadAuthors}
        />
      )}
    </div>
  );
};

export default Authors;
