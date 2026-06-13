import {
  canApproveBookings,
  canPostJournalEntry,
  canReadBookings,
  canShowAuditRoute,
  canShowTenantsRoute,
  canShowUserRoleRoute,
  canWriteBookings,
  canWriteAccounts,
  hasGlobalRole,
  hasTenantRole,
} from './permissions';

const tenantA = 'tenant-a';
const tenantB = 'tenant-b';

const tenantRole = (role, tenantId = tenantA) => ({ role, scope: 'tenant', tenant_id: tenantId });
const globalRole = (role) => ({ role, scope: 'global' });

describe('permission helpers', () => {
  test('tenant roles are tenant-isolated', () => {
    const roles = [tenantRole('Reader', tenantA)];

    expect(hasTenantRole(roles, tenantA, 'Reader')).toBe(true);
    expect(hasTenantRole(roles, tenantB, 'Reader')).toBe(false);
    expect(canReadBookings(roles, tenantA)).toBe(true);
    expect(canReadBookings(roles, tenantB)).toBe(false);
  });

  test('approver and officer can read but cannot write bookings', () => {
    const approverRoles = [tenantRole('Approver')];
    const officerRoles = [tenantRole('Officer')];

    expect(canReadBookings(approverRoles, tenantA)).toBe(true);
    expect(canApproveBookings(approverRoles, tenantA)).toBe(true);
    expect(canWriteBookings(approverRoles, tenantA)).toBe(false);

    expect(canReadBookings(officerRoles, tenantA)).toBe(true);
    expect(canWriteBookings(officerRoles, tenantA)).toBe(false);
  });

  test('writer can create bookings but only power user can post', () => {
    const writerRoles = [tenantRole('Writer')];
    const powerUserRoles = [tenantRole('PowerUser')];

    expect(canWriteBookings(writerRoles, tenantA)).toBe(true);
    expect(canPostJournalEntry(writerRoles, tenantA)).toBe(false);

    expect(canWriteBookings(powerUserRoles, tenantA)).toBe(true);
    expect(canPostJournalEntry(powerUserRoles, tenantA)).toBe(true);
  });

  test('navigation route visibility follows role boundaries', () => {
    const readerRoles = [tenantRole('Reader')];
    const adminRoles = [tenantRole('Admin')];
    const officerRoles = [tenantRole('Officer')];
    const auditorRoles = [globalRole('Auditor')];
    const powerAdminRoles = [globalRole('PowerAdmin')];

    expect(canShowUserRoleRoute(readerRoles)).toBe(false);
    expect(canShowUserRoleRoute(adminRoles)).toBe(true);
    expect(canShowUserRoleRoute(powerAdminRoles)).toBe(true);

    expect(canShowTenantsRoute(adminRoles)).toBe(false);
    expect(canShowTenantsRoute(powerAdminRoles)).toBe(true);

    expect(canShowAuditRoute(readerRoles)).toBe(false);
    expect(canShowAuditRoute(officerRoles)).toBe(true);
    expect(canShowAuditRoute(auditorRoles)).toBe(true);
  });

  test('account write visibility matches frontend action rules', () => {
    expect(canWriteAccounts([tenantRole('PowerUser')], tenantA)).toBe(true);
    expect(canWriteAccounts([tenantRole('Admin')], tenantA)).toBe(true);
    expect(canWriteAccounts([globalRole('PowerAdmin')], tenantA)).toBe(true);
    expect(canWriteAccounts([tenantRole('Writer')], tenantA)).toBe(false);
  });

  test('global role helper handles multiple names', () => {
    const roles = [globalRole('Auditor')];

    expect(hasGlobalRole(roles, 'Auditor', 'PowerAdmin')).toBe(true);
    expect(hasGlobalRole(roles, 'PowerAdmin')).toBe(false);
  });
});
