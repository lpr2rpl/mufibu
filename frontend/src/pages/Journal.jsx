import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getJournalEntries, getAccounts, createJournalEntry, updateJournalEntry,
  approveEntry, rejectEntry, postEntry, submitEntry,
} from '../api/client';

const S = {
  card: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16 },
  badge: (status) => {
    const colors = {
      draft: ['#e3f2fd', '#1565c0'],
      pending_approval: ['#fff8e1', '#e65100'],
      approved: ['#e8f5e9', '#2e7d32'],
      rejected: ['#ffebee', '#c62828'],
      posted: ['#f3e5f5', '#6a1b9a'],
    };
    const [bg, color] = colors[status] || ['#f5f5f5', '#555'];
    return { padding: '2px 8px', borderRadius: 12, fontSize: 12, background: bg, color };
  },
  th: { textAlign: 'left', padding: '10px 12px', color: '#666', borderBottom: '2px solid #eee', fontSize: 13 },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f5f5f5' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 },
  btn: (color) => ({
    padding: '7px 14px', background: color || '#1a237e', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  }),
};

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 520, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ color: '#1a237e' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Journal() {
  const { tenantId } = useParams();
  const { canWriteBookings, canApprove } = useAuth();
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    description: '', main_account_id: '', contra_account_id: '',
    amount: '', requires_approval: false, reference: '', notes: '',
  });
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus ? { status: filterStatus } : {};
      const [je, acc] = await Promise.all([
        getJournalEntries(tenantId, params),
        getAccounts(tenantId),
      ]);
      setEntries(je.data);
      setAccounts(acc.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load data');
    }
    setLoading(false);
  }, [tenantId, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await createJournalEntry(tenantId, {
        ...form,
        amount: parseFloat(form.amount),
      });
      setShowForm(false);
      setForm({ entry_date: new Date().toISOString().slice(0, 10), description: '', main_account_id: '', contra_account_id: '', amount: '', requires_approval: false, reference: '', notes: '' });
      load();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to create entry');
    }
  };

  const handleApprove = async (entry) => {
    try { await approveEntry(tenantId, entry.id, {}); load(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed to approve'); }
  };

  const handleReject = async () => {
    try {
      await rejectEntry(tenantId, rejectModal.id, { rejection_reason: rejectReason });
      setRejectModal(null); setRejectReason(''); load();
    } catch (e) { alert(e.response?.data?.detail || 'Failed to reject'); }
  };

  const handlePost = async (entry) => {
    if (!window.confirm('Post this entry? This action is final.')) return;
    try { await postEntry(tenantId, entry.id); load(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed to post'); }
  };

  const accMap = Object.fromEntries(accounts.map(a => [a.id, `${a.account_number} - ${a.name}`]));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: '#1a237e' }}>Journal Entries</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
            <option value="">All statuses</option>
            {['draft', 'pending_approval', 'approved', 'rejected', 'posted'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {canWriteBookings(tenantId) && (
            <button style={S.btn()} onClick={() => setShowForm(true)}>+ New Entry</button>
          )}
        </div>
      </div>

      {error && <div style={{ background: '#ffebee', color: '#c62828', padding: 12, borderRadius: 6, marginBottom: 16 }}>{error}</div>}

      <div style={S.card}>
        {loading ? <div>Loading...</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Number', 'Date', 'Description', 'Main Account', 'Contra Account', 'Amount', 'Status', 'Actions'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#999', padding: 24 }}>No entries found</td></tr>
              )}
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ ...S.td, fontFamily: 'monospace' }}>{e.entry_number}</td>
                  <td style={S.td}>{e.entry_date}</td>
                  <td style={{ ...S.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</td>
                  <td style={{ ...S.td, fontSize: 13 }}>{accMap[e.main_account_id] || e.main_account_id?.slice(0, 8)}</td>
                  <td style={{ ...S.td, fontSize: 13 }}>{accMap[e.contra_account_id] || e.contra_account_id?.slice(0, 8)}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>
                    {parseFloat(e.amount).toLocaleString('en', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={S.td}><span style={S.badge(e.status)}>{e.status}</span></td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {canApprove(tenantId) && e.status === 'pending_approval' && (
                      <>
                        <button style={{ ...S.btn('#2e7d32'), marginRight: 4, padding: '4px 10px' }} onClick={() => handleApprove(e)}>Approve</button>
                        <button style={{ ...S.btn('#c62828'), marginRight: 4, padding: '4px 10px' }} onClick={() => { setRejectModal(e); setRejectReason(''); }}>Reject</button>
                      </>
                    )}
                    {canWriteBookings(tenantId) && e.status === 'approved' && (
                      <button style={{ ...S.btn('#6a1b9a'), padding: '4px 10px' }} onClick={() => handlePost(e)}>Post</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <Modal title="New Journal Entry" onClose={() => setShowForm(false)}>
          {error && <div style={{ background: '#ffebee', color: '#c62828', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Entry Date</label>
                <input style={S.input} type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} required />
              </div>
              <div>
                <label style={S.label}>Amount</label>
                <input style={S.input} type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Description</label>
              <input style={S.input} type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Main Account (Hauptkonto)</label>
                <select style={S.input} value={form.main_account_id} onChange={e => setForm(f => ({ ...f, main_account_id: e.target.value }))} required>
                  <option value="">Select account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Contra Account (Gegenkonto)</label>
                <select style={S.input} value={form.contra_account_id} onChange={e => setForm(f => ({ ...f, contra_account_id: e.target.value }))} required>
                  <option value="">Select account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Reference</label>
                <input style={S.input} type="text" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 20 }}>
                <input type="checkbox" id="reqApproval" checked={form.requires_approval} onChange={e => setForm(f => ({ ...f, requires_approval: e.target.checked }))} style={{ marginRight: 8 }} />
                <label htmlFor="reqApproval" style={{ fontSize: 13 }}>Requires four-eyes approval</label>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Notes</label>
              <textarea style={{ ...S.input, height: 70, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ ...S.btn('#888') }}>Cancel</button>
              <button type="submit" style={S.btn()}>Create Entry</button>
            </div>
          </form>
        </Modal>
      )}

      {rejectModal && (
        <Modal title="Reject Entry" onClose={() => setRejectModal(null)}>
          <p style={{ marginBottom: 12, fontSize: 14 }}>Entry: <strong>{rejectModal.entry_number}</strong> - {rejectModal.description}</p>
          <label style={S.label}>Rejection Reason</label>
          <textarea style={{ ...S.input, height: 80, marginBottom: 16 }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} required />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setRejectModal(null)} style={S.btn('#888')}>Cancel</button>
            <button onClick={handleReject} style={S.btn('#c62828')}>Confirm Rejection</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
