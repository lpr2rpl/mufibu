import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getMe } from '../api/client';
import {
  canApproveBookings as canApproveBookingsForRoles,
  canManageRoles as canManageRolesForRoles,
  canPostJournalEntry as canPostJournalEntryForRoles,
  canReadAccounts as canReadAccountsForRoles,
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

  // Tokens live in httpOnly cookies; the session (user + roles) is fetched
  // from the backend, which reads those cookies.  Nothing is kept in
  // localStorage, and the JWT is never read by JavaScript.
  const loadUser = useCallback(async () => {
    try {
      const { data } = await getMe();
      setUser(data.user);
      setRoles(data.roles || []);
    } catch {
      setUser(null);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (username, password) => {
    const { data } = await apiLogin(username, password);
    setUser(data.user);
    setRoles(data.roles || []);
  };

  const doLogout = async () => {
    try { await apiLogout(); } catch {}
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

  const canReadAccounts = (tenantId) =>
    canReadAccountsForRoles(roles, tenantId);

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
      canManageRoles, canReadAccounts, canWriteAccounts, canPostJournalEntry,
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
