import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAuditLog } from '../api/client';

const S = {
  card: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#666', borderBottom: '2px solid #eee', fontSize: 13 },
  td: { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f5f5f5' },
  input: { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 },
};

const ACTION_COLORS = {
  INSERT: '#e8f5e9', UPDATE: '#e3f2fd', SOFT_DELETE: '#ffebee',
  LOGIN: '#f3e5f5', LOGOUT: '#fff3e0', APPROVE: '#e8f5e9',
  REJECT: '#ffebee', ROLE_ASSIGN: '#e8eaf6', ROLE_REVOKE: '#fff8e1',
  TENANT_CREATE: '#e8f5e9', PHASE_EXTEND: '#e3f2fd',
};

export default function Audit() {
  const { isAuditor, isPowerAdmin, roles } = useAuth();
  // Officers can read audit log for their assigned tenants
  const officerTenantIds = roles.filter(r => r.role === 'Officer').map(r => r.tenant_id).filter(Boolean);
  const isOfficer = officerTenantIds.length > 0;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [table, setTable] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: page * limit, limit };
      if (action) params.action = action;
      if (table) params.table_name = table;
      const { data } = await getAuditLog(params);
      setEntries(data);
    } catch (e) { setError(e.response?.data?.detail || 'Failed to load audit log'); }
    setLoading(false);
  }, [action, table, page]);

  useEffect(() => { load(); }, [load]);

  if (!isAuditor() && !isPowerAdmin() && !isOfficer) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Access denied. Auditor, PowerAdmin, or Officer role required.</div>;
  }

  const ACTIONS = ['INSERT', 'UPDATE', 'SOFT_DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'ROLE_ASSIGN', 'ROLE_REVOKE', 'TENANT_CREATE', 'PHASE_EXTEND'];
  const TABLES = ['users', 'tenants', 'user_role_assignments', 'accounts', 'journal_entries'];

  return (
    <div>
      <h2 style={{ color: '#1a237e', marginBottom: 20 }}>Audit Log</h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={action} onChange={e => { setAction(e.target.value); setPage(0); }} style={S.input}>
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={table} onChange={e => { setTable(e.target.value); setPage(0); }} style={S.input}>
          <option value="">All tables</option>
          {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => load()} style={{ ...S.input, background: '#1a237e', color: '#fff', cursor: 'pointer', border: 'none' }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ background: '#ffebee', color: '#c62828', padding: 12, borderRadius: 6, marginBottom: 16 }}>{error}</div>}

      <div style={S.card}>
        {loading ? <div>Loading...</div> : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Timestamp', 'Action', 'Table', 'Record', 'User', 'Tenant', 'Notes'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {entries.length === 0 && (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#999', padding: 24 }}>No audit entries</td></tr>
                )}
                {entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {new Date(e.occurred_at).toLocaleString()}
                    </td>
                    <td style={S.td}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: ACTION_COLORS[e.action] || '#f5f5f5',
                      }}>{e.action}</span>
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.table_name || '-'}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
                      {e.record_id ? e.record_id.slice(0, 8) + '...' : '-'}
                    </td>
                    <td style={{ ...S.td, fontSize: 12 }}>{e.user_id ? e.user_id.slice(0, 8) + '...' : '-'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{e.tenant_id ? e.tenant_id.slice(0, 8) + '...' : '-'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#666', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.notes || (e.new_values ? JSON.stringify(e.new_values).slice(0, 60) : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>
                Previous
              </button>
              <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={entries.length < limit}
                style={{ padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
