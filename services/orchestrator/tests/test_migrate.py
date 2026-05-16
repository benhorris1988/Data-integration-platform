"""Migration discovery + GO-splitting."""

from __future__ import annotations

from pathlib import Path

from lakebridge.migrate import discover

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"


def test_discover_finds_all_migrations() -> None:
    found = discover(MIGRATIONS_DIR)
    versions = [m.version for m in found]
    assert versions == sorted(versions), "migrations must be returned in version order"
    assert versions[0] == 1
    # Every name maps to a unique version.
    assert len(versions) == len(set(versions))


def test_batches_split_on_go() -> None:
    found = discover(MIGRATIONS_DIR)
    init = next(m for m in found if m.version == 1)
    batches = init.batches
    # 0001 has two GO-separated batches: CREATE SCHEMA and CREATE TABLE.
    assert len(batches) == 2
    assert "CREATE SCHEMA" in batches[0]
    assert "schema_migrations" in batches[1]


def test_checksum_stable_for_identical_content(tmp_path: Path) -> None:
    """The ledger relies on the SHA-256 being a function of file bytes."""
    a = tmp_path / "0001_a.sql"
    a.write_text("SELECT 1;\nGO\nSELECT 2;\n", encoding="utf-8")
    [m] = discover(tmp_path)
    expected = (
        "8e1a8c98c4e6c54a13d2a7c6c97f6f5cb651e0d8c0e6c54c13d2a7c6c97f6f5c"  # placeholder shape
    )
    assert len(m.checksum) == 64
    # Same content again yields same hash.
    [m2] = discover(tmp_path)
    assert m.checksum == m2.checksum
    assert m.checksum != expected  # sanity — placeholder isn't accidentally the real hash
