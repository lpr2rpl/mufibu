import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getTenants, getTrialBalance, getIncomeStatement, getBalanceSheet } from '../api/client';
import Spinner from '../components/Spinner';
import { getTenantIds, truncateId } from '../utils/roles';
import { card, th, td } from '../styles/common';

const S = { card, th, td };

const btnStyle = {
  padding: '6px 14px', background: '#1a237e', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
};

function ReportSection({ title, onLoad, loading, children, extra }) {
  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 14px', fontSize: 15, color: '#333' }}>{title}</h3>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {extra}
        <button style={btnStyle} onClick={onLoad} disabled={loading}>
          Load
        </button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
      ) : children}
    </div>
  );
}

function MonoCell({ value, color }) {
  return (
    <td style={{ ...S.td, fontFamily: 'monospace', textAlign: 'right', color: color || 'inherit' }}>
      {Number(value).toFixed(2)}
    </td>
  );
}

export default function Reports() {
  const { roles, isPowerAdmin, isAuditor } = useAuth();
  const toast = useToast();
  const tenantIds = getTenantIds(roles);

  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [asOfDate, setAsOfDate] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [trialBalance, setTrialBalance] = useState(null);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [tbLoading, setTbLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [bsLoading, setBsLoading] = useState(false);
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
  const effectiveTenants = tenantList.length > 0 ? tenantList : tenantIds.map(id => ({ id, name: truncateId(id) }));

  const handleTenantChange = (e) => {
    setSelectedTenant(e.target.value);
    setTrialBalance(null);
    setIncomeStatement(null);
    setBalanceSheet(null);
  };

  const handleDateChange = (e) => {
    setAsOfDate(e.target.value);
    setTrialBalance(null);
    setIncomeStatement(null);
    setBalanceSheet(null);
  };

  const handleFromDateChange = (e) => {
    setFromDate(e.target.value);
    setIncomeStatement(null);
  };

  const handleLoadTrialBalance = async () => {
    if (!selectedTenant) return;
    setTbLoading(true);
    setTrialBalance(null);
    try {
      const { data } = await getTrialBalance(selectedTenant, asOfDate || undefined);
      setTrialBalance(data);
    } catch {
      toast.error('Failed to load trial balance');
    }
    setTbLoading(false);
  };

  const handleLoadIncomeStatement = async () => {
    if (!selectedTenant) return;
    setIsLoading(true);
    setIncomeStatement(null);
    try {
      const { data } = await getIncomeStatement(selectedTenant, asOfDate || undefined, fromDate || undefined);
      setIncomeStatement(data);
    } catch {
      toast.error('Failed to load income statement');
    }
    setIsLoading(false);
  };

  const handleLoadBalanceSheet = async () => {
    if (!selectedTenant) return;
    setBsLoading(true);
    setBalanceSheet(null);
    try {
      const { data } = await getBalanceSheet(selectedTenant, asOfDate || undefined);
      setBalanceSheet(data);
    } catch {
      toast.error('Failed to load balance sheet');
    }
    setBsLoading(false);
  };

  if (tenantsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ color: '#1a237e', marginBottom: 4 }}>Reports</h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Financial reports for your accounting tenants.
      </p>

      {/* Shared controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {effectiveTenants.length > 1 && (
          <select
            style={{ fontSize: 13, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 4 }}
            value={selectedTenant || ''}
            onChange={handleTenantChange}
          >
            {effectiveTenants.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <label style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
          As of date:
          <input
            type="date"
            value={asOfDate}
            onChange={handleDateChange}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4 }}
          />
        </label>
        {asOfDate && (
          <button
            onClick={() => { setAsOfDate(''); setTrialBalance(null); setIncomeStatement(null); setBalanceSheet(null); }}
            style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', background: '#f5f5f5', color: '#555' }}
          >
            Clear date
          </button>
        )}
      </div>

      {/* Trial Balance */}
      <ReportSection title="Trial Balance" onLoad={handleLoadTrialBalance} loading={tbLoading}>
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
                  <MonoCell value={r.debit_total} />
                  <MonoCell value={r.credit_total} />
                  <MonoCell value={r.net} color={Number(r.net) < 0 ? '#c62828' : '#2e7d32'} />
                </tr>
              ))}
              {trialBalance.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#888' }}>No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ReportSection>

      {/* Income Statement */}
      <ReportSection title="Income Statement (P&amp;L)" onLoad={handleLoadIncomeStatement} loading={isLoading}
        extra={
          <label style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
            From:
            <input type="date" value={fromDate} onChange={handleFromDateChange}
              style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4 }} />
          </label>
        }
      >
        {incomeStatement && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Number', 'Name', 'Net'].map(h => <th key={h} style={{ ...S.th, fontSize: 12 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td colSpan={3} style={{ ...S.td, fontWeight: 700, background: '#f5f5f5', color: '#1a237e' }}>Revenue</td></tr>
              {incomeStatement.revenue.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <MonoCell value={r.net} color="#2e7d32" />
                </tr>
              ))}
              {incomeStatement.revenue.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, color: '#888', textAlign: 'center' }}>No revenue accounts.</td></tr>
              )}
              <tr><td colSpan={3} style={{ ...S.td, fontWeight: 700, background: '#f5f5f5', color: '#1a237e' }}>Expenses</td></tr>
              {incomeStatement.expense.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <MonoCell value={r.net} color="#c62828" />
                </tr>
              ))}
              {incomeStatement.expense.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, color: '#888', textAlign: 'center' }}>No expense accounts.</td></tr>
              )}
              <tr style={{ borderTop: '2px solid #1a237e' }}>
                <td colSpan={2} style={{ ...S.td, fontWeight: 700 }}>Net Income</td>
                <MonoCell value={incomeStatement.net_income} color={Number(incomeStatement.net_income) >= 0 ? '#2e7d32' : '#c62828'} />
              </tr>
            </tbody>
          </table>
        )}
      </ReportSection>

      {/* Balance Sheet */}
      <ReportSection title="Balance Sheet" onLoad={handleLoadBalanceSheet} loading={bsLoading}>
        {balanceSheet && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Number', 'Name', 'Net'].map(h => <th key={h} style={{ ...S.th, fontSize: 12 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {/* Assets */}
              <tr><td colSpan={3} style={{ ...S.td, fontWeight: 700, background: '#f5f5f5', color: '#1a237e' }}>Assets</td></tr>
              {balanceSheet.assets.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <MonoCell value={r.net} />
                </tr>
              ))}
              {balanceSheet.assets.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, color: '#888', textAlign: 'center' }}>No asset accounts.</td></tr>
              )}
              <tr style={{ background: '#e8eaf6' }}>
                <td colSpan={2} style={{ ...S.td, fontWeight: 700 }}>Total Assets</td>
                <MonoCell value={balanceSheet.total_assets} color="#1a237e" />
              </tr>
              {/* Liabilities */}
              <tr><td colSpan={3} style={{ ...S.td, fontWeight: 700, background: '#f5f5f5', color: '#1a237e' }}>Liabilities</td></tr>
              {balanceSheet.liabilities.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <MonoCell value={r.net} />
                </tr>
              ))}
              {balanceSheet.liabilities.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, color: '#888', textAlign: 'center' }}>No liability accounts.</td></tr>
              )}
              <tr style={{ background: '#e8eaf6' }}>
                <td colSpan={2} style={{ ...S.td, fontWeight: 700 }}>Total Liabilities</td>
                <MonoCell value={balanceSheet.total_liabilities} color="#1a237e" />
              </tr>
              {/* Equity */}
              <tr><td colSpan={3} style={{ ...S.td, fontWeight: 700, background: '#f5f5f5', color: '#1a237e' }}>Equity</td></tr>
              {balanceSheet.equity.map(r => (
                <tr key={r.account_id}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.account_number}</td>
                  <td style={S.td}>{r.name}</td>
                  <MonoCell value={r.net} />
                </tr>
              ))}
              {balanceSheet.equity.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, color: '#888', textAlign: 'center' }}>No equity accounts.</td></tr>
              )}
              <tr style={{ background: '#e8eaf6' }}>
                <td colSpan={2} style={{ ...S.td, fontWeight: 700 }}>Total Equity</td>
                <MonoCell value={balanceSheet.total_equity} color="#1a237e" />
              </tr>
              {/* Summary */}
              <tr style={{ borderTop: '2px solid #1a237e' }}>
                <td colSpan={3} style={{ ...S.td, fontSize: 12, color: '#555', textAlign: 'right' }}>
                  Assets ({Number(balanceSheet.total_assets).toFixed(2)}) = Liabilities ({Number(balanceSheet.total_liabilities).toFixed(2)}) + Equity ({Number(balanceSheet.total_equity).toFixed(2)})
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </ReportSection>
    </div>
  );
}
