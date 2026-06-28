import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getTenants, getTrialBalance } from '../api/client';
import Spinner from '../components/Spinner';
import { getTenantIds, truncateId } from '../utils/roles';
import { card, th, td } from '../styles/common';

const S = { card, th, td };

export default function Reports() {
  const { roles, isPowerAdmin, isAuditor } = useAuth();
  const toast = useToast();
  const tenantIds = getTenantIds(roles);

  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tenantsLoading, setTenantsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (isPowerAdmin() || isAuditor()) {
          const { data } = await getTenants();
          setTenants(data);
          if (data.length > 0 && tenantIds.length === 0) {
            setSelectedTenant(data[0].id);
          }
        }
      } catch {
        toast.error('Failed to load tenants');
      }
      const firstTenant = tenantIds[0] || null;
      setSelectedTenant(prev => prev || firstTenant);
      setTenantsLoading(false);
    };
    load();
  }, []);

  const tenantList = tenants.length > 0
    ? tenants.filter(t => tenantIds.length === 0 || tenantIds.includes(t.id))
    : tenantIds.map(id => ({ id, name: truncateId(id) }));

  const handleLoadTrialBalance = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    setTrialBalance(null);
    try {
      const { data } = await getTrialBalance(selectedTenant);
      setTrialBalance(data);
    } catch {
      toast.error('Failed to load trial balance');
    }
    setLoading(false);
  };

  if (tenantsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner size={40} />
      </div>
    );
  }

  const effectiveTenants = tenantList.length > 0 ? tenantList : tenantIds.map(id => ({ id, name: truncateId(id) }));

  return (
    <div>
      <h2 style={{ color: '#1a237e', marginBottom: 4 }}>Reports</h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>
        Financial reports for your accounting tenants.
      </p>

      <div style={S.card}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, color: '#333' }}>Trial Balance</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          {effectiveTenants.length > 1 && (
            <select
              style={{ fontSize: 13, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 4 }}
              value={selectedTenant || ''}
              onChange={e => { setSelectedTenant(e.target.value); setTrialBalance(null); }}
            >
              {effectiveTenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <button
            style={{
              padding: '6px 14px', background: '#1a237e', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}
            onClick={handleLoadTrialBalance}
            disabled={!selectedTenant || loading}
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>

        {trialBalance && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Number', 'Name', 'Type', 'Debit', 'Credit', 'Net'].map(h => (
                  <th key={h} style={{ ...S.th, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trialBalance.map(r => (
                <tr key={r.account_id} style={{ opacity: Number(r.debit_total) === 0 && Number(r.credit_total) === 0 ? 0.4 : 1 }}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#888' }}>{r.account_type}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', textAlign: 'right' }}>{Number(r.debit_total).toFixed(2)}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', textAlign: 'right' }}>{Number(r.credit_total).toFixed(2)}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', textAlign: 'right', color: Number(r.net) < 0 ? '#c62828' : '#2e7d32' }}>
                    {Number(r.net).toFixed(2)}
                  </td>
                </tr>
              ))}
              {trialBalance.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#888' }}>No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...S.card, color: '#888', fontSize: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#333' }}>More reports coming soon</h3>
        <p style={{ margin: 0 }}>Income statement, balance sheet, and cash flow statement are planned.</p>
      </div>
    </div>
  );
}
