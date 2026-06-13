import unittest
import uuid

from app.auth.permissions import (
    POWER_ADMIN_ONLY_ROLES,
    is_admin,
    is_approver,
    is_auditor,
    is_officer,
    is_power_admin,
    is_power_user,
    is_reader,
    is_writer,
)
from app.rls import build_rls_context


TENANT_A = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
TENANT_B = uuid.UUID("00000000-0000-0000-0000-0000000000b2")
TENANT_C = uuid.UUID("00000000-0000-0000-0000-0000000000c3")
TENANT_D = uuid.UUID("00000000-0000-0000-0000-0000000000d4")
TENANT_E = uuid.UUID("00000000-0000-0000-0000-0000000000e5")
TENANT_F = uuid.UUID("00000000-0000-0000-0000-0000000000f6")
USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


def tenant_role(role, tenant_id):
    return {"role": role, "scope": "tenant", "tenant_id": str(tenant_id)}


def global_role(role):
    return {"role": role, "scope": "global"}


class SecurityContractTests(unittest.TestCase):
    def test_tenant_isolation(self):
        roles = [tenant_role("Reader", TENANT_A)]

        self.assertTrue(is_reader(roles, TENANT_A))
        self.assertFalse(is_reader(roles, TENANT_B))
        self.assertFalse(is_writer(roles, TENANT_A))
        self.assertFalse(is_admin(roles, TENANT_A))

    def test_journal_workflow_roles(self):
        writer = [tenant_role("Writer", TENANT_A)]
        power_user = [tenant_role("PowerUser", TENANT_A)]
        approver = [tenant_role("Approver", TENANT_A)]

        self.assertTrue(is_reader(writer, TENANT_A))
        self.assertTrue(is_writer(writer, TENANT_A))
        self.assertFalse(is_power_user(writer, TENANT_A))
        self.assertFalse(is_approver(writer, TENANT_A))

        self.assertTrue(is_writer(power_user, TENANT_A))
        self.assertTrue(is_power_user(power_user, TENANT_A))

        self.assertTrue(is_reader(approver, TENANT_A))
        self.assertTrue(is_approver(approver, TENANT_A))
        self.assertFalse(is_writer(approver, TENANT_A))

    def test_audit_visibility_roles(self):
        officer = [tenant_role("Officer", TENANT_A)]
        auditor = [global_role("Auditor")]
        power_admin = [global_role("PowerAdmin")]

        self.assertTrue(is_officer(officer, TENANT_A))
        self.assertTrue(is_reader(officer, TENANT_A))
        self.assertFalse(is_officer(officer, TENANT_B))
        self.assertFalse(is_writer(officer, TENANT_A))

        self.assertTrue(is_auditor(auditor))
        self.assertTrue(is_reader(auditor, TENANT_B))
        self.assertFalse(is_writer(auditor, TENANT_B))

        self.assertTrue(is_power_admin(power_admin))
        self.assertFalse(is_reader(power_admin, TENANT_A))

    def test_role_assignment_power_admin_only_roles(self):
        self.assertEqual(POWER_ADMIN_ONLY_ROLES, {"Admin", "Officer"})

    def test_rls_context_maps_all_roles(self):
        roles = [
            tenant_role("Reader", TENANT_A),
            tenant_role("Writer", TENANT_B),
            tenant_role("PowerUser", TENANT_C),
            tenant_role("Approver", TENANT_D),
            tenant_role("Officer", TENANT_E),
            tenant_role("Admin", TENANT_F),
            global_role("Auditor"),
            global_role("PowerAdmin"),
        ]

        ctx = build_rls_context(str(USER_ID), roles)

        self.assertEqual(ctx.user_id, str(USER_ID))
        self.assertEqual(
            set(ctx.readable_tenant_ids),
            {str(TENANT_A), str(TENANT_B), str(TENANT_C), str(TENANT_D), str(TENANT_E)},
        )
        self.assertEqual(set(ctx.writable_tenant_ids), {str(TENANT_B), str(TENANT_C)})
        self.assertEqual(set(ctx.admin_tenant_ids), {str(TENANT_F)})
        self.assertTrue(ctx.is_auditor)
        self.assertTrue(ctx.is_power_admin)
        self.assertFalse(ctx.bypass_rls)


if __name__ == "__main__":
    unittest.main()
