import axios from 'axios';

const BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
          original.headers['Authorization'] = `Bearer ${data.access_token}`;
          return api(original);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (username, password) =>
  api.post('/auth/login', { username, password });
export const logout = () => api.post('/auth/logout');
export const getMe = () => api.get('/auth/me');

// Tenants
export const getTenants = () => api.get('/tenants');
export const createTenant = (data) => api.post('/tenants', data);

// Users
export const getUsers = () => api.get('/users');
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.patch(`/users/${id}`, data);

// Roles
export const getRoles = () => api.get('/roles');
export const getAssignments = (params) => api.get('/roles/assignments', { params });
export const assignRole = (data) => api.post('/roles/assignments', data);
export const extendAssignment = (id, data) => api.patch(`/roles/assignments/${id}/extend`, data);
export const revokeAssignment = (id, data) => api.patch(`/roles/assignments/${id}/revoke`, data);

// Accounts
export const getAccounts = (tenantId, params) =>
  api.get(`/tenants/${tenantId}/accounts`, { params });
export const createAccount = (tenantId, data) =>
  api.post(`/tenants/${tenantId}/accounts`, data);
export const updateAccount = (tenantId, accountId, data) =>
  api.patch(`/tenants/${tenantId}/accounts/${accountId}`, data);

// Journal
export const getJournalEntries = (tenantId, params) =>
  api.get(`/tenants/${tenantId}/journal`, { params });
export const getJournalEntry = (tenantId, entryId) =>
  api.get(`/tenants/${tenantId}/journal/${entryId}`);
export const createJournalEntry = (tenantId, data) =>
  api.post(`/tenants/${tenantId}/journal`, data);
export const updateJournalEntry = (tenantId, entryId, data) =>
  api.patch(`/tenants/${tenantId}/journal/${entryId}`, data);
export const submitEntry = (tenantId, entryId) =>
  api.post(`/tenants/${tenantId}/journal/${entryId}/submit`);
export const approveEntry = (tenantId, entryId, data) =>
  api.post(`/tenants/${tenantId}/journal/${entryId}/approve`, data);
export const rejectEntry = (tenantId, entryId, data) =>
  api.post(`/tenants/${tenantId}/journal/${entryId}/reject`, data);
export const postEntry = (tenantId, entryId) =>
  api.post(`/tenants/${tenantId}/journal/${entryId}/post`);

// Audit
export const getAuditLog = (params) => api.get('/audit', { params });

export default api;
