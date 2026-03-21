import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getMe } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { setLoading(false); return; }
    try {
      const { data } = await getMe();
      setUser(data);
      // Decode roles from token payload (middle part of JWT)
      const payload = JSON.parse(atob(token.split('.')[1]));
      setRoles(payload.roles || []);
    } catch {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (username, password) => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    await loadUser();
  };

  const doLogout = async () => {
    try { await apiLogout(); } catch {}
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    setRoles([]);
  };

  // Permission helpers
  const hasGlobalRole = (...names) =>
    roles.some(r => names.includes(r.role) && r.scope === 'global');

  const hasTenantRole = (tenantId, ...names) =>
    roles.some(r => names.includes(r.role) && r.tenant_id === tenantId);

  const canReadBookings = (tenantId) =>
    hasTenantRole(tenantId, 'Reader', 'Writer', 'PowerUser') || hasGlobalRole('Auditor');

  const canWriteBookings = (tenantId) =>
    hasTenantRole(tenantId, 'Writer', 'PowerUser');

  const canApprove = (tenantId) =>
    hasTenantRole(tenantId, 'Approver');

  const canManageRoles = (tenantId) =>
    hasTenantRole(tenantId, 'Admin') || hasGlobalRole('PowerAdmin');

  const isPowerAdmin = () => hasGlobalRole('PowerAdmin');
  const isAuditor = () => hasGlobalRole('Auditor');

  return (
    <AuthContext.Provider value={{
      user, roles, loading,
      login, logout: doLogout,
      hasGlobalRole, hasTenantRole,
      canReadBookings, canWriteBookings, canApprove,
      canManageRoles, isPowerAdmin, isAuditor,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
