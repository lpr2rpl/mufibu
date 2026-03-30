import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getAccounts, createAccount, updateAccount } from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const S = {
  card: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 16 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#777', borderBottom: '2px solid #eee', fontSize: 12, fontWeight: 700 },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f5f5f5' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 },
  btn: (c) => ({ padding: '7px 14px', background: c || '#1a237e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }),
};

const TYPE_COLORS = {
  asset: ['#e3f2fd', '#1565c0'],
  liability: ['#fff3e0', '#e65100'],
  equity: ['#f3e5f5', '#6a1b9a'],
  revenue: ['#e8f5e9', '#2e7d32'],
  expense: ['#ffebee', '#c62828'],
};


export default function Accounts() {
  const { tenantId } = useParams();
  const { hasTenantRole, isPowerAdmin } = useAuth();
  const toast = useToast();
  const canWrite = hasTenantRole(tenantId, 'PowerUser', 'Admin') || isPowerAdmin();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editAcct, setEditAcct] = useState(null);
  const emptyForm = { account_number: '', name: '', account_type: 'asset', description: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAccounts(tenantId, { active_only: false });
      setAccounts(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load accounts');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editAcct) {
        await updateAccount(tenantId, editAcct.id, { name: form.name, description: form.description });
        toast.success('Account updated.');
      } else {
        await createAccount(tenantId, form);
        toast.success('Account created.');
      }
      setShowForm(false); setEditAcct(null);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Operation failed');
    }
  };

  const openEdit = (acct) => {
    setEditAcct(acct);
    setForm({ account_number: acct.account_number, name: acct.name, account_type: acct.account_type, description: acct.description || '' });
    setShowForm(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: '#1a237e', margin: 0 }}>Chart of Accounts</h2>
        {canWrite && (
          <button style={S.btn()} onClick={() => { setEditAcct(null); setForm(emptyForm); setShowForm(true); }}>
            + New Account
          </button>
        )}
      </div>
      <div style={S.card}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : accounts.length === 0 ? (
          <EmptyState message="No accounts yet. Create your first account." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Number', 'Name', 'Type', 'Description', 'Status', canWrite && 'Actions'].filter(Boolean).map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const [bg, color] = TYPE_COLORS[a.account_type] || ['#f5f5f5', '#555'];
                return (
                  <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 600 }}>{a.account_number}</td>
                    <td style={S.td}>{a.name}</td>
                    <td style={S.td}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: bg, color }}>{a.account_type}</span>
                    </td>
                    <td style={{ ...S.td, color: '#888', fontSize: 13 }}>{a.description || '—'}</td>
                    <td style={S.td}>
                      <Badge label={a.is_active ? 'Active' : 'Inactive'} variant={a.is_active ? 'active' : 'inactive'} />
                    </td>
                    {canWrite && (
                      <td style={S.td}>
                        <button style={{ ...S.btn('#455a64'), padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(a)}>Edit</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <Modal title={editAcct ? 'Edit Account' : 'New Account'} onClose={() => { setShowForm(false); setEditAcct(null); }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Account Number</label>
              <input style={S.input} value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} required disabled={!!editAcct} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Name</label>
              <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            {!editAcct && (
              <div style={{ marginBottom: 12 }}>
                <label style={S.label}>Account Type</label>
                <select style={S.input} value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}>
                  {['asset', 'liability', 'equity', 'revenue', 'expense'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Description</label>
              <textarea style={{ ...S.input, height: 70, resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setShowForm(false); setEditAcct(null); }} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>{editAcct ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
