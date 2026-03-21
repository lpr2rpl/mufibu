import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getTenants, getJournalEntries } from '../api/client';

const card = {
  background: '#fff', borderRadius: 8, padding: 20,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16,
};

export default function Dashboard() {
  const { user, roles, isPowerAdmin, isAuditor } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const tenantRoles = roles.filter(r => r.scope === 'tenant');
  const tenantIds = [...new Set(tenantRoles.map(r => r.tenant_id).filter(Boolean))];

  useEffect(() => {
    const load = async () => {
      try {
        if (isPowerAdmin() || isAuditor()) {
          const { data } = await getTenants();
          setTenants(data);
        }
        const statMap = {};
        for (const tid of tenantIds) {
          try {
            const { data } = await getJournalEntries(tid, { limit: 1 });
            statMap[tid] = { recent: data };
          } catch {}
        }
        setStats(statMap);
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div>Loading dashboard...</div>;

  return (
    <div>
      <h2 style={{ marginBottom: 20, color: '#1a237e' }}>
        Welcome, {user?.full_name || user?.username}
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ ...card, borderLeft: '4px solid #1a237e' }}>
          <div style={{ fontSize: 13, color: '#888' }}>Active Roles</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1a237e', marginTop: 4 }}>
            {roles.length}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            {roles.map(r => r.role).join(', ')}
          </div>
        </div>
        {(isPowerAdmin() || isAuditor()) && (
          <div style={{ ...card, borderLeft: '4px solid #388e3c' }}>
            <div style={{ fontSize: 13, color: '#888' }}>Tenants</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#388e3c', marginTop: 4 }}>
              {tenants.length}
            </div>
          </div>
        )}
        <div style={{ ...card, borderLeft: '4px solid #f57c00' }}>
          <div style={{ fontSize: 13, color: '#888' }}>My Tenants</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f57c00', marginTop: 4 }}>
            {tenantIds.length}
          </div>
        </div>
      </div>

      {tenantIds.length > 0 && (
        <div style={card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>Quick Access</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {tenantIds.map(tid => (
              <div key={tid}>
                <Link
                  to={`/journal/${tid}`}
                  style={{
                    display: 'inline-block', padding: '8px 16px',
                    background: '#e8eaf6', color: '#1a237e', borderRadius: 6,
                    textDecoration: 'none', fontSize: 14, marginRight: 8,
                  }}
                >
                  Journal ({tid.slice(0, 8)}...)
                </Link>
                <Link
                  to={`/accounts/${tid}`}
                  style={{
                    display: 'inline-block', padding: '8px 16px',
                    background: '#e8f5e9', color: '#2e7d32', borderRadius: 6,
                    textDecoration: 'none', fontSize: 14,
                  }}
                >
                  Accounts
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {(isPowerAdmin() || isAuditor()) && tenants.length > 0 && (
        <div style={card}>
          <h3 style={{ marginBottom: 12, color: '#333' }}>All Tenants</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#666' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#666' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#666' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{t.name}</td>
                  <td style={{ padding: '8px', color: '#666' }}>{t.description || '-'}</td>
                  <td style={{ padding: '8px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 12,
                      background: t.is_active ? '#e8f5e9' : '#ffebee',
                      color: t.is_active ? '#2e7d32' : '#c62828',
                    }}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
