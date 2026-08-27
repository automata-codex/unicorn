---
id: ADR-0011
title: "Embedding model: `voyage-4-lite`, chosen together with the column dimension"
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The `voyage-3-lite` default never matched the `vector(1024)` column, and an empty
  index meant pgvector never evaluated a comparison to say so. Settles on
  `voyage-4-lite`, and names the two constraints nothing in the type system enforces:
  ingestion and runtime must be the same model, not merely two of the same width, and
  a swap is checked against the column before ingesting.
---

M7 shipped with `VOYAGE_EMBED_MODEL` defaulting to `voyage-3-lite` on the stated assumption that it matched the `vector(1024)` declaration on `rules_chunk.embedding`. It does not — `voyage-3-lite` emits 512 dimensions; `voyage-3` is the 1024-dimensional model of that generation. The error was invisible for the whole of M7 because the index is empty: `RulesRepository.findByCosineSimilarity` filters `embedding IS NOT NULL`, so pgvector never evaluated `<=>` against a row and never raised the dimension mismatch. It would have surfaced on the first M7.2 ingestion run.

The default is now `voyage-4-lite`, which emits 1024 dimensions by default and leaves the column, the `game_system.embedding_dim` seed, and every existing migration unchanged. Choosing it over `voyage-3` also avoids adopting a model Voyage now lists as legacy; the voyage-4 family is current, `voyage-4-lite` is the same $0.02/M as `voyage-3-lite`, and legacy models no longer carry a free-token allowance. `voyage-4` and `voyage-4-large` are drop-in step-ups if retrieval quality warrants the cost — same default dimension, no migration.

Two constraints follow, and neither is enforced by the type system: the ingestion model and the runtime `VOYAGE_EMBED_MODEL` must be the *same model*, not merely two models of the same width, or similarity scores are meaningless while looking healthy; and any future model swap must be checked against the column dimension before ingesting rather than after. M7.2's pipeline should validate the returned vector length against `game_system.embedding_dim` before insert — that check is the cheap guard that would have caught this at M7 time.

No eval re-baseline is owed for this change on its own. Both existing baselines ran against an empty index, so no graded turn ever consumed an embedding; the re-baseline that `ADR-0023` anticipates is owed to ingestion itself, not to the model swap.
