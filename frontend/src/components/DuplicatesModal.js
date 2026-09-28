import React, { useState, useEffect } from 'react';
import { bookAPI } from '../services/api';
import { toast } from 'react-toastify';
import './DuplicatesModal.css';

const STATUS_LABEL = {
  available: 'Available',
  wanted: 'Wanted',
  downloading: 'Downloading',
  reading: 'Reading',
  completed: 'Completed',
  ignored: 'Ignored'
};

const DuplicatesModal = ({ onClose, onChanged }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await bookAPI.getDuplicates();
      setGroups(data || []);
    } catch (err) {
      toast.error('Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleMerge = async (group) => {
    setBusy(true);
    try {
      await bookAPI.mergeDuplicates(group.map((b) => b.id));
      toast.success('Duplicates merged');
      onChanged?.();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (book) => {
    if (!window.confirm(`Delete "${book.title}"?`)) return;
    setBusy(true);
    try {
      await bookAPI.delete(book.id);
      toast.success(`Deleted "${book.title}"`);
      onChanged?.();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content duplicates-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-header">
          <h2>Duplicates</h2>
          <p className="search-query">{loading ? '' : `${groups.length} group${groups.length === 1 ? '' : 's'} of duplicate books`}</p>
        </div>

        <div className="duplicates-body">
          {loading ? (
            <div className="loading-inline">Finding duplicates…</div>
          ) : groups.length === 0 ? (
            <p className="no-results">No duplicates found 🎉</p>
          ) : (
            groups.map((group, gi) => (
              <div key={gi} className="dupe-group">
                <div className="dupe-group-head">
                  <strong>{group[0].title}</strong>
                  <span className="dupe-group-author">{group[0].author}</span>
                  <button className="merge-btn" onClick={() => handleMerge(group)} disabled={busy}>
                    Merge (keep best)
                  </button>
                </div>
                {group.map((book) => (
                  <div key={book.id} className="dupe-item">
                    {book.coverUrl
                      ? <img src={book.coverUrl} alt="" className="dupe-cover" />
                      : <div className="dupe-cover dupe-cover-fallback">{book.mediaType === 'audiobook' ? '🎧' : '📖'}</div>}
                    <div className="dupe-main">
                      <span className={`dupe-status status-${book.status}`}>{STATUS_LABEL[book.status] || book.status}</span>
                      <span className="dupe-type">{book.mediaType}</span>
                      {book.filePath && <code className="dupe-path">{book.filePath}</code>}
                    </div>
                    <button className="delete-btn" onClick={() => handleDelete(book)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DuplicatesModal;
