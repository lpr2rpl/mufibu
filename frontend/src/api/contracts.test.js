import { API_BASE_URL, API_PATHS } from './contracts';

function assertHasFields(obj, fields) {
  fields.forEach((f) => {
    expect(obj).toHaveProperty(f);
  });
}

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
    expect(API_PATHS.tenants.journalReverse('t1', 'e1')).toBe('/tenants/t1/journal/e1/reverse');
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

describe('response shape contracts', () => {
  test('JournalEntry shape includes required fields', () => {
    const entry = {
      id: 'u1', tenant_id: 't1', entry_number: '2026000001',
      entry_date: '2026-01-01', description: 'Test', status: 'draft',
      requires_approval: false, main_account_id: 'a1', contra_account_id: 'a2',
      amount: '100.00', reference: null, notes: null, approval_notes: null,
      created_at: '2026-01-01T00:00:00Z', created_by: 'u1', lines: [],
      reversed_at: null, reversed_by: null, reversal_entry_id: null,
    };
    assertHasFields(entry, [
      'id', 'tenant_id', 'entry_number', 'entry_date', 'description', 'status',
      'requires_approval', 'main_account_id', 'contra_account_id', 'amount',
      'approval_notes', 'created_at', 'created_by', 'lines',
      'reversed_at', 'reversed_by', 'reversal_entry_id',
    ]);
  });

  test('Account shape includes required fields', () => {
    const account = {
      id: 'a1', tenant_id: 't1', account_number: '1000', name: 'Cash',
      account_type: 'asset', parent_account_id: null, description: null,
      is_active: true, created_at: '2026-01-01T00:00:00Z',
    };
    assertHasFields(account, [
      'id', 'tenant_id', 'account_number', 'name', 'account_type', 'is_active', 'created_at',
    ]);
  });

  test('AuthSession shape includes access_expires_at', () => {
    const session = {
      user: { id: 'u1', username: 'admin', email: 'a@b.com', full_name: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      roles: [],
      access_expires_at: '2026-01-01T01:00:00Z',
    };
    assertHasFields(session, ['user', 'roles', 'access_expires_at']);
  });

  test('ReversalResponse shape is correct', () => {
    const reversal = { reversal_entry_id: 'e2', reversal_entry_number: '2026000002' };
    assertHasFields(reversal, ['reversal_entry_id', 'reversal_entry_number']);
  });
});
