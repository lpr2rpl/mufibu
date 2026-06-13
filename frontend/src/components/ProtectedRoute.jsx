import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, allow }) {
  const auth = useAuth();
  const { user, loading } = auth;
  const params = useParams();
  const location = useLocation();

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow(auth, params)) {
    return <Navigate to="/dashboard" replace state={{ deniedFrom: location.pathname }} />;
  }
  return children;
}
