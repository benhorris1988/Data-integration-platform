"""structlog setup. Loggers are namespaced `lakebridge.<area>`.

The processor chain also includes `_run_log_tap`, which publishes a copy
of each log line to the in-process event bus when a `run_id` is bound via
contextvars. The Run detail UI subscribes to this stream over SSE.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def _run_log_tap(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """If a `run_id` is bound, publish the log line to the event bus so the
    Run detail SSE channel can stream it. The processor doesn't mutate the
    event_dict — log lines still flow to stdout as JSON."""
    run_id = event_dict.get("run_id")
    if run_id is None:
        return event_dict
    try:
        from .events import bus, log_buffer

        # Keep the payload small and serialisable. Strip noisy structlog
        # internals; preserve the operator-visible fields.
        payload = {
            "run_id": run_id,
            "level": event_dict.get("level", "info"),
            "ts": event_dict.get("timestamp"),
            "logger": event_dict.get("logger", ""),
            "event": event_dict.get("event", ""),
            "extra": {
                k: v
                for k, v in event_dict.items()
                if k not in {"run_id", "level", "timestamp", "logger", "event"}
                and isinstance(v, (str, int, float, bool, type(None)))
            },
        }
        log_buffer().append(int(run_id), payload)
        bus().publish("log.line", payload)
    except Exception:  # pragma: no cover — never let logging break the request
        pass
    return event_dict


def configure(level: str = "INFO") -> None:
    """Configure structlog + the stdlib root logger. Idempotent."""
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            _run_log_tap,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a logger; call as `get_logger("lakebridge.runner")`."""
    return structlog.get_logger(name)
