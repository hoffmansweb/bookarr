import React, { useState } from 'react';
import { nzbAPI } from '../services/api';
import { toast } from 'react-toastify';
import './SearchResultsModal.css';

// Results handled by the in-app audiobook pipeline (download -> M4B -> library)
const PIPELINE_TYPES = ['youtube', 'web', 'librivox', 'archive'];

const formatBadge = (result) => {
  if (result.type === 'youtube') return '▶️ YouTube';
  if (result.type === 'librivox') return '🎧 LibriVox';
  if (result.type === 'archive') return '🏛️ Archive.org';
  if (result.type === 'web') return result.kind === 'direct' ? '🎧 Audio file' : result.kind === 'directory' ? '📂 Folder' : '🌐 Web page';
  if (result.format === 'audiobook') return '🎧 Audiobook';
  return `📖 ${(result.format || 'epub').toUpperCase()}`;
};

const formatDuration = (secs) => {
  const s = Number(secs);
  if (!s) return null;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const SearchResultsModal = ({ book, results, onClose, onUpdate, onStatusChange }) => {
  const [busyIndex, setBusyIndex] = useState(null);

  const handleDownload = async (result, index) => {
    setBusyIndex(index);
    try {
      let message;
      if (PIPELINE_TYPES.includes(result.type)) {
        const { data } = await nzbAPI.audiobookDownload(book.id, result);
        message = data.queued === false ? 'Already downloading' : 'Audiobook queued — downloading and converting to M4B';
      } else {
        const { data } = await nzbAPI.download({
          url: result.downloadUrl,
          md5: result.md5,
          title: result.title,
          bookId: book.id,
          type: result.type,
          format: result.format
        });
        message = result.type === 'annas'
          ? (data.queued === false ? 'Already downloading' : 'Anna\'s Archive download queued (link can take 1–2 min)')
          : `Download started (${result.format})`;
      }
      toast.success(message);
      if (onStatusChange) onStatusChange(book.id, 'downloading');
      onUpdate();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Download failed');
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content search-results-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          <h2>Search Results</h2>
          <p className="search-query">{book.title}</p>
        </div>

        <div className="modal-body">
          {results.length === 0 ? (
            <p className="no-results">No results found</p>
          ) : (
            <div className="results-list">
              {results.map((result, index) => (
                <div key={`${result.downloadUrl || result.md5}-${index}`} className="result-item">
                  <div className="result-info">
                    <div className="result-title-row">
                      {(result.coverUrl || result.thumbnail) && <img src={result.coverUrl || result.thumbnail} alt="" className="result-cover" />}
                      <strong>{result.title}</strong>
                    </div>
                    <div className="result-meta">
                      <span className="indexer">{result.indexer}</span>
                      {result.matched === false && (
                        <span className="type-badge" title="The release name doesn't contain this title and author — check before downloading" style={{ background: '#5c3b00', color: '#ffd28a' }}>⚠ may not match</span>
                      )}
                      <span className={`format-badge format-${result.format}`}>{formatBadge(result)}</span>
                      {!PIPELINE_TYPES.includes(result.type) && <span className="type-badge">{result.type === 'annas' ? 'direct' : result.type}</span>}
                      {result.author && result.type !== 'annas' && <span className="channel">{result.author}</span>}
                      {result.language && <span className="date">{result.language}</span>}
                      {result.year && <span className="date">{result.year}</span>}
                      {result.size > 0 && <span className="size">{result.size >= 1048576 ? `${(result.size / 1048576).toFixed(result.size < 10485760 ? 1 : 0)} MB` : `${Math.max(1, Math.round(result.size / 1024))} KB`}</span>}
                      {formatDuration(result.duration) && <span className="duration">⏱️ {formatDuration(result.duration)}</span>}
                      {result.chapters > 0 && <span className="duration">{result.chapters} ch</span>}
                      {result.seeders > 0 && <span className="seeders">⬆ {result.seeders}</span>}
                      {result.peers > 0 && <span className="peers">⬇ {result.peers}</span>}
                      {result.channel && <span className="channel">{result.channel}</span>}
                      {result.pubDate && <span className="date">{new Date(result.pubDate).toLocaleDateString()}</span>}
                    </div>
                    {result.snippet && <div className="result-genre">{result.snippet.slice(0, 200)}</div>}
                    {result.genre && <div className="result-genre">{result.genre}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button onClick={() => handleDownload(result, index)} className="download-btn" disabled={busyIndex !== null}>
                      {busyIndex === index ? 'Starting…' : 'Download'}
                    </button>
                    {PIPELINE_TYPES.includes(result.type) && result.downloadUrl && (
                      <a href={result.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', textAlign: 'center' }}>Open ↗</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResultsModal;
