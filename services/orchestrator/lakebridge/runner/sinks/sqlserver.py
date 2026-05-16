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
) -> tuple[int, list[tuple[tuple[Any, ...], str]]]:
    """Insert `rows` into the staging table, appending the trailer columns.

    Returns `(loaded_count, quarantined)`:
        loaded_count — rows successfully inserted into the target
        quarantined  — list of (row, reason) tuples that could not be inserted.
                       The caller writes these to `run_errors` with code
                       `LB-QUARANTINE` and keeps going.

    Strategy:
        1. Try the fast path: `fast_executemany` over the whole batch.
        2. If anything fails (a single overflow value rolls back the
           whole batch on pyodbc), roll back and retry per row, catching
           the rows that fail and reporting them as quarantined.

    The slow path is only paid when there's bad data — happy-path
    performance is unchanged.
    """
    if not rows:
        return 0, []

    full_columns = [*columns, *_TRAILER_COLUMNS]
    placeholders = ", ".join("?" for _ in full_columns)
    quoted = ", ".join(f"[{c}]" for c in full_columns)
    sql = f"INSERT INTO [{schema}].[{table}] ({quoted}) VALUES ({placeholders})"

    def enrich(r: tuple[Any, ...]) -> tuple[Any, ...]:
        # lb_loaded_at is filled by the table DEFAULT; we still pass None
        # for column-positional safety.
        return (*r, run_id, None, row_hash(r), 0, None)

    enriched = [enrich(r) for r in rows]

    # Fast path.
    try:
        with conn.cursor() as cur:
            cur.fast_executemany = True
            cur.executemany(sql, enriched)
        return len(rows), []
    except Exception as fast_exc:
        # Whole batch rolls back on a single bad row; we drop into per-row
        # mode to isolate the offenders. Roll back first so the connection
        # state is clean.
        import contextlib

        with contextlib.suppress(Exception):
            conn.rollback()
        # Best-effort: if the batch is just two rows, the fast-path error
        # already tells us nearly as much as a per-row probe. We still
        # iterate so the reason field gets the correct per-row message.
        _ = fast_exc

    loaded = 0
    quarantined: list[tuple[tuple[Any, ...], str]] = []
    with conn.cursor() as cur:
        for raw, full in zip(rows, enriched, strict=True):
            try:
                cur.execute(sql, full)
                loaded += 1
            except Exception as row_exc:
                reason = str(row_exc).splitlines()[0][:200]
                quarantined.append((raw, reason))
                # An aborted per-row statement may leave the cursor needing
                # rollback on some drivers; be defensive.
                with contextlib.suppress(Exception):
                    conn.rollback()
    return loaded, quarantined


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
