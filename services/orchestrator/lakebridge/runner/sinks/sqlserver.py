"""SQL Server staging sink.

`fast_executemany=True` is the difference between 100 rows/sec and
80,000+ rows/sec for batched parameterised inserts — always use it for the
load step.

The sink does not own the target table's schema. The DBA pre-provisions
the table per `db/staging/conventions.md`; this code only writes rows and
appends the Lakebridge trailer columns (`lb_run_id`, `lb_loaded_at`, …).
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from typing import Any

# pyodbc is imported lazily inside functions so the rest of the package
# (and the test suite) imports cleanly on machines that have no ODBC driver.


_TRAILER_COLUMNS = (
    "lb_run_id",
    "lb_loaded_at",
    "lb_source_hash",
    "lb_quarantined",
    "lb_quarantine_reason",
)


def truncate(conn: Any, schema: str, table: str) -> None:
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE [{schema}].[{table}]")
    conn.commit()


def target_count(conn: Any, schema: str, table: str, run_id: int | None) -> int:
    """Count rows in the staging table.

    When `run_id` is supplied, restrict to that run's rows (correct for
    `append` / `watermark_delta`). When omitted, count the whole table
    (correct for `full_snapshot` / `truncate_and_load`).
    """
    sql = f"SELECT COUNT_BIG(*) FROM [{schema}].[{table}]"
    params: tuple[Any, ...] = ()
    if run_id is not None:
        sql += " WHERE lb_run_id = ?"
        params = (run_id,)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return int(row[0]) if row else 0


def row_hash(values: Iterable[Any]) -> str:
    """Canonical hex MD5 over a row's values. Used as `lb_source_hash`."""
    h = hashlib.md5(usedforsecurity=False)
    for v in values:
        h.update(b"\x1f")
        h.update(b"\x00" if v is None else str(v).encode("utf-8"))
    return h.hexdigest()


def bulk_insert(
    conn: Any,
    schema: str,
    table: str,
    columns: list[str],
    rows: list[tuple[Any, ...]],
    *,
    run_id: int,
) -> int:
    """Insert `rows` into the staging table, appending the trailer columns.

    Returns the number of rows written (== `len(rows)` on success, since
    pyodbc with fast_executemany doesn't surface per-row failures — the
    whole batch either lands or rolls back).
    """
    if not rows:
        return 0
    full_columns = [*columns, *_TRAILER_COLUMNS]
    placeholders = ", ".join("?" for _ in full_columns)
    quoted = ", ".join(f"[{c}]" for c in full_columns)
    sql = f"INSERT INTO [{schema}].[{table}] ({quoted}) VALUES ({placeholders})"

    enriched: list[tuple[Any, ...]] = []
    for r in rows:
        h = row_hash(r)
        # lb_loaded_at is filled by the DEFAULT; we still pass None for
        # column-positional safety so the SQL doesn't need per-row variants.
        enriched.append((*r, run_id, None, h, 0, None))

    with conn.cursor() as cur:
        cur.fast_executemany = True
        cur.executemany(sql, enriched)
    return len(rows)


def commit(conn: Any) -> None:
    conn.commit()


def rollback(conn: Any) -> None:
    import contextlib

    with contextlib.suppress(Exception):  # pragma: no cover — already-closed conns can't roll back
        conn.rollback()


def open_connection(odbc_dsn: str) -> Any:
    """Open a fresh SQL Server connection. The runner uses its own conn
    (separate from the API pool) so a long-running load doesn't starve API
    handlers."""
    import pyodbc

    conn = pyodbc.connect(odbc_dsn, autocommit=False)
    conn.setdecoding(pyodbc.SQL_CHAR, encoding="utf-8")
    conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-8")
    conn.setencoding(encoding="utf-8")
    return conn
