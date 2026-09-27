import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import Navbar from './components/Navbar';

import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Books from './pages/Books';
import Authors from './pages/Authors';
import Settings from './pages/Settings/Settings';
import Calendar from './pages/Calendar';
import Activity from './pages/Activity';

import './App.css';

const queryClient = new QueryClient();

function RouteTracker() {
  const location = useLocation();
  
  useEffect(() => {
    if (location.pathname !== '/login' && location.pathname !== '/register') {
      localStorage.setItem('lastRoute', location.pathname);
    }
  }, [location]);
  
  return null;
}

function RouteRestorer() {
  const navigate = useNavigate();
  const location = useLocation();
  
  useEffect(() => {
    const lastRoute = localStorage.getItem('lastRoute');
    if (lastRoute && location.pathname === '/' && localStorage.getItem('token')) {
      navigate(lastRoute, { replace: true });
    }
  }, []);
  
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <Router>
            <RouteTracker />
            <RouteRestorer />
            <div className="app">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                
                <Route path="/*" element={
                  <PrivateRoute>
                    <Navbar />
                    <main className="main-content">
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/books" element={<Books />} />
                        <Route path="/authors" element={<Authors />} />
                        <Route path="/calendar" element={<Calendar />} />
                        <Route path="/activity" element={<Activity />} />
                        <Route path="/settings/:section?" element={<AdminRoute><Settings /></AdminRoute>} />
                        {/* System and Admin now live inside Settings; keep old links working */}
                        <Route path="/system" element={<Navigate to="/settings/system" replace />} />
                        <Route path="/admin" element={<Navigate to="/settings/users" replace />} />
                        <Route path="*" element={<Navigate to="/" />} />
                      </Routes>
                    </main>
                  </PrivateRoute>
                } />
              </Routes>
              
              <ToastContainer position="bottom-right" autoClose={3000} />
            </div>
          </Router>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
