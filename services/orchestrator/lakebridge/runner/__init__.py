"""The extraction engine: connect → count → extract → load → recon → finalize."""

from .engine import RunResult, execute_run

__all__ = ["RunResult", "execute_run"]
