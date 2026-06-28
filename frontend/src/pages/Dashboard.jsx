import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getTenants, getJournalEntriesPage, getAccountsPage } from '../api/client';
import Spinner from '../components/Spinner';
import Badge from '../components/Badge';
import { getTenantIds, truncateId } from '../utils/roles';
import { card, th, td } from '../styles/common';

const S = {
  card,
  statCard: (color) => ({
    ...card, marginBottom: 0,
    borderLeft: `4px solid ${color}`,
  }),
  th,
  td,
  quickLink: (color, bg) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', background: bg, color,
    borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 500,
  }),
};

function StatCard({ label, value, color, sub }) {
  return (
    <div style={S.statCard(color)}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user, roles, isPowerAdmin, isAuditor } = useAuth();
  const toast = useToast();
  const [tenants, setTenants] = useState([]);
  const [recentByTenant, setRecentByTenant] = useState({});
  const [statusCountsByTenant, setStatusCountsByTenant] = useState({});
  const [accountCountByTenant, setAccountCountByTenant] = useState({});
  const [loading, setLoading] = useState(true);

  const tenantIds = getTenantIds(roles);

  useEffect(() => {
    const load = async () => {
      const promises = [];

      if (isPowerAdmin() || isAuditor()) {
        promises.push(
          getTenants()
            .then(({ data }) => setTenants(data))
            .catch(() => toast.error('Failed to load tenants'))
        );
      }

      promises.push(
        Promise.all(
          tenantIds.map(tid =>
            getJournalEntriesPage(tid, { limit: 5, skip: 0 })
              .then(({ data }) => [tid, data.items || []])
              .catch(() => [tid, []])
          )
        ).then(results => {
          const map = {};
          results.forEach(([tid, items]) => { map[tid] = items; });
          setRecentByTenant(map);
        })
      );

      const STATUSES = ['draft', 'pending_approval', 'approved', 'posted', 'rejected'];
      promises.push(
        Promise.all(
          tenantIds.map(tid =>
            Promise.all(
              STATUSES.map(s =>
                getJournalEntriesPage(tid, { limit: 1, skip: 0, status: s })
                  .then(({ data }) => [s, data.total || 0])
                  .catch(() => [s, 0])
              )
            ).then(pairs => [tid, Object.fromEntries(pairs)])
          )
        ).then(results => {
          const map = {};
          results.forEach(([tid, counts]) => { map[tid] = counts; });
          setStatusCountsByTenant(map);
        })
      );

      promises.push(
        Promise.all(
          tenantIds.map(tid =>
            getAccountsPage(tid, { limit: 1, skip: 0 })
              .then(({ data }) => [tid, data.total || 0])
              .catch(() => [tid, 0])
          )
        ).then(results => {
          const map = {};
          results.forEach(([tid, count]) => { map[tid] = count; });
          setAccountCountByTenant(map);
        })
      );

      await Promise.all(promises);
      setLoading(false);
    };
    load();
  }, []);

  const totalRecent = Object.values(recentByTenant).reduce((s, arr) => s + arr.length, 0);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <Spinner size={40} />
      </div>
    );
  }

  const hasTenantAccess = tenantIds.length > 0;

  return (
    <div>
      <h2 style={{ marginBottom: 4, color: '#1a237e', fontWeight: 700 }}>
        Welcome back, {user?.full_name || user?.username}
      </h2>
      <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
        Here's an overview of your accounting workspace.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard
          label="Active Roles"
          value={roles.length}
          color="#1a237e"
          sub={roles.map(r => r.role).join(', ')}
        />
        {(isPowerAdmin() || isAuditor()) && (
          <StatCard label="Total Tenants" value={tenants.length} color="#388e3c" />
        )}
        {hasTenantAccess && (
          <StatCard label="My Tenants" value={tenantIds.length} color="#f57c00" />
        )}
        {hasTenantAccess && (
          <StatCard label="Recent Entries" value={totalRecent} color="#6a1b9a" sub="Last 5 per tenant" />
        )}
      </div>

      {hasTenantAccess && tenantIds.map(tid => {
        const counts = statusCountsByTenant[tid];
        const accCount = accountCountByTenant[tid];
        const t = tenants.find(x => x.id === tid);
        const tName = t ? t.name : truncateId(tid);
        if (!counts) return null;
        return (
          <div key={`summary-${tid}`} style={S.card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#333' }}>
              Summary &mdash; {tName}
            </h3>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
              <div>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>Accounts</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1a237e' }}>{accCount ?? '\u2014'}</div>
              </div>
              {[
                ['Draft', 'draft', '#757575'],
                ['Pending', 'pending_approval', '#f57c00'],
                ['Approved', 'approved', '#388e3c'],
                ['Posted', 'posted', '#1a237e'],
                ['Rejected', 'rejected', '#c62828'],
              ].map(([label, key, color]) => (
                <div key={key}>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{counts[key] ?? 0}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {hasTenantAccess && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, color: '#333' }}>Quick Access</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tenantIds.map(tid => {
              const t = tenants.find(x => x.id === tid);
              const label = t ? t.name : truncateId(tid);
              return (
                <React.Fragment key={tid}>
                  <Link to={`/journal/${tid}`} style={S.quickLink('#1a237e', '#e8eaf6')}>
                    Journal &mdash; {label}
                  </Link>
                  <Link to={`/accounts/${tid}`} style={S.quickLink('#2e7d32', '#e8f5e9')}>
                    Accounts &mdash; {label}
                  </Link>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {tenantIds.map(tid => {
        const entries = recentByTenant[tid] || [];
        if (!entries.length) return null;
        const t = tenants.find(x => x.id === tid);
        const tName = t ? t.name : truncateId(tid);
        return (
          <div key={tid} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: '#333' }}>Recent Entries &mdash; {tName}</h3>
              <Link to={`/journal/${tid}`} style={{ fontSize: 13, color: '#1a237e', textDecoration: 'none' }}>
                View all &rarr;
              </Link>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['#', 'Date', 'Description', 'Amount', 'Status'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.entry_number}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                    <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.description}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td style={S.td}><Badge label={e.status} variant={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {(isPowerAdmin() || isAuditor()) && tenants.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#333' }}>All Tenants</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['Name', 'Description', 'Status'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{t.name}</td>
                  <td style={{ ...S.td, color: '#666' }}>{t.description || '\u2014'}</td>
                  <td style={S.td}>
                    <Badge label={t.is_active ? 'Active' : 'Inactive'} variant={t.is_active ? 'active' : 'inactive'} />
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
