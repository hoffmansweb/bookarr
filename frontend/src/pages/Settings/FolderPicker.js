// Accessible modal for picking a server-side folder (library / download paths).
import React, { useEffect, useRef, useState } from 'react';
import { settingsAPI } from '../../services/api';

const parentOf = (p) => {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx <= 0) return trimmed.startsWith('/') ? '/' : null;
  const parent = trimmed.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
};
const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

const FolderPicker = ({ title, initialPath, onSelect, onClose }) => {
  const [drives, setDrives] = useState([]);
  const [path, setPath] = useState(initialPath || '');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    settingsAPI.getDrives().then(({ data }) => {
      setDrives(data.drives || []);
      if (!initialPath && data.drives?.[0]) setPath(data.drives[0]);
    }).catch(() => {});
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    settingsAPI.getFolders(path)
      .then(({ data }) => setFolders((data.folders || []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))))
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, [path]);

  const parent = path ? parentOf(path) : null;

  return (
    <div className="s-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="s-modal" role="dialog" aria-modal="true" aria-labelledby="folder-picker-title" tabIndex={-1} ref={dialogRef}>
        <header className="s-modal__header">
          <h2 id="folder-picker-title">{title}</h2>
          <button type="button" className="s-btn s-btn--ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="s-modal__toolbar">
          {drives.length > 0 && (
            <select className="s-input" aria-label="Drive or mount" value={drives.find(d => path.startsWith(d)) || ''} onChange={(e) => setPath(e.target.value)}>
              <option value="" disabled>Drive…</option>
              {drives.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <input className="s-input" aria-label="Current folder" value={path} onChange={(e) => setPath(e.target.value)} />
        </div>

        <ul className="s-folder-list" aria-busy={loading} aria-label="Folders">
          {parent && (
            <li><button type="button" className="s-folder" onClick={() => setPath(parent)}>⬆️ .. (up)</button></li>
          )}
          {folders.map(f => (
            <li key={f}><button type="button" className="s-folder" onClick={() => setPath(f)}>📁 {baseName(f)}</button></li>
          ))}
          {!loading && folders.length === 0 && <li className="s-muted s-folder-empty">No sub-folders</li>}
          {loading && <li className="s-muted s-folder-empty">Loading…</li>}
        </ul>

        <footer className="s-modal__footer">
          <button type="button" className="s-btn s-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="s-btn s-btn--primary" disabled={!path} onClick={() => onSelect(path)}>Use this folder</button>
        </footer>
      </div>
    </div>
  );
};

export default FolderPicker;
