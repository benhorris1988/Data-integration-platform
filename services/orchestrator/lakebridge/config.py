"""Runtime configuration, loaded from environment via pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_migrations_dir() -> Path:
    # services/orchestrator/lakebridge/config.py → repo_root/db/migrations
    return Path(__file__).resolve().parents[3] / "db" / "migrations"


class Settings(BaseSettings):
    """Process-wide configuration. Read once at startup."""

    model_config = SettingsConfigDict(
        env_prefix="LAKEBRIDGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Environment metadata (shown in the UI footer / top bar) ────────────
    env: str = "dev"
    region: str = "local"
    build: str = "dev"

    # ── SQL Server (application metadata + staging lake) ───────────────────
    # Either supply a full ODBC connection string OR the component parts.
    mssql_dsn: str | None = None
    mssql_host: str = "localhost"
    mssql_port: int = 1433
    mssql_database: str = "lakebridge"
    mssql_user: str = "sa"
    mssql_password: str = ""
    mssql_driver: str = "ODBC Driver 18 for SQL Server"
    mssql_encrypt: str = "yes"
    mssql_trust_server_certificate: str = "yes"
    mssql_pool_size: int = 8
    mssql_login_timeout_sec: int = 10

    # ── Migrations ─────────────────────────────────────────────────────────
    migrations_dir: Path = Field(default_factory=_default_migrations_dir)

    # ── Scheduler ──────────────────────────────────────────────────────────
    scheduler_enabled: bool = True
    scheduler_tick_sec: int = 5
    runner_concurrency: int = 4

    # ── API ────────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    cors_allow_origins: list[str] = ["http://localhost:5173"]

    # ── Authentication ────────────────────────────────────────────────────
    # auth_mode picks how `/api/me` resolves the current user:
    #   "oidc"     — verify Okta ID tokens; mint our own session cookie
    #   "dev"      — allow `/api/auth/dev-session` to stamp a session as
    #                any seeded user. Do NOT use in production.
    #   "disabled" — every request becomes anonymous Admin. Use only for
    #                tests and CI smoke runs.
    auth_mode: Literal["oidc", "dev", "disabled"] = "dev"
    # Signing key for the session cookie. Rotate by changing this value;
    # existing sessions are invalidated on rotation.
    session_secret: str = "change-me-in-production"
    session_cookie_name: str = "lb_session"
    session_max_age_sec: int = 60 * 60 * 8  # 8 hours
    # OIDC config (only consulted when auth_mode=oidc).
    oidc_issuer: str | None = None              # e.g. https://corp.okta.com/oauth2/default
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_audience: str | None = None            # defaults to client_id
    oidc_redirect_uri: str = "http://localhost:8080/api/auth/callback"
    oidc_post_login_redirect: str = "http://localhost:5173/"

    def odbc_connection_string(self) -> str:
        """Return an ODBC connection string for pyodbc.connect()."""
        if self.mssql_dsn:
            return self.mssql_dsn
        parts = [
            f"DRIVER={{{self.mssql_driver}}}",
            f"SERVER={self.mssql_host},{self.mssql_port}",
            f"DATABASE={self.mssql_database}",
            f"UID={self.mssql_user}",
            f"PWD={self.mssql_password}",
            f"Encrypt={self.mssql_encrypt}",
            f"TrustServerCertificate={self.mssql_trust_server_certificate}",
            f"Login Timeout={self.mssql_login_timeout_sec}",
        ]
        return ";".join(parts) + ";"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor — call this instead of constructing Settings."""
    return Settings()
