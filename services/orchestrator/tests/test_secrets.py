"""SecretResolver implementations — env, vault, AKV.

We don't have a real Vault / AKV in CI, so we substitute fake SDK
clients via monkeypatch before constructing the resolver. The bug
surface we care about is the path-mapping + missing-secret handling.
"""

from __future__ import annotations

from typing import Any

import pytest

from lakebridge import secrets as secretsmod


def test_env_resolver_finds_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "LAKEBRIDGE_SECRET_SECRET_LAKEBRIDGE_IFS_READER", "supersecret"
    )
    r = secretsmod.EnvSecretResolver()
    assert r.resolve("secret/lakebridge/ifs-reader") == "supersecret"


def test_env_resolver_misses_when_unset() -> None:
    r = secretsmod.EnvSecretResolver()
    assert r.resolve("secret/never/configured") is None


def test_vault_resolver_path_split(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakeKvV2:
        def read_secret_version(
            self,
            *,
            path: str,
            mount_point: str,
            raise_on_deleted_version: bool,
        ) -> dict[str, Any]:
            captured["mount"] = mount_point
            captured["path"] = path
            captured["raise"] = raise_on_deleted_version
            return {"data": {"data": {"password": "from-vault"}}}

    class FakeKv:
        v2 = FakeKvV2()

    class FakeSecrets:
        kv = FakeKv()

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        secrets = FakeSecrets()

    import hvac

    monkeypatch.setattr(hvac, "Client", FakeClient)

    r = secretsmod.VaultSecretResolver(address="http://vault", token="t")
    out = r.resolve("secret/lakebridge/ifs-reader")
    assert out == "from-vault"
    # The vault path is split on the first slash; everything after is the
    # path under the mount.
    assert captured["mount"] == "secret"
    assert captured["path"] == "lakebridge/ifs-reader"


def test_vault_resolver_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeKvV2:
        def read_secret_version(self, **_kw: Any) -> dict[str, Any]:
            return {"data": {"data": {"username": "no-password-field"}}}

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        secrets = type("S", (), {"kv": type("K", (), {"v2": FakeKvV2()})()})()

    import hvac

    monkeypatch.setattr(hvac, "Client", FakeClient)
    r = secretsmod.VaultSecretResolver(address="http://vault", token="t")
    assert r.resolve("secret/lakebridge/ifs-reader") is None


def test_vault_resolver_handles_sdk_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeKvV2:
        def read_secret_version(self, **_kw: Any) -> dict[str, Any]:
            raise RuntimeError("upstream connection refused")

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        secrets = type("S", (), {"kv": type("K", (), {"v2": FakeKvV2()})()})()

    import hvac

    monkeypatch.setattr(hvac, "Client", FakeClient)
    r = secretsmod.VaultSecretResolver(address="http://vault", token="t")
    # Returns None rather than raising — surfaces as "secret miss" upstream.
    assert r.resolve("secret/foo/bar") is None


def test_akv_resolver_maps_slashes_to_hyphens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeSecret:
        value = "from-akv"

    class FakeClient:
        def __init__(self, **_kw: Any) -> None:
            pass

        def get_secret(self, name: str) -> FakeSecret:
            captured["name"] = name
            return FakeSecret()

    from azure.keyvault import secrets as az_secrets

    monkeypatch.setattr(az_secrets, "SecretClient", FakeClient)

    r = secretsmod.AzureKeyVaultResolver(vault_url="https://kv.vault.azure.net")
    assert r.resolve("secret/lakebridge/ifs-reader") == "from-akv"
    # AKV doesn't allow slashes in secret names — verify the mapping.
    assert captured["name"] == "secret-lakebridge-ifs-reader"


def test_configure_from_env_unknown_backend_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LAKEBRIDGE_SECRETS_BACKEND", "garbage")
    with pytest.raises(RuntimeError):
        secretsmod.configure_from_env()


def test_configure_from_env_vault_requires_addr_and_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LAKEBRIDGE_SECRETS_BACKEND", "vault")
    monkeypatch.delenv("VAULT_ADDR", raising=False)
    monkeypatch.delenv("VAULT_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="VAULT_ADDR"):
        secretsmod.configure_from_env()
