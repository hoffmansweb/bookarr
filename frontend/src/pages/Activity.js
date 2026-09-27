import React, { useState, useEffect } from 'react';
import { activityAPI } from '../services/api';
import { toast } from 'react-toastify';
import './Activity.css';

const Activity = () => {
  const [activeTab, setActiveTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();

    // Setup polling for the active queue
    const interval = setInterval(() => {
      if (activeTab === 'queue') {
        pollQueue();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'queue') {
        const { data } = await activityAPI.getQueue();
        setQueue(data);
      } else {
        const { data } = await activityAPI.getHistory();
        setHistory(data);
      }
    } catch (error) {
      console.error('Failed to fetch activity data:', error);
      toast.error('Failed to load activity details');
    } finally {
      setLoading(false);
    }
  };

  const pollQueue = async () => {
    try {
      const { data } = await activityAPI.getQueue();
      setQueue(data);
    } catch (error) {
      console.error('Failed to poll queue:', error);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this download and reset the book status?')) return;
    
    try {
      await activityAPI.cancelQueueItem(id);
      toast.success('Download cancelled successfully');
      setQueue(prev => prev.filter(item => item.id !== id));
    } catch (error) {
      console.error('Failed to cancel download:', error);
      toast.error('Failed to cancel download');
    }
  };

  const formatSpeed = (bytesPerSec) => {
    if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="activity-page animate-fade-in">
      <div className="page-header">
        <h1>Activity</h1>
        <button onClick={fetchData} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>

      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Queue ({queue.length})
        </button>
        <button 
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History ({history.length})
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading activity information...</div>
      ) : (
        <div className="tab-content">
          {activeTab === 'queue' && (
            <div className="queue-list">
              {queue.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📂</span>
                  <h3>No Active Downloads</h3>
                  <p>Books you download from indexers will show up here while in progress.</p>
                </div>
              ) : (
                queue.map(item => (
                  <div key={item.id} className="activity-card glass-panel">
                    <div className="activity-card-left">
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt={item.title} className="book-cover-thumbnail" />
                      ) : (
                        <div className="book-cover-placeholder">📚</div>
                      )}
                      <div className="book-details">
                        <h3>{item.title}</h3>
                        <p className="author-name">by {item.author}</p>
                        <div className="badges">
                          <span className={`media-badge ${item.mediaType}`}>
                            {item.mediaType === 'audiobook' ? '🎧 Audiobook' : '📖 Ebook'}
                          </span>
                          <span className={`status-badge ${item.status}`}>
                            {item.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="activity-card-right">
                      <div className="progress-container">
                        <div className="progress-info">
                          <span>{item.progress}%</span>
                          {item.speed > 0 && <span className="speed-info">{formatSpeed(item.speed)}</span>}
                        </div>
                        <div className="progress-bar-bg">
                          <div 
                            className="progress-bar-fill" 
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCancel(item.id)} 
                        className="cancel-download-btn"
                        title="Cancel download and reset status"
                      >
                        ✕ Cancel
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="history-list">
              {history.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📜</span>
                  <h3>History is Empty</h3>
                  <p>Once you successfully import books into your library, they will appear here.</p>
                </div>
              ) : (
                <div className="history-table-container glass-panel">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Author</th>
                        <th>Type</th>
                        <th>Date Imported</th>
                        <th>Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(item => (
                        <tr key={item.id}>
                          <td>
                            <div className="history-title-cell">
                              {item.coverUrl && <img src={item.coverUrl} alt="" className="table-cover-thumb" />}
                              <strong>{item.title}</strong>
                            </div>
                          </td>
                          <td>{item.author}</td>
                          <td data-label="Type">
                            <span className={`media-badge ${item.mediaType}`}>
                              {item.mediaType === 'audiobook' ? '🎧' : '📖'}
                            </span>
                          </td>
                          <td data-label="Date Imported">{new Date(item.importedAt).toLocaleString()}</td>
                          <td className="path-cell" data-label="Path" title={item.filePath}>
                            <code>{item.filePath || 'Auto-Managed Library'}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Activity;
