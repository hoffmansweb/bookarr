import React, { useState, useEffect, useRef } from 'react';
import { bookAPI, nzbAPI, ttsAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import SearchResultsModal from './SearchResultsModal';
import Reader from './Reader';
import DownloadProgress from './DownloadProgress';
import './BookModal.css';

const BookModal = ({ book, onClose, onUpdate }) => {
  const { user } = useAuth();
  const [searching, setSearching] = useState(false);
  const [showReader, setShowReader] = useState(false);
  const [hasClients, setHasClients] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [currentBook, setCurrentBook] = useState(book);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState(null);
  const socket = useSocket();

  // Normalize author display - handles both DB books ({author: {name}}) and search results ({author: "string"})
  const authorName = currentBook.author?.name || currentBook.author || currentBook.authors?.[0] || '';
  const isInDb = !!currentBook.id;

  useEffect(() => {
    checkNzbAvailability();
  }, []);

  // Live progress for Anna's Archive / audiobook pipeline / TTS jobs on this book
  useEffect(() => {
    if (!socket || !currentBook.id) return undefined;
    const onProgress = (p) => {
      if (p.bookId !== currentBook.id) return;
      setProgress(p);
      if (p.stage === 'done') {
        toast.success(p.source === 'annas' ? 'Ebook downloaded' : p.source === 'tts' ? 'Narration finished' : 'Audiobook ready');
        setCurrentBook(b => ({ ...b, status: 'available' }));
        onUpdate();
      } else if (p.stage === 'failed' && p.willRetry) {
        toast.info(`${p.message || 'Source failed'} — trying the next source`);
      } else if (p.stage === 'failed') {
        toast.error(`Download failed: ${p.message || 'unknown error'}`);
        setCurrentBook(b => ({ ...b, status: 'wanted' }));
        onUpdate();
      } else if (p.source !== 'tts') {
        // Any other stage means a download is running for this book
        setCurrentBook(b => (b.status === 'downloading' ? b : { ...b, status: 'downloading' }));
      }
    };
    socket.on('download:progress', onProgress);
    return () => socket.off('download:progress', onProgress);
  }, [socket, currentBook.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressText = (p) => {
    if (!p) return null;
    const pct = p.percent != null ? ` ${p.percent}%` : '';
    const labels = {
      queued: 'Queued', resolving: 'Finding download link…', downloading: `Downloading${p.parts ? ` part ${p.part}/${p.parts}` : ''}${pct}`,
      converting: `Converting to M4B${pct}`, saving: 'Saving to library…', importing: 'Importing…', narrating: `Narrating chapter ${p.chapter}/${p.chapters}`,
      done: 'Done ✓', failed: `Failed: ${p.message || ''}`
    };
    return labels[p.stage] || p.stage;
  };

  const checkNzbAvailability = async () => {
    try {
      const { data } = await nzbAPI.status();
      setHasClients(data.hasClients || data.hasIndexers || data.hasYoutube);
    } catch (error) {
      setHasClients(true);
    }
  };

  // Background searches may hand the book to a download client (no live event), so re-check shortly after
  const recheckStatus = (id) => {
    [5000, 15000, 30000].forEach(ms => setTimeout(async () => {
      try {
        const { data } = await bookAPI.getById(id);
        setCurrentBook(b => (b.id === id && data?.status && data.status !== b.status ? { ...b, ...data } : b));
      } catch (e) { /* modal may be closed */ }
    }, ms));
  };

  // One click: add to library and start looking in the formats chosen in Settings (ebook / audiobook / both)
  const handleGet = async () => {
    setAdding(true);
    try {
      const { data } = await bookAPI.grab({ ...currentBook, author: authorName });
      const labels = { ebook: '📖 ebook', audiobook: '🎧 audiobook' };
      toast.success(`Added — looking for ${data.formats.map(f => labels[f]).join(' + ')}`);
      if (data.books?.[0]) {
        setCurrentBook(data.books[0]);
        recheckStatus(data.books[0].id);
      }
      onUpdate();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add book');
    } finally {
      setAdding(false);
    }
  };

  const handleAutoSearchAndAdd = async () => {
    setSearching(true);
    try {
      const { data } = await nzbAPI.search(currentBook.title, authorName, { isbn: currentBook.isbn13 || currentBook.isbn10 });
      // Only auto-grab a result that clearly is this book by this author: ebook first, then an
      // audiobook (e.g. YouTube). Results are already in your source-priority order.
      const matches = data.results.filter(r => r.matched !== false);
      const firstResult = matches.find(r => r.format !== 'audiobook') || matches[0];
      if (!firstResult) {
        if (data.results.length) {
          toast.info('No result clearly matches this book and author — use Manual Search to pick one');
          setSearching(false);
          return;
        }
        toast.info('No results found');
      } else {
        await nzbAPI.startDownload(firstResult, currentBook.id);
        toast.success(`${firstResult.type === 'youtube' ? 'YouTube download' : 'Download'} started: ${firstResult.title}`);
        // Stay open so the progress bar is visible
        setCurrentBook(b => ({ ...b, status: 'downloading', downloadName: firstResult.title }));
        onUpdate();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Auto search failed');
    } finally {
      setSearching(false);
    }
  };

  // Everything in one list: ebook/indexer results first, then YouTube / LibriVox / Archive / web
  // audiobook results appended as they arrive (they're slower). Sources switched off in
  // Settings (e.g. YouTube) are skipped server-side.
  const searchRunRef = useRef(0); // late audiobook results must not reopen a closed results window
  const SOURCE_LABELS = { youtube: 'YouTube', librivox: 'LibriVox', archive: 'Internet Archive', web: 'Web' };
  // e.g. "Audiobooks — YouTube: 3 · LibriVox: none" (or a note that YouTube is switched off)
  const toastAudiobookSources = (sources) => {
    if (!sources) return;
    const parts = Object.entries(sources).map(([id, n]) => `${SOURCE_LABELS[id] || id}: ${n || 'none'}`);
    if (!('youtube' in sources)) parts.push('YouTube: off in Settings');
    toast.info(`Audiobooks — ${parts.join(' · ')}`);
  };
  // The backend search covers Anna's, indexers and the enabled audiobook sources (YouTube etc.)
  const handleSearch = async () => {
    setSearching(true);
    const run = ++searchRunRef.current;
    try {
      const { data } = await nzbAPI.search(currentBook.title, authorName, { isbn: currentBook.isbn13 || currentBook.isbn10 });
      if (run !== searchRunRef.current) return;
      const results = data.results || [];
      toastAudiobookSources(data.audioSources);
      if (results.length) setSearchResults(results);
      else toast.info('No results found');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Google/web + LibriVox + Internet Archive + YouTube, ranked
  const handleAudiobookSearch = async () => {
    setSearching(true);
    try {
      const { data } = await nzbAPI.audiobookSearch(currentBook.title, authorName);
      toastAudiobookSources(data.sources);
      if (data.results.length === 0) {
        toast.info('No audiobook sources found');
      } else {
        setSearchResults(data.results);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Audiobook search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleAudiobookAuto = async () => {
    setSearching(true);
    try {
      const { data } = await nzbAPI.audiobookAuto(currentBook.id);
      if (data.success) {
        toast.success(data.message);
        setCurrentBook(b => ({ ...b, status: 'downloading' }));
        onUpdate();
      } else {
        toast.info(data.message || 'No audiobook sources found');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Audiobook search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleNarrate = async () => {
    try {
      // Narrate with the voice this user picked in the reader (e.g. a Kokoro voice)
      const voiceName = localStorage.getItem('ttsVoice') || undefined;
      const speed = parseFloat(localStorage.getItem('ttsRate')) || undefined;
      await ttsAPI.convert(currentBook.id, { voiceName, speed });
      toast.success('Narration queued — the audiobook will appear under Audiobooks');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not start narration');
    }
  };

  const handleStatusChange = async (status) => {
    try {
      await bookAPI.update(currentBook.id, { status });
      toast.success('Status updated');
      onUpdate();
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content book-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          {currentBook.coverUrl && <img src={currentBook.coverUrl} alt={currentBook.title} />}
          <div>
            <h2>{currentBook.title}</h2>
            {authorName && <p className="author-name">{authorName}</p>}
            {currentBook.source && !isInDb && <span className="source-badge">{currentBook.source}</span>}
          </div>
        </div>

        <div className="modal-body">
          {currentBook.status === 'available' && currentBook.filePath && (
            <div style={{ marginBottom: '15px' }}>
              <button 
                className="primary-btn" 
                onClick={() => setShowReader(true)}
                style={{ width: '100%', padding: '12px', fontSize: '1.1rem', fontWeight: 'bold' }}
              >
                {currentBook.bookType === 'audiobook' ? '🎧 Play Audiobook' : (!currentBook.filePath.toLowerCase().endsWith('.epub') ? '⬇️ Download File' : '📖 Read Ebook')}
              </button>
            </div>
          )}

          <div className="book-meta">
            {currentBook.publishedDate && <span>Published: {currentBook.publishedDate}</span>}
            {currentBook.pageCount && <span>{currentBook.pageCount} pages</span>}
            {currentBook.rating && <span>⭐ {currentBook.rating.toFixed(1)}</span>}
            {currentBook.isbn13 && <span>ISBN: {currentBook.isbn13}</span>}
          </div>

          {currentBook.description && <p className="description">{currentBook.description}</p>}

          {isInDb && (currentBook.status === 'downloading' || (progress?.source === 'tts' && progress.stage !== 'done')) && (
            <DownloadProgress
              key={currentBook.id}
              book={currentBook}
              onStatusChange={(fresh) => { setCurrentBook(b => ({ ...b, ...fresh })); onUpdate(); }}
            />
          )}

          {user?.role === 'admin' && !isInDb && (
            <div className="add-section">
              <button onClick={handleGet} disabled={adding} className="primary-btn">
                {adding ? 'Adding...' : '⬇️ Get Book'}
              </button>
            </div>
          )}

          {isInDb && (
            <div className="status-section">
              <label>Status:</label>
              <select value={currentBook.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={user?.role !== 'admin'}>
                <option value="wanted">Wanted</option>
                <option value="downloading">Downloading</option>
                <option value="available">Available</option>
                <option value="reading">Reading</option>
                <option value="completed">Completed</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
          )}

          {user?.role === 'admin' && isInDb && hasClients && (
            <div className="nzb-section">
              <div className="section-header">
                <h3>Search & Download</h3>
                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                  <button onClick={handleAutoSearchAndAdd} disabled={searching} className="primary-btn">
                    {searching ? (<><span className="spinner"></span>Searching...</>) : 'Auto Search & Add'}
                  </button>
                  <button onClick={handleSearch} disabled={searching}>
                    {searching ? 'Searching...' : 'Manual Search'}
                  </button>
                  <button onClick={handleAudiobookSearch} disabled={searching}>
                    {searching ? 'Searching...' : '🎧 Find Audiobook'}
                  </button>
                  <button onClick={handleAudiobookAuto} disabled={searching}>
                    {searching ? 'Searching...' : '⚡ Auto Audiobook'}
                  </button>
                  {currentBook.filePath?.toLowerCase().endsWith('.epub') && !currentBook.availableFormats?.audiobook && (
                    <button onClick={handleNarrate} disabled={searching || (progress?.source === 'tts' && progress.stage !== 'done')}>🎙️ Create Audio</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReader && (
        <Reader
          book={currentBook}
          onClose={() => setShowReader(false)}
          onStarredChange={() => onUpdate?.()}
        />
      )}

      {searchResults && (
        <SearchResultsModal
          book={currentBook}
          results={searchResults}
          onClose={() => { searchRunRef.current++; setSearchResults(null); }}
          onUpdate={onUpdate}
          onStatusChange={(id, status) => setCurrentBook(b => ({ ...b, status }))}
        />
      )}
    </div>
  );
};

export default BookModal;
