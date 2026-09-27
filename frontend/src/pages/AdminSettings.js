import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import './AdminSettings.css';

// `embedded`: rendered inside Settings → User management (no page title)
const AdminSettings = ({ embedded = false }) => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  // Use the shared axios client (correct host, auth header, non-2xx -> throw)
  // instead of fetch() against a hard-coded localhost URL.
  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error(error.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    try {
      const { username, email, role } = updates;
      const { data: updated } = await api.put(`/admin/users/${userId}`, { username, email, role });
      setUsers(prev => prev.map(u => u.id === userId ? updated : u));
      setEditingUser(null);
    } catch (error) {
      console.error('Failed to update user:', error);
      toast.error(error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await api.delete(`/admin/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast.error(error.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      
      toast.success('Password changed successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      setPasswordError(error.response?.data?.error || error.message);
    }
  };

  if (user?.role !== 'admin') {
    return <div className="admin-settings"><p>Access denied. Admin only.</p></div>;
  }

  if (loading) {
    return <div className="admin-settings"><p>Loading...</p></div>;
  }

  return (
    <div className="admin-settings">
      {!embedded && <h1>User Management</h1>}
      
      <div className="password-section">
        <h2>Change Password</h2>
        <form onSubmit={handleChangePassword} className="password-form">
          {passwordError && <div className="error">{passwordError}</div>}
          <input
            type="password"
            placeholder="Current Password"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="New Password"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Confirm New Password"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            required
          />
          <button type="submit">Change Password</button>
        </form>
      </div>
      
      <div className="users-section">
        <h2>User Management</h2>
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>
                  {editingUser === u.id ? (
                    <select
                      defaultValue={u.role}
                      onChange={(e) => handleUpdateUser(u.id, { ...u, role: e.target.value })}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className={`role-badge ${u.role}`}>{u.role}</span>
                  )}
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => setEditingUser(editingUser === u.id ? null : u.id)}>
                    {editingUser === u.id ? 'Cancel' : 'Edit'}
                  </button>
                  {u.id !== user.id && (
                    <button onClick={() => handleDeleteUser(u.id)} className="delete-btn">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminSettings;
