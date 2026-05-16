"""Source-credential lookup.

`secret_ref` on `lakebridge.sources` is a vault-style path like
`secret/lakebridge/ifs-reader`. In production this resolves to a Vault /
Azure Key Vault / AWS Secrets Manager lookup; in development we read the
value from an env var named after the secret_ref.

The abstraction is intentionally small so swapping the resolver is a
one-import change. The runner's password handling never leaves this
module — callers pass `secret_ref`, never a raw password.
"""

from __future__ import annotations

import os
from typing import Protocol

from .logging import get_logger

log = get_logger("lakebridge.secrets")


class SecretResolver(Protocol):
    def resolve(self, secret_ref: str) -> str | None:
        """Return the secret for `secret_ref`, or None if not found."""
        ...


class EnvSecretResolver:
    """Reads `secret_ref` from the env var `LAKEBRIDGE_SECRET_<slug>`,
    where `<slug>` is `secret_ref` upper-cased with `/` and `-` replaced by
    `_`. Useful for local dev and CI; never use it in production.
    """

    def resolve(self, secret_ref: str) -> str | None:
        env_key = "LAKEBRIDGE_SECRET_" + secret_ref.upper().replace("/", "_").replace("-", "_")
        value = os.environ.get(env_key)
        if value is None:
            log.warning("secret.miss", secret_ref=secret_ref, env_key=env_key)
        return value


# Hand-off points for the production wiring. They're stubs today — the
# `resolve()` calls raise so a misconfigured production deployment fails
# loud at boot rather than silently falling through to env vars.


class VaultSecretResolver:
    def __init__(self, *, address: str, token: str) -> None:
        self._address = address
        self._token = token

    def resolve(self, secret_ref: str) -> str | None:  # pragma: no cover
        raise NotImplementedError(
            "VaultSecretResolver is a stub — wire hvac.Client.secrets.kv.v2.read_secret_version "
            "before using this in production"
        )


class AzureKeyVaultResolver:
    def __init__(self, *, vault_url: str) -> None:
        self._vault_url = vault_url

    def resolve(self, secret_ref: str) -> str | None:  # pragma: no cover
        raise NotImplementedError(
            "AzureKeyVaultResolver is a stub — wire azure.keyvault.secrets.SecretClient before "
            "using this in production"
        )


_resolver: SecretResolver = EnvSecretResolver()


def get_resolver() -> SecretResolver:
    return _resolver


def set_resolver(resolver: SecretResolver) -> None:
    """Override the process-wide resolver. Call at boot from main.py."""
    global _resolver
    _resolver = resolver
