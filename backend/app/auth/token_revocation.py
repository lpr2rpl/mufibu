"""
Pure token-revocation watermark logic shared by the auth code and tests.

Tokens are stateless, so to revoke them without a per-token store the backend
keeps a per-user watermark (users.tokens_valid_after).  Any token whose iat
(issued-at) is before the watermark is rejected.  Bumping the watermark to the
current time therefore revokes all of that user's outstanding access and
refresh tokens at once - used by logout, account deactivation/deletion, and the
PowerAdmin force-logout endpoint.

Kept free of framework/DB imports so it can be unit-tested without a database
(mirrors app/auth/permissions.py).
"""
from datetime import datetime, timezone
from typing import Optional


def token_revoked(
    issued_at_epoch: Optional[int],
    tokens_valid_after: Optional[datetime],
) -> bool:
    """
    Return True when a token is invalidated by the user's revocation watermark.

    A token issued at or after the watermark is still valid.  A token issued
    before it - or one carrying no iat claim, which cannot be proven recent - is
    treated as revoked.  When no watermark is set, nothing is revoked.
    """
    if tokens_valid_after is None:
        return False
    if not issued_at_epoch:
        return True
    issued = datetime.fromtimestamp(issued_at_epoch, tz=timezone.utc)
    return issued < tokens_valid_after
