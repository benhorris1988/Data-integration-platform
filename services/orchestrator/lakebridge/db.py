"""SQL Server access for the application metadata schema.

Uses pyodbc with a tiny hand-rolled connection pool — SQLAlchemy ORM is
overkill for the access patterns here (mostly straight SELECTs with a few
INSERT/UPDATEs), and the runner needs raw cursor control for BULK INSERT
with `fast_executemany=True`.

The pool is lazy: nothing is opened until the first `borrow()`. Tests that
do not touch the DB never hit a driver, which is why `pyodbc` is imported
inside functions, not at module scope.
"""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from queue import Empty, Queue
from typing import Any

from .config import get_settings


class ConnectionPool:
    """A thread-safe pool of pyodbc connections.

    Connections are returned to the pool on close. Dead connections are
    detected on borrow and replaced — that's the only health check we do;
    everything else is delegated to pyodbc/ODBC error handling.
    """

    def __init__(self, dsn: str, size: int) -> None:
        self._dsn = dsn
        self._size = size
        self._pool: Queue[Any] = Queue(maxsize=size)
        self._lock = threading.Lock()
        self._opened = 0

    def _open(self) -> Any:
        import pyodbc  # local import — see module docstring

        conn = pyodbc.connect(self._dsn, autocommit=False)
        # Make Python decimals + UTF-8 strings round-trip cleanly.
        conn.setdecoding(pyodbc.SQL_CHAR, encoding="utf-8")
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-8")
        conn.setencoding(encoding="utf-8")
        return conn

    @contextmanager
    def borrow(self) -> Iterator[Any]:
        """Borrow a connection; returned on context exit."""
        try:
            conn = self._pool.get_nowait()
        except Empty:
            with self._lock:
                if self._opened < self._size:
                    self._opened += 1
                    conn = self._open()
                else:
                    # Block until one is returned.
                    conn = self._pool.get()
        # Cheap liveness check; reopens if the connection is dead.
        try:
            with conn.cursor() as c:
                c.execute("SELECT 1")
                c.fetchone()
        except Exception:
            with contextlib.suppress(Exception):
                conn.close()
            conn = self._open()
        try:
            yield conn
        finally:
            self._pool.put_nowait(conn)


_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def get_pool() -> ConnectionPool:
    """Singleton accessor. The pool is constructed on first call."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                s = get_settings()
                _pool = ConnectionPool(s.odbc_connection_string(), s.mssql_pool_size)
    return _pool


@contextmanager
def connection() -> Iterator[Any]:
    """Borrow a connection from the singleton pool."""
    with get_pool().borrow() as conn:
        yield conn


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    """Execute a SELECT and return rows as dicts."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    """Execute a SELECT and return the first row as a dict, or None."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        if row is None:
            return None
        cols = [c[0] for c in cur.description]
        return dict(zip(cols, row, strict=True))


def execute(sql: str, params: tuple[Any, ...] = ()) -> int:
    """Execute a write statement; commits on success. Returns rowcount."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rc = cur.rowcount
        conn.commit()
        return rc
