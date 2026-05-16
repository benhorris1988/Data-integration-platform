"""Test-wide fixtures.

We don't have a SQL Server to talk to in CI, so anything that imports
`lakebridge.db` at module load is fine (pyodbc is imported lazily), but
tests that *use* it need to mock the connection function.
"""

from __future__ import annotations

import os

# Make `Settings()` work without a real .env by pinning everything to
# safe defaults before any orchestrator module loads.
os.environ.setdefault("LAKEBRIDGE_MSSQL_PASSWORD", "test")
os.environ.setdefault("LAKEBRIDGE_SCHEDULER_ENABLED", "false")
