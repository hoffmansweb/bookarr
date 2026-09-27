import React from 'react';
import AuthorCard from './AuthorCard';
import './AuthorSearchModal.css';

const AuthorSearchModal = ({ authors, onClose, onAuthorAdded }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content author-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Author Search Results</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="authors-grid">
          {authors.map((author, index) => (
            <AuthorCard 
              key={index} 
              author={author} 
              onUpdate={onAuthorAdded}
              isSearchResult={true}
            />
          ))}
          {authors.length === 0 && <p>No authors found</p>}
        </div>
      </div>
    </div>
  );
};

export default AuthorSearchModal;
