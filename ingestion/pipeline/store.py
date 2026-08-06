"""Write chunks and their embeddings to `rules_chunk`.

Idempotent by replacement: every run deletes the target system's rows and
reinserts. Safe because nothing references `rules_chunk.id` today — if a
Phase 2 table ever cites specific chunks, this needs a gentler update path.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from .chunk import Chunk

logger = logging.getLogger(__name__)

#: Created at migration time against an empty table, so its cluster centroids
#: are meaningless until rows exist.
EMBEDDING_INDEX = "rules_chunk_embedding_idx"


class StorageError(RuntimeError):
    """The database refused, or is not in the state this expects."""


def _vector_literal(vector: Sequence[float]) -> str:
    """pgvector's text input format.

    psycopg would otherwise send a Python list as a Postgres array literal
    (``{0.1,0.2}``), which the ``vector`` type does not accept. Mirrors
    ``vectorLiteral`` in ``apps/zoltar-be/src/rules/rules.repository.ts``.
    """
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"


def lookup_system(connection, slug: str) -> tuple[str, int]:
    """``game_system.id`` and ``embedding_dim`` for a slug.

    The dimension is read from the row rather than hardcoded — that read *is*
    the check the dimension guard performs against.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, embedding_dim FROM game_system WHERE slug = %s", (slug,)
        )
        row = cursor.fetchone()
    if row is None:
        raise StorageError(
            f"no game_system row with slug '{slug}'. Systems are seeded by "
            "migration (see infra/db/migrations/V7__rules_index.sql); a new "
            "system needs its row before it can be ingested."
        )
    return str(row[0]), int(row[1])


def replace_chunks(
    connection,
    *,
    system_id: str,
    chunks: Sequence[Chunk],
    embeddings: Sequence[Sequence[float]],
) -> int:
    """Delete this system's rows and insert the new ones, in one transaction.

    ``embedding`` is never written NULL: ``findByCosineSimilarity`` filters
    ``embedding IS NOT NULL``, so a NULL-embedding row is invisible to the
    runtime while still counting in every ``COUNT(*)`` sanity check — a row
    that looks present and can never be retrieved.
    """
    if len(chunks) != len(embeddings):
        raise StorageError(
            f"{len(chunks)} chunks against {len(embeddings)} embeddings; "
            "refusing to insert misaligned data"
        )

    rows = [
        (
            system_id,
            chunk.source,
            list(chunk.section_path),
            chunk.content,
            _vector_literal(vector),
        )
        for chunk, vector in zip(chunks, embeddings)
    ]

    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM rules_chunk WHERE system_id = %s", (system_id,))
        deleted = cursor.rowcount
        cursor.executemany(
            "INSERT INTO rules_chunk (system_id, source, section_path, content, embedding) "
            "VALUES (%s, %s, %s, %s, %s::vector)",
            rows,
        )
    connection.commit()

    logger.info("replaced %d existing rows with %d new rows", max(deleted, 0), len(rows))
    return len(rows)


def reindex_embeddings(connection) -> None:
    """Rebuild the ivfflat index now that the table has rows.

    ``rules_chunk_embedding_idx`` was created at migration time against an
    empty table, so it has no meaningful cluster centroids, and every
    re-ingestion churns it against stale ones. pgvector's own guidance is to
    build an ivfflat index after the data lands.

    The failure mode of a degenerate ivfflat index is poor or empty recall
    rather than an error — `ORDER BY embedding <=> …` stays *correct* only
    because Postgres may fall back to a sequential scan, which is not
    something to rely on. Ingestion is an offline job, so the lock is free.
    """
    logger.info("reindexing %s", EMBEDDING_INDEX)
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute(f"REINDEX INDEX {EMBEDDING_INDEX}")
    finally:
        connection.autocommit = False


def count_chunks(connection, system_id: str) -> tuple[int, int]:
    """``(rows, rows_with_a_null_embedding)`` for one system."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*), count(*) FILTER (WHERE embedding IS NULL) "
            "FROM rules_chunk WHERE system_id = %s",
            (system_id,),
        )
        row = cursor.fetchone()
    return int(row[0]), int(row[1])
