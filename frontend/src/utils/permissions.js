export function hasGlobalRole(roles, ...names) {
  return roles.some(r => names.includes(r.role) && r.scope === 'global');
}

export function hasTenantRole(roles, tenantId, ...names) {
  return roles.some(r => names.includes(r.role) && r.tenant_id === tenantId);
}

export function canReadBookings(roles, tenantId) {
  return (
    hasTenantRole(roles, tenantId, 'Reader', 'Writer', 'PowerUser', 'Approver', 'Officer') ||
    hasGlobalRole(roles, 'Auditor')
  );
}

export function canWriteBookings(roles, tenantId) {
  return hasTenantRole(roles, tenantId, 'Writer', 'PowerUser');
}

export function canApproveBookings(roles, tenantId) {
  return hasTenantRole(roles, tenantId, 'Approver');
}

export function canManageRoles(roles, tenantId) {
  return hasTenantRole(roles, tenantId, 'Admin') || hasGlobalRole(roles, 'PowerAdmin');
}

export function canReadAccounts(roles, tenantId) {
  return canReadBookings(roles, tenantId) ||
    hasTenantRole(roles, tenantId, 'Admin') ||
    hasGlobalRole(roles, 'PowerAdmin');
}

export function canWriteAccounts(roles, tenantId) {
  // Admin manages role assignments only and has no account write access;
  // mirrors require_account_write and the accounts RLS write policy.
  return hasTenantRole(roles, tenantId, 'PowerUser') || hasGlobalRole(roles, 'PowerAdmin');
}

export function canPostJournalEntry(roles, tenantId) {
  return hasTenantRole(roles, tenantId, 'PowerUser');
}

export function canShowUserRoleRoute(roles) {
  return hasGlobalRole(roles, 'PowerAdmin') || roles.some(r => r.role === 'Admin');
}

export function canShowTenantsRoute(roles) {
  return hasGlobalRole(roles, 'PowerAdmin');
}

export function canShowAuditRoute(roles) {
  return hasGlobalRole(roles, 'Auditor', 'PowerAdmin') || roles.some(r => r.role === 'Officer');
}
