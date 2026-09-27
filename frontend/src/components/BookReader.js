import React, { useState } from 'react';
import { ReactReader } from 'react-reader';
import './BookReader.css';

const getApiBaseUrl = () => {
  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:5000` : origin;
};

const BookReader = ({ book, onClose }) => {
  const [location, setLocation] = useState(0);

  const fileUrl = book.filePath ? `${getApiBaseUrl()}/api/books/${book.id}/file` : null;

  if (!fileUrl) {
    return (
      <div className="reader-modal" onClick={onClose}>
        <div className="reader-error">
          <h2>File not available</h2>
          <p>This book has not been downloaded yet.</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-modal">
      <div className="reader-header">
        <h2>{book.title}</h2>
        <button onClick={onClose}>✕ Close</button>
      </div>
      <div className="reader-container">
        <ReactReader
          url={fileUrl}
          location={location}
          locationChanged={(loc) => setLocation(loc)}
        />
      </div>
    </div>
  );
};

export default BookReader;
