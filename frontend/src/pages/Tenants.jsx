import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getTenants, createTenant } from '../api/client';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const S = {
  card: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#666', borderBottom: '2px solid #eee', fontSize: 13 },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f5f5f5' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 10 },
  btn: (c) => ({ padding: '7px 14px', background: c || '#1a237e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }),
};

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ color: '#1a237e' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Tenants() {
  const { isPowerAdmin } = useAuth();
  const toast = useToast();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getTenants();
      setTenants(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load tenants');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createTenant(form);
      toast.success(`Tenant "${form.name}" created.`);
      setShowForm(false);
      setForm({ name: '', description: '' });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create tenant');
    }
  };

  if (!isPowerAdmin()) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Access denied. PowerAdmin role required.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: '#1a237e', margin: 0 }}>Tenant Management</h2>
        <button style={S.btn()} onClick={() => setShowForm(true)}>+ New Tenant</button>
      </div>
      <div style={S.card}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : tenants.length === 0 ? (
          <EmptyState message="No tenants yet." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Name', 'Description', 'Status', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{t.name}</td>
                  <td style={{ ...S.td, color: '#666' }}>{t.description || '—'}</td>
                  <td style={S.td}><Badge label={t.is_active ? 'Active' : 'Inactive'} variant={t.is_active ? 'active' : 'inactive'} /></td>
                  <td style={{ ...S.td, fontSize: 12, color: '#888' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <Modal title="New Tenant" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate}>
            <label style={S.label}>Tenant Name</label>
            <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            <label style={S.label}>Description</label>
            <textarea style={{ ...S.input, height: 80, resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setShowForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>Create Tenant</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
