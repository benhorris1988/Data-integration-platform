"""Cron predicate tests."""

from __future__ import annotations

from datetime import UTC, datetime

from lakebridge.scheduler import _cron_fires_at, next_fire


def test_every_15_min_fires_on_quarter_hour() -> None:
    expr = "*/15 * * * *"
    assert _cron_fires_at(expr, datetime(2026, 5, 16, 14, 0, tzinfo=UTC))
    assert _cron_fires_at(expr, datetime(2026, 5, 16, 14, 15, tzinfo=UTC))
    assert not _cron_fires_at(expr, datetime(2026, 5, 16, 14, 16, tzinfo=UTC))


def test_six_am_daily() -> None:
    expr = "0 6 * * *"
    assert _cron_fires_at(expr, datetime(2026, 5, 16, 6, 0, tzinfo=UTC))
    assert not _cron_fires_at(expr, datetime(2026, 5, 16, 6, 1, tzinfo=UTC))
    assert not _cron_fires_at(expr, datetime(2026, 5, 16, 7, 0, tzinfo=UTC))


def test_invalid_cron_returns_false() -> None:
    assert not _cron_fires_at("bogus", datetime(2026, 5, 16, 14, 0, tzinfo=UTC))


def test_next_fire_advances() -> None:
    now = datetime(2026, 5, 16, 14, 7, tzinfo=UTC)
    nxt = next_fire("*/15 * * * *", after=now)
    assert nxt == datetime(2026, 5, 16, 14, 15, tzinfo=UTC)
