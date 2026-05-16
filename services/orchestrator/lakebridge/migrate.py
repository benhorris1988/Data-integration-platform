"""Migration runner — applies numbered T-SQL files from `db/migrations/`.

Each file is expected to be safe to re-run (i.e. uses `IF OBJECT_ID … IS NULL`
or `CREATE OR ALTER`), but the ledger ensures we never run the same file
twice in normal operation. Each batch separated by `GO` is sent as its own
`cursor.execute()` call because pyodbc cannot parse `GO` itself.
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import click

from .config import get_settings
from .db import connection
from .logging import configure, get_logger

log = get_logger("lakebridge.migrate")

_FILENAME = re.compile(r"^(\d{4})_(.+)\.sql$")
# Split T-SQL on `GO` separator lines (case-insensitive, on its own line).
_GO_SPLIT = re.compile(r"^\s*GO\s*$", re.IGNORECASE | re.MULTILINE)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()

    @property
    def batches(self) -> list[str]:
        return [b.strip() for b in _GO_SPLIT.split(self.sql) if b.strip()]


def discover(directory: Path) -> list[Migration]:
    """Return migrations in version order."""
    found: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        m = _FILENAME.match(path.name)
        if not m:
            continue
        version = int(m.group(1))
        name = m.group(2)
        found.append(Migration(version, name, path, path.read_text(encoding="utf-8")))
    return found


def applied(conn: Any) -> dict[int, dict[str, Any]]:
    """Return applied migrations keyed by version. Empty if the ledger
    table does not exist yet (first run)."""
    with conn.cursor() as cur:
        cur.execute("SELECT OBJECT_ID(N'lakebridge.schema_migrations', N'U')")
        row = cur.fetchone()
        if row is None or row[0] is None:
            return {}
        cur.execute(
            "SELECT version, name, checksum, applied_at, duration_ms "
            "FROM lakebridge.schema_migrations"
        )
        cols = [c[0] for c in cur.description]
        return {
            r[cols.index("version")]: dict(zip(cols, r, strict=True))
            for r in cur.fetchall()
        }


def _record(conn: Any, m: Migration, duration_ms: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO lakebridge.schema_migrations "
            "(version, name, checksum, duration_ms) VALUES (?, ?, ?, ?)",
            (m.version, m.name, m.checksum, duration_ms),
        )


def apply(conn: Any, m: Migration) -> int:
    """Apply a single migration. Returns elapsed milliseconds."""
    log.info("migration.apply.start", version=m.version, name=m.name)
    started = time.monotonic()
    # Each migration runs in its own transaction. If any batch fails the
    # whole migration is rolled back and the ledger is not updated.
    try:
        with conn.cursor() as cur:
            for batch in m.batches:
                cur.execute(batch)
        # Only record the ledger row AFTER the DDL committed cleanly.
        elapsed_ms = int((time.monotonic() - started) * 1000)
        _record(conn, m, elapsed_ms)
        conn.commit()
    except Exception:
        conn.rollback()
        log.exception("migration.apply.failed", version=m.version, name=m.name)
        raise
    log.info("migration.apply.ok", version=m.version, name=m.name, duration_ms=elapsed_ms)
    return elapsed_ms


@click.group()
def cli() -> None:
    """Lakebridge migration CLI."""
    configure(level="INFO")


@cli.command()
def up() -> None:
    """Apply all pending migrations."""
    s = get_settings()
    migrations = discover(s.migrations_dir)
    if not migrations:
        click.echo(f"no migrations found in {s.migrations_dir}")
        return
    with connection() as conn:
        existing = applied(conn)
        pending = [m for m in migrations if m.version not in existing]
        if not pending:
            click.echo(f"up to date — {len(migrations)} migrations applied")
            return
        for m in pending:
            click.echo(f"applying {m.version:04d}_{m.name} …")
            apply(conn, m)
        click.echo(f"applied {len(pending)} migrations")


@cli.command()
def status() -> None:
    """Show applied vs pending."""
    s = get_settings()
    migrations = discover(s.migrations_dir)
    with connection() as conn:
        existing = applied(conn)
    click.echo(f"migrations dir: {s.migrations_dir}")
    click.echo(f"found:   {len(migrations)}")
    click.echo(f"applied: {len(existing)}")
    for m in migrations:
        marker = "✓" if m.version in existing else " "
        click.echo(f"  [{marker}] {m.version:04d}  {m.name}")


@cli.command()
@click.argument("version", type=int)
def verify(version: int) -> None:
    """Compare an applied migration's stored checksum with the file on disk.

    Drift means somebody hand-edited the SQL after it ran — which can
    break the next environment that applies it from scratch.
    """
    s = get_settings()
    migrations = {m.version: m for m in discover(s.migrations_dir)}
    if version not in migrations:
        raise click.UsageError(f"no migration file for version {version}")
    with connection() as conn:
        existing = applied(conn)
    if version not in existing:
        raise click.UsageError(f"version {version} not yet applied")
    on_disk = migrations[version].checksum
    on_db = existing[version]["checksum"]
    if on_disk == on_db:
        click.echo(f"ok — {version:04d} matches on disk and in db")
    else:
        click.echo(f"DRIFT — {version:04d}")
        click.echo(f"  disk: {on_disk}")
        click.echo(f"  db:   {on_db}")
        raise SystemExit(2)


if __name__ == "__main__":  # pragma: no cover
    cli()
