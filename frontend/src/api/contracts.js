export const API_BASE_URL = '/api/v1';

export const API_PATHS = {
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    me: '/auth/me',
    refresh: '/auth/refresh',
  },
  tenants: {
    list: '/tenants',
    page: '/tenants/page',
    detail: (tenantId) => `/tenants/${tenantId}`,
    accounts: (tenantId) => `/tenants/${tenantId}/accounts`,
    accountsPage: (tenantId) => `/tenants/${tenantId}/accounts/page`,
    account: (tenantId, accountId) => `/tenants/${tenantId}/accounts/${accountId}`,
    journal: (tenantId) => `/tenants/${tenantId}/journal`,
    journalPage: (tenantId) => `/tenants/${tenantId}/journal/page`,
    journalEntry: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}`,
    journalSubmit: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}/submit`,
    journalApprove: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}/approve`,
    journalReject: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}/reject`,
    journalPost: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}/post`,
  },
  users: {
    list: '/users',
    page: '/users/page',
    detail: (userId) => `/users/${userId}`,
  },
  roles: {
    list: '/roles',
    page: '/roles/page',
    assignments: '/roles/assignments',
    assignmentsPage: '/roles/assignments/page',
    assignmentExtend: (assignmentId) => `/roles/assignments/${assignmentId}/extend`,
    assignmentRevoke: (assignmentId) => `/roles/assignments/${assignmentId}/revoke`,
  },
  audit: {
    list: '/audit',
    page: '/audit/page',
  },
};

/**
 * @typedef {'Reader'|'Writer'|'PowerUser'|'Approver'|'Admin'|'Officer'|'Auditor'|'PowerAdmin'} RoleName
 * @typedef {'tenant'|'global'} RoleScope
 *
 * @typedef {Object} RoleClaim
 * @property {RoleName} role
 * @property {RoleScope} scope
 * @property {string=} tenant_id
 *
 * @typedef {Object} TokenResponse
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {'bearer'} token_type
 *
 * @typedef {Object} PageParams
 * @property {number=} skip
 * @property {number=} limit
 *
 * @template T
 * @typedef {Object} Page
 * @property {number} total
 * @property {number} skip
 * @property {number} limit
 * @property {T[]} items
 */
