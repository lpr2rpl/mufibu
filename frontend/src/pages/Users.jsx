import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getUsers, createUser, getRoles, getAssignments, assignRole, revokeAssignment, extendAssignment, getTenants } from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { truncateId } from '../utils/roles';
import { apiError } from '../utils/apiError';
import { card, th, td, input, label, btn } from '../styles/common';

const S = {
  card, th, td, input, label, btn,
  tab: (active) => ({
    padding: '8px 20px', background: active ? '#1a237e' : '#f5f5f5', color: active ? '#fff' : '#555',
    border: 'none', cursor: 'pointer', borderRadius: '6px 6px 0 0', fontSize: 14, marginRight: 4,
  }),
};

const POWER_ADMIN_ONLY_ROLES = ['Admin', 'Officer'];

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
  const [showUserForm, setShowUserForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [extendModal, setExtendModal] = useState(null);
  const [newValidUntil, setNewValidUntil] = useState('');
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', full_name: '' });
  const [assignForm, setAssignForm] = useState({ user_id: '', role_name: '', tenant_id: '', valid_until: '' });

  const adminTenantIds = myRoles.filter(r => r.role === 'Admin').map(r => r.tenant_id);
  const isAdmin = adminTenantIds.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, a, r, t] = await Promise.all([
        getUsers(),
        getAssignments({ active_only: false }),
        getRoles(),
        isPowerAdmin() ? getTenants() : Promise.resolve({ data: [] }),
      ]);
      setUsers(u.data);
      setAssignments(a.data);
      setAllRoles(r.data);
      setTenants(t.data);
    } catch (e) {
      toast.error(apiError(e, 'Failed to load'));
    }
    setLoading(false);
  }, [isPowerAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUser(userForm);
      toast.success(`User "${userForm.username}" created.`);
      setShowUserForm(false);
      setUserForm({ username: '', email: '', password: '', full_name: '' });
      load();
    } catch (e) {
      toast.error(apiError(e, 'Failed to create user'));
    }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
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
    } catch (e) {
      toast.error(apiError(e, 'Failed to assign role'));
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeAssignment(confirmRevoke.id, {});
      toast.success('Role assignment revoked.');
      setConfirmRevoke(null);
      load();
    } catch (e) {
      toast.error(apiError(e, 'Failed to revoke'));
    }
  };

  const handleExtend = async () => {
    try {
      await extendAssignment(extendModal.id, { valid_until: newValidUntil });
      toast.success('Assignment extended.');
      setExtendModal(null);
      setNewValidUntil('');
      load();
    } catch (e) {
      toast.error(apiError(e, 'Failed to extend'));
    }
  };

  const availableRoles = allRoles.filter(r => {
    if (isPowerAdmin()) return true;
    if (isAdmin) return r.scope === 'tenant' && !POWER_ADMIN_ONLY_ROLES.includes(r.name);
    return false;
  });

  const loadingRow = (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
  );

  return (
    <div>
      <h2 style={{ color: '#1a237e', marginBottom: 20 }}>User & Role Management</h2>

      <div style={{ marginBottom: -1 }}>
        <button style={S.tab(tab === 'users')} onClick={() => setTab('users')}>Users</button>
        <button style={S.tab(tab === 'roles')} onClick={() => setTab('roles')}>Role Assignments</button>
      </div>

      <div style={{ ...S.card, borderRadius: '0 8px 8px 8px' }}>
        {tab === 'users' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              {isPowerAdmin() && <button style={S.btn()} onClick={() => setShowUserForm(true)}>+ New User</button>}
            </div>
            {loading ? loadingRow : users.length === 0 ? (
              <EmptyState message="No users found." />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Username', 'Full Name', 'Email', 'Status', 'Created'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{u.username}</td>
                      <td style={S.td}>{u.full_name || '—'}</td>
                      <td style={S.td}>{u.email}</td>
                      <td style={S.td}>
                        <Badge label={u.is_active ? 'Active' : 'Inactive'} variant={u.is_active ? 'active' : 'inactive'} />
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
            {loading ? loadingRow : assignments.length === 0 ? (
              <EmptyState message="No role assignments found." />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['User', 'Role', 'Tenant', 'Valid From', 'Valid Until', 'Active', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                      <td style={S.td}>{a.username || truncateId(a.user_id)}</td>
                      <td style={S.td}><strong>{a.role_name}</strong></td>
                      <td style={{ ...S.td, fontSize: 12 }}>{a.tenant_name || (a.tenant_id ? truncateId(a.tenant_id) : 'Global')}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{new Date(a.valid_from).toLocaleDateString()}</td>
                      <td style={{ ...S.td, fontSize: 12, color: a.valid_until ? '#555' : '#888' }}>
                        {a.valid_until ? new Date(a.valid_until).toLocaleDateString() : 'Open-ended'}
                      </td>
                      <td style={S.td}>
                        <Badge label={a.is_active ? 'Yes' : 'No'} variant={a.is_active ? 'active' : 'inactive'} />
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
              <div key={f} style={{ marginBottom: 12 }}>
                <label style={S.label}>{f.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
                <input style={S.input} type={f === 'email' ? 'email' : 'text'} value={userForm[f]}
                  onChange={e => setUserForm(u => ({ ...u, [f]: e.target.value }))} required={f !== 'full_name'} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Password</label>
              <input style={S.input} type="password" value={userForm.password}
                onChange={e => setUserForm(u => ({ ...u, password: e.target.value }))} required minLength={8} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowUserForm(false)} style={S.btn('#888')}>Cancel</button>
              <button type="submit" style={S.btn()}>Create User</button>
            </div>
          </form>
        </Modal>
      )}

      {showAssignForm && (
        <Modal title="Assign Role" onClose={() => setShowAssignForm(false)}>
          <form onSubmit={handleAssign}>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>User</label>
              <select style={S.input} value={assignForm.user_id} onChange={e => setAssignForm(f => ({ ...f, user_id: e.target.value }))} required>
                <option value="">Select user</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.username} ({u.full_name || u.email})</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Role</label>
              <select style={S.input} value={assignForm.role_name} onChange={e => setAssignForm(f => ({ ...f, role_name: e.target.value }))} required>
                <option value="">Select role</option>
                {availableRoles.map(r => <option key={r.id} value={r.name}>{r.name} ({r.scope})</option>)}
              </select>
            </div>
            {assignForm.role_name && allRoles.find(r => r.name === assignForm.role_name)?.scope === 'tenant' && (
              <div style={{ marginBottom: 12 }}>
                <label style={S.label}>Tenant</label>
                <select style={S.input} value={assignForm.tenant_id} onChange={e => setAssignForm(f => ({ ...f, tenant_id: e.target.value }))} required>
                  <option value="">Select tenant</option>
                  {(isPowerAdmin() ? tenants : adminTenantIds.map(id => ({ id, name: id }))).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Valid Until (optional)</label>
              <input style={S.input} type="datetime-local" value={assignForm.valid_until}
                onChange={e => setAssignForm(f => ({ ...f, valid_until: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
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
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>New Valid Until</label>
            <input style={S.input} type="datetime-local" value={newValidUntil} onChange={e => setNewValidUntil(e.target.value)} required />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
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
