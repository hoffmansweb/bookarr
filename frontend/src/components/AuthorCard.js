import React from 'react';
import AuthorAvatar from './AuthorAvatar';
import { authorAPI } from '../services/api';
import { toast } from 'react-toastify';
import './AuthorCard.css';

const AuthorCard = ({ author, onUpdate, isSearchResult }) => {
  const handleAdd = async () => {
    try {
      setLoading(true);
      await authorAPI.addAuthor({ name: author.name });
      toast.success('Author and books added!');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to add author');
    } finally {
      setLoading(false);
    }
  };

  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const handleMonitor = async () => {
    try {
      if (author.monitored) {
        await authorAPI.unmonitor(author.id);
        toast.success('Author unmonitored');
      } else {
        await authorAPI.monitor(author.id);
        toast.success('Author monitored');
      }
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to update monitoring');
    }
  };

  const handleRefresh = async (e) => {
    if (e) e.stopPropagation();
    try {
      setRefreshing(true);
      await authorAPI.refresh(author.id);
      toast.success('Author books refreshed');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  if (isSearchResult) {
    return (
      <div className="author-card">
        <AuthorAvatar name={author.name} imageUrl={author.imageUrl} className="author-card-image" />
        <div className="author-info">
          <h3>{author.name}</h3>
          {author.genres && <p className="genres">{author.genres}</p>}
          {author.bio && <p className="bio">{author.bio.substring(0, 150)}...</p>}
          <p className="book-count">{author.bookCount || 0} books found</p>
          <div className="author-actions">
            <button onClick={handleAdd} disabled={loading}>
              {loading ? 'Adding...' : 'Add Author'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="author-card" onClick={() => !isSearchResult && onUpdate?.(author)}>
      <AuthorAvatar name={author.name} imageUrl={author.imageUrl} className="author-card-image" />
      <div className="author-info">
        <h3>{author.name}</h3>
        <p className="book-count">{author.books?.length || 0} books</p>
        {/* Present only when the author matched through one of their book titles (the Authors
            search covers names *and* titles), so a result with an unrelated-looking name explains
            itself. Up to three titles, one line. */}
        {author.matchedBooks?.length > 0 && (
          <p className="matched-books" title={author.matchedBooks.join(', ')}>
            📖 {author.matchedBooks.join(', ')}
          </p>
        )}
        {author.lastChecked && (
          <p className="last-checked">
            Last checked: {new Date(author.lastChecked).toLocaleDateString()}
          </p>
        )}
        
        <div className="author-actions" onClick={(e) => e.stopPropagation()}>
          <button 
            className={author.monitored ? 'monitored' : ''} 
            onClick={handleMonitor}
          >
            {author.monitored ? '✓ Monitored' : 'Monitor'}
          </button>
          <button onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <>
                <span className="spin-icon">🔄</span> Refreshing...
              </>
            ) : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorCard;
