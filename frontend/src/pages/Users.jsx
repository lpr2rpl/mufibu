import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getUsers, createUser, getRoles, getAssignments, assignRole, revokeAssignment, extendAssignment, getTenants } from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

const S = {
  card: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#666', borderBottom: '2px solid #eee', fontSize: 13 },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f5f5f5' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 10 },
  btn: (c) => ({ padding: '7px 14px', background: c || '#1a237e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }),
  tab: (active) => ({
    padding: '8px 20px', background: active ? '#1a237e' : '#f5f5f5', color: active ? '#fff' : '#555',
    border: 'none', cursor: 'pointer', borderRadius: '6px 6px 0 0', fontSize: 14, marginRight: 4,
  }),
};


export default function Users() {
  const { isPowerAdmin, roles: myRoles } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUserForm, setShowUserForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [extendModal, setExtendModal] = useState(null);
  const [newValidUntil, setNewValidUntil] = useState('');
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', full_name: '' });
  const [assignForm, setAssignForm] = useState({ user_id: '', role_name: '', tenant_id: '', valid_until: '' });

  // Determine tenant scope for admin
  const adminTenantIds = myRoles.filter(r => r.role === 'Admin').map(r => r.tenant_id);
  const isAdmin = adminTenantIds.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, a, r] = await Promise.all([getUsers(), getAssignments({ active_only: false }), getRoles()]);
      setUsers(u.data);
      setAssignments(a.data);
      setAllRoles(r.data);
      if (isPowerAdmin()) {
        const { data: t } = await getTenants();
        setTenants(t);
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load');
    }
    setLoading(false);
  }, [isPowerAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await createUser(userForm);
      toast.success(`User "${userForm.username}" created.`);
      setShowUserForm(false);
      setUserForm({ username: '', email: '', password: '', full_name: '' });
      load();
    } catch (e) { setError(e.response?.data?.detail || 'Failed to create user'); }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await assignRole({
        ...assignForm,
        tenant_id: assignForm.tenant_id || null,
        valid_until: assignForm.valid_until || null,
      });
      toast.success('Role assigned successfully.');
      setShowAssignForm(false);
      setAssignForm({ user_id: '', role_name: '', tenant_id: '', valid_until: '' });
      load();
    } catch (e) { setError(e.response?.data?.detail || 'Failed to assign role'); }
  };

  const handleRevoke = async () => {
    try {
      await revokeAssignment(confirmRevoke.id, {});
      toast.success('Role assignment revoked.');
      setConfirmRevoke(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to revoke');
    }
  };

  const handleExtend = async () => {
    try {
      await extendAssignment(extendModal.id, { valid_until: newValidUntil });
      toast.success('Assignment extended.');
      setExtendModal(null); setNewValidUntil(''); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to extend');
    }
  };

  // PowerAdmin can assign all roles (including Admin and Officer).
  // Tenant Admin can assign Reader/Writer/PowerUser/Approver for their tenant.
  // Officer is PowerAdmin-only: it implements the per-tenant read map.
  const POWER_ADMIN_ONLY_ROLES = ['Admin', 'Officer'];
  const availableRoles = allRoles.filter(r => {
    if (isPowerAdmin()) return true;
    if (isAdmin) return r.scope === 'tenant' && !POWER_ADMIN_ONLY_ROLES.includes(r.name);
    return false;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: '#1a237e' }}>User & Role Management</h2>
      </div>

      <div style={{ marginBottom: -1 }}>
        <button style={S.tab(tab === 'users')} onClick={() => setTab('users')}>Users</button>
        <button style={S.tab(tab === 'roles')} onClick={() => setTab('roles')}>Role Assignments</button>
      </div>

      <div style={{ ...S.card, borderRadius: '0 8px 8px 8px' }}>
        {error && <div style={{ background: '#ffebee', color: '#c62828', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}

        {tab === 'users' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              {isPowerAdmin() && <button style={S.btn()} onClick={() => setShowUserForm(true)}>+ New User</button>}
            </div>
            {loading ? <div>Loading...</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Username', 'Full Name', 'Email', 'Status', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{u.username}</td>
                      <td style={S.td}>{u.full_name || '-'}</td>
                      <td style={S.td}>{u.email}</td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, color: u.is_active ? '#2e7d32' : '#c62828' }}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: '#888' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'roles' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              {(isPowerAdmin() || isAdmin) && (
                <button style={S.btn()} onClick={() => setShowAssignForm(true)}>+ Assign Role</button>
              )}
            </div>
            {loading ? <div>Loading...</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['User', 'Role', 'Tenant', 'Valid From', 'Valid Until', 'Active', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                      <td style={S.td}>{a.username || a.user_id?.slice(0, 8)}</td>
                      <td style={S.td}><strong>{a.role_name}</strong></td>
                      <td style={{ ...S.td, fontSize: 12 }}>{a.tenant_name || (a.tenant_id ? a.tenant_id.slice(0, 8) : 'Global')}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{new Date(a.valid_from).toLocaleDateString()}</td>
                      <td style={{ ...S.td, fontSize: 12, color: a.valid_until ? '#555' : '#888' }}>
                        {a.valid_until ? new Date(a.valid_until).toLocaleDateString() : 'Open-ended'}
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, color: a.is_active ? '#2e7d32' : '#c62828' }}>
                          {a.is_active ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        {a.is_active && (
                          <>
                            <button style={{ ...S.btn('#455a64'), padding: '3px 8px', fontSize: 12, marginRight: 4 }}
                              onClick={() => { setExtendModal(a); setNewValidUntil(''); }}>Extend</button>
                            <button style={{ ...S.btn('#c62828'), padding: '3px 8px', fontSize: 12 }}
                              onClick={() => setConfirmRevoke(a)}>Revoke</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {showUserForm && (
        <Modal title="New User" onClose={() => setShowUserForm(false)}>
          <form onSubmit={handleCreateUser}>
            {['username', 'email', 'full_name'].map(f => (
              <div key={f}>
                <label style={S.label}>{f.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
                <input style={S.input} type={f === 'email' ? 'email' : 'text'} value={userForm[f]}
                  onChange={e => setUserForm(u => ({ ...u, [f]: e.target.value }))} required={f !== 'full_name'} />
              </div>
            ))}
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={userForm.password}
              onChange={e => setUserForm(u => ({ ...u, password: e.target.value }))} required minLength={8} />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setShowUserForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>Create User</button>
            </div>
          </form>
        </Modal>
      )}

      {showAssignForm && (
        <Modal title="Assign Role" onClose={() => setShowAssignForm(false)}>
          <form onSubmit={handleAssign}>
            <label style={S.label}>User</label>
            <select style={S.input} value={assignForm.user_id} onChange={e => setAssignForm(f => ({ ...f, user_id: e.target.value }))} required>
              <option value="">Select user</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.username} ({u.full_name || u.email})</option>)}
            </select>
            <label style={S.label}>Role</label>
            <select style={S.input} value={assignForm.role_name} onChange={e => setAssignForm(f => ({ ...f, role_name: e.target.value }))} required>
              <option value="">Select role</option>
              {availableRoles.map(r => <option key={r.id} value={r.name}>{r.name} ({r.scope})</option>)}
            </select>
            {assignForm.role_name && allRoles.find(r => r.name === assignForm.role_name)?.scope === 'tenant' && (
              <>
                <label style={S.label}>Tenant</label>
                <select style={S.input} value={assignForm.tenant_id} onChange={e => setAssignForm(f => ({ ...f, tenant_id: e.target.value }))} required>
                  <option value="">Select tenant</option>
                  {(isPowerAdmin() ? tenants : adminTenantIds.map(id => ({ id, name: id }))).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </>
            )}
            <label style={S.label}>Valid Until (optional)</label>
            <input style={S.input} type="datetime-local" value={assignForm.valid_until}
              onChange={e => setAssignForm(f => ({ ...f, valid_until: e.target.value }))} />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setShowAssignForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>Assign</button>
            </div>
          </form>
        </Modal>
      )}

      {extendModal && (
        <Modal title="Extend Assignment" onClose={() => setExtendModal(null)}>
          <p style={{ marginBottom: 12, fontSize: 14 }}>
            <strong>{extendModal.username}</strong> / <strong>{extendModal.role_name}</strong><br />
            Current valid until: {extendModal.valid_until ? new Date(extendModal.valid_until).toLocaleString() : 'Open-ended'}
          </p>
          <label style={S.label}>New Valid Until</label>
          <input style={S.input} type="datetime-local" value={newValidUntil} onChange={e => setNewValidUntil(e.target.value)} required />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setExtendModal(null)} style={S.btn('#888')}>Cancel</button>
            <button onClick={handleExtend} style={S.btn()}>Extend Phase</button>
          </div>
        </Modal>
      )}

      {confirmRevoke && (
        <ConfirmDialog
          message={`Revoke the ${confirmRevoke.role_name} role from ${confirmRevoke.username}?`}
          danger
          onConfirm={handleRevoke}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
    </div>
  );
}
