import React, { useState } from 'react';
import { bookAPI, nzbAPI } from '../services/api';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import Reader from './Reader';
import DownloadProgress from './DownloadProgress';
import { useSocket } from '../context/SocketContext';
import { extractYear } from '../utils/dates';
import './BookCard.css';

const BookCard = ({ book, onUpdate, onClick, onAuthorClick }) => {
  const { user } = useAuth();
  const [showReader, setShowReader] = useState(false);
  const [starred, setStarred] = useState(book.UserBooks?.starred || false);
  // A missing (or dead) cover URL used to drop the whole cover box, which left those cards
  // shorter than their neighbours; a placeholder keeps every card in the grid the same size.
  const [coverFailed, setCoverFailed] = useState(false);
  
  const [downloading, setDownloading] = useState(false);
  const [downloadingType, setDownloadingType] = useState(null);
  const [ttsProgress, setTtsProgress] = useState(false);
  const socket = useSocket();

  React.useEffect(() => {
    if (book.filePath?.toLowerCase().endsWith('.epub') && !book.availableFormats?.audiobook) {
      import('../services/api').then(({ ttsAPI }) => {
        ttsAPI.convertStatus(book.id).then(({ data }) => {
          if (data && data.stage && data.stage !== 'none' && data.stage !== 'done' && data.stage !== 'failed') {
            setTtsProgress(true);
          }
        }).catch(() => {});
      });
    }
  }, [book.id, book.filePath, book.availableFormats]);

  React.useEffect(() => {
    if (!socket || !book.id) return;
    const onProgress = (p) => {
      if (p.bookId === book.id && p.source === 'tts') {
        if (p.stage === 'done') {
          setTtsProgress(false);
          toast.success(`Audiobook created for ${book.title}!`);
          onUpdate?.();
        } else {
          setTtsProgress(true);
        }
      }
    };
    socket.on('download:progress', onProgress);
    return () => socket.off('download:progress', onProgress);
  }, [socket, book.id]);
  const [grabbed, setGrabbed] = useState(false);

  // Search results (not in the library yet): add + start looking, per the "Get" setting
  const handleGrab = async (e) => {
    e.stopPropagation();
    setDownloading(true);
    setDownloadingType('grab');
    try {
      const { data } = await bookAPI.grab({ ...book, author: book.author?.name || book.author || book.authors?.[0] });
      const labels = { ebook: '📖 ebook', audiobook: '🎧 audiobook' };
      toast.success(`Added "${book.title}" — looking for ${data.formats.map(f => labels[f]).join(' + ')}`);
      setGrabbed(true);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add book');
    } finally {
      setDownloading(false);
      setDownloadingType(null);
    }
  };
  
  const handleStatusChange = async (status) => {
    try {
      await bookAPI.update(book.id, { status });
      toast.success('Book status updated');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to update book');
    }
  };

  const handleAddToLibrary = async () => {
    try {
      await bookAPI.addToLibrary(book.id);
      toast.success('Added to library');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to add to library');
    }
  };

  const handleToggleStar = async (e) => {
    e.stopPropagation();
    try {
      const res = await bookAPI.toggleStar(book.id);
      setStarred(res.data.starred);
      toast.success(res.data.starred ? 'Starred' : 'Unstarred');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to toggle star');
    }
  };

  const authorName = book.author?.name || book.author || '';

  const handleGetBook = async (e, format) => {
    e.stopPropagation();
    setDownloading(true);
    setDownloadingType(format);
    try {
      if (format === 'audiobook') {
        // Results come back in the audiobook source priority from Settings (e.g. YouTube first)
        const { data } = await nzbAPI.search(book.title, authorName, { mediaType: 'audiobook' });
        const release = data.results.find(r => r.format === 'audiobook' && r.matched !== false);
        if (release) {
          await nzbAPI.startDownload(release, book.id);
          toast.success(`${release.type === 'youtube' ? 'YouTube download' : 'Download'} started: ${release.title}`);
        } else {
          const { data: auto } = await nzbAPI.audiobookAuto(book.id);
          if (auto.success) toast.success(auto.message);
          else toast.info(auto.message || 'No audiobook found');
        }
      } else {
        const { data } = await nzbAPI.search(book.title, authorName, { isbn: book.isbn13 || book.isbn10, mediaType: 'ebook' });
        const result = data.results.find(r => r.format !== 'audiobook' && r.matched !== false);
        if (!result) {
          toast.info('No results found');
        } else {
          await nzbAPI.download({ url: result.downloadUrl, md5: result.md5, title: result.title, bookId: book.id, type: result.type, format: result.format });
          toast.success(result.type === 'annas' ? `Queued from Anna's Archive: ${result.title}` : `Download started: ${result.title}`);
        }
      }
      onUpdate?.();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Search failed');
    } finally {
      setDownloading(false);
      setDownloadingType(null);
    }
  };

  return (
    <div className={`book-card ${onClick ? 'clickable' : ''}`} onClick={onClick ? () => onClick(book) : undefined}>
      {book.coverUrl && !coverFailed ? (
        <img src={book.coverUrl} alt={book.title} onError={() => setCoverFailed(true)} />
      ) : (
        <div className="book-cover-fallback" aria-hidden="true">
          {book.bookType === 'audiobook' ? '🎧' : '📖'}
        </div>
      )}
      {(book.status === 'downloading' || ttsProgress) && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 5px 5px', zIndex: 10, background: 'rgba(0,0,0,0.6)' }}>
          <DownloadProgress book={book} onStatusChange={(fresh) => onUpdate?.()} />
        </div>
      )}
      <div className="book-info">
        <h3>
          {book.title}
          <button className="star-btn" onClick={handleToggleStar}>
            {starred ? '⭐' : '☆'}
          </button>
        </h3>
        {book.series && (
          <span className="series-badge" style={{ display: 'inline-block', background: '#38444d', color: '#1d9bf0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', marginBottom: '8px', fontWeight: 'bold' }}>
            {book.series} {book.seriesNumber ? `#${book.seriesNumber}` : ''}
          </span>
        )}
        {book.bookType && <span className="book-type-badge">{book.bookType}</span>}
        {(book.author?.name || book.author) && (
          <p 
            className="author" 
            style={{ cursor: onAuthorClick ? 'pointer' : 'default', textDecoration: onAuthorClick ? 'underline' : 'none' }} 
            onClick={(e) => { 
              if (onAuthorClick) { 
                e.stopPropagation(); 
                onAuthorClick(book.author || book.author?.name); 
              } 
            }}
          >
            {book.author?.name || book.author}
          </p>
        )}
        {book.narrator && <p className="narrator">🎙️ {book.narrator}</p>}
        {extractYear(book.publishedDate) && <p className="date">{extractYear(book.publishedDate)}</p>}
        {book.bookType === 'audiobook' && book.duration && <p className="duration">⏱️ {Math.floor(book.duration / 60)}h {book.duration % 60}m</p>}
        {book.bookType !== 'audiobook' && book.pageCount && <p className="pages">📄 {book.pageCount} pages</p>}
        {book.rating && <p className="rating">⭐ {book.rating.toFixed(1)}</p>}

        {Number(book.UserBooks?.progress) > 0 && Number(book.UserBooks?.progress) < 100 && (
          <div className="book-progress" title={`${Math.round(book.UserBooks.progress)}% complete`}>
            <div className="book-progress-fill" style={{ width: `${book.UserBooks.progress}%` }} />
          </div>
        )}

        <div className="book-actions" onClick={(e) => e.stopPropagation()}>
          {user?.role === 'admin' && !book.id && (
            <button onClick={handleGrab} disabled={downloading || grabbed}>
              {downloadingType === 'grab' ? <><span className="btn-spinner"></span> Adding...</> : grabbed ? '✓ Added' : '⬇️ Get'}
            </button>
          )}
          {user?.role === 'admin' && book.id && book.status === 'wanted' && (
            <>
              <button onClick={(e) => handleGetBook(e, 'ebook')} disabled={downloading}>
                {downloadingType === 'ebook' ? <span className="btn-spinner"></span> : '📖'} {downloadingType === 'ebook' ? 'Searching...' : 'Get Ebook'}
              </button>
              <button onClick={(e) => handleGetBook(e, 'audiobook')} disabled={downloading}>
                {downloadingType === 'audiobook' ? <span className="btn-spinner"></span> : '🎧'} {downloadingType === 'audiobook' ? 'Searching...' : 'Get Audio'}
              </button>
            </>
          )}
          {book.status === 'available' && book.filePath && (
            <button onClick={(e) => { 
              e.stopPropagation(); 
              if (book.bookType !== 'audiobook' && !book.filePath.toLowerCase().endsWith('.epub')) {
                const token = localStorage.getItem('token');
                window.location.href = `/api/books/${book.id}/file?token=${encodeURIComponent(token || '')}`;
              } else {
                setShowReader(true);
              }
            }}>
              {book.bookType === 'audiobook' ? '🎧 Play' : (!book.filePath.toLowerCase().endsWith('.epub') ? '⬇️ Download' : '📖 Read')}
            </button>
          )}
        </div>
      </div>
      
      {showReader && (
        <Reader
          book={book}
          onClose={() => setShowReader(false)}
          // Starting the book files it under Favorites (Settings → General); show the star at once
          onStarredChange={() => { setStarred(true); onUpdate?.(); }}
        />
      )}
    </div>
  );
};

export default BookCard;
