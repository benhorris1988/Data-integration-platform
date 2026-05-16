"""FastAPI app factory + uvicorn entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .api import audit, auth, dashboard, health, jobs, recon, runs, sources, users
from .config import get_settings
from .csrf import CsrfMiddleware
from .logging import configure, get_logger
from .scheduler import start_global_scheduler, stop_global_scheduler

log = get_logger("lakebridge.main")


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    s = get_settings()
    configure(level="INFO")
    log.info(
        "lakebridge.boot",
        env=s.env,
        region=s.region,
        scheduler_enabled=s.scheduler_enabled,
    )
    if s.scheduler_enabled:
        start_global_scheduler()
    try:
        yield
    finally:
        if s.scheduler_enabled:
            stop_global_scheduler()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Lakebridge",
        description="IFS → SQL Server staging orchestrator & operator API.",
        version="0.1.0",
        lifespan=_lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_allow_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    # Middleware order: outermost wraps everything, so order is
    # CORS → Session → CSRF → routers. CSRF reads the session, so it
    # must be added AFTER SessionMiddleware (Starlette executes in
    # reverse-add order).
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(
        SessionMiddleware,
        secret_key=s.session_secret,
        session_cookie=s.session_cookie_name,
        max_age=s.session_max_age_sec,
        same_site="lax",
        https_only=False,  # set true when fronted by TLS; dev runs http
    )
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(jobs.router)
    app.include_router(runs.router)
    app.include_router(sources.router)
    app.include_router(dashboard.router)
    app.include_router(recon.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    return app


app = create_app()


def run() -> None:
    """`lakebridge-serve` entrypoint."""
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "lakebridge.main:app",
        host=s.api_host,
        port=s.api_port,
        log_config=None,  # we configure logging ourselves in _lifespan
    )


if __name__ == "__main__":  # pragma: no cover
    run()
