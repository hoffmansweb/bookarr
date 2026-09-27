import React, { useState, useEffect } from 'react';
import { systemAPI } from '../services/api';
import { toast } from 'react-toastify';
import './SystemStatus.css';

// `embedded`: rendered inside Settings → System (no page title)
const SystemStatus = ({ embedded = false }) => {
  const [activeSubTab, setActiveSubTab] = useState('status');
  const [statusData, setStatusData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);

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
