import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Journal from './pages/Journal';
import Accounts from './pages/Accounts';
import Users from './pages/Users';
import Tenants from './pages/Tenants';
import Audit from './pages/Audit';

// Global CSS for animations (injected once)
const globalStyle = `
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; }
`;

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/journal/:tenantId" element={<Journal />} />
                <Route path="/accounts/:tenantId" element={<Accounts />} />
                <Route path="/users" element={<Users />} />
                <Route path="/tenants" element={<Tenants />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <style>{globalStyle}</style>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </>
  );
}
