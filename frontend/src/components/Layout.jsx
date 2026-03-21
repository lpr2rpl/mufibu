import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const S = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220, background: '#1a237e', color: '#fff',
    display: 'flex', flexDirection: 'column', padding: '0 0 16px',
  },
  brand: {
    padding: '20px 16px 16px', fontSize: 20, fontWeight: 700,
    borderBottom: '1px solid rgba(255,255,255,0.15)', marginBottom: 8,
  },
  nav: { flex: 1 },
  navLink: (active) => ({
    display: 'block', padding: '10px 20px', color: active ? '#fff' : 'rgba(255,255,255,0.75)',
    textDecoration: 'none', background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
    borderLeft: active ? '3px solid #90caf9' : '3px solid transparent',
    fontSize: 14,
  }),
  userBar: {
    padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.15)',
    fontSize: 13, color: 'rgba(255,255,255,0.8)',
  },
  logoutBtn: {
    marginTop: 8, padding: '6px 12px', background: 'rgba(255,255,255,0.15)',
    border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', width: '100%',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column' },
  topbar: {
    background: '#fff', padding: '12px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  content: { flex: 1, padding: 24, overflowY: 'auto' },
};

export default function Layout({ children }) {
  const { user, logout, isPowerAdmin, isAuditor, roles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const tenantRoles = roles.filter(r => r.scope === 'tenant');
  const tenantIds = [...new Set(tenantRoles.map(r => r.tenant_id).filter(Boolean))];
  const activeTenant = tenantIds[0] || null;

  const handleLogout = async () => { await logout(); navigate('/login'); };

  const nav = [
    { to: '/dashboard', label: 'Dashboard' },
    activeTenant && { to: `/journal/${activeTenant}`, label: 'Journal Entries' },
    activeTenant && { to: `/accounts/${activeTenant}`, label: 'Chart of Accounts' },
    (isPowerAdmin() || roles.some(r => r.role === 'Admin')) && { to: '/users', label: 'Users & Roles' },
    isPowerAdmin() && { to: '/tenants', label: 'Tenants' },
    isAuditor() && { to: '/audit', label: 'Audit Log' },
  ].filter(Boolean);

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.brand}>MuFiBu</div>
        <nav style={S.nav}>
          {nav.map(item => (
            <Link key={item.to} to={item.to} style={S.navLink(path.startsWith(item.to))}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={S.userBar}>
          <div style={{ fontWeight: 600 }}>{user?.full_name || user?.username}</div>
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>{user?.email}</div>
          <button style={S.logoutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>
      <div style={S.main}>
        <div style={S.topbar}>
          <span style={{ fontWeight: 600, color: '#1a237e' }}>
            Financial Accounting System
          </span>
          <span style={{ fontSize: 13, color: '#888' }}>
            {roles.map(r => r.role).join(', ')}
          </span>
        </div>
        <div style={S.content}>{children}</div>
      </div>
    </div>
  );
}
