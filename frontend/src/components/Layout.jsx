import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getTenants } from '../api/client';
import { getTenantIds } from '../utils/roles';
import { canShowAuditRoute, canShowTenantsRoute, canShowUserRoleRoute } from '../utils/permissions';

const S = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 230, background: '#1a237e', color: '#fff',
    display: 'flex', flexDirection: 'column', padding: '0 0 16px',
    flexShrink: 0,
  },
  brand: {
    padding: '20px 16px 16px', fontSize: 20, fontWeight: 700,
    borderBottom: '1px solid rgba(255,255,255,0.15)', marginBottom: 8,
    letterSpacing: 1,
  },
  nav: { flex: 1, overflowY: 'auto' },
  navSection: {
    padding: '6px 16px 2px', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 1.2, color: 'rgba(255,255,255,0.4)',
    marginTop: 8,
  },
  navLink: (active) => ({
    display: 'flex', alignItems: 'center', padding: '9px 20px',
    color: active ? '#fff' : 'rgba(255,255,255,0.72)',
    textDecoration: 'none',
    background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
    borderLeft: active ? '3px solid #90caf9' : '3px solid transparent',
    fontSize: 14, transition: 'background 0.15s',
  }),
  tenantPicker: {
    margin: '8px 12px 0',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '6px 8px',
  },
  tenantLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 },
  tenantSelect: {
    width: '100%', background: 'transparent', border: 'none',
    color: '#fff', fontSize: 13, marginTop: 4, cursor: 'pointer', outline: 'none',
  },
  userBar: {
    padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.15)',
    fontSize: 13, color: 'rgba(255,255,255,0.8)',
  },
  logoutBtn: {
    marginTop: 8, padding: '6px 12px', background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4,
    color: '#fff', cursor: 'pointer', width: '100%', fontSize: 13,
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: {
    background: '#fff', padding: '0 24px', height: 52,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  content: { flex: 1, padding: 24, overflowY: 'auto' },
};

export default function Layout({ children }) {
  const { user, logout, isPowerAdmin, isAuditor, roles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const tenantIds = getTenantIds(roles);

  // Tenant selector state
  const [tenants, setTenants] = useState([]);
  const [activeTenant, setActiveTenant] = useState(tenantIds[0] || null);

  useEffect(() => {
    if (isPowerAdmin() || isAuditor()) {
      getTenants().then(({ data }) => setTenants(data)).catch(() => {});
    }
  }, []);

  // Build display-ready tenant list
  const tenantList = tenants.length > 0
    ? tenants
    : tenantIds.map(id => ({ id, name: id.slice(0, 8) + '...' }));

  const handleLogout = async () => { await logout(); navigate('/login'); };

  const nav = [
    { section: 'Overview' },
    { to: '/dashboard', label: 'Dashboard' },
    activeTenant && { section: 'Accounting' },
    activeTenant && { to: `/journal/${activeTenant}`, label: 'Journal Entries' },
    activeTenant && { to: `/accounts/${activeTenant}`, label: 'Chart of Accounts' },
    canShowUserRoleRoute(roles) && { section: 'Administration' },
    canShowUserRoleRoute(roles) && { to: '/users', label: 'Users & Roles' },
    canShowTenantsRoute(roles) && { to: '/tenants', label: 'Tenants' },
    canShowAuditRoute(roles) && { to: '/audit', label: 'Audit Log' },
  ].filter(Boolean);

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.brand}>MuFiBu</div>

        {/* Tenant selector */}
        {tenantList.length > 1 && (
          <div style={S.tenantPicker}>
            <div style={S.tenantLabel}>Active Tenant</div>
            <select
              style={S.tenantSelect}
              value={activeTenant || ''}
              onChange={e => {
                setActiveTenant(e.target.value);
                // Navigate to same page type for new tenant if we're on a tenant-scoped page
                const journalMatch = path.match(/^\/journal\//);
                const accountsMatch = path.match(/^\/accounts\//);
                if (journalMatch)  navigate(`/journal/${e.target.value}`);
                if (accountsMatch) navigate(`/accounts/${e.target.value}`);
              }}
            >
              {tenantList.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        <nav style={S.nav}>
          {nav.map((item, i) =>
            item.section ? (
              <div key={`sec-${i}`} style={S.navSection}>{item.section}</div>
            ) : (
              <Link key={item.to} to={item.to} style={S.navLink(path.startsWith(item.to))}>
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div style={S.userBar}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.full_name || user?.username}
          </div>
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button style={S.logoutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <div style={S.main}>
        <div style={S.topbar}>
          <span style={{ fontWeight: 600, color: '#1a237e', fontSize: 15 }}>
            Financial Accounting System
          </span>
          <span style={{ fontSize: 12, color: '#888', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {roles.map((r, i) => (
              <span key={i} style={{
                padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                background: r.scope === 'global' ? '#e8eaf6' : '#f3e5f5',
                color: r.scope === 'global' ? '#283593' : '#6a1b9a',
              }}>
                {r.role}
              </span>
            ))}
          </span>
        </div>
        <div style={S.content}>{children}</div>
      </div>
    </div>
  );
}
