"""
Pure permission helpers shared by runtime auth code and tests.
"""

POWER_ADMIN_ONLY_ROLES = {"Admin", "Officer"}


def has_global_role(roles: list[dict], *role_names: str) -> bool:
    return any(
        r.get("role") in role_names and r.get("scope") == "global"
        for r in roles
    )


def has_tenant_role(roles: list[dict], tenant_id, *role_names: str) -> bool:
    tid = str(tenant_id)
    return any(
        r.get("role") in role_names and r.get("tenant_id") == tid
        for r in roles
    )


def is_reader(roles: list[dict], tenant_id) -> bool:
    return (
        has_tenant_role(roles, tenant_id, "Reader", "Writer", "PowerUser", "Approver", "Officer")
        or has_global_role(roles, "Auditor")
    )


def is_writer(roles: list[dict], tenant_id) -> bool:
    return has_tenant_role(roles, tenant_id, "Writer", "PowerUser")


def is_power_user(roles: list[dict], tenant_id) -> bool:
    return has_tenant_role(roles, tenant_id, "PowerUser")


def is_approver(roles: list[dict], tenant_id) -> bool:
    return has_tenant_role(roles, tenant_id, "Approver")


def is_officer(roles: list[dict], tenant_id) -> bool:
    return has_tenant_role(roles, tenant_id, "Officer")


def is_admin(roles: list[dict], tenant_id) -> bool:
    return has_tenant_role(roles, tenant_id, "Admin")


def is_auditor(roles: list[dict]) -> bool:
    return has_global_role(roles, "Auditor")


def is_power_admin(roles: list[dict]) -> bool:
    return has_global_role(roles, "PowerAdmin")
