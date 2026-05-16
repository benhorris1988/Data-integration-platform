"""Engine state-machine tests with mocked Oracle + SQL Server."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from lakebridge.runner import engine
from lakebridge.runner.engine import JobSpec, execute_run


@dataclass
class _RecordingSink:
    events: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    recons: list[dict[str, Any]] = field(default_factory=list)

    def on_run_start(self, run_id: int) -> None:
        self.events.append(("run.start", {"run_id": run_id}))

    def on_run_finish(self, run_id, status, watermark_after):
        self.events.append(
            ("run.finish", {"run_id": run_id, "status": status, "wm": watermark_after})
        )

    def on_step_start(self, run_id, step_no, step_name):
        self.events.append(("step.start", {"step_no": step_no, "name": step_name}))

    def on_step_progress(self, run_id, step_no, progress_pct, rows_processed, message):
        self.events.append(
            ("step.progress", {"step_no": step_no, "pct": progress_pct, "rows": rows_processed})
        )

    def on_step_finish(self, run_id, step_no, step_name, status, message):
        self.events.append(
            ("step.finish", {"step_no": step_no, "name": step_name, "status": status})
        )

    def on_error(self, run_id, severity, code, step_name, message, source_pk, payload_json):
        self.events.append(("error", {"code": code, "step": step_name, "msg": message}))

    def record_recon(self, run_id, job_id, source_count, target_count, checksum_match, threshold_pct):
        self.recons.append({
            "run_id": run_id,
            "source_count": source_count,
            "target_count": target_count,
            "checksum_match": checksum_match,
        })


def _spec(**overrides: Any) -> JobSpec:
    base: dict[str, Any] = dict(
        job_id=1,
        code="EXT.TEST.JOB",
        strategy="full_snapshot",
        source_object="IFSAPP.TEST_TAB",
        source_query=None,
        target_schema="stg_ifs_test",
        target_table="test_tab",
        batch_size=2,
        watermark_column=None,
        watermark_before=None,
        source_host="oracle.local",
        source_port=1521,
        source_sid="X",
        source_service_name=None,
        source_user="u",
        source_password="p",
        source_tls_required=False,
    )
    base.update(overrides)
    return JobSpec(**base)


class _FakeCM:
    def __init__(self, conn: object) -> None:
        self._conn = conn

    def __enter__(self) -> object:
        return self._conn

    def __exit__(self, *_: Any) -> None:
        return None


def test_happy_path_full_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    sink = _RecordingSink()
    src_conn = object()
    sink_conn = object()

    monkeypatch.setattr(
        engine.sources.oracle, "connect", lambda ep: _FakeCM(src_conn)
    )
    monkeypatch.setattr(
        engine.sources.oracle, "count_rows", lambda c, obj, pred: 4
    )

    def _fake_batches(c, sql, params, batch):
        yield ["PART_NO", "DESCRIPTION"], [("A", "a"), ("B", "b")]
        yield ["PART_NO", "DESCRIPTION"], [("C", "c"), ("D", "d")]

    monkeypatch.setattr(engine.sources.oracle, "fetch_batches", _fake_batches)

    truncated: list[tuple[str, str]] = []
    inserted_total = 0

    def _truncate(_conn, schema, table):
        truncated.append((schema, table))

    def _bulk_insert(_conn, schema, table, columns, rows, *, run_id):
        nonlocal inserted_total
        inserted_total += len(rows)
        assert run_id == 99
        return len(rows)

    monkeypatch.setattr(engine.sinks.sqlserver, "open_connection", lambda dsn: sink_conn)
    monkeypatch.setattr(engine.sinks.sqlserver, "truncate", _truncate)
    monkeypatch.setattr(engine.sinks.sqlserver, "bulk_insert", _bulk_insert)
    monkeypatch.setattr(engine.sinks.sqlserver, "target_count", lambda c, s, t, r: 4)
    monkeypatch.setattr(engine.sinks.sqlserver, "commit", lambda c: None)

    result = execute_run(_spec(), run_id=99, target_dsn="DSN", state=sink)

    assert result.status == "succeeded"
    assert result.rows_loaded == 4
    assert result.source_count == 4
    assert result.target_count == 4
    assert truncated == [("stg_ifs_test", "test_tab")]

    # Every step ran in order, ending succeeded.
    step_finish = [e for e in sink.events if e[0] == "step.finish"]
    finish_names = [e[1]["name"] for e in step_finish]
    assert finish_names == ["connect", "count", "extract", "load", "recon", "finalize"]
    assert all(e[1]["status"] == "succeeded" for e in step_finish)


def test_watermark_delta_tracks_max(monkeypatch: pytest.MonkeyPatch) -> None:
    sink = _RecordingSink()

    monkeypatch.setattr(engine.sources.oracle, "connect", lambda ep: _FakeCM(object()))
    monkeypatch.setattr(engine.sources.oracle, "count_rows", lambda c, obj, pred: 3)

    def _fake_batches(c, sql, params, batch):
        # Mixed order on purpose — engine should keep the lexical max.
        yield ["ID", "MODIFIED_DATE"], [("1", "2026-05-16T10:00:00Z"), ("2", "2026-05-16T11:00:00Z")]
        yield ["ID", "MODIFIED_DATE"], [("3", "2026-05-16T10:30:00Z")]

    monkeypatch.setattr(engine.sources.oracle, "fetch_batches", _fake_batches)
    monkeypatch.setattr(engine.sinks.sqlserver, "open_connection", lambda dsn: object())
    monkeypatch.setattr(engine.sinks.sqlserver, "truncate", lambda *a, **kw: None)
    monkeypatch.setattr(engine.sinks.sqlserver, "bulk_insert", lambda *a, **kw: len(a[4]))
    monkeypatch.setattr(engine.sinks.sqlserver, "target_count", lambda c, s, t, r: 3)
    monkeypatch.setattr(engine.sinks.sqlserver, "commit", lambda c: None)

    spec = _spec(
        strategy="watermark_delta",
        watermark_column="MODIFIED_DATE",
        watermark_before="2026-05-16T09:00:00Z",
    )
    result = execute_run(spec, run_id=42, target_dsn="DSN", state=sink)
    assert result.status == "succeeded"
    assert result.watermark_after == "2026-05-16T11:00:00Z"


def test_oracle_failure_marks_run_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    sink = _RecordingSink()

    def _explode(ep):
        raise RuntimeError("ORA-12541: TNS: no listener")

    monkeypatch.setattr(engine.sources.oracle, "connect", _explode)

    result = execute_run(_spec(), run_id=7, target_dsn="DSN", state=sink)

    assert result.status == "failed"
    assert any(e[0] == "error" for e in sink.events)
    # The connect step ran first and never finished succeeded.
    finished_succeeded = [
        e for e in sink.events if e[0] == "step.finish" and e[1]["status"] == "succeeded"
    ]
    assert finished_succeeded == []


def test_cancel_check_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    sink = _RecordingSink()
    monkeypatch.setattr(engine.sources.oracle, "connect", lambda ep: _FakeCM(object()))
    monkeypatch.setattr(engine.sinks.sqlserver, "open_connection", lambda dsn: object())

    # Cancel immediately after connect.
    calls = {"n": 0}

    def cancel() -> bool:
        calls["n"] += 1
        return calls["n"] >= 1

    result = execute_run(
        _spec(), run_id=8, target_dsn="DSN", state=sink, cancel_check=cancel
    )
    assert result.status == "cancelled"
    # Cancellation is a status transition, not an error event — verify the
    # run finished in 'cancelled' state and no error rows were recorded.
    finish = [e for e in sink.events if e[0] == "run.finish"]
    assert finish
    assert finish[0][1]["status"] == "cancelled"
    assert [e for e in sink.events if e[0] == "error"] == []
