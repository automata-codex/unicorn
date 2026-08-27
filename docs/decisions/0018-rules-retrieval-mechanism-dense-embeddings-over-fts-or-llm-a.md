---
id: ADR-0018
title: "Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex"
area: rules-retrieval
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The three spikes that settled dense embeddings over Postgres FTS and LLM-authored
  regex, including the latency budget that rules out any second model call at query
  time and the one query that discriminated between the mechanisms. It does not settle
  vocabulary sensitivity, which is `ADR-0019`'s subject.
---

Raised as an alternative to the planned Voyage/pgvector pipeline: have an LLM
translate a `rules_lookup` query into a regex, grep the extracted rules text,
and let the Warden parse ±200 words of context around hits. Investigated
across three spikes against the real Mothership PSG 1e extraction
(`docs/rules-extraction-findings.md § S3–S5`), run in the current M7.2
branch before any chunking work went in, specifically to decide before
building M7.2's block-merge chunker if it turned out to be unnecessary.

**Regex was rejected as a mechanism before it was tested, and S5 later
confirmed the reasoning empirically.** The Voyage query-time round trip
alone is ~98% of the ~100–200ms query budget (`docs/rules-ingestion.md §
Query Time`, measured in `docs/rules-extraction-findings.md § S5.4`), so a
second network hop — an LLM call to author a regex, or any other synchronous
model call at query time — does not fit that budget. Postgres full-text
search (`tsvector`/`ts_rank`/`ts_headline`) was tested instead, as the
mechanism that captures the same lexical-matching intuition without the
extra round trip or the ReDoS surface of an LLM-generated pattern.

**FTS lost to dense retrieval on the query that discriminates.** Against an
identical 38-page, page-granular corpus and the three real recorded
`rules_lookup` queries (keyword-stuffed, generic-TTRPG phrasing —
`perception check looking around environment, noticing details`), FTS never
placed the correct page in the top 3 for the query whose most distinctive
term the book doesn't use (`perception` occurs on zero pages). Dense
retrieval, run against the identical corpus and the identical unmodified
queries, ranked that page 9th instead of 24th — meaningfully better, though
still outside the top-3 budget on its own.

| | FTS (best config, S3/S4) | Dense retrieval (S5) |
|---|---|---|
| Q1 (out-of-corpus term) | 24th → 18th with vocab swap | **9th**, unmodified |
| Q2 | 1st | 1st |
| Q3 | 2nd | 3rd |

**Decided:** Voyage/pgvector dense retrieval is confirmed as the
`rules_lookup` mechanism. M7.2 continues on its existing design — no rebuild
of the ingestion path, no FTS index added in parallel. This was not a
foregone conclusion going in; three spikes were run specifically because
regex/FTS were live enough to be worth deciding before more chunker work
landed.

**What this does not settle.** Dense retrieval is not vocabulary-agnostic —
sensitive to the same two axes (verbosity, vocabulary) that broke FTS, just
less brittle about it. That's a separate decision, below.
