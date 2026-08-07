"""Puts `ingestion/` on `sys.path` so tests import `pipeline.chunk` directly.

Explicit rather than relying on pytest's rootdir/conftest path insertion,
which depends on import mode and on whether `tests/` carries an `__init__.py`
— both easy to change by accident, and the failure looks like a missing
dependency rather than a path problem.

`ingestion/` is outside the npm workspace globs and has no packaging of its
own; the pipeline is run as scripts from this directory, so this mirrors how
`ingest.py` itself resolves `pipeline.*`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
