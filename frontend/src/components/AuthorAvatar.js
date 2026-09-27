// Author photo with an initials fallback: used when there's no photo, or the image fails to load.
// Also hides known non-photo images (e.g. Amazon's "Follow this author" banner) already in the DB.
import React, { useState } from 'react';

const NOT_A_PHOTO = /m\.media-amazon\.com\/images\/G\/|banner|sprite|follow|nophoto|no-photo|placeholder/i;

const initials = (name = '') => name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

// Stable pleasant colour per author name
const hue = (name = '') => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const AuthorAvatar = ({ name, imageUrl, className = '', style }) => {
  const [failed, setFailed] = useState(false);
  const usable = imageUrl && !failed && !NOT_A_PHOTO.test(imageUrl);

  if (usable) {
    return <img src={imageUrl} alt={name} className={className} style={style} onError={() => setFailed(true)} loading="lazy" />;
  }
  const h = hue(name);
  return (
    <div
      className={`author-avatar-fallback ${className}`}
      role="img"
      aria-label={name}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, hsl(${h} 45% 28%), hsl(${(h + 40) % 360} 50% 18%))`,
        color: '#fff',
        fontWeight: 700,
        letterSpacing: '0.04em',
        userSelect: 'none',
        ...style
      }}
    >
      <span style={{ fontSize: 'clamp(1.2rem, 3vw, 2.6rem)' }}>{initials(name)}</span>
    </div>
  );
};

export default AuthorAvatar;
