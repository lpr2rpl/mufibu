# Role-Based Access Control

MuFiBu uses role claims in JWTs, backend permission helpers, and PostgreSQL RLS
session variables.  These layers must stay aligned.

## Roles

Tenant-scoped roles:

- `Reader`: read tenant accounting data.
- `Writer`: read tenant accounting data and create bookings.
- `PowerUser`: Writer permissions plus broader tenant booking control.
- `Approver`: read tenant bookings and approve or reject pending entries.
- `Admin`: manage role assignments for one tenant; no booking access.
- `Officer`: read-only access to assigned tenants; assigned by PowerAdmin.

Global roles:

- `Auditor`: read all tenant accounting data and audit records.
- `PowerAdmin`: create tenants and manage privileged role assignments.

## Permission Matrix

| Capability | Reader | Writer | PowerUser | Approver | Admin | Officer | Auditor | PowerAdmin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Read tenant bookings | yes | yes | yes | yes | no | yes | all | no |
| Create journal entries | no | yes | yes | no | no | no | no | no |
| Edit own draft entries | no | yes | yes | no | no | no | no | no |
| Edit any draft entries | no | no | yes | no | no | no | no | no |
| Approve or reject entries | no | no | no | yes | no | no | no | no |
| Post entries | no | no | yes | no | no | no | no | no |
| Read accounts | yes | yes | yes | yes | yes | yes | all | yes |
| Write accounts | no | no | yes | no | app yes, RLS pending alignment | no | no | yes |
| Manage tenant role assignments | no | no | no | no | tenant | no | no | all |
| Create tenants | no | no | no | no | no | no | no | yes |
| Read audit log | own via RLS | own via RLS | own via RLS | own via RLS | own via RLS | assigned tenants | all | all |

## Role Assignment Rules

- PowerAdmin can assign and revoke all roles.
- Only PowerAdmin can assign or revoke `Admin` and `Officer`.
- Tenant Admin can assign and revoke Reader, Writer, PowerUser, and Approver
  for their own tenant.
- Expired role phases are not reused; a new assignment record should be created
  when access continues after expiry.

## Token Behavior

Active role assignments are embedded in access and refresh tokens at login and
refresh time.  Because the access token is stateless, revoking a role in the
database does not affect an already-issued access token until it expires.

Use shorter access-token lifetimes when fast revocation matters.

## Alignment Rule

For every permission change, update and test all of these surfaces:

- `backend/app/auth/permissions.py`
- `backend/app/rls.py`
- `database/migrations/*_rls*.sql`
- `frontend/src/utils/permissions.js`
- route-specific backend checks
- route-level frontend guards
