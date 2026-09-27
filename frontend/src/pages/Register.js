import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import './Auth.css';

// The same limits the server enforces (backend/src/routes/auth.js), so a typo is explained in the
// form itself instead of arriving as a bare "400 Bad Request" in the browser console.
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;
// No TLD required: a self-hosted install often uses admin@bookarr or admin@localhost
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

const validate = ({ username, email, password }) => {
  const errors = {};
  if (username.trim().length < MIN_USERNAME) {
    errors.username = `Username must be at least ${MIN_USERNAME} characters`;
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = 'Enter a valid email address, e.g. you@example.com';
  }
  if (password.length < MIN_PASSWORD) {
    errors.password = `Password must be at least ${MIN_PASSWORD} characters`;
  }
  return errors;
};

const Register = () => {
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const update = (field) => (event) => {
    const { value } = event.target;
    setFormData((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: '' } : current));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const errors = validate(formData);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      toast.error(Object.values(errors)[0]);
      return;
    }

    setSubmitting(true);
    try {
      await register({
        username: formData.username.trim(),
        email: formData.email.trim(),
        password: formData.password
      });
      toast.success('Registration successful!');
      navigate('/');
    } catch (error) {
      // The API answers { error, errors: [...] } — show the sentence, not the status code
      const data = error.response?.data;
      const message = data?.error || data?.errors?.[0]?.msg
        || (error.response ? 'Registration failed' : 'Cannot reach the Bookarr server');
      const field = data?.errors?.[0]?.path;
      if (field) setFieldErrors({ [field]: data.errors[0].msg });
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Bookarr</h1>
        <h2>Register</h2>
        <form onSubmit={handleSubmit} noValidate>
          <input
            type="text"
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            minLength={MIN_USERNAME}
            maxLength={64}
            aria-invalid={Boolean(fieldErrors.username)}
            value={formData.username}
            onChange={update('username')}
            required
          />
          {fieldErrors.username && <div className="auth-error">{fieldErrors.username}</div>}
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={Boolean(fieldErrors.email)}
            value={formData.email}
            onChange={update('email')}
            required
          />
          {fieldErrors.email && <div className="auth-error">{fieldErrors.email}</div>}
          <input
            type="password"
            placeholder="Password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            aria-invalid={Boolean(fieldErrors.password)}
            value={formData.password}
            onChange={update('password')}
            required
          />
          {fieldErrors.password
            ? <div className="auth-error">{fieldErrors.password}</div>
            : <div className="auth-hint">At least {MIN_PASSWORD} characters</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Register'}
          </button>
        </form>
        <p>The first account created becomes the administrator.</p>
        <p>Already have an account? <Link to="/login">Login</Link></p>
      </div>
    </div>
  );
};

export default Register;
