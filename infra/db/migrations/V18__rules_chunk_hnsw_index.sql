-- Replace the ivfflat vector index on rules_chunk with hnsw.
--
-- The ivfflat index from V7 silently under-returns. With `lists = 100` over a
-- 66-row corpus most lists are empty, so a single-probe index scan finds about
-- one row: `LIMIT 2` returned 1 row, while `LIMIT 3` fell back to a sequential
-- scan and was correct. The planner's choice between the two is a cost
-- estimate, so the defect appears and disappears with the requested limit —
-- `rules_lookup` permits limits 1 through 5.
--
-- The root cause is not the `lists` value. It is that ivfflat derives its
-- cluster centroids from the rows present when the index is built, and a
-- migration builds it against an empty table. Any `lists` chosen here would be
-- chosen against zero rows and would need revisiting every time the corpus
-- changed size — which M7.5's chunking iteration is about to do repeatedly.
--
-- hnsw is graph-based and builds incrementally, so it does not care that the
-- table is empty at migration time and needs no per-corpus tuning. Defaults
-- (m = 16, ef_construction = 64) are unchanged; at query time `hnsw.ef_search`
-- defaults to 40, comfortably above the tool's maximum limit of 5.
--
-- See docs/rules-extraction-findings.md § S13.7.

DROP INDEX rules_chunk_embedding_idx;

CREATE INDEX rules_chunk_embedding_idx ON rules_chunk
  USING hnsw (embedding vector_cosine_ops);
