import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { notificationAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import './Navbar.css';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // ≤768px: the six links do not fit a phone, so they move into a drawer behind the ☰ button
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef(null);
  const notificationsRef = useRef(null);
  const userMenuRef = useRef(null);
  const socket = useSocket();

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleNotification = (notification) => {
      setNotifications(prev => [notification, ...prev]);
    };
    socket.on('notification', handleNotification);
    // Remove the listener, otherwise each new socket/remount adds another one
    return () => socket.off('notification', handleNotification);
  }, [socket]);

  // Dismiss the mobile drawer, the notification panel and the user menu on Escape or on a tap
  // outside them. The two panels cover a phone screen, so without this the tap that was meant to
  // dismiss a panel landed on the page behind it and the panel stayed up.
  useEffect(() => {
    if (!menuOpen && !showNotifications && !showUserMenu) return;
    const close = (e) => {
      // Tap outside the whole bar: everything goes.
      if (navRef.current && !navRef.current.contains(e.target)) {
        setMenuOpen(false);
        setShowNotifications(false);
        setShowUserMenu(false);
        return;
      }
      // Tap elsewhere in the bar (e.g. the brand): close the two panels only.
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) setShowNotifications(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setShowNotifications(false);
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, showNotifications, showUserMenu]);

  const loadNotifications = async () => {
    try {
      const { data } = await notificationAPI.getAll({ read: false });
      setNotifications(data);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications([]);
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await notificationAPI.markAsRead(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (error) {
      console.error('Failed to mark read:', error);
    }
  };

  const navItems = [
    { to: '/', label: 'Home', icon: '🏠' },
    { to: '/books', label: 'Library', icon: '📚' },
    { to: '/authors', label: 'Authors', icon: '✍️' },
    { to: '/activity', label: 'Activity', icon: '⏱️' },
    ...(user?.role === 'admin' ? [{ to: '/settings', label: 'Settings', icon: '⚙️' }] : [])
  ];

  return (
    <>
    <nav className="navbar" ref={navRef}>
      <div className="nav-brand">
        <Link to="/">Bookarr</Link>
      </div>
      
      <div id="main-menu" className={`nav-links ${menuOpen ? 'open' : ''}`}>
        <Link to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        <Link to="/books" onClick={() => setMenuOpen(false)}>Library</Link>
        <Link to="/authors" onClick={() => setMenuOpen(false)}>Authors</Link>
        <Link to="/activity" onClick={() => setMenuOpen(false)}>Activity</Link>
        {user?.role === 'admin' && <Link to="/settings" onClick={() => setMenuOpen(false)}>Settings</Link>}
      </div>

      <div className="nav-actions">
        <button
          className="nav-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="main-menu"
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
        <div className="notifications" ref={notificationsRef}>
          <button className="nav-btn" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setShowNotifications(!showNotifications)}>
            🔔
            {notifications.length > 0 && (
              <span className="badge">{notifications.length}</span>
            )}
          </button>
          
          {showNotifications && (
            <div className="notifications-dropdown">
              <div className="notifications-header">
                <h3>Notifications</h3>
                {notifications.length > 0 && (
                  <button onClick={handleMarkAllRead}>Mark all read</button>
                )}
              </div>
              <div className="notifications-list">
                {notifications.length > 0 ? (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      className="notification-item"
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleMarkRead(n.id)}
                    >
                      <strong>{n.title}</strong>
                      <p>{n.message}</p>
                    </div>
                  ))
                ) : (
                  <p style={{ padding: '15px', color: '#8b98a5', textAlign: 'center', margin: 0 }}>
                    No new notifications
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="user-menu" ref={userMenuRef}>
          <button className="user-avatar" onClick={() => setShowUserMenu(!showUserMenu)}>
            {user?.username?.charAt(0).toUpperCase()}
          </button>
          
          {showUserMenu && (
            <div className="user-dropdown">
              <div className="user-dropdown-header">
                <strong>{user?.username}</strong>
                <span>{user?.email}</span>
              </div>
              <div className="user-dropdown-items">
                {user?.role === 'admin' && (
                  <button onClick={() => { setShowUserMenu(false); navigate('/settings'); }}>Settings</button>
                )}
                <button onClick={() => { logout(); setShowUserMenu(false); }}>Logout</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>

    <nav className="bottom-nav" aria-label="Primary">
      {navItems.map((item) => {
        const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav-item${active ? ' active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
};

export default Navbar;
