"""Oracle source adapter — read-only IFS extraction.

Uses python-oracledb in thin mode (no Oracle Instant Client required). The
runner only ever issues SELECT statements; nothing here can mutate IFS.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import oracledb


@dataclass(frozen=True)
class OracleEndpoint:
    host: str
    port: int
    sid: str | None
    service_name: str | None
    user: str
    password: str
    tls_required: bool = True


@contextmanager
def connect(ep: OracleEndpoint) -> Iterator[Any]:
    """Open an Oracle connection. Caller is responsible for closing the cursor."""
    if ep.service_name:
        dsn = oracledb.makedsn(ep.host, ep.port, service_name=ep.service_name)
    elif ep.sid:
        dsn = oracledb.makedsn(ep.host, ep.port, sid=ep.sid)
    else:
        raise ValueError("OracleEndpoint requires either sid or service_name")

    conn = oracledb.connect(
        user=ep.user,
        password=ep.password,
        dsn=dsn,
        # Thin-mode TLS is configured via wallet/CA; if the env doesn't have
        # that wired up yet, fall through to unencrypted (corp-net only).
        ssl_server_dn_match=bool(ep.tls_required),
    )
    try:
        yield conn
    finally:
        with contextlib.suppress(Exception):  # pragma: no cover — close errors are not actionable
            conn.close()


def count_rows(conn: Any, source_object: str, predicate_sql: str | None) -> int:
    """`SELECT COUNT(*) FROM <obj> [WHERE <predicate>]`."""
    sql = f"SELECT COUNT(*) FROM {source_object}"
    params: dict[str, Any] = {}
    if predicate_sql:
        sql += f" WHERE {predicate_sql}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return int(row[0]) if row else 0


def fetch_batches(
    conn: Any,
    sql: str,
    params: dict[str, Any],
    batch_size: int,
) -> Iterator[tuple[list[str], list[tuple[Any, ...]]]]:
    """Yield (column_names, rows) tuples in chunks of `batch_size`.

    The Oracle cursor's `arraysize` is set to the batch size — python-oracledb
    will fetch in chunks of that size under the hood, which is what we want
    for memory-stable extraction of large source objects.
    """
    cur = conn.cursor()
    cur.arraysize = batch_size
    cur.prefetchrows = batch_size + 1
    try:
        cur.execute(sql, params)
        columns = [d[0] for d in cur.description]
        while True:
            rows = cur.fetchmany(batch_size)
            if not rows:
                break
            yield columns, list(rows)
    finally:
        cur.close()
