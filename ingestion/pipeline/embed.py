"""Voyage AI embedding of chunk content, in document mode.

``input_type="document"`` here, ``input_type="query"`` at lookup time. Voyage
uses the hint to optimise representations for asymmetric retrieval, so getting
it wrong degrades recall silently rather than failing.

The model must be the *same model* the runtime embeds queries with, not merely
one of the same width: two different 1024-dimension models produce similarity
scores that look entirely plausible and mean nothing. See
``docs/decisions.md § Embedding model``.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

logger = logging.getLogger(__name__)


class EmbeddingError(RuntimeError):
    """Voyage refused, or returned something unusable."""


#: Voyage's embeddings endpoint accepts up to 1,000 texts per request. A
#: PSG-sized book fits in a single call, but batching costs nothing now and
#: means this code does not need revisiting for a rulebook that doesn't.
MAX_BATCH = 128


def embed_documents(
    texts: Sequence[str],
    *,
    model: str,
    api_key: str,
    batch_size: int = MAX_BATCH,
) -> list[list[float]]:
    """Embed chunk contents, preserving order.

    **Order is the load-bearing property.** The embedding at index *i* has to
    belong to chunk *i*; a reordering bug across batch boundaries produces an
    index that passes every count-based check, returns confident results, and
    is wholly wrong. Batches are therefore assembled and appended in sequence
    and the total is asserted against the input length.
    """
    if not texts:
        return []

    import voyageai  # imported here so this module stays cheap to import

    client = voyageai.Client(api_key=api_key)
    vectors: list[list[float]] = []

    for start in range(0, len(texts), batch_size):
        batch = list(texts[start : start + batch_size])
        logger.info(
            "embedding chunks %d-%d of %d (model=%s)",
            start + 1,
            start + len(batch),
            len(texts),
            model,
        )
        try:
            response = client.embed(batch, model=model, input_type="document")
        except Exception as err:  # voyageai raises a family of API errors
            raise EmbeddingError(f"Voyage API error: {err}") from err

        embeddings = getattr(response, "embeddings", None)
        if embeddings is None or len(embeddings) != len(batch):
            raise EmbeddingError(
                f"Voyage returned {len(embeddings or [])} embeddings for a "
                f"batch of {len(batch)}"
            )
        vectors.extend(list(vector) for vector in embeddings)

    if len(vectors) != len(texts):
        raise EmbeddingError(
            f"embedded {len(vectors)} vectors for {len(texts)} chunks — refusing "
            "to insert, since a length mismatch means chunk/vector alignment "
            "cannot be trusted"
        )
    return vectors


def assert_dimensions(vectors: Sequence[Sequence[float]], expected: int) -> None:
    """Check every vector's width against ``game_system.embedding_dim``.

    This is the guard that would have caught the ``voyage-3-lite``
    512-dimension mistake at M7 time, where the error stayed invisible for a
    whole milestone because an empty index means pgvector never evaluates
    ``<=>`` and never raises.

    **Call this before the DELETE, not after.** Running it later would trade a
    caught bug for an emptied index.
    """
    widths = {len(vector) for vector in vectors}
    if not widths:
        return
    if widths != {expected}:
        raise EmbeddingError(
            f"embedding dimension mismatch: game_system.embedding_dim is "
            f"{expected}, but the configured model returned width(s) "
            f"{sorted(widths)}. The ingestion model and the backend's "
            "VOYAGE_EMBED_MODEL must be the same model, and its output width "
            "must match the rules_chunk.embedding column."
        )
