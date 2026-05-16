"""Double-submit cookie CSRF protection.

The orchestrator sits behind an OIDC sign-in cookie. SameSite=lax blocks
the easy attacks but corporate proxies that strip the `Origin` header
break that guarantee, so we layer an explicit CSRF token on top.

Flow:
1. On every response, set `lb_csrf=<random>` cookie (NOT httponly so JS
   can read it). The value lives on the session; subsequent responses
   re-emit the same value.
2. The UI reads the cookie from `document.cookie` and sends it back in
   the `X-Lakebridge-Csrf` header on POST/PUT/PATCH/DELETE.
3. The middleware compares the header to the session value. Mismatch →
   403. GETs / HEADs / OPTIONS are not checked (they should be safe).

The `lb_csrf` cookie is regenerated on logout (the session is cleared,
so the next response stamps a fresh value).
"""

from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Auth endpoints are the bootstrap path — the browser doesn't have the
# CSRF cookie yet on first contact. Okta also won't send our custom
# header on its callback POST. Everything else under /api/* must carry
# the token on state-changing methods.
SKIP_PATHS_PREFIX = ("/api/auth/",)


class CsrfMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: Callable,
        *,
        cookie_name: str = "lb_csrf",
        header_name: str = "x-lakebridge-csrf",
    ) -> None:
        super().__init__(app)
        self.cookie_name = cookie_name
        self.header_name = header_name

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        method = request.method.upper()
        path = request.url.path
        # Generate (or load) the per-session token now so the response can
        # always carry it — including on the very first GET.
        session = request.session
        token = session.get("csrf")
        if not token:
            token = secrets.token_urlsafe(32)
            session["csrf"] = token

        # Validate on unsafe methods. Skip OIDC callbacks; skip the
        # OAuth-redirect endpoint where the browser is mid-redirect.
        needs_check = (
            method in UNSAFE_METHODS
            and path.startswith("/api/")
            and not any(path.startswith(p) for p in SKIP_PATHS_PREFIX)
        )
        if needs_check:
            provided = request.headers.get(self.header_name) or request.headers.get(
                self.header_name.title()
            )
            if not provided or not secrets.compare_digest(provided, token):
                return JSONResponse(
                    {"detail": "CSRF token missing or invalid"},
                    status_code=403,
                )

        response = await call_next(request)
        # JS needs to read the cookie, so httponly must be False.
        response.set_cookie(
            self.cookie_name,
            token,
            max_age=60 * 60 * 8,
            samesite="lax",
            secure=False,
            httponly=False,
            path="/",
        )
        return response
