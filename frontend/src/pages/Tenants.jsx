import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getTenants, createTenant } from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { apiError } from '../utils/apiError';
import { card, th, td, input, label, btn } from '../styles/common';

const S = { card, th, td, input, label, btn };

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
      toast.error(apiError(e, 'Failed to load tenants'));
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
      toast.error(apiError(e, 'Failed to create tenant'));
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
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Tenant Name</label>
              <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Description</label>
              <textarea style={{ ...S.input, height: 80, resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>Create Tenant</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
