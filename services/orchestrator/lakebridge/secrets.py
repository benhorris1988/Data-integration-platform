"""Source-credential lookup.

`secret_ref` on `lakebridge.sources` is a vault-style path like
`secret/lakebridge/ifs-reader`. Three resolver implementations:

- `EnvSecretResolver` — reads `LAKEBRIDGE_SECRET_<slug>` env var. Useful
  for local dev and CI; never deploy with this in production.
- `VaultSecretResolver` — HashiCorp Vault KV v2. The `secret_ref` is
  parsed as `<mount>/<path>` and the secret data is expected to have a
  `password` field (override via the `key` argument).
- `AzureKeyVaultResolver` — Azure Key Vault. The `secret_ref` is mapped
  to a secret name by replacing slashes with hyphens (AKV doesn't allow
  slashes in names), so `secret/lakebridge/ifs-reader` becomes
  `secret-lakebridge-ifs-reader`. Authentication uses
  DefaultAzureCredential (managed identity in prod, env vars in dev).

Which resolver to install is decided at boot time in main.py from
`LAKEBRIDGE_SECRETS_BACKEND` — default `env`.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Protocol

from .logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    pass

log = get_logger("lakebridge.secrets")


class SecretResolver(Protocol):
    def resolve(self, secret_ref: str) -> str | None:
        """Return the secret for `secret_ref`, or None if not found."""
        ...


class EnvSecretResolver:
    """Reads `secret_ref` from the env var `LAKEBRIDGE_SECRET_<slug>`,
    where `<slug>` is `secret_ref` upper-cased with `/` and `-` replaced
    by `_`. Useful for local dev and CI; never deploy with this in
    production."""

    def resolve(self, secret_ref: str) -> str | None:
        env_key = "LAKEBRIDGE_SECRET_" + secret_ref.upper().replace("/", "_").replace("-", "_")
        value = os.environ.get(env_key)
        if value is None:
            log.warning("secret.miss", secret_ref=secret_ref, env_key=env_key)
        return value


class VaultSecretResolver:
    """HashiCorp Vault KV v2 resolver.

    The `secret_ref` is split on the first `/`: the prefix is the KV
    engine mount, the remainder is the path under that mount. So
    `secret/lakebridge/ifs-reader` reads
    `<vault_url>/v1/secret/data/lakebridge/ifs-reader` and pulls the
    `password` key out of the `data.data` map.
    """

    def __init__(
        self,
        *,
        address: str,
        token: str,
        key: str = "password",
        timeout: float = 5.0,
    ) -> None:
        import hvac

        self._client = hvac.Client(url=address, token=token, timeout=timeout)
        self._key = key

    def resolve(self, secret_ref: str) -> str | None:
        if "/" not in secret_ref:
            log.warning("secret.bad_ref", secret_ref=secret_ref)
            return None
        mount, path = secret_ref.split("/", 1)
        try:
            resp: dict[str, Any] = self._client.secrets.kv.v2.read_secret_version(
                path=path, mount_point=mount, raise_on_deleted_version=True
            )
        except Exception as exc:  # hvac.exceptions.* are many; catch all
            log.warning("secret.read_failed", secret_ref=secret_ref, error=str(exc)[:200])
            return None
        data = (resp.get("data") or {}).get("data") or {}
        value = data.get(self._key)
        if not isinstance(value, str):
            log.warning("secret.missing_key", secret_ref=secret_ref, key=self._key)
            return None
        return value


class AzureKeyVaultResolver:
    """Azure Key Vault resolver.

    AKV secret names can't contain slashes, so we map `secret/foo/bar` →
    `secret-foo-bar`. Authentication uses `DefaultAzureCredential`, which
    picks up managed identity in production and the standard
    `AZURE_*` env vars in development.
    """

    def __init__(self, *, vault_url: str) -> None:
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.secrets import SecretClient

        self._client = SecretClient(
            vault_url=vault_url, credential=DefaultAzureCredential()
        )

    def resolve(self, secret_ref: str) -> str | None:
        name = secret_ref.replace("/", "-").replace("_", "-")
        try:
            return self._client.get_secret(name).value
        except Exception as exc:
            log.warning("secret.read_failed", secret_ref=secret_ref, error=str(exc)[:200])
            return None


_resolver: SecretResolver = EnvSecretResolver()


def get_resolver() -> SecretResolver:
    return _resolver


def set_resolver(resolver: SecretResolver) -> None:
    """Override the process-wide resolver. Called at boot from main.py
    based on `LAKEBRIDGE_SECRETS_BACKEND`."""
    global _resolver
    _resolver = resolver


def configure_from_env() -> None:
    """Pick a resolver based on `LAKEBRIDGE_SECRETS_BACKEND`. Called once
    during app startup.

    Recognised values:
        env   — EnvSecretResolver (default)
        vault — VaultSecretResolver, reads VAULT_ADDR + VAULT_TOKEN
        akv   — AzureKeyVaultResolver, reads LAKEBRIDGE_AKV_URL
    """
    backend = os.environ.get("LAKEBRIDGE_SECRETS_BACKEND", "env").lower()
    if backend == "env":
        set_resolver(EnvSecretResolver())
        return
    if backend == "vault":
        addr = os.environ.get("VAULT_ADDR")
        token = os.environ.get("VAULT_TOKEN")
        if not addr or not token:
            log.error("secrets.vault.misconfigured", have_addr=bool(addr), have_token=bool(token))
            raise RuntimeError(
                "LAKEBRIDGE_SECRETS_BACKEND=vault requires VAULT_ADDR + VAULT_TOKEN"
            )
        set_resolver(VaultSecretResolver(address=addr, token=token))
        log.info("secrets.vault.configured", address=addr)
        return
    if backend == "akv":
        url = os.environ.get("LAKEBRIDGE_AKV_URL")
        if not url:
            log.error("secrets.akv.misconfigured")
            raise RuntimeError(
                "LAKEBRIDGE_SECRETS_BACKEND=akv requires LAKEBRIDGE_AKV_URL"
            )
        set_resolver(AzureKeyVaultResolver(vault_url=url))
        log.info("secrets.akv.configured", vault_url=url)
        return
    raise RuntimeError(f"unknown LAKEBRIDGE_SECRETS_BACKEND: {backend!r}")
