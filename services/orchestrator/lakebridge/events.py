"""Tiny in-process pub/sub for SSE.

A single instance lives at module scope. Subscribers get an `asyncio.Queue`
each; publishing fans out to every queue. This is fine for an internal
console with a small number of operators; if the scale ever changes, swap
this for Redis pub/sub without touching the API endpoints.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Event:
    type: str
    payload: dict[str, Any]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._lock = asyncio.Lock()

    def publish(self, event: str, payload: dict[str, Any]) -> None:
        """Non-blocking publish from sync code. Drops events for slow consumers."""
        e = Event(event, payload)
        for q in list(self._subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                # Slow consumer's queue full; drop. We'd rather miss a tick
                # than block the runner.
                q.put_nowait(e)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[Event]]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._subscribers.add(q)
        try:
            yield q
        finally:
            async with self._lock:
                self._subscribers.discard(q)


_bus = EventBus()


def bus() -> EventBus:
    return _bus
