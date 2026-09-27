import React, { createContext, useContext, useEffect, useState } from 'react';
import io from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

// Mirror services/api.js: REACT_APP_API_URL points at ".../api"; otherwise the
// backend runs on port 5000 of the host serving the UI. Hard-coding localhost
// broke real-time updates for anyone not browsing on the server itself.
const getSocketUrl = () => {
  if (process.env.REACT_APP_SOCKET_URL) return process.env.REACT_APP_SOCKET_URL;
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL.replace(/\/api\/?$/, '');
  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:5000` : origin;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const newSocket = io(getSocketUrl(), { auth: { token: localStorage.getItem('token') } });
      setSocket(newSocket);

      return () => newSocket.close();
    }
    setSocket(null);
  }, [user]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
