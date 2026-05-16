"""/api/recon — the matrix the Reconciliation screen renders."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/api/recon", tags=["recon"])


@router.get("")
def matrix(limit_jobs: int = 14, last_n: int = 6) -> list[dict[str, Any]]:
    """Return up to `limit_jobs` rows, each with the last `last_n` recon
    cells. Shape mirrors the UI's `RECON` constant."""
    from .. import db

    jobs = db.fetch_all(
        "SELECT TOP (?) id AS job_id, code, target_schema, target_table "
        "FROM lakebridge.jobs "
        "ORDER BY pinned DESC, id",
        (limit_jobs,),
    )
    out: list[dict[str, Any]] = []
    for j in jobs:
        cells = db.fetch_all(
            "SELECT TOP (?) source_count, target_count, variance_rows, "
            "       checksum_match, result, threshold_pct, computed_at "
            "FROM lakebridge.recon_checks "
            "WHERE job_id = ? "
            "ORDER BY computed_at DESC",
            (last_n, j["job_id"]),
        )
        # Oldest-first (left-to-right) so the UI reads naturally.
        cells.reverse()
        out.append({"job": j, "cells": cells})
    return out
