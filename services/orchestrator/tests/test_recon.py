"""Recon hash-bucket helpers."""

from __future__ import annotations

from lakebridge.runner.engine import (
    _bucket_fingerprints,
    _bucket_for,
    _compare_buckets,
)


def test_bucket_for_partitions_the_byte_space() -> None:
    assert _bucket_for(0x00) == "00-3F"
    assert _bucket_for(0x3F) == "00-3F"
    assert _bucket_for(0x40) == "40-7F"
    assert _bucket_for(0x7F) == "40-7F"
    assert _bucket_for(0x80) == "80-BF"
    assert _bucket_for(0xBF) == "80-BF"
    assert _bucket_for(0xC0) == "C0-FF"
    assert _bucket_for(0xFF) == "C0-FF"


def test_fingerprints_are_order_independent() -> None:
    hashes = [
        "01" * 16,
        "02" * 16,
        "03" * 16,
    ]
    a = _bucket_fingerprints(hashes)
    b = _bucket_fingerprints(list(reversed(hashes)))
    assert a == b


def test_compare_flags_count_drift() -> None:
    src = _bucket_fingerprints(["01" * 16, "02" * 16])
    tgt = _bucket_fingerprints(["01" * 16])  # missing one row in 00-3F
    out = _compare_buckets(src, tgt)
    by_bucket = {b["bucket"]: b for b in out}
    assert not by_bucket["00-3F"]["matched"]
    # All other buckets are empty on both sides → match.
    for name in ("40-7F", "80-BF", "C0-FF"):
        assert by_bucket[name]["matched"]


def test_compare_flags_xor_drift_at_same_count() -> None:
    # Same number of rows in the same bucket, different content → XOR
    # fingerprints diverge and matched is False.
    src = _bucket_fingerprints(["01" * 16, "02" * 16])
    tgt = _bucket_fingerprints(["03" * 16, "04" * 16])
    out = _compare_buckets(src, tgt)
    by_bucket = {b["bucket"]: b for b in out}
    assert by_bucket["00-3F"]["source_count"] == 2
    assert by_bucket["00-3F"]["target_count"] == 2
    assert not by_bucket["00-3F"]["matched"]


def test_identical_inputs_match_everywhere() -> None:
    same = ["01" * 16, "7f" * 16, "ab" * 16, "fe" * 16]
    out = _compare_buckets(_bucket_fingerprints(same), _bucket_fingerprints(same))
    assert all(b["matched"] for b in out)
