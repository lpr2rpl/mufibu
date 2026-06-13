/** Returns deduplicated tenant IDs accessible to the current user from their roles array. */
export function getTenantIds(roles) {
  const tenantRoles = roles.filter(r => r.scope === 'tenant');
  return [...new Set(tenantRoles.map(r => r.tenant_id).filter(Boolean))];
}

/** Truncates a UUID/ID to a short displayable form, e.g. "a1b2c3d4..." */
export function truncateId(id, length = 8) {
  if (!id) return '-';
  return id.length > length ? id.slice(0, length) + '...' : id;
}
