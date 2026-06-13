import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getAuditLog } from '../api/client';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { truncateId } from '../utils/roles';
import { apiError } from '../utils/apiError';
import { card, th, td, input, btn } from '../styles/common';

const S = { card, th, td, input, btn };

const ACTION_COLORS = {
  INSERT: '#e8f5e9', UPDATE: '#e3f2fd', SOFT_DELETE: '#ffebee',
  LOGIN: '#f3e5f5', LOGOUT: '#fff3e0', APPROVE: '#e8f5e9',
  REJECT: '#ffebee', ROLE_ASSIGN: '#e8eaf6', ROLE_REVOKE: '#fff8e1',
  TENANT_CREATE: '#e8f5e9', PHASE_EXTEND: '#e3f2fd',
};

const LIMIT = 50;
const ACTIONS = ['INSERT', 'UPDATE', 'SOFT_DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'ROLE_ASSIGN', 'ROLE_REVOKE', 'TENANT_CREATE', 'PHASE_EXTEND'];
const TABLES  = ['users', 'tenants', 'user_role_assignments', 'accounts', 'journal_entries'];

export default function Audit() {
  const { isAuditor, isPowerAdmin, roles } = useAuth();
  const toast = useToast();
  const isOfficer = roles.some(r => r.role === 'Officer');
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
      toast.error(apiError(e, 'Failed to load audit log'));
    }
    setLoading(false);
  }, [action, table, page]);

  useEffect(() => { load(); }, [load]);

  if (!isAuditor() && !isPowerAdmin() && !isOfficer) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Access denied. Auditor, PowerAdmin, or Officer role required.</div>;
  }

  return (
    <div>
      <h2 style={{ color: '#1a237e', marginBottom: 20 }}>Audit Log</h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={action} onChange={e => { setAction(e.target.value); setPage(0); }}
          style={{ ...S.input, width: 'auto' }}>
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={table} onChange={e => { setTable(e.target.value); setPage(0); }}
          style={{ ...S.input, width: 'auto' }}>
          <option value="">All tables</option>
          {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={load} style={S.btn()}>Refresh</button>
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
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.table_name || '\u2014'}</td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
                        {truncateId(e.record_id)}
                      </td>
                      <td style={{ ...S.td, fontSize: 12 }}>{truncateId(e.user_id)}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{truncateId(e.tenant_id)}</td>
                      <td style={{ ...S.td, fontSize: 12, color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={e.notes || (e.new_values ? JSON.stringify(e.new_values) : '')}>
                        {e.notes || (e.new_values ? JSON.stringify(e.new_values).slice(0, 60) : '\u2014')}
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
