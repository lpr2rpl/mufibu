import axios from 'axios';
import { API_BASE_URL, API_PATHS } from './contracts';

const api = axios.create({
  baseURL: API_BASE_URL,
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
          const { data } = await axios.post(`${API_BASE_URL}${API_PATHS.auth.refresh}`, {
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
  api.post(API_PATHS.auth.login, { username, password });
export const logout = () => api.post(API_PATHS.auth.logout);
export const getMe = () => api.get(API_PATHS.auth.me);

// Tenants
export const getTenants = () => api.get(API_PATHS.tenants.list);
export const getTenantsPage = (params) => api.get(API_PATHS.tenants.page, { params });
export const createTenant = (data) => api.post(API_PATHS.tenants.list, data);

// Users
export const getUsers = () => api.get(API_PATHS.users.list);
export const getUsersPage = (params) => api.get(API_PATHS.users.page, { params });
export const createUser = (data) => api.post(API_PATHS.users.list, data);
export const updateUser = (id, data) => api.patch(API_PATHS.users.detail(id), data);

// Roles
export const getRoles = () => api.get(API_PATHS.roles.list);
export const getRolesPage = (params) => api.get(API_PATHS.roles.page, { params });
export const getAssignments = (params) => api.get(API_PATHS.roles.assignments, { params });
export const getAssignmentsPage = (params) => api.get(API_PATHS.roles.assignmentsPage, { params });
export const assignRole = (data) => api.post(API_PATHS.roles.assignments, data);
export const extendAssignment = (id, data) => api.patch(API_PATHS.roles.assignmentExtend(id), data);
export const revokeAssignment = (id, data) => api.patch(API_PATHS.roles.assignmentRevoke(id), data);

// Accounts
export const getAccounts = (tenantId, params) =>
  api.get(API_PATHS.tenants.accounts(tenantId), { params });
export const getAccountsPage = (tenantId, params) =>
  api.get(API_PATHS.tenants.accountsPage(tenantId), { params });
export const createAccount = (tenantId, data) =>
  api.post(API_PATHS.tenants.accounts(tenantId), data);
export const updateAccount = (tenantId, accountId, data) =>
  api.patch(API_PATHS.tenants.account(tenantId, accountId), data);

// Journal
export const getJournalEntries = (tenantId, params) =>
  api.get(API_PATHS.tenants.journal(tenantId), { params });
export const getJournalEntriesPage = (tenantId, params) =>
  api.get(API_PATHS.tenants.journalPage(tenantId), { params });
export const getJournalEntry = (tenantId, entryId) =>
  api.get(API_PATHS.tenants.journalEntry(tenantId, entryId));
export const createJournalEntry = (tenantId, data) =>
  api.post(API_PATHS.tenants.journal(tenantId), data);
export const updateJournalEntry = (tenantId, entryId, data) =>
  api.patch(API_PATHS.tenants.journalEntry(tenantId, entryId), data);
export const submitEntry = (tenantId, entryId) =>
  api.post(API_PATHS.tenants.journalSubmit(tenantId, entryId));
export const approveEntry = (tenantId, entryId, data) =>
  api.post(API_PATHS.tenants.journalApprove(tenantId, entryId), data);
export const rejectEntry = (tenantId, entryId, data) =>
  api.post(API_PATHS.tenants.journalReject(tenantId, entryId), data);
export const postEntry = (tenantId, entryId) =>
  api.post(API_PATHS.tenants.journalPost(tenantId, entryId));

// Audit
export const getAuditLog = (params) => api.get(API_PATHS.audit.list, { params });
export const getAuditLogPage = (params) => api.get(API_PATHS.audit.page, { params });

export default api;
