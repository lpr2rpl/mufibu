import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getMe } from '../api/client';
import {
  canApproveBookings as canApproveBookingsForRoles,
  canManageRoles as canManageRolesForRoles,
  canPostJournalEntry as canPostJournalEntryForRoles,
  canReadBookings as canReadBookingsForRoles,
  canWriteAccounts as canWriteAccountsForRoles,
  canWriteBookings as canWriteBookingsForRoles,
  hasGlobalRole as hasGlobalRoleForRoles,
  hasTenantRole as hasTenantRoleForRoles,
} from '../utils/permissions';

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
    hasGlobalRoleForRoles(roles, ...names);

  const hasTenantRole = (tenantId, ...names) =>
    hasTenantRoleForRoles(roles, tenantId, ...names);

  const canReadBookings = (tenantId) =>
    canReadBookingsForRoles(roles, tenantId);

  const canWriteBookings = (tenantId) =>
    canWriteBookingsForRoles(roles, tenantId);

  const canApprove = (tenantId) =>
    canApproveBookingsForRoles(roles, tenantId);

  const canManageRoles = (tenantId) =>
    canManageRolesForRoles(roles, tenantId);

  const canWriteAccounts = (tenantId) =>
    canWriteAccountsForRoles(roles, tenantId);

  const canPostJournalEntry = (tenantId) =>
    canPostJournalEntryForRoles(roles, tenantId);

  const isPowerAdmin = () => hasGlobalRole('PowerAdmin');
  const isAuditor = () => hasGlobalRole('Auditor');

  return (
    <AuthContext.Provider value={{
      user, roles, loading,
      login, logout: doLogout,
      hasGlobalRole, hasTenantRole,
      canReadBookings, canWriteBookings, canApprove,
      canManageRoles, canWriteAccounts, canPostJournalEntry,
      isPowerAdmin, isAuditor,
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
