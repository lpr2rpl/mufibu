import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const S = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a237e 0%, #283593 100%)',
  },
  card: {
    background: '#fff', borderRadius: 8, padding: '40px 36px', width: 360,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  logo: { textAlign: 'center', marginBottom: 28, color: '#1a237e' },
  h1: { fontSize: 28, fontWeight: 700, margin: 0 },
  sub: { fontSize: 13, color: '#888', marginTop: 4 },
  field: { marginBottom: 18 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#444' },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 6,
    fontSize: 14, outline: 'none', transition: 'border-color 0.2s',
  },
  btn: {
    width: '100%', padding: '12px', background: '#1a237e', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  error: {
    background: '#ffebee', color: '#c62828', padding: '10px 12px',
    borderRadius: 6, fontSize: 13, marginBottom: 16,
  },
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.h1}>MuFiBu</div>
          <div style={S.sub}>Multi-Tenant Financial Accounting</div>
        </div>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label}>Username or Email</label>
            <input
              style={S.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input
              style={S.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button style={S.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
