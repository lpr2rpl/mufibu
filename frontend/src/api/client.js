import axios from 'axios';
import { API_BASE_URL, API_PATHS } from './contracts';

// Auth tokens live in httpOnly cookies (set by the backend), so the browser
// attaches them automatically; withCredentials makes axios send them.
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Read a non-httpOnly cookie (used only for the CSRF token).
function readCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

const UNSAFE_METHODS = ['post', 'put', 'patch', 'delete'];

// Double-submit CSRF: echo the csrf_token cookie in a header on unsafe methods.
api.interceptors.request.use((config) => {
  if (UNSAFE_METHODS.includes((config.method || 'get').toLowerCase())) {
    const csrf = readCookie('csrf_token');
    if (csrf) {
      config.headers['X-CSRF-Token'] = csrf;
    }
  }
  return config;
});

// On 401, attempt a single cookie-based refresh, then retry the original.
// A shared promise coalesces concurrent refreshes.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isRefreshCall = original?.url?.includes(API_PATHS.auth.refresh);
    if (error.response?.status === 401 && original && !original._retry && !isRefreshCall) {
      original._retry = true;
      try {
        refreshing = refreshing || api.post(API_PATHS.auth.refresh);
        await refreshing;
        refreshing = null;
        return api(original);
      } catch (refreshError) {
        refreshing = null;
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
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
export const refreshTokens = () => api.post(API_PATHS.auth.refresh);
export const changePassword = (body) => api.post(API_PATHS.auth.changePassword, body);
export const updateProfile = (data) => api.patch(API_PATHS.auth.me, data);

// Tenants
export const getTenants = () => api.get(API_PATHS.tenants.list);
export const getTenantSummary = (tenantId) =>
  api.get(API_PATHS.tenants.summary(tenantId));
export const getTenantsPage = (params) => api.get(API_PATHS.tenants.page, { params });
export const createTenant = (data) => api.post(API_PATHS.tenants.list, data);
export const updateTenant = (tenantId, data) => api.patch(API_PATHS.tenants.detail(tenantId), data);

// Users
export const getUsers = () => api.get(API_PATHS.users.list);
export const getUsersPage = (params) => api.get(API_PATHS.users.page, { params });
export const getUser = (userId) => api.get(API_PATHS.users.detail(userId));
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
export const getAccountLedger = (tenantId, accountId, params) =>
  api.get(API_PATHS.tenants.accountLedger(tenantId, accountId), { params });
export const getTrialBalance = (tenantId, asOfDate) =>
  api.get(API_PATHS.tenants.trialBalance(tenantId), { params: asOfDate ? { as_of_date: asOfDate } : {} });
export const getIncomeStatement = (tenantId, asOfDate, fromDate) => {
  const params = {};
  if (asOfDate) params.as_of_date = asOfDate;
  if (fromDate) params.from_date = fromDate;
  return api.get(API_PATHS.tenants.incomeStatement(tenantId), { params });
};
export const getBalanceSheet = (tenantId, asOfDate) =>
  api.get(API_PATHS.tenants.balanceSheet(tenantId), { params: asOfDate ? { as_of_date: asOfDate } : {} });

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
export const reverseEntry = (tenantId, entryId) =>
  api.post(API_PATHS.tenants.journalReverse(tenantId, entryId));

// Audit
export const getAuditLog = (params) => api.get(API_PATHS.audit.list, { params });
export const getAuditLogPage = (params) => api.get(API_PATHS.audit.page, { params });

export default api;
