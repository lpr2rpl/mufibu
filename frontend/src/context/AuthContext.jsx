import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { login as apiLogin, logout as apiLogout, getMe, refreshTokens } from '../api/client';
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
  const [accessExpiresAt, setAccessExpiresAt] = useState(null);
  const [sessionExpiring, setSessionExpiring] = useState(false);
  const warningTimerRef = useRef(null);

  const _scheduleWarning = useCallback((expiresAt) => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    setSessionExpiring(false);
    if (!expiresAt) return;
    const msUntilWarning = new Date(expiresAt).getTime() - Date.now() - 5 * 60 * 1000;
    if (msUntilWarning > 0) {
      warningTimerRef.current = setTimeout(() => setSessionExpiring(true), msUntilWarning);
    }
  }, []);

  // Tokens live in httpOnly cookies; the session (user + roles) is fetched
  // from the backend, which reads those cookies.  Nothing is kept in
  // localStorage, and the JWT is never read by JavaScript.
  const loadUser = useCallback(async () => {
    try {
      const { data } = await getMe();
      setUser(data.user);
      setRoles(data.roles || []);
      setAccessExpiresAt(data.access_expires_at || null);
      _scheduleWarning(data.access_expires_at || null);
    } catch {
      setUser(null);
      setRoles([]);
      setAccessExpiresAt(null);
    } finally {
      setLoading(false);
    }
  }, [_scheduleWarning]);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (username, password) => {
    const { data } = await apiLogin(username, password);
    setUser(data.user);
    setRoles(data.roles || []);
    setAccessExpiresAt(data.access_expires_at || null);
    _scheduleWarning(data.access_expires_at || null);
  };

  const doLogout = async () => {
    try { await apiLogout(); } catch {}
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setUser(null);
    setRoles([]);
    setAccessExpiresAt(null);
    setSessionExpiring(false);
  };

  const extendSession = async () => {
    try {
      const { data } = await refreshTokens();
      setAccessExpiresAt(data.access_expires_at || null);
      _scheduleWarning(data.access_expires_at || null);
    } catch {
      doLogout();
    }
  };

  const dismissSessionWarning = () => setSessionExpiring(false);

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
      sessionExpiring, extendSession, dismissSessionWarning,
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
