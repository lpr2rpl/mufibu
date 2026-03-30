import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getAuditLog } from '../api/client';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { truncateId } from '../utils/roles';

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

const LIMIT = 50;

export default function Audit() {
  const { isAuditor, isPowerAdmin, roles } = useAuth();
  const toast = useToast();
  const officerTenantIds = roles.filter(r => r.role === 'Officer').map(r => r.tenant_id).filter(Boolean);
  const isOfficer = officerTenantIds.length > 0;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [table, setTable] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: page * LIMIT, limit: LIMIT };
      if (action) params.action = action;
      if (table) params.table_name = table;
      const { data } = await getAuditLog(params);
      setEntries(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load audit log');
    }
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

      <div style={S.card}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : (
          <>
            {entries.length === 0 ? (
              <EmptyState message="No audit entries match the current filters." />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Timestamp', 'Action', 'Table', 'Record', 'User', 'Tenant', 'Notes'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 12 }}>
                        {new Date(e.occurred_at).toLocaleString()}
                      </td>
                      <td style={S.td}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: ACTION_COLORS[e.action] || '#f5f5f5',
                        }}>{e.action}</span>
                      </td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.table_name || '—'}</td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
                        {truncateId(e.record_id)}
                      </td>
                      <td style={{ ...S.td, fontSize: 12 }}>{truncateId(e.user_id)}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{truncateId(e.tenant_id)}</td>
                      <td style={{ ...S.td, fontSize: 12, color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={e.notes || (e.new_values ? JSON.stringify(e.new_values) : '')}>
                        {e.notes || (e.new_values ? JSON.stringify(e.new_values).slice(0, 60) : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pagination page={page} onPage={setPage} hasMore={entries.length === LIMIT} />
          </>
        )}
      </div>
    </div>
  );
}
