import React, { useState, useEffect } from 'react';
import { systemAPI, settingsAPI } from '../services/api';
import { toast } from 'react-toastify';
import './SystemStatus.css';

// `embedded`: rendered inside Settings → System (no page title)
const SystemStatus = ({ embedded = false }) => {
  const [activeSubTab, setActiveSubTab] = useState('status');
  const [statusData, setStatusData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  // Settings -> System -> Updates. The answer comes from the Bookarr API (see the update section
  // in controllers/systemController.js): a browser call to api.github.com logged a 404 in the
  // console whenever the repository had no published release, and the page could not say why.
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // Backup & Restore: a restore uploads as long as it takes, and a refusal has to stay on screen.
  // A toast is gone in five seconds, which is exactly why "400 Bad Request" told the user nothing.
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoreWarnings, setRestoreWarnings] = useState([]);

  const checkForUpdates = async (force = false) => {
    setCheckingUpdate(true);
    try {
      const { data } = await systemAPI.checkUpdates(force);
      setUpdateInfo(data);
    } catch (error) {
      // The endpoint answers 200 with a sentence for every GitHub outcome, so this is Bookarr's own
      // API being unreachable - worth saying, and still not a console error.
      setUpdateInfo({
        checked: false,
        message: `Could not ask the Bookarr API for the release list (${error.response?.data?.error || error.message}). Check the container log if this keeps happening.`
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Ask once when the tab is first opened; the button forces a fresh answer past the 5 minute cache.
  useEffect(() => {
    if (activeSubTab === 'updates' && !updateInfo) checkForUpdates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);


  useEffect(() => {
    fetchStatus();
    if (activeSubTab === 'logs') {
      fetchLogs();
    }
  }, [activeSubTab]);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data } = await systemAPI.getStatus();
      setStatusData(data);
    } catch (error) {
      console.error('Failed to fetch system status:', error);
      toast.error('Failed to load system status');
    } finally {
      setLoading(false);
    }
  };


  
  const handleExport = async () => {
    try {
      const response = await systemAPI.downloadBackup();
      const url = URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'bookarr-backup.sqlite';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch && filenameMatch.length === 2) {
          filename = filenameMatch[1];
        }
      }
      
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Full backup downloaded');
    } catch (e) {
      toast.error('Database export failed');
      console.error(e);
    }
  };

  // A restore takes one file, and a .zip bundle or a raw .sqlite are the only two shapes Bookarr
  // writes. Both are checked here as well, so the wrong file is explained before a long upload.
  const BACKUP_NAME = /\.(zip|sqlite3?|db)$/i;

  const restoreFailed = (message, err) => {
    setRestoreError(message);
    toast.error(message);
    if (err) console.error('Backup restore failed:', err.response?.data || err.message);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setRestoreError('');
    setRestoreWarnings([]);

    if (!BACKUP_NAME.test(file.name)) {
      restoreFailed(`Bookarr restores a .zip or .sqlite backup - "${file.name}" is neither. (A .gz, .tar, .sql or .7z archive cannot be read here.)`);
      return;
    }
    if (!file.size) {
      restoreFailed(`"${file.name}" is 0 bytes, so the download or the copy failed. Download the backup again and retry.`);
      return;
    }

    const confirmed = window.confirm(`Restore ${file.name} (${formatBytes(file.size)})? The database is replaced with the file, a copy of the current one is saved to the backups folder first, and any .env / JWT secret in the archive is restored too (the file it replaces is kept with a .backup- date suffix). Everyone is signed out.`);
    if (!confirmed) return;

    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('dbFile', file);

      toast.info(`Uploading ${file.name} and restoring...`);
      const { data } = await systemAPI.restoreBackup(formData);

      const alsoRestored = data?.configFiles?.length ? ` + ${data.configFiles.join(', ')}` : '';
      toast.success(data?.safetySnapshot ? `Restore complete: database${alsoRestored} (previous database kept as ${data.safetySnapshot})` : 'Restore complete.');
      if (data?.configFiles?.length) toast.info('Restart Bookarr to load the restored .env / JWT secret.');
      if (data?.warnings?.length) setRestoreWarnings(data.warnings);

      // The restored database has different users once file-level config was restored, so signing in
      // again is the honest next step.
      setTimeout(() => {
        window.location.href = '/login';
      }, data?.warnings?.length ? 8000 : 3000);
    } catch (err) {
      // The API answers { error } for a refused file; the upload layer answers plain text (413).
      const detail = typeof err.response?.data === 'string' ? err.response.data.trim() : err.response?.data?.error;
      const fallback = err.response
        ? `the server refused the upload (HTTP ${err.response.status})`
        : 'cannot reach the Bookarr server';
      restoreFailed(`Import failed - ${detail || fallback}`, err);
    } finally {
      setRestoring(false);
    }
  };


  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const { data } = await systemAPI.getLogs();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Failed to fetch system logs:', error);
      toast.error('Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    
    const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
    const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : "";
    const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : "";
    const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : "";
    return dDisplay + hDisplay + mDisplay + sDisplay;
  };

  const getLogClass = (line) => {
    if (line.includes('[ERROR]')) return 'log-error';
    if (line.includes('[WARN]')) return 'log-warn';
    if (line.includes('[INFO]')) return 'log-info';
    return 'log-default';
  };

  return (
    <div className="system-status-page animate-fade-in">
      <div className="page-header" style={embedded ? { justifyContent: 'flex-end' } : undefined}>
        {!embedded && <h1>System Status</h1>}
        <button 
          onClick={activeSubTab === 'logs' ? fetchLogs : fetchStatus} 
          className="refresh-btn"
        >
          🔄 Refresh
        </button>
      </div>

      <div className="tabs">
        <button 
          className={`tab-btn ${activeSubTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('status')}
        >
          Status & Health
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'disks' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('disks')}
        >
          Disk Space
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('logs')}
        >
          Logs
        </button>
                <button 
          className={`tab-btn ${activeSubTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('about')}
        >
          About
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'backup' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('backup')}
        >
          Backup
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'updates' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('updates')}
        >
          Updates
        </button>
      </div>

      {loading && activeSubTab !== 'logs' ? (
        <div className="loading">Loading system resource states...</div>
      ) : (
        <div className="tab-content">
          {activeSubTab === 'status' && statusData && (
            <div className="status-grid">
              <div className="status-card glass-panel">
                <h3>Application Health</h3>
                <div className="status-item">
                  <span>Database Status:</span>
                  <strong className={`health-${statusData.system.dbStatus}`}>
                    {statusData.system.dbStatus === 'connected' ? '🟢 Connected' : '🔴 Disconnected'}
                  </strong>
                </div>
                <div className="status-item">
                  <span>Uptime:</span>
                  <strong>{formatUptime(statusData.system.uptime)}</strong>
                </div>
                <div className="status-item">
                  <span>Node.js Version:</span>
                  <strong>{statusData.system.nodeVersion}</strong>
                </div>
              </div>

              <div className="status-card glass-panel">
                <h3>System Resources</h3>
                <div className="status-item">
                  <span>Operating System:</span>
                  <strong>{statusData.system.osType} ({statusData.system.platform} {statusData.system.arch})</strong>
                </div>
                <div className="status-item">
                  <span>OS Release:</span>
                  <strong>{statusData.system.osRelease}</strong>
                </div>
                <div className="status-item">
                  <span>Total System Memory:</span>
                  <strong>{formatBytes(statusData.system.totalMem)}</strong>
                </div>
                <div className="status-item">
                  <span>Free System Memory:</span>
                  <strong>{formatBytes(statusData.system.freeMem)}</strong>
                </div>
              </div>

              <div className="status-card glass-panel">
                <h3>Process Memory (RSS)</h3>
                <div className="status-item">
                  <span>Resident Set Size (RSS):</span>
                  <strong>{formatBytes(statusData.processMemory.rss)}</strong>
                </div>
                <div className="status-item">
                  <span>Heap Total:</span>
                  <strong>{formatBytes(statusData.processMemory.heapTotal)}</strong>
                </div>
                <div className="status-item">
                  <span>Heap Used:</span>
                  <strong>{formatBytes(statusData.processMemory.heapUsed)}</strong>
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'disks' && statusData && (
            <div className="disk-list">
              {statusData.disks.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">💽</span>
                  <h3>No Folders Configured</h3>
                  <p>Configure library and download folders in Settings > General to view disk space statistics.</p>
                </div>
              ) : (
                statusData.disks.map((disk, idx) => (
                  <div key={idx} className="disk-card glass-panel">
                    <div className="disk-info-header">
                      <h3>{disk.name}</h3>
                      <code>{disk.path}</code>
                    </div>
                    {disk.error ? (
                      <div className="disk-error-msg">⚠️ Failed to read: {disk.error}</div>
                    ) : (
                      <div className="disk-details-container">
                        <div className="progress-bar-bg">
                          <div 
                            className={`progress-bar-fill ${disk.percentage > 90 ? 'disk-danger' : disk.percentage > 75 ? 'disk-warning' : 'disk-normal'}`} 
                            style={{ width: `${disk.percentage}%` }}
                          />
                        </div>
                        <div className="disk-meta-stats">
                          <span>{disk.percentage}% Used</span>
                          <span>Free: {formatBytes(disk.free)} / Total: {formatBytes(disk.total)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          
          
          {activeSubTab === 'updates' && (
            <div className="status-grid">
              <div className="status-card glass-panel" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>System Updates</h3>
                  <button className="s-btn" onClick={() => checkForUpdates(true)} disabled={checkingUpdate}>
                    {checkingUpdate ? 'Checking...' : 'Check for Updates'}
                  </button>
                </div>
                
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  <p style={{ margin: '0 0 10px 0', color: '#ccc' }}><strong>Current Version:</strong> {statusData?.system?.version || 'Unknown'}</p>
                  
                  {updateInfo ? (
                    <div>
                      {updateInfo.published && updateInfo.latest ? (
                        <>
                          <p style={{ margin: '0 0 15px 0', color: updateInfo.updateAvailable ? '#4caf50' : '#ccc' }}>
                            <strong>Latest release:</strong> {updateInfo.latest.tag || updateInfo.latest.version}
                            {updateInfo.latest.publishedAt ? ` — published ${new Date(updateInfo.latest.publishedAt).toLocaleDateString()}` : ''}
                            {updateInfo.latest.prerelease ? ' (prerelease)' : ''}
                          </p>

                          {updateInfo.updateAvailable ? (
                            <div style={{ padding: '15px', border: '1px solid #4caf50', borderRadius: '8px', backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
                              <h4 style={{ margin: '0 0 10px 0', color: '#4caf50' }}>🎉 Update Available!</h4>
                              <p style={{ margin: '0 0 15px 0', fontSize: '0.9em', lineHeight: '1.4' }}>
                                <strong>Docker Users:</strong> Because you are running inside an isolated container, Bookarr cannot overwrite itself. Simply use Watchtower for automatic updates, or manually run <code>docker pull ghcr.io/hoffmansweb/bookarr:latest</code> and restart your container.<br/><br/>
                                <strong>Windows Users:</strong> Download the latest installer from the release page below.
                              </p>
                              <a href={updateInfo.latest.url} target="_blank" rel="noopener noreferrer" className="s-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
                                View Release Notes
                              </a>
                            </div>
                          ) : updateInfo.updateAvailable === false ? (
                            <p style={{ margin: 0, color: '#4caf50' }}>✅ You are running the latest version of Bookarr!</p>
                          ) : (
                            <p className="update-note">{updateInfo.message}</p>
                          )}
                        </>
                      ) : (
                        <p className={updateInfo.checked ? 'update-note' : 'update-note update-note-warn'}>{updateInfo.message}</p>
                      )}

                      <p className="update-meta">
                        <a href={updateInfo.releasesUrl} target="_blank" rel="noopener noreferrer">All releases on GitHub</a>
                        {updateInfo.checkedAt ? ` — checked ${new Date(updateInfo.checkedAt).toLocaleTimeString()}` : ''}
                        {updateInfo.cached ? ' (from the 5 minute cache — the button asks again)' : ''}
                      </p>
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: '#888' }}>{checkingUpdate ? 'Asking GitHub...' : 'Press "Check for Updates" to ask GitHub for the newest release.'}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'backup' && (
            <div className="status-grid">
              <div className="status-card glass-panel" style={{ gridColumn: '1 / -1' }}>
                <h3>Backup & Restore</h3>
                <p style={{ color: '#ccc', marginBottom: '20px' }}>Download everything Bookarr keeps: the database (settings, users, books, reading and listening progress, notifications, indexers, download clients) and, when your install has them, your .env and the JWT session secret. Passwords live in the database as bcrypt hashes, never in plain text. A restore swaps the database back in, restores those config files too (the files they replace are renamed with a .backup- date suffix) and saves a copy of the current database first, so a mistake is reversible. Your ebook and audiobook files are not in the archive - the database only holds their paths - so back up the library folders themselves as well. The archive contains credentials, so keep it somewhere safe.</p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button type="button" className="refresh-btn" onClick={handleExport} disabled={restoring}>⬇️ Download backup</button>
                  <label className="refresh-btn" style={{ cursor: restoring ? 'progress' : 'pointer', display: 'flex', alignItems: 'center', opacity: restoring ? 0.7 : 1 }}>
                    {restoring ? '⏳ Restoring…' : '⬆️ Restore backup'}
                    <input type="file" accept=".zip,.sqlite,.sqlite3,.db,application/zip,application/x-sqlite3" onChange={handleImport} disabled={restoring} style={{ display: 'none' }} />
                  </label>
                </div>
                {restoreError && <div className="restore-error">{restoreError}</div>}
                {restoreWarnings.map((warning) => <div className="restore-warning" key={warning}>{warning}</div>)}
              </div>
            </div>
          )}

          {activeSubTab === 'about' && (
            <div className="about-container glass-panel" style={{ padding: '30px', textAlign: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                <img src="/logo192.png" alt="Bookarr Logo" width="120" style={{ borderRadius: '24px', marginBottom: '10px' }} />
                <h2 style={{ fontSize: '2em', margin: 0 }}>Bookarr</h2>
                <p style={{ fontSize: '1.2em', color: '#ccc', maxWidth: '500px', lineHeight: '1.5' }}>
                  The ultimate self-hosted Ebook and Audiobook Library Manager.
                </p>
                <div style={{ marginTop: '20px', display: 'flex', gap: '15px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <a href="https://github.com/hoffmansweb/bookarr" target="_blank" rel="noopener noreferrer" className="s-btn" style={{ textDecoration: 'none' }}>📦 GitHub Repository</a>
                  <a href="https://github.com/hoffmansweb/bookarr/issues" target="_blank" rel="noopener noreferrer" className="s-btn" style={{ textDecoration: 'none' }}>🐛 Report a Bug</a>
                  <a href="https://github.com/hoffmansweb/bookarr/discussions" target="_blank" rel="noopener noreferrer" className="s-btn" style={{ textDecoration: 'none' }}>💬 Discussions</a>
                </div>
                <div style={{ marginTop: '40px', padding: '20px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '12px', width: '100%', maxWidth: '400px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ color: '#888' }}>Version</span>
                    <strong>{statusData?.system?.version || 'Unknown'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Node.js</span>
                    <strong>{statusData?.system?.nodeVersion || 'Unknown'}</strong>
                  </div>
                </div>
                <p style={{ marginTop: '20px', color: '#666', fontSize: '0.9em' }}>Developed with ❤️ by the Bookarr community.</p>
              </div>
            </div>
          )}

          {activeSubTab === 'logs' && (
            <div className="logs-container glass-panel">
              <div className="logs-panel-header">
                <h3>Winston Application Logs (combined.log)</h3>
                {logsLoading && <span className="logs-loading-indicator">Refreshing...</span>}
              </div>
              <div className="terminal-window">
                {logsLoading && logs.length === 0 ? (
                  <div className="terminal-loading">Reading log files...</div>
                ) : logs.length === 0 ? (
                  <div className="terminal-empty">No log events found.</div>
                ) : (
                  <div className="terminal-lines">
                    {logs.map((line, idx) => (
                      <div key={idx} className={`terminal-line ${getLogClass(line)}`}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SystemStatus;
