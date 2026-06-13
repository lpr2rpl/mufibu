import { API_BASE_URL, API_PATHS } from './contracts';

describe('api contract paths', () => {
  test('base URL matches backend router prefix', () => {
    expect(API_BASE_URL).toBe('/api/v1');
  });

  test('tenant-scoped paths match backend route shape', () => {
    expect(API_PATHS.tenants.accounts('t1')).toBe('/tenants/t1/accounts');
    expect(API_PATHS.tenants.accountsPage('t1')).toBe('/tenants/t1/accounts/page');
    expect(API_PATHS.tenants.journal('t1')).toBe('/tenants/t1/journal');
    expect(API_PATHS.tenants.journalPage('t1')).toBe('/tenants/t1/journal/page');
    expect(API_PATHS.tenants.journalApprove('t1', 'e1')).toBe('/tenants/t1/journal/e1/approve');
  });

  test('role assignment paths match backend route shape', () => {
    expect(API_PATHS.roles.assignments).toBe('/roles/assignments');
    expect(API_PATHS.roles.assignmentsPage).toBe('/roles/assignments/page');
    expect(API_PATHS.roles.assignmentRevoke('a1')).toBe('/roles/assignments/a1/revoke');
  });

  test('top-level page paths match backend route shape', () => {
    expect(API_PATHS.tenants.page).toBe('/tenants/page');
    expect(API_PATHS.users.page).toBe('/users/page');
    expect(API_PATHS.roles.page).toBe('/roles/page');
    expect(API_PATHS.audit.page).toBe('/audit/page');
  });
});
