import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  getJournalEntriesPage, getAccounts, createJournalEntry,
  approveEntry, rejectEntry, postEntry, submitEntry, reverseEntry,
} from '../api/client';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { truncateId } from '../utils/roles';
import { apiError } from '../utils/apiError';
import { pageOffset } from '../utils/pagination';
import { card, th, td, input, label, btn } from '../styles/common';

const S = {
  card, th, td, input, label, btn,
  tab: (active) => ({
    padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
    background: active ? '#1a237e' : '#f0f0f0',
    color: active ? '#fff' : '#555',
    borderRadius: 6, fontWeight: active ? 600 : 400,
  }),
  searchInput: {
    padding: '7px 12px', border: '1px solid #ddd', borderRadius: 6,
    fontSize: 14, width: 220, outline: 'none',
  },
};

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'posted', label: 'Posted' },
];

const LIMIT = 25;

const makeEmptyForm = () => ({
  entry_date: new Date().toISOString().slice(0, 10),
  description: '', main_account_id: '', contra_account_id: '',
  amount: '', requires_approval: false, reference: '', notes: '',
});

export default function Journal() {
  const { tenantId } = useParams();
  const { canWriteBookings, canApprove, canPostJournalEntry } = useAuth();
  const toast = useToast();

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveModal, setApproveModal] = useState(null);
  const [approveNotes, setApproveNotes] = useState('');
  const [confirmPost, setConfirmPost] = useState(null);
  const [confirmReverse, setConfirmReverse] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(makeEmptyForm);
  const [expandedId, setExpandedId] = useState(null);

  const search = useDebouncedValue(searchInput, 400);
  const queryKey = `${filterStatus}::${search}::${fromDate}::${toDate}`;
  const lastQueryRef = useRef(queryKey);

  useEffect(() => {
    getAccounts(tenantId)
      .then(({ data }) => setAccounts(data))
      .catch(() => {});
  }, [tenantId]);

  const load = useCallback(async () => {
    if (lastQueryRef.current !== queryKey && page !== 0) {
      lastQueryRef.current = queryKey;
      setPage(0);
      return;
    }
    lastQueryRef.current = queryKey;
    setLoading(true);
    try {
      const params = { skip: pageOffset(page, LIMIT), limit: LIMIT };
      if (filterStatus) params.status = filterStatus;
      if (search.trim()) params.search = search.trim();
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const { data } = await getJournalEntriesPage(tenantId, params);
      setEntries(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(apiError(e, 'Failed to load entries'));
    }
    setLoading(false);
  }, [tenantId, filterStatus, search, fromDate, toDate, page, queryKey, reloadToken]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createJournalEntry(tenantId, { ...form, amount: parseFloat(form.amount) });
      toast.success('Journal entry created.');
      setShowForm(false);
      setForm(makeEmptyForm());
      setPage(0);
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to create entry'));
    }
    setSubmitting(false);
  };

  const handleSubmitForApproval = async (entry) => {
    try {
      await submitEntry(tenantId, entry.id);
      toast.success('Entry submitted for approval.');
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to submit entry'));
    }
  };

  const handleApproveConfirm = async () => {
    try {
      await approveEntry(tenantId, approveModal.id, { approval_notes: approveNotes || undefined });
      toast.success('Entry approved.');
      setApproveModal(null);
      setApproveNotes('');
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to approve'));
    }
  };

  const handleReverse = async () => {
    try {
      const { data } = await reverseEntry(tenantId, confirmReverse.id);
      toast.success(`Reversal ${data.reversal_entry_number} created as draft.`);
      setConfirmReverse(null);
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to create reversal'));
    }
  };

  const handleReject = async () => {
    try {
      await rejectEntry(tenantId, rejectModal.id, { rejection_reason: rejectReason });
      toast.success('Entry rejected.');
      setRejectModal(null);
      setRejectReason('');
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to reject'));
    }
  };

  const handlePost = async () => {
    try {
      await postEntry(tenantId, confirmPost.id);
      toast.success('Entry posted.');
      setConfirmPost(null);
      setReloadToken((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e, 'Failed to post'));
    }
  };

  const accMap = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, `${a.account_number} - ${a.name}`])),
    [accounts]
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: '#1a237e', margin: 0 }}>Journal Entries</h2>
        {canWriteBookings(tenantId) && (
          <button style={S.btn()} onClick={() => setShowForm(true)}>+ New Entry</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={S.searchInput}
          placeholder="Search description, number..."
          value={searchInput}
          onChange={e => {
            setSearchInput(e.target.value);
          }}
        />
        <input type="date" style={{ ...S.searchInput, width: 'auto' }}
          value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
          title="From date" />
        <input type="date" style={{ ...S.searchInput, width: 'auto' }}
          value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
          title="To date" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_TABS.map(t => (
            <button key={t.value} style={S.tab(filterStatus === t.value)}
              onClick={() => { setFilterStatus(t.value); setPage(0); }}>
              {t.label}
            </button>
          ))}
        </div>
        {(filterStatus || searchInput || fromDate || toDate) && (
          <button
            style={{ ...S.btn('#888'), padding: '7px 12px', fontSize: 13 }}
            onClick={() => { setFilterStatus(''); setSearchInput(''); setFromDate(''); setToDate(''); setPage(0); }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={S.card}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : (
          <>
            {entries.length === 0 ? (
              <EmptyState message={
                search || filterStatus
                  ? 'No entries match your filters.'
                  : 'No journal entries yet. Create your first entry.'
              } />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['#', 'Date', 'Description', 'Hauptkonto', 'Gegenkonto', 'Amount', 'Status', 'Actions'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <React.Fragment key={e.id}>
                    <tr
                      style={{ background: e.status === 'rejected' ? '#fffafa' : undefined, cursor: 'pointer' }}
                      onClick={() => setExpandedId(id => id === e.id ? null : e.id)}
                    >
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.entry_number}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                      <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.description}>
                        {e.description}
                      </td>
                      <td style={{ ...S.td, fontSize: 12 }}>{accMap[e.main_account_id] || truncateId(e.main_account_id)}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{accMap[e.contra_account_id] || truncateId(e.contra_account_id)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td style={S.td}
                        title={
                          e.reversal_entry_id
                            ? ('Reversed by: ' + ((entries.find(r => r.id === e.reversal_entry_id) || {}).entry_number || 'see reversal entry'))
                            : e.status === 'posted' && e.posted_by
                              ? ('Posted by: ' + e.posted_by.slice(0, 8))
                              : (e.approval_notes ? ('Approval note: ' + e.approval_notes) : undefined)
                        }>
                        <Badge label={e.status} variant={e.status} />
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }} onClick={ev => ev.stopPropagation()}>
                        {canWriteBookings(tenantId) && e.status === 'draft' && e.requires_approval && (
                          <button style={{ ...S.btn('#455a64'), padding: '3px 9px', fontSize: 12, marginRight: 4 }}
                            onClick={() => handleSubmitForApproval(e)}>Submit</button>
                        )}
                        {canApprove(tenantId) && e.status === 'pending_approval' && (
                          <>
                            <button style={{ ...S.btn('#2e7d32'), padding: '3px 9px', fontSize: 12, marginRight: 4 }}
                              onClick={() => { setApproveModal(e); setApproveNotes(''); }}>Approve</button>
                            <button style={{ ...S.btn('#c62828'), padding: '3px 9px', fontSize: 12 }}
                              onClick={() => { setRejectModal(e); setRejectReason(''); }}>Reject</button>
                          </>
                        )}
                        {canPostJournalEntry(tenantId) && e.status === 'approved' && (
                          <button style={{ ...S.btn('#6a1b9a'), padding: '3px 9px', fontSize: 12 }}
                            onClick={() => setConfirmPost(e)}>Post</button>
                        )}
                        {canPostJournalEntry(tenantId) && e.status === 'posted' && !e.reversed_at && (
                          <button style={{ ...S.btn('#37474f'), padding: '3px 9px', fontSize: 12 }}
                            onClick={() => setConfirmReverse(e)}>Reverse</button>
                        )}
                      </td>
                    </tr>
                    {expandedId === e.id && (
                      <tr style={{ background: '#f9f9f9' }}>
                        <td colSpan={8} style={{ padding: '4px 16px 10px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr>
                                {['Line', 'Account', 'Dr/Cr', 'Amount'].map(h => (
                                  <th key={h} style={{ ...S.th, fontSize: 11, padding: '4px 8px' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {e.lines && e.lines.length > 0
                                ? e.lines.filter(l => !l.deleted_at).map(l => (
                                  <tr key={l.id}>
                                    <td style={{ ...S.td, padding: '3px 8px' }}>{l.line_number}</td>
                                    <td style={{ ...S.td, padding: '3px 8px', fontFamily: 'monospace' }}>
                                      {accMap[l.account_id] || truncateId(l.account_id)}
                                    </td>
                                    <td style={{ ...S.td, padding: '3px 8px', textTransform: 'capitalize' }}>{l.debit_credit}</td>
                                    <td style={{ ...S.td, padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                      {Number(l.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))
                                : (
                                  <>
                                    <tr>
                                      <td style={{ ...S.td, padding: '3px 8px' }}>1</td>
                                      <td style={{ ...S.td, padding: '3px 8px', fontFamily: 'monospace' }}>
                                        {accMap[e.main_account_id] || truncateId(e.main_account_id)}
                                      </td>
                                      <td style={{ ...S.td, padding: '3px 8px' }}>Debit</td>
                                      <td style={{ ...S.td, padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                        {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style={{ ...S.td, padding: '3px 8px' }}>2</td>
                                      <td style={{ ...S.td, padding: '3px 8px', fontFamily: 'monospace' }}>
                                        {accMap[e.contra_account_id] || truncateId(e.contra_account_id)}
                                      </td>
                                      <td style={{ ...S.td, padding: '3px 8px' }}>Credit</td>
                                      <td style={{ ...S.td, padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                        {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  </>
                                )
                              }
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
            {entries.length > 0 && (() => {
              const pageTotal = entries.reduce((s, e) => s + Number(e.amount), 0);
              return (
                <div style={{ textAlign: 'right', fontSize: 12, color: '#888', padding: '6px 4px 2px' }}>
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'} &middot; Total: {pageTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              );
            })()}
            <Pagination page={page} onPage={setPage} total={total} limit={LIMIT} />
          </>
        )}
      </div>

      {showForm && (
        <Modal title="New Journal Entry" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Entry Date</label>
                <input style={S.input} type="date" value={form.entry_date}
                  onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} required />
              </div>
              <div>
                <label style={S.label}>Amount</label>
                <input style={S.input} type="number" step="0.01" min="0.01" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Description</label>
              <input style={S.input} type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Main Account (Hauptkonto)</label>
                <select style={S.input} value={form.main_account_id}
                  onChange={e => setForm(f => ({ ...f, main_account_id: e.target.value }))} required>
                  <option value="">Select account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Contra Account (Gegenkonto)</label>
                <select style={S.input} value={form.contra_account_id}
                  onChange={e => setForm(f => ({ ...f, contra_account_id: e.target.value }))} required>
                  <option value="">Select account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Reference</label>
                <input style={S.input} type="text" value={form.reference}
                  onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', paddingTop: 20 }}>
                <input type="checkbox" id="reqApproval" checked={form.requires_approval}
                  onChange={e => setForm(f => ({ ...f, requires_approval: e.target.checked }))}
                  style={{ marginRight: 8, width: 16, height: 16 }} />
                <label htmlFor="reqApproval" style={{ fontSize: 13, cursor: 'pointer' }}>
                  Requires four-eyes approval
                </label>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Notes</label>
              <textarea style={{ ...S.input, height: 64, resize: 'vertical' }} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" disabled={submitting} style={{ ...S.btn(), opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Creating...' : 'Create Entry'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {rejectModal && (
        <Modal title="Reject Entry" onClose={() => setRejectModal(null)}>
          <p style={{ marginBottom: 12, fontSize: 14, color: '#555' }}>
            Entry <strong>{rejectModal.entry_number}</strong>: {rejectModal.description}
          </p>
          <label style={S.label}>Rejection Reason <span style={{ color: '#c62828' }}>*</span></label>
          <textarea style={{ ...S.input, height: 80, marginBottom: 16 }}
            value={rejectReason} onChange={e => setRejectReason(e.target.value)}
            placeholder="Provide a reason for rejection..." required />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setRejectModal(null)} style={S.btn('#888')}>Cancel</button>
            <button onClick={handleReject} disabled={!rejectReason.trim()}
              style={{ ...S.btn('#c62828'), opacity: rejectReason.trim() ? 1 : 0.5 }}>
              Confirm Rejection
            </button>
          </div>
        </Modal>
      )}

      {approveModal && (
        <Modal title="Approve Entry" onClose={() => setApproveModal(null)}>
          <p style={{ marginBottom: 12, fontSize: 14, color: '#555' }}>
            Approve entry <strong>{approveModal.entry_number}</strong>: {approveModal.description}
          </p>
          <label style={S.label}>Approval Notes <span style={{ color: '#888', fontWeight: 400 }}>(optional)</span></label>
          <textarea style={{ ...S.input, height: 72, marginBottom: 16 }}
            value={approveNotes} onChange={e => setApproveNotes(e.target.value)}
            placeholder="Add notes about this approval decision..." />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setApproveModal(null)} style={S.btn('#888')}>Cancel</button>
            <button onClick={handleApproveConfirm} style={S.btn('#2e7d32')}>Confirm Approval</button>
          </div>
        </Modal>
      )}

      {confirmPost && (
        <ConfirmDialog
          message={`Post entry ${confirmPost.entry_number}? This action is final and cannot be undone.`}
          danger
          onConfirm={handlePost}
          onCancel={() => setConfirmPost(null)}
        />
      )}

      {confirmReverse && (
        <ConfirmDialog
          message={`Create a reversal draft for entry ${confirmReverse.entry_number}? The original entry is unchanged.`}
          onConfirm={handleReverse}
          onCancel={() => setConfirmReverse(null)}
        />
      )}
    </div>
  );
}
