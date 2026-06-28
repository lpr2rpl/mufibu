export const API_BASE_URL = '/api/v1';

export const API_PATHS = {
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    me: '/auth/me',
    refresh: '/auth/refresh',
    changePassword: '/auth/change-password',
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
    journalReverse: (tenantId, entryId) => `/tenants/${tenantId}/journal/${entryId}/reverse`,
    summary: (tenantId) => `/tenants/${tenantId}/summary`,
    trialBalance: (tenantId) => `/tenants/${tenantId}/trial-balance`,
    incomeStatement: (tenantId) => `/tenants/${tenantId}/income-statement`,
    balanceSheet: (tenantId) => `/tenants/${tenantId}/balance-sheet`,
    accountLedger: (tenantId, accountId) => `/tenants/${tenantId}/accounts/${accountId}/ledger`,
    accountsTree: (tenantId) => `/tenants/${tenantId}/accounts/tree`,
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
 * Login, refresh, and /auth/me return this; tokens are delivered as httpOnly
 * cookies, never in the body.
 * @typedef {Object} AuthSession
 * @property {Object} user
 * @property {RoleClaim[]} roles
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
 *
 * @typedef {Object} JournalEntry
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} entry_number
 * @property {string} entry_date
 * @property {string} description
 * @property {'draft'|'pending_approval'|'approved'|'rejected'|'posted'} status
 * @property {boolean} requires_approval
 * @property {string} main_account_id
 * @property {string} contra_account_id
 * @property {string} amount
 * @property {string=} reference
 * @property {string=} notes
 * @property {string=} approval_notes
 * @property {string} created_at
 * @property {string} created_by
 * @property {JournalEntryLine[]} lines
 *
 * @typedef {Object} JournalEntryLine
 * @property {string} id
 * @property {number} line_number
 * @property {string} account_id
 * @property {'debit'|'credit'} debit_credit
 * @property {string} amount
 * @property {string=} description
 *
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} account_number
 * @property {string} name
 * @property {'asset'|'liability'|'equity'|'revenue'|'expense'} account_type
 * @property {string=} parent_account_id
 * @property {string=} description
 * @property {boolean} is_active
 * @property {string} created_at
 *
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} occurred_at
 * @property {string=} user_id
 * @property {string=} tenant_id
 * @property {string} action
 * @property {string=} table_name
 * @property {string=} record_id
 * @property {Object=} old_values
 * @property {Object=} new_values
 * @property {string=} notes
 *
 * @typedef {Object} ReversalResponse
 * @property {string} reversal_entry_id
 * @property {string} reversal_entry_number
 */
