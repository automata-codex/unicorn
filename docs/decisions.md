# Decisions Log

Zoltar is an AI-GM platform for solo and small-group tabletop RPG play.

This log is a lightweight record of significant technical and architectural decisions made during design and development.

The design document (`docs/zoltar-design-doc.md`) captures the major product and architecture decisions; this log covers decisions made during implementation planning that aren't fully documented there.

Each entry records what was decided, what the alternatives were, and why.

---

## Architecture & Backend

### ORM: Drizzle over TypeORM

Drizzle's approach to Row Level Security is cleaner than TypeORM's — setting Postgres session variables and working with RLS policies requires less ceremony. Drizzle also produces more predictable SQL and infers TypeScript types directly from the schema definition at compile time, with no generation step. TypeORM is the NestJS default but not the right fit here.

### Migrations: Flyway over drizzle-kit

Flyway is ORM-agnostic and produces plain SQL migration files that are inspectable, version-controlled, and portable. Drizzle-kit generates SQL from schema diffs, which is useful during development but ties migration management to the ORM. Running Flyway from a Docker container in the Compose stack eliminates the JVM overhead concern. The two tools are not in conflict — drizzle-kit can be used for schema diffing during development while Flyway owns what actually gets applied.

### No circular FK between `adventure` and `gm_context`

An earlier design put `gm_context_id` on `adventure` as well as `adventure_id` on `gm_context`, creating a circular FK that required a nullable column and a three-step insert (adventure → gm_context → update adventure). Dropped in favour of a unidirectional reference: `gm_context.adventure_id` with a unique index. Lookup in either direction is a single indexed query.

### `session` renamed to `adventure`

The domain concept is an adventure, not a session. Sessions in the traditional sense are a social scheduling artifact that dissolves in solo async play. Adventures are the first-class domain concept — they own the GM context, messages, and game events. The table is named `adventure` rather than `session` throughout.

### No `@nestjs/cqrs`

The API follows a CQRS-flavored pattern with clean separation between the command path (GM pipeline) and the query path (direct DB reads), enforced by NestJS module boundaries. The formal `@nestjs/cqrs` command/query bus infrastructure adds overhead without meaningful benefit at this scale. Module separation achieves the same discipline.

### No event sourcing

ES is a natural fit for games in theory but awkward with an AI GM layer — Claude's responses aren't deterministic, so replaying events doesn't reproduce the same narrative. The message log plus state snapshot approach provides most of the practical ES benefits (audit trail, session reconstruction, correction without deletion) without the full ceremony.

### `@uv/auth-core` and `@uv/service-interfaces` are separate packages

Both packages exist so the future closed-source SaaS implementation repo can import abstract classes without depending on the open-source backend app. The split between the two packages reflects a difference in consumer profile: `AuthService` is a cross-cutting concern relevant to frontend-adjacent code (session validation, future SSR auth checks) and may be consumed outside a pure backend context. The six remaining service interfaces (`EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`) are backend-only concerns with no plausible frontend consumer. Keeping `auth-core` separate preserves the existing package boundary established in M1 and avoids mixing concerns that evolve at different rates.

### Explicit `status` column on `adventures` table; no inference from `gm_context` row presence

An earlier design derived adventure status from whether a `gm_context` row existed for the adventure. Row absence is ambiguous: it could mean synthesis is in progress, synthesis failed, or a bug prevented row creation. There is no clean way to represent synthesis failure without an explicit status field. An explicit `adventure_status` enum column (`synthesizing`, `ready`, `completed`, `failed`) makes status queryable without a join and allows the `failed` state to be surfaced to users rather than leaving them with a stuck adventure. The column is added in V9 migration with a back-fill for any existing adventures.

### Magic link auth is backend-owned; Auth.js is not used

Auth.js (`@auth/sveltekit`) requires SvelteKit's server-side hooks infrastructure to function. The frontend is a pure Svelte 5 SPA with no SSR or server-side hooks, so Auth.js cannot be used. Rather than pull in SvelteKit as a dependency for a single feature, magic link auth is implemented natively in the NestJS backend: the backend owns token generation, email delivery, session creation, and session validation. The `user`, `session`, and `verification_token` tables from V1 (originally created in the Auth.js schema format) are used as-is — we write to them directly. `AuthService.validateSession()` is unchanged: it reads the `session` table regardless of how the session was created.

### Frontend is Svelte 5 SPA, not SvelteKit

SvelteKit's SSR and routing conventions add complexity without meaningful benefit for this product: the GM pipeline is entirely backend-driven, there is no SEO requirement, and the auth flow is owned by the backend. A plain Svelte 5 + Vite SPA is simpler to reason about, has no server-side rendering surface, and makes the frontend/backend boundary explicit. The tech stack entry in the design doc and README reflects this: "Svelte 5 (SPA)" not "SvelteKit."

### Embedding model: `voyage-4-lite`, chosen together with the column dimension

M7 shipped with `VOYAGE_EMBED_MODEL` defaulting to `voyage-3-lite` on the stated assumption that it matched the `vector(1024)` declaration on `rules_chunk.embedding`. It does not — `voyage-3-lite` emits 512 dimensions; `voyage-3` is the 1024-dimensional model of that generation. The error was invisible for the whole of M7 because the index is empty: `RulesRepository.findByCosineSimilarity` filters `embedding IS NOT NULL`, so pgvector never evaluated `<=>` against a row and never raised the dimension mismatch. It would have surfaced on the first M7.2 ingestion run.

The default is now `voyage-4-lite`, which emits 1024 dimensions by default and leaves the column, the `game_system.embedding_dim` seed, and every existing migration unchanged. Choosing it over `voyage-3` also avoids adopting a model Voyage now lists as legacy; the voyage-4 family is current, `voyage-4-lite` is the same $0.02/M as `voyage-3-lite`, and legacy models no longer carry a free-token allowance. `voyage-4` and `voyage-4-large` are drop-in step-ups if retrieval quality warrants the cost — same default dimension, no migration.

Two constraints follow, and neither is enforced by the type system: the ingestion model and the runtime `VOYAGE_EMBED_MODEL` must be the *same model*, not merely two models of the same width, or similarity scores are meaningless while looking healthy; and any future model swap must be checked against the column dimension before ingesting rather than after. M7.2's pipeline should validate the returned vector length against `game_system.embedding_dim` before insert — that check is the cheap guard that would have caught this at M7 time.

No eval re-baseline is owed for this change on its own. Both existing baselines ran against an empty index, so no graded turn ever consumed an embedding; the re-baseline that `docs/decisions.md § Warden model upgraded to claude-sonnet-5` anticipates is owed to ingestion itself, not to the model swap.

---

## Rules Ingestion

### Rules ingestion pipeline and retrieval quality are separate milestones

M7.2's original spec included post-ingestion validation — an eval re-baseline and a dedicated playtest — as its own Part 6. Both moved out to a new milestone, M7.5 (Rules Retrieval Quality), during M7.2 implementation.

**Why.** M7.5 exists to iterate on chunking quality, potentially as far as a hand-curated Markdown replacement for automated extraction. That iteration changes what's in the index. The re-baseline costs roughly 300 Warden turns plus judge calls (2 models × 15 fixtures × N=10) — buying it against an index about to be re-chunked means buying it twice. Same shape of waste the `roll_dice` schema-field deferral (below) was already guarding against, except worse: that was an unavoidable confound between two things worth measuring together; this would be pure waste, re-measuring the same thing after changing it out from under the measurement.

**What makes deferring the re-baseline safe rather than merely postponing it:** the retrieval eval harness (`task eval:retrieval`) reads index quality for the price of a few Voyage calls — no Anthropic spend at all. "Is this index worth baselining?" gets answered long before anyone pays to baseline it. Without that harness the deferral would just be procrastination with an extra step.

**The completion-criteria split, not just the reasoning, is why they're separate milestones rather than one milestone with a later Part 6.** M7.2's criteria are binary — the CLI runs, rows land, the harness scores. M7.5's is a quality bar — chunking iteration continues until the bar is met or a stopping rule fires. Milestones with quality-bar criteria absorb whatever is adjacent to them; folding the re-baseline into M7.2 would have made M7.2 itself open-ended, defeating the reason for having Done-When criteria at all.

**Consequence:** M7.2 ends with a populated index and a way to measure it — not with evidence the Warden is actually better off. That evidence is M7.5's. The three entries below waiting on a populated-index re-baseline (`§ Warden model upgraded to claude-sonnet-5`, `§ Agentic graph decomposition stays deferred`, `§ rollType / gatedByRollId / actingEntityId on roll_dice stay deferred`) stay open one milestone longer than an M7.2-only plan would have implied.

### Rules ingestion is CLI-only in Phase 1

No web upload surface. A self-hosted user installs the Python pipeline, points
it at a PDF they own, and runs one command; `ingestion/README.md` is the
supported path.

This follows directly from the licensing posture rather than from effort. The
model is "the user runs ingestion against a PDF they own, on their own
infrastructure" (`docs/rules-ingestion.md § Licensing Posture`), and a web
uploader would put the operator in the position of receiving other people's
rulebook PDFs — which is the distribution question the whole posture exists to
avoid, arriving through a different door.

It is also honest about the shape of the job: ingestion is a rare, offline,
minutes-long batch that pulls 1.3 GB of extraction models and needs a
per-edition config file checked by hand. That is a CLI's work, not a form's.

**Recorded because the absence of a web UI is the single most likely thing a
future reader assumes was an oversight.** It is not. Revisit if a hosted
deployment ever needs non-technical users to add their own books, at which
point the licensing question has to be answered first, not second.

### Chunk extraction is block-based with footer-derived provenance, not markdown headings

The design doc's chunking premise — treat each `###` Markdown heading as a candidate chunk boundary — does not survive contact with the actual extraction output. The PSG's whole-book heading histogram is 84 `#`, 3 `##`, 10 `###`, 55 `####` (`docs/rules-extraction-findings.md § S1.5`): 10 `###` headings against a 100–400-chunk target kills the approach on arithmetic alone, and the levels are assigned by font size rather than document structure — `#### ARMOR` and `# 14 ARMOR` are the same section at different levels, and reading order scrambles across the character-creation spread. Markdown output is also the wrong extraction format independent of the heading problem: it discards page attribution entirely, and the only page-marker mechanism it carries (`<span id="page-N-M">` anchors) covers 16 of 44 pages.

**Decided:** ingestion runs marker with `--output_format chunks`, not `markdown` — typed blocks (`Text`/`Table`/`ListGroup`, dropping headers/footers/pictures) carrying page and bbox metadata, merged toward a ~400-token chunk target with 50–100 tokens of overlap (`docs/rules-extraction-findings.md § S1.6`). Chapter boundaries force a chunk break.

Provenance is derived, not read from any marker field. `blocks[].page` is an internal id, not a page number (physical page 0 → `'7'`, 1 → `'512'` — plausible-looking and wrong, the exact failure mode worth guarding against in any future extraction work). The physical page number comes from the `/page/N/` prefix on each block's `id`; the printed page number and chapter name are read from the PDF's running footer via `pypdfium2` directly, which resolves chapter on 36 of 44 pages (`docs/rules-extraction-findings.md § S1.8`). `section_hierarchy`, marker's own structural field, was tested and rejected as a breadcrumb source — it records the last header seen at each visual level, which turns siblings into parents on scrambled multi-column pages (`STEP 5. GAIN STRESS > STEP 6. NOTE TRAUMA RESPONSE`).

**Edition-specific, not general.** The `printed page = physical page + 1` offset and the footer-parsing approach are verified only against the PSG 1e. Any second Mothership book needs its own check before ingestion (`docs/rules-extraction-findings.md § Open questions`).

### Reading order requires an explicit column-aware sort; an LLM may validate it, never perform it

Marker's emitted block order is not reading order on multi-column pages. Of the 16 pages carrying two or more numbered section headers, 8 emit them out of order, including full reversals (`docs/rules-extraction-findings.md § S6.2`); the true rate is plausibly higher since that test can't see unnumbered headings. A chunker that merges blocks in emitted order — the design doc's implicit assumption — would concatenate roughly half the book's body pages backwards.

Two approaches were on the table: an LLM pass that reads the page image and proposes correct ordering, or a deterministic geometric sort using the bbox coordinates every block already carries. LLM-assisted flagging was piloted first for a different purpose (auditing extraction defects generally) and, as a side effect, demonstrated it could recover correct order by eye — but that's the wrong place for the capability to live: routing per-page ordering through an LLM call at ingestion time would make a Python-only, no-LLM-calls pipeline (`docs/rules-ingestion.md`, hard constraint) depend on a model call for every multi-column page, forever, on every re-ingestion.

**Decided:** a ~25-line deterministic sort. Full-width blocks (≥60% of page width) flush the current column band and stand alone; everything else is banded by `y0` position and split left/right by bbox x-centre against the page midline (`docs/rules-extraction-findings.md § S7.2`). This recovered 15 of 16 measurable pages with nothing regressed. The one residual failure (physical page 17, a boxed callout whose heading is narrower than its full-width body) is understood and local, not a case against the approach.

**The boundary that follows from this:** the sort must be deterministic and live in `ingest.py`. An LLM may validate the result — flagging pages where the sort still looks wrong, informed by the page image rather than geometry alone — but must never perform the reordering itself. Where geometry genuinely can't resolve a page, the escape hatch is a hand-blessed ordering recorded once per edition in `fixups.json`, keyed on block `id`; that's an explicit, reviewed exception, not a runtime dependency.

**Coverage caveat carried forward, not resolved here.** The numbered-header test that validates the sort only sees 16 of 44 pages. The LLM-flagging pass is the intended instrument for validating the other 28 (unnumbered headings), not yet run at that scope.

### Character-creation content is excluded from the rules index — structurally unreachable by the Warden

Physical pages 4, 41, and 42 cover Mothership character creation. Confirmed via tool-array and query-log inspection that `rules_lookup` is wired only into the play-loop tool array — character creation runs its own flow and makes no Anthropic calls at all, so nothing the Warden does can retrieve these pages regardless of what the index contains (`docs/rules-extraction-findings.md § S2`).

**Decided:** exclude physical pages 4, 41, 42 from the rules index. This also resolves the duplicate-spread question for that trio without needing dedup logic: 41 and 42 are byte-identical duplicates of page 4's character-creation spread, and both drop with it. Page 4 also carries the worst provenance in the corpus — its footer doesn't resolve to a chapter — so exclusion removes a hard case rather than requiring a fallback-chapter decision for it.

**Extended to page 3 on 2026-08-07, but on different grounds — and the difference is the point.** The character-profile sheet is now excluded too (`ingestion/mothership/system.json` carries `drop_pages: [3, 4, 41, 42]`), measured as M7.5 iteration round 2 in `docs/rules-extraction-findings.md § S18`.

This entry previously guessed page 3 was "the same category" as 4/41/42. **It is not.** Pages 4/41/42 are excluded because the Warden *structurally cannot reach them* — an argument from the tool array that holds regardless of what the index contains or how well retrieval works. Page 3 is perfectly reachable and is excluded because it is *actively harmful*: it held **10 of 147 top-3 slots** across the fixture set and sat at **rank 1 ahead of the correct page** for two answerable combat queries (`rq-003`, `rq-017`), on stat-name density alone. Removing it promoted both and cost no recall. (It also lifted MRR by roughly 0.02, but see `docs/rules-extraction-findings.md § S22`: that metric alternates between 0.842 and 0.856 across repeated runs at one configuration, so it is colour here rather than evidence.)

Same action, two different justifications, and conflating them would have been expensive for the next page anyone asks about: **reachability is confirmed by reading the tool array; harm has to be measured.** A page that is reachable and merely useless costs nothing and needs no decision. A page that is reachable and *attractive to the wrong queries* costs a top-3 slot every time, and only a scored fixture set can tell the two apart.

**Method note worth carrying forward.** Round 2's decision criterion was fixed before the run as "exclude if recall holds *and unanswerable top-1 similarity falls*." Recall held; unanswerable similarity did not move at all. The second clause was a proxy for false-positive pressure that pointed at the wrong fixtures — page 3's false positives were landing on *answerable* queries, displacing pages that genuinely answered, which an unanswerable-set aggregate cannot see. The exclusion stands on the direct per-fixture evidence instead. Recorded rather than quietly reinterpreted, per `§ S18.4`.

### Fixup match schema keyed on block `id`, not `{section, contains}`

`docs/rules-ingestion.md § Step 2` specifies fixup entries matched by `{section, contains}` — e.g. `{"section": ["Combat", "Panic"], "contains": "1-10Roll"}`. Neither key can express the confirmed extraction defects. `contains` needs text to match against, and the defect is 14 of 32 `Table` blocks extracting as empty (`<p></p>`) — there's nothing there to match on. `section` was meant to derive from `section_hierarchy`, already rejected above as unreliable ancestry.

**Decided:** match fixup entries on the block `id` (e.g. `/page/11/Table/5`) instead — stable, unique, and already the fallback every other part of this pipeline uses once `page` and `section_hierarchy` proved unreliable (`docs/rules-extraction-findings.md § S6.5`). `ingestion/mothership/fixups.json` remains empty pending the table-defect scoping decision in `roadmap.md` M7.2; this entry fixes the schema those fixups will eventually use, not the defects themselves.

---

## Rules Retrieval

### Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex

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

### Query preprocessing for `rules_lookup` promoted from optional to critical path

Shortening a `rules_lookup` query to its 2–3 distinctive terms puts the
correct page at rank 1 on *both* FTS and dense retrieval, for all three real
recorded queries — including the one query no other configuration on either
backend ever retrieved (`docs/rules-extraction-findings.md § S4`, `§ S5.3`).
This is the single largest effect measured across the whole retrieval
investigation, larger than the FTS-vs-embeddings choice itself (`docs/decisions.md
§ Rules retrieval mechanism`, above).

Two separable fixes, with different costs:

- ~~**Term-dropping is mechanical and has no open question attached.** A
  document-frequency ceiling computed from the index itself (drop query
  terms occurring on more than some threshold share of pages) requires no
  vocabulary knowledge and no LLM call. Proven on both backends. This is now
  M7.2/M7.5 scope, not a maybe.~~
  **Overturned by measurement, 2026-08-06.** The mechanism shipped in M7.2 and
  was then swept with `task eval:retrieval` against 37 labelled answerable
  queries. It has **no useful setting on this corpus**: every ceiling that
  drops anything costs recall (0.4 is −10.8 pp recall@3; 0.55 is −8.1 pp), and
  every ceiling that costs nothing (0.65 and above) drops nothing, because the
  measured document frequencies cluster at 47–64% with no gap between filler
  and topic vocabulary to place a threshold in
  (`docs/rules-extraction-findings.md § S15.3`).

  What went wrong in the reasoning above is the word *proven*. What S4 proved
  was that **hand-authored** trimming helps — by someone who already knew the
  target page, which `§ S4.5` flagged as an upper bound. A frequency ceiling is
  a different instrument, and on a single-book corpus it discards the word that
  names the mechanic, because `saving` is frequent precisely *because the book
  is about saves*. Assuming the automated proxy inherited the manual result's
  evidence was the error, and it is the one worth remembering.

  **Shipped state:** the mechanism, the `--df-threshold` flag, and the sweep
  all remain; `DEFAULT_DF_THRESHOLD` is 0.75, deliberately above every observed
  frequency, so the default costs nothing while a larger or multi-book corpus
  might yet admit a useful ceiling. The vocabulary half of this entry, below,
  is untouched and still open.
- **Vocabulary mapping is the part still open.** Substituting book
  vocabulary for generic-TTRPG terms (`perception` → `Intellect`) is a real,
  separate effect — moved the worst query from 9th to 4th under dense
  retrieval — but the reformulations tested were authored by someone who
  already knew the target page (`docs/rules-extraction-findings.md § S4.5`),
  so this is an upper bound, not a validated fix. Two candidate approaches,
  not yet chosen between: a per-system synonym/thesaurus table (real ongoing
  authoring cost, one per supported game system), or prompt-side guidance
  steering the Warden's own query phrasing toward book vocabulary. The
  latter is free — the Warden is already the LLM making the tool call, so
  shaping its query costs no additional latency or API call, unlike a
  dedicated query-rewriting model call, which the latency finding above
  rules out.

**Consequence for the M7.2 retrieval eval harness.** Fixtures written by
hand in tidy, correct-vocabulary phrasing cannot detect this failure mode at
all — the harness needs query fixtures that reflect real Warden output
(verbose, sometimes off-vocabulary), not idealized questions, or it will
report a retrieval quality bar the Warden's actual queries never clear.

**Not yet decided:** whether prompt-side guidance alone closes enough of the
vocabulary gap to skip a synonym table, or whether both are needed. Prompt
guidance is untested; only the oracle-authored upper bound has been
measured.

**Amendment — the vocabulary gap splits into two problems, not one, and the
floor is more load-bearing than it looked.** Measured against the 596 real
`rules_lookup` queries recorded in `unicorn-artifacts` (`docs/rules-extraction-findings.md
§ S8`), not just the original three. The "vocabulary mapping" fix above
assumed a single problem — the Warden's word, the book's word — but at scale
it splits into two with different fixes:

- **Wrong word** (`initiative`→`turn order`, `stealth`→`sneak`): the book has
  the concept under different vocabulary. A synonym table or prompt-side
  phrasing guidance genuinely fixes this. 157 of the 344 out-of-corpus-term
  queries (45.6%) fall here.
- **Concept absent** (suppressive fire, flanking, opposed rolls, difficulty
  numbers): the PSG resolves everything by rolling under a stat, so these
  mechanics have no referent in the book at all. No mapping — synonym table
  or otherwise — can retrieve a rule the book doesn't contain. 130 of 344
  (37.8%) fall here, and the correct behaviour is returning nothing, which
  the design already treats as a supported outcome (`docs/rules-extraction-findings.md
  § S8.3`, `§ S9`).

**Consequence:** the similarity floor (`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md
§ Part 4`, left open) is not an optional refinement alongside the vocabulary
work — it's the only mechanism that correctly handles over a third of real
queries, at a rate the original three-query sample gave no way to see. Both
fixes are now confirmed necessary and non-overlapping, not alternatives to
weigh against each other.

### No similarity floor for `rules_lookup` — the distributions overlap, and the free-looking threshold is fitted to noise

M7.5 Part 4, decided 2026-08-07 against the final index (61 chunks, `drop_pages: [3, 4, 41, 42]`), per `docs/rules-extraction-findings.md § S20`. `RulesLookupService.lookup()` is unchanged: it returns whatever `findByCosineSimilarity` gives back, with no threshold.

**The distributions overlap and interleave.** Answerable-with-a-correct-hit spans 0.342–0.600 (n=35); unanswerable spans 0.270–0.416 (n=12). The overlap zone 0.342–0.416 contains 5 correct answers and 6 unanswerable queries, mixed rather than merely abutting. That is the spec's stated criterion for "no honest floor exists yet," and it is not met.

**The part worth recording is the threshold that looks free.** A floor at 0.34 — just under the answerable minimum — discards **0 of 35** correct answers and suppresses **5 of 12** unanswerable queries. It is the obvious thing to ship.

It is rejected because its measured cost is zero *by construction*. 0.342 is not the lowest similarity a correct answer has; it is the lowest one had in a 35-point sample, and a threshold placed just beneath a sample minimum is fitted to an order statistic. The quantity that would justify it — the distribution's true left tail — is exactly what 35 points cannot estimate.

The asymmetry settles it. A suppressed unanswerable query costs nothing: the Warden already handles empty results correctly, with a prompt block for it and a `gmUpdates.notes` convention for recording the gap. A suppressed *correct* chunk costs a wrong ruling with no trace that anything was withheld. **Recorded rather than merely decided, because the table is persuasive and will be persuasive to the next person who builds it.**

**What would actually make a floor derivable, and it is not chunking.** Three iteration rounds moved these distributions by 0.001 (`§ S15.4` measured 0.342–0.416 on the M7.2 index; `§ S20.1` measures the same on the final one). They could not have moved it: the excluded pages were displacing correct answers on *answerable* queries, while an unanswerable query's top hit was already a legitimate topically-adjacent chunk. Unanswerable queries score 0.27–0.42 because they ask about absent mechanics in *present* vocabulary — `flanking` and `opposed rolls` are not in the book, but `combat`, `armor`, and `cover` are — so the embedding is measuring real proximity and is not wrong.

A floor becomes available when the unanswerable distribution shifts down, and the only lever that moves it is upstream of retrieval: stop generating concept-absent queries, which `§ S9.3` measured at 130 of 344 out-of-corpus queries (37.8%). That is the mechanical-model primer in M7.5 Part 4.6. **Re-derive the floor after the primer has been measured, not after the next chunking change.**

### The D&D-5e-bias hypothesis has a confirmed instance, in the schema rather than in retrieval

The hypothesis — that the Warden's out-of-corpus vocabulary is specifically D&D 5e lexicon
bleeding into Mothership play, rather than generic TTRPG vocabulary — was recorded in
`docs/rules-extraction-findings.md` as named-but-untested open question. The retrieval-side version
remains untested; nothing below measures a query.

**But the M7.6 code inventory found 5e mechanics in the Mothership character sheet and
pool definitions, which nobody was looking at when the hypothesis was formed.** Two
instances, both cited against `milestones/m7.6-code-inventory.md` at `e1cdaac`:

- **`level: z.number().int().min(1).max(10).default(1)`**
  (`packages/game-systems/src/mothership/character-sheet.schema.ts:15`). Mothership has no
  levels. Advancement is Skill Training (§24.1, measured in years and credits) and Shore
  Leave converting Stress into permanently improved Saves (§39.1). The field has no
  producer and no consumer anywhere in the repo — absent from
  `formatMothershipCharacterProse`, absent from the frontend's hand-written
  `CharacterSheet` type, absent from both create and edit forms. A levels concept with a
  1–10 range arrived from somewhere, and it was not the Player's Survival Guide.
- **`HP_DEFINITION = { min: null, max: null, thresholds: [{ value: 0, effect:
  'death_save_required' }] }`** (`packages/game-systems/src/mothership/pool-definitions.ts`).
  That is the 5e rule — 0 HP sends you to death saving throws. Mothership's rule is
  different in kind: Health reaching zero gives a **Wound** and a roll on the Wounds Table,
  Health resets to Maximum minus carryover, and the Death Save comes only when Wounds
  equal Maximum Wounds (§28.2, §29.1–29.2). There is no `maxWounds` field on the sheet and
  no wounds pool definition, so the entire Wounds layer is absent and the code substitutes
  the 5e shortcut for it.

**Why this is worth an entry rather than a bug report.** The two defects are individually
fixable in M7.6 and would not need recording. What needs recording is the *pattern*: 5e
mechanics entered a Mothership artifact silently, at authoring time, and survived M2, M3,
M5, M6 and M7 without anyone noticing. The hypothesis predicted this happening in the
Warden's queries at runtime. Finding it instead in a schema written by hand, in a
different artifact, at a different time, is independent evidence for the same underlying
cause and is stronger than another instance of the predicted kind would have been.

**The drift went the wrong way, which rules out inheritance.** The retired
`apps/zoltar-playtest` prototype carried `sanity` under `saves` (correct — Sanity is a Save,
§18.2), no `instinct`, and no `level`
(`apps/zoltar-playtest/src/lib/types.ts`, via the inventory). The production schema has
`sanity` and `instinct` under `stats` and a `level` field. So the current shape was
authored rather than inherited from the prototype, and it is *less* faithful than what
preceded it.

**A third instance, weaker, recorded for completeness.** `stats.instinct`
(`character-sheet.schema.ts:21`) is not a 5e import — Instinct is a real Mothership stat,
but it belongs to **Contractors** (§40.1), the simplified NPC statblock where it is the
catchall standing in for Fear, Sanity, Body, Speed and Intellect. It is not a
player-character attribute. This is the same failure mode as the two above — a mechanic
from an adjacent model applied to the PC sheet — with a different adjacent model.

**What this does and does not license.**

- It **does** justify treating "check for 5e assumptions" as a standing review question on
  any Mothership artifact authored without the book open, and specifically on the M7.6
  spec, which is being written to correct exactly these fields.
- It **does not** validate the retrieval-side claim. The vocabulary gap measured in
  `§ Query preprocessing for rules_lookup promoted from optional to critical path`
  (amendment) splits 157 wrong-word / 130 concept-absent out of 344, and *which* lexicon
  those out-of-corpus terms come from is still unmeasured. Confirming the hypothesis in
  one artifact does not confirm it in another, and the mechanical-model primer's design
  should not start assuming 5e as the source.
- The cheap test remains available and is still not run: classify the 130 concept-absent
  queries by whether the named mechanic exists in 5e. Flanking, suppressive fire, opposed
  rolls and DCs all do. That is a labelling pass over data already in `unicorn-artifacts`,
  with no Warden run and no API spend.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### The retrieval stopping rule is measured on the metrics with headroom, not on the saturated one

`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § The stopping rule`
originally closed M7.5 "after three full iteration rounds that do not
improve `recall@3` on the `authored` set by more than 5 percentage points in
aggregate."

**`authored` recall@3 is 100.0%** (`docs/rules-extraction-findings.md
§ S15.2`, confirmed in `§ S16.1`). It cannot improve by any amount, so that
condition fires after round three unconditionally — including after a round
that took `warden-observed` from 91.3% to 100%. The rule was measuring
progress on the one axis with no headroom left, which makes it a round
counter dressed as a quality test.

**Decided:** the no-progress test is evaluated on `recall@3` over the
**answerable set as a whole** and on **`warden-observed`** specifically, with
`authored` held as a **regression floor** rather than a growth target. The
5 pp threshold and the three-round budget are unchanged; only the axis moves.
A round that drops `authored` below 100% has made things worse regardless of
what it did elsewhere, and is logged as such.

**Corrected before round 1 ran, not after.** That ordering is the whole point
— a stopping rule amended once results are in is indistinguishable from
moving the goalposts, which is the same hazard as choosing a bar after seeing
the numbers. The spec was amended in place and this entry written before any
lever was pulled.

**The general lesson, which is not about this rule.** A metric that is
saturated at authoring time is a bad progress test and a fine regression
test, and the two roles are easy to conflate because the same number serves
both. `authored` at 100% still earns its place in the report — a chunking
change that broke it would be caught immediately — but "did this round help"
has to be asked of a number that can answer. Worth checking whenever a
threshold is written against a metric that is already at its ceiling.

---

## Claude Integration — Tool Schemas & State

### Warden model upgraded to `claude-sonnet-5`

Declared 2026-08-03 on the evidence of the 4.6 → Sonnet 5 full-corpus baseline, re-scored under the migrated checkers. Sonnet 5 improves on every axis the harness measures where either model is passable at all, and the two axes where it doesn't are axes where *neither* model is acceptable — which makes them prompt targets rather than arguments against the swap.

Same prompt (`97feadbd`), same corpus (`88fa84bd8329`), same N, no orchestration work, single-grader:

| Check | 4.6 | Sonnet 5 |
| --- | --- | --- |
| `out-of-order-resolution` | 0.39 (7/18) | **1.00 (20/20)** |
| `system-rolled-player-action` | 0.18 (3/17) | **0.90 (18/20)** |
| `turn03-unsurfaced-check` | 0.00 (0/10) | **0.70 (7/10)** |
| `turn24-scene-jump` | 0.50 (3/6) | **0.90 (9/10)** |
| `turn24-over-resolution` | 0.33 (2/6) | **0.80 (8/10)** |
| `turn24-hidden-info-leak` | 0.40 (2/5) | **0.89 (8/9)** |
| `turn28-hidden-info-leak` | 0.67 (6/9) | **1.00 (10/10)** |
| `turn21-narrating-past-a-block` | 1.00 (9/9) | 1.00 (10/10) |
| `turn16-narrating-past-a-block` | 0.00 (0/10) | 0.00 (0/10) |
| `unauditable-mapping` (3 fixtures) | 2/29 | 0/16 |

`unauditable-mapping` is nominally *worse* under Sonnet 5, and should not be read that way: 2-of-29 against 0-of-16 is un-rankable on its numerators alone, the same defect described under "Un-rankable is a numerator problem" in `eval-methodology.md`. The correct reading is that both models essentially never state a result-to-meaning mapping before a spontaneous roll, and the harness cannot currently tell them apart on it.

Secondary but not minor: **errors dropped from 18 of 150 rows to 4**, almost all of them the inner tool loop hitting its 20-iteration cap on the `turn24-*` family. That is why three of the 4.6 rates above rest on N=5–6 and should be read as directional. It also means part of the apparent gap on those three fixtures is a difference in error rate rather than in quality — the honest reading is that Sonnet 5 both scores better and finishes, and the second is what makes the first measurable.

Two failure modes survive the swap with real denominators behind them: `unauditable-mapping` (2 passes across 45 judged inputs spanning both models) and `turn16-narrating-past-a-block` (0/10 under both). Both are now confirmed genuine rather than checker artifacts, which is the useful outcome — they are prompt work, and they are the two places prompt work should go first.

**What this decision does not claim.** All figures are single-grader. Both baselines executed against an empty `rules_chunk` index, so nothing here accounts for how rules availability changes reach-for-dice behaviour; the M7.5 re-baseline is the real test of these numbers (moved from M7.2 — see § Rules ingestion pipeline and retrieval quality are separate milestones). At N=10 the 95% CI half-width at p=0.5 is ~±31pp, so individual rates near the middle are unsettled even where the direction is not. And a first run against a new model audits the harness as much as the model — the two defects that audit surfaced are recorded in `eval-methodology.md`, and the rates above are the post-correction ones.

**The M7.5 re-baseline answered that, 2026-08-09, and the decision stands — but one number in the table above has to be retired.** Sonnet 5 against the populated index at prompt `0bdd1306`, both sides re-scored under the corrected checker:

| Tag | Sonnet 5, July (`97feadbd`, empty index) | Sonnet 5, now (`0bdd1306`, populated) |
|---|---|---|
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.90 (18/20) | **0.45 (9/20)** |
| `OUT-OF-ORDER-RESOLUTION` | 1.00 (20/20) | 0.94 (17/18) |
| `UNSURFACED-CHECK` | 0.70 (7/10) | **1.00 (10/10)** |
| `HIDDEN-INFO-LEAK` | 0.90 (18/20) | **1.00 (20/20)** |
| `SCENE-JUMP` | 0.90 (9/10) | 0.80 (8/10) |
| `NARRATING-PAST-A-BLOCK` | 0.50 (10/20) | 0.50 (10/20) |

The upgrade rationale is unaffected — every one of these is Sonnet 5 against Sonnet 5, and 4.6 was not re-run (its arm carried 10 tool-loop-cap errors on the M7.5 attempt, and the upgrade question was settled in July; see `docs/rules-extraction-findings.md § S31`).

What must be retired is the reading that `SYSTEM-ROLLED-PLAYER-ACTION` at 0.90 was "the model's ceiling." It halved once the index was populated and the primer taught when a check is warranted, and the two moves are one behaviour: `UNSURFACED-CHECK` reached 1.00 in the same run. The Warden learned to recognise that a roll is called for and then rolls it itself. That is a prompt target, and it is now the largest one in the corpus.

Also retired: 0.90 was measured with a checker that could not see the failure. The M7.5 `actingEntityId` integration shipped a false pass that graded ten violations clean (§ `actingEntityId` must resolve against a declared identifier set, below). The July figure is unaffected — those artifacts predate the field and take the prose path, verified bit-identical on re-score — but every figure produced between 2026-08-07 and 2026-08-09 on this tag was wrong.

**The judged half of that table is now self-graded, and was already half-way there.** `JUDGE_MODEL` has been `claude-sonnet-5` since the judged checks were built — deliberately above the Warden's 4.6, so a more capable grader sat over the model under test. This decision closes that gap: the Warden and its judge are now the same model. The consequence is retroactive as well as forward-looking, and it is a real confound in the comparison above: on the 4.6 side a Sonnet 5 judge graded a 4.6 generator, while on the Sonnet 5 side it graded itself. Every judged row in the table therefore has an asymmetry the structural rows don't.

Two things bound the damage. `out-of-order-resolution` and `system-rolled-player-action` — which happen to be the two largest and cleanest gains, 0.39 → 1.00 and 0.18 → 0.90 — are structural and reach a verdict with no model in the loop at all. And `eval:judge-variance` measures grader stability against frozen input, which is unaffected by which model produced that input. The judged rows should still be read as directional rather than as clean measurements until an independent grader confirms them.

The alternative — pinning the judge to 4.6 to preserve the gap — was rejected: it trades a self-grading bias for grader drift against a model we no longer ship, which is the worse of the two because nobody would be watching it. Raise the judge above the Warden again when an Opus-tier grader is affordable for routine comparisons.

Mechanically the change is `DEFAULT_SYNTHESIS_MODEL` in `apps/zoltar-be/src/anthropic/anthropic.service.ts`, plus the tech-stack row in `CLAUDE.md`. The eval harness already takes `--model` and needs nothing.

**One runtime consequence to watch.** Sonnet 5 runs adaptive thinking when the `thinking` parameter is omitted; Sonnet 4.6 ran without thinking. `max_tokens` caps thinking *and* response text together, so `DEFAULT_SESSION_MAX_TOKENS` (4096) and `DEFAULT_SYNTHESIS_MAX_TOKENS` (8192) now cover strictly more. No code change was needed — the inner tool loop and `buildCorrectionRequest` both echo `response.content` verbatim, which is exactly what round-tripping thinking blocks requires — and the Sonnet 5 baseline already ran this path at 4096 with 4 errored rows in 150 against 4.6's 18. Watch for `stop_reason: 'max_tokens'` on long combat turns anyway; the headroom is smaller than it was.

**Addendum — the 4.6 arm is retired as a decision input, and a Haiku 4.5 control arm inherits
its other job.** Declared 2026-08-09 during M7.5 scheduling; recorded 2026-08-11, two days
late, and only because drafting M7.8 surfaced that the arm existed nowhere but a chat log.
That delay is the entry, not an aside: the whole point of writing this down was to stop the arm
being *quietly* dropped from a checklist, and it was two days from being dropped quietly anyway.

The retirement argument is the one already made two paragraphs above about the judge, applied a
position earlier in the pipeline. A regression harness protects the thing you ship, and 4.6 is
not it. Re-baselining 4.6 against the populated index answers "how much would rules availability
help a model we don't use," which is on the critical path to nothing. The 4.6 side of the table
above is also the weaker half of its own evidence — three of those rates rest on N=5–6 because
4.6 errored out, and its M7.5 arm carried 10 tool-loop-cap errors before being abandoned. Keeping
it would mean watching a second arm nobody would actually read, which is precisely why the
4.6-pinned judge was rejected.

**What the second arm was doing besides comparison.** `out-of-order-resolution` (1.00, 20/20 in
July; 0.94 now) and `turn28-hidden-info-leak` (1.00, 10/10) pin at the top, and this project's own
rule is that a rate sitting at either extreme across every rep is a harness suspect rather than a
finding — with the ceiling case exactly as suspect as the floor and materially less likely to be
investigated, because a pinned 1.00 presents with full applicability and a healthy denominator
(§ A rate that never moves is a harness suspect, not a finding; that entry's instance list is
amended to include `turn28-hidden-info-leak`). A weaker model failing those checks is the only
evidence currently available that they can reach a `fail` verdict at all. Drop both arms and that
guard goes with them, silently.

**So the arm survives with a different job and a different model: Haiku 4.5, low N, `--fixtures`
scoped to the fixtures carrying those two checks.** Cheaper and faster than 4.6, which matters
because wall-clock was the original complaint. There is no `--tag` selector and deliberately never
was (a second overlapping selector was declined at M7.4), so scoping is by fixture and the
irrelevant rows are simply not read. Read the arm in one direction only: a weak model **passing** a
pinned check is the finding. Failing it is the expected result and says nothing about the Warden —
Haiku's rates are not a model comparison and must never be reported beside Sonnet 5's as though
they were.

**Scheduled as a rider on M7.6's re-baseline**, not as work of its own, since that is the next
graded Warden run on the calendar and the arm needs no orchestration beyond a second invocation.
Landing it before M7.7 buys something specific: if either check turns out to be undiscriminating,
that is known before fixtures get authored from the playtest capture, and an authoring decision
made against a blind checker is the one class of harness defect `eval:rescore` cannot retroactively
repair.

**Superseded in part by M7.8.** Known-answer fixtures assert the same property directly — engineered
to fail a specific check, asserting the harness agrees — in both directions, at zero Warden spend,
and repeatably. Where such a pair exists, the control arm is redundant inference. What it does not
cover is checks nobody thought to author a pair for, and M8 introduces caller and initiative checkers
that will arrive without one. So the arm narrows a second time: decision input (retired 2026-08-09)
→ checker control (M7.6) → coverage-gap probe for un-paired checks (M7.8 onward). That is
deliberately the same trajectory recorded for the "pinned at either extreme" heuristic, because they
are the same kind of instrument — indirect probes standing in for not being able to read a checker
with confidence — and they retire together, per check, as coverage arrives. The reciprocal record
lives in that entry's own addendum.

**What this does not claim.** A Haiku failure proves a check *can* move; it does not prove the check
fails for the right reason, and a checker that fails weak output for the wrong reason would look
identical from here. That gap is exactly what M7.8 closes and why the arm is transitional rather than
permanent. The arm also says nothing about the judge, which is probabilistic by construction and
characterised through `eval:judge-variance` against frozen input, not through a second generator.

### Tool use over prompt instructions for structured output

Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

### HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field

An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

### State placement is decided by the lifetime of the referent, not the lifetime of the value

There are three places a piece of state can live — the character sheet, campaign state,
and adventure state — and until now there was no rule for choosing between them. The
sheet/campaign line was settled once, for HP and current Stress, in
`§ Character sheet stores identity and build, not live mutable state`. The
campaign/adventure line was never stated at all: `adventures` carries `mode`,
`initiative_order`, `caller_id` and `rolling_summary`, and everything else defaults into
`campaign_state.data` because that is where the blob is.

**The rule.** State lives at the scope of the thing it is *about*:

- **The referent never changes after creation** → **character sheet**. Name, pronouns,
  class, the creation rolls as rolled.
- **The referent outlives the adventure** → **campaign state**. Anything attached to a
  character, a recurring NPC, or the party's ship.
- **The referent is created and destroyed with the adventure** → **adventure state**. A
  derelict's reactor integrity, a synthesized threat's HP, a countdown timer, initiative
  order, scenario flags.

**Reset is a rule, not a lifecycle.** This is the part that is easy to get wrong, and
getting it wrong is what motivated writing the rule down. D&D 5e spell slots feel
adventure-scoped because 5e adventures conventionally begin after a long rest — but start
a party mid-dungeon with two of four slots spent and the slots plainly carry forward. The
long rest is a *mechanic that writes to campaign state*, not evidence that slots are
adventure-scoped. Ability drain is the cleaner case: a shadow's Strength drain is undone
by greater restoration, a purchase, exactly parallel to Mothership's Psychosurgery. In 5e
essentially nothing character-attached is adventure state — not slots, hit dice,
exhaustion, attunement, or prepared spells.

Making campaign the default and adventure the exception has a useful property: a system
with no reset mechanic needs no special handling, and a system with one implements the
reset as a state change rather than as a storage boundary.

**Mothership under the rule, which is not where the intuition points.** All *character*
state is campaign state — Mothership has no factory reset of any kind. Damage to Stats
and Saves is undone only by paid medical treatment; Maximum Health and Maximum Wounds
decrease monotonically with no recovery path in the Player's Survival Guide at all
(§29.2 Death table `00`; Panic `19`). But all *scenario* state — synthesized NPC and
threat pools, flags, `worldFacts`, `scenarioState` — is adventure-scoped by the rule, and
all of it lives in `campaign_state.data` today, in flat maps with no adventure
discriminator.

**A cross-check that agrees with the rule.** The writer already correlates with the
scope. Character creation writes campaign-scoped player pools
(`§ Player resource pools are derived at character creation, not at synthesis`);
synthesis writes NPC, threat, and timer pools. If synthesis wrote it, it is adventure
state.

**Known limit, recorded rather than pre-solved.** Some systems scope finer than an
adventure. Infinity 2d20's Momentum is a shared party pool that resets between *scenes*;
Feng Shui 2's Fortune resets per session while Marks of Death are permanent. The referent
rule still holds — Momentum's referent is the scene — but the three-destination model has
no home for it. Revisit at Phase 3–4 when those systems land, not before.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### Character sheet stores identity and build, not live mutable state

`character_sheet.data` carries the character's identity (name, class, entityId), build (stats, saves, skills, equipment), and ceilings (`maxHp`, `maxStress`). It does not carry current HP or current stress — those are mutable values that change during play and live exclusively in `campaign_state.data.resourcePools` as `{entityId}_hp` and `{entityId}_stress`. At character creation time, `deriveMothershipCharacterResourcePools` seeds the pools at full HP and zero stress from the ceilings. An earlier design kept `currentHp` and `stress: { current, max }` on the sheet, but these drifted from the authoritative pool values the moment play began and served no purpose after creation.

**Addendum — the rule generalizes, and applying it consistently moves more than HP and
Stress off the sheet**

This entry settles two fields and states a split as a by-product: sheet holds identity,
build, and ceilings; pools hold current values. It never generalized, and the fields it
would have caught were classified before the Mothership rules were read closely.

The rationale does generalize. "These drifted from the authoritative pool values the
moment play began and served no purpose after creation," read as a rule — *if a value
mutates in play, campaign state owns it; the sheet keeps only what creation determines
and play never touches* — disposes of several fields this entry currently places on the
sheet:

- **`stats` and `saves` are not build data.** All seven move in play: Wounds reduce
  Strength (`-1d10`) and Body Save (`-2d10`); Level 2 radiation reduces all Stats and
  Saves by 1 per round; Stress above 20 reduces "the most relevant Stat or Save" by the
  excess — a *discretionary* reduction, the Warden choosing which. Shore Leave
  permanently raises Saves.
- **The ceilings are not ceilings.** Maximum Health drops 1d5 on a Death-table `00`;
  Maximum Wounds drops 1 on Panic `19`. Both are mid-adventure events, and neither is
  restored by anything in the Player's Survival Guide.
- **`maxStress` is pointed at the wrong quantity.** There is no per-character maximum
  Stress; 20 is a system constant. The per-character value is *Minimum* Stress, which
  starts at 2 and moves in at least seven ways.
- **`equipment: string[]` and `saves.armor: number` cannot hold what they name.** Armor
  Points belong to a worn item and are consumed — damage ≥ AP destroys the armor, and a
  patched vaccsuit is AP 1 — so AP is `{ base, current, destroyed }` with DR tracked
  separately. Loadout entries carry charges, rounds, and doses.

**One correction of fact in the entry above:** it describes the derivation as seeding
pools "at full HP and zero stress." Current Stress starts at **2**, not 0, and floors at
Minimum Stress thereafter, never at zero. Whether the code matches the entry or the rules
is a verification item for M7.6.

Full field-by-field derivation, with rule citations, in the M7.6 PSG inventory. The
placement rule this addendum is an instance of is
`§ State placement is decided by the lifetime of the referent, not the lifetime of the
value`.

**Addendum 2 — the code inventory resolves the open verification item, and the schema is
further from the rules than the first addendum assumed**

The first addendum flagged the "zero stress" seed as a verification item for M7.6.
`milestones/m7.6-code-inventory.md` (commit `e1cdaac`) resolves it: **the code matches this
entry, and both are wrong against the rules.** The stress pool is incorrect on three axes,
not one:

- **Seed.** `current: 0` (`packages/game-systems/src/mothership/character-pools.ts:22`).
  The PSG starts current Stress at 2 (§20.1).
- **Floor.** `STRESS_DEFINITION.min = 0`. The PSG floors Stress at *Minimum* Stress, which
  starts at 2 and moves in at least seven ways — never at zero (§20.2).
- **Cap.** `STRESS_DEFINITION.max = null`. The PSG caps Stress at 20, with the excess
  reducing the most relevant Stat or Save (§20.1).

**A behavioural divergence the spec has to resolve deliberately.** A delta that would take
a pool below its `min` is **rejected**, not clamped. For HP this never fires — `min` is
`null`, which is what makes `§ Pool validator applies full delta before threshold
detection` work as written (the goblin at −2 HP). For stress it fires at zero. If M7.6
routes Stats and Saves through pools, each one needs an explicit reject-or-clamp decision
rather than inheriting whichever behaviour its `min` happens to produce.

**Three further shape defects the inventory found, beyond the four this entry's first
addendum lists:**

- **`stats` has six fields and should have four.** `sanity` is a Save (§18.2), not a Stat;
  `instinct` is a Contractor stat (§40.1) and not a player-character attribute at all.
  `saves` correspondingly lacks Sanity.
- **Wounds are entirely absent** — no `maxWounds`, no wounds pool. See
  `§ The D&D-5e-bias hypothesis has a confirmed instance, in the schema rather than in
  retrieval` for what the code does instead.
- **`level` exists, is written by nothing and read by nothing**, in a game with no levels.

### Pool validator applies full delta before threshold detection

When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.

### Pool behavior defined in system Zod schema, not hardcoded in validator

Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.

### Entity death does not auto-zero prefixed pools

When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.

### Entity and resource pool identifiers use underscores only

Dots in identifier strings cause subtle bugs when code uses dot-notation property access on JSON keys. Hyphens are legal but inconsistent with TypeScript naming conventions. Underscores are unambiguous. Resource pools follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `vasquez_stress`.

### `diceRequests` IDs assigned by the backend, not Claude

An earlier design had Claude generate UUIDs for dice request entries. Claude doesn't generate UUIDs reliably. The backend assigns IDs after receiving `submit_gm_response` and returns them in the action response. Claude omits the ID field entirely.

### State snapshot field consolidation deferred to Milestone 1.2

The snapshot has accumulated fields across playtesting — `initialState` counters, `world_facts` scratchpad, character state, entity positions, and flags — each solving a distinct problem as it was discovered. At 1.2, when the tool schema is being locked, both sides of the read/write contract should be rationalized together: what Claude reads in the snapshot and what it writes via tools. Doing this earlier would be premature; the playtest data doesn't exist yet to inform good consolidation decisions.

### `flags` structure merges value and trigger into a single object

An earlier design kept flags and flag triggers as two parallel top-level maps in campaign state: `flags: Record<string, boolean>` and `flagTriggers: Record<string, string>`. These were merged into a single structure keyed by flag name:

```typescript
flags: Record<string, { value: boolean, trigger: string }>
```

Keeping them parallel required maintaining two maps in sync — a flag with no corresponding trigger entry was an invisible bug waiting to happen. The merged structure makes each flag self-contained. The trigger is immutable after initialization (it describes the in-fiction condition that flips the flag, which doesn't change). `stateChanges.flagTriggers` on the `submit_gm_response` write path only carries the new value (`{ flagName: newValue }`) — it does not restate the trigger.

### Player resource pools are derived at character creation, not at synthesis

Player HP and stress pools (e.g. `vasquez_hp`, `vasquez_stress`) are written into `campaign_state.data.resourcePools` at the moment the character sheet is created — not later, and not re-derived by synthesis. The derivation is a pure function in `@uv/game-systems` (`deriveMothershipCharacterResourcePools`) that maps `{ currentHp, maxHp, stress }` from the sheet onto the canonical `{entity_id}_{pool_name}` naming convention. `CharacterService.create` calls `CampaignRepository.mergePlayerResourcePools` immediately after inserting the sheet; the merge is transactional and preserves any existing pools on key conflict.

An earlier approach deferred the derivation to the synthesis write path, on the theory that state-population should happen in one place. This coupled synthesis to character-sheet internals across systems and created an ordering hazard: if synthesis ever runs before character creation (e.g. pre-generated adventures, Collaborative mode), the player pools would never exist. Doing the write at character creation makes the invariant easy to state — "once a character sheet exists, its pools exist" — and means the synthesis path only writes NPC/threat/timer pools generated by Claude. `buildResourcePools` in the synthesis write path preserves any pool keys already present, so the two writers never race each other.

**Amendment 2026-08-10 — the closing sentence was wrong, and it is how the M7.5 capture acquired two prefixes for one character**

"`buildResourcePools` … preserves any pool keys already present, so the two writers never race each other" states a real mechanism and draws a false conclusion from it. Preservation settles a **collision** — the same key written twice. The failure that actually occurred is the opposite one: the two writers spell the player's id *differently*, collide with nothing, and both spellings persist. The captured adventure carries `lt_alvarez_hp` at 20/20, pristine, beside `alvarez_hp` at 7/20 with all the damage, plus an `alvarez_armor` that no derivation produces. The safety argument in this entry is precisely what let that through.

The cause was upstream of the merge, in the prompt. `formatMothershipCharacterProse` rendered `sheet.name` and never `sheet.entityId`, so synthesis was shown "Lt. Alvarez" and nothing else and had to invent an identifier to build pool names from — and that display name derives equally well to `lt_alvarez` or `alvarez`. Character creation had already written the canonical pair under the real id. Two writers, two spellings, no collision.

Three changes close it, and the split between them is deliberate:

- **The prompt now names the id.** `formatMothershipCharacterProse` emits `Entity ID:`, and a `PLAYER CHARACTER:` section states that the player's HP and stress pools already exist and must not appear in `initialState`. This is the actual fix; the two below exist because a prompt instruction is not an invariant.
- **The synthesis write path drops impersonating keys and logs them.** A key naming a pool of a kind the player already owns, under a prefix resolving to neither the player's id nor an entity the payload declares, is dropped. It is redundant by construction, so dropping loses nothing — but it is logged, because a drop means the model re-spelled the id after being handed it, which is worth seeing before a playtest rather than after.
- **The play-time validator rejects rather than drops.** `applyResourcePool`'s bootstrap branch applies the same rule and pushes a rejection naming the valid id, so the model corrects inside the tool loop. Rejection is right here and wrong at synthesis: mid-turn there is a loop to correct in, and failing an expensive synthesis over a naming quirk is not.

**The rule is suffix-collision, not prefix-must-resolve.** A stricter "every pool prefix must name a declared entity" would reject `station_power_reserve` and `contamination_spread_timer` — legitimate scenario-level pools that attach to no entity and never will. Only a pool that duplicates a kind the player already owns is refused, which is exactly the observed defect and nothing else. The check is disabled entirely when no player ids are declared, mirroring `roll_dice`'s empty-known-set behaviour under `§ actingEntityId must resolve against a declared identifier set` — a campaign with no character sheet must not have every pool bootstrap rejected.

The entry's main claim is unaffected: derivation still happens at character creation, and synthesis still does not re-derive.

**Addendum — the derivation is one-way, so sheet edits never reach the pools**

`mergePlayerResourcePools` preserves existing keys on conflict, which the amendment above
discusses as a collision property. It has a second consequence that entry doesn't draw
out: **it cannot overwrite, so re-running the derivation against changed sheet data is a
no-op whenever the pools already exist — which is always, after creation.** Editing a
sheet to raise `maxHp` updates the sheet and leaves `{entityId}_hp.max` at its old value.
The only case where the re-run does anything is a changed `entityId`, where it mints a
second orphaned pair — the same defect shape the amendment above records, reached by a
different route (`milestones/m7.6-code-inventory.md`, `e1cdaac`).

**Consequence for M7.6:** any migration that changes ceilings on the sheet has to write
the pools too. Sheet-only migrations silently do nothing to live state.

**Two adjacent findings from the same inventory, recorded here because they share the
cause — nothing reconciles sheet and pools after creation:**

- `CharacterService.delete` removes the sheet row and leaves the derived pools in
  `campaign_state.data.resourcePools`. They persist and keep rendering in the snapshot.
- With no sheet, `getPlayerEntityIds` returns `[]`, and per `session.service.ts:908-912`
  an empty set disables `actingEntityId` validation entirely. So deleting a character
  silently switches off a structural guard that M7.5 landed
  (`§ actingEntityId must resolve against a declared identifier set, and an unresolvable
  id is undecided`).
- The `assertNoActiveAdventure` guard on update and delete blocks only `synthesizing`,
  `ready`, and `in_progress` — sheets are editable once an adventure is `completed`,
  `aborted`, or `failed`.

### Synthesis prompts are system-specific; no driver registry yet

Each supported game system owns its own synthesis prompt module under `apps/zoltar-be/src/synthesis/<system>/synthesis.prompts.ts` (currently only `mothership/`). System-specific exports — system prompt, character-sheet prose formatter, synthesis user prompt, coherence check prompt, and the canonical oracle-category list — are all prefixed with the system name (`MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT`, `formatMothershipCharacterProse`, etc.) so names never falsely suggest cross-system generality. Universals — the `submit_gm_context` and `report_coherence` tool definitions and the coherence report Zod schema — live in `src/synthesis/synthesis.tools.ts` and `synthesis.schema.ts` and are imported by every system module.

A generic prompt module was rejected because oracle category counts, character sheet structure, and tonal framing all differ across systems; a single parameterized builder would either be the least common denominator or a tangle of per-system branches. A `synthesisDrivers[systemId]` registry was also considered and deferred: until a second system exists, any interface we define is a guess shaped entirely by Mothership's needs, and the second system is more likely to reveal the right abstraction than to conform to a premature one. When UVG (or the next system) lands, the registry pattern can be introduced at that moment with two concrete implementations to compare against.

---

## Claude Integration — Turn Loop & Correction

### Correction loop bounded at one re-prompt

When Claude's proposed state changes fail validation, the backend re-prompts once with a structured `tool_result` describing the rejections and waits for a corrected `submit_gm_response`. If that second response also fails validation, the turn aborts with 502 and the entire turn transaction rolls back — leaving only the player-message row that was persisted before the Claude call. Not two retries, not a budget — a hard cap at one re-prompt.

The cost of a correction round is one extra Claude API call on a path that should be rare in practice; compounding two rounds doubles that cost and masks the real problem, which is either a bug in the validator rules or a model that needs prompt work. Playtest evidence should drive validator tuning and prompt revision, not a larger retry budget. If the cap proves too aggressive, loosen it only after identifying a specific class of rejection that a second retry would have fixed without just papering over a validator-or-prompt bug.

### The correction loop does not re-enter the inner tool loop

M7 introduces an inner tool-use loop in `SessionService.sendMessage`: Claude may call `roll_dice` and `rules_lookup` any number of times before issuing `submit_gm_response`. When the M6 validator subsequently rejects the proposed `stateChanges`, the correction pass re-prompts Claude with `tool_choice: { type: 'tool', name: 'submit_gm_response' }` — explicitly narrowing away from `{ type: 'any' }` — so the correction cannot invoke additional tools. The rejection is handed to Claude as a `tool_result { is_error: true }` and Claude must resubmit directly.

Rationale: dice and rules retrieval are inputs to Claude's reasoning. By the time `submit_gm_response` arrives, those tools have already done their work against the live fiction. If the proposed state changes are invalid, the fix is narrative (restate the same fiction with a valid delta), not mechanical (re-roll). Letting the correction path re-invoke `roll_dice` would also make dice-outcome manipulation possible ("that wasn't the result I wanted, reroll until validation passes") — a principle violation that's easy to avoid by construction.

Implementation: `buildCorrectionRequest` in `session.correction.ts` hardcodes `toolChoice: { type: 'tool', name: 'submit_gm_response' }` in its return, overriding whatever was on the original request. The unit test `session.correction.spec.ts` asserts this override explicitly.

### `rules_lookup` calls are captured in `adventure_telemetry.payload.rulesLookups`, not in `game_events`

Every `roll_dice` call writes a `dice_roll` row to `game_events` — dice are mechanically consequential, part of the turn's audit trail, and rolls (like player actions and GM responses) carry sequence numbers so the full turn can be replayed from the event log.

`rules_lookup` calls are different in kind. They are metadata about how Claude arrived at a ruling, not state changes. The player is not entitled to see every query the Warden made; the tool is a reasoning aid. Recording lookups in `game_events` would (a) pollute the player-visible event stream with Warden internals, (b) require inventing a "lookup" actor_type / payload shape for data that never affects state, and (c) couple the lookup-telemetry schema to the game_events sequence-number contract for no operational benefit.

Instead, `rulesLookups: RulesLookupRecord[]` lives in `adventure_telemetry.payload` alongside the turn's prompt snapshot, Claude request/response metadata, and validator output. Playtest review tooling (M7.1) reads from that row and can surface lookups — including empty-result ones, which are the primary signal for M7.2 ingestion prioritization — without touching the event log.

The record carries `query`, `limit`, `resultCount`, `topSimilarity`, and `sources` (citation strings). Full chunk text is deliberately omitted: re-running the query at review time reproduces the chunks deterministically until the index is re-ingested, and storing them inline would bloat the telemetry JSONB without marginal benefit. If Phase 2 review surfaces a need for full-text capture, a `texts: string[]` field can be added.

### Agentic graph decomposition stays deferred; dice-arbitration evidence weakens the case without closing it

The standing deferral on a LangGraph-style decomposition of the turn loop carried a falsifiable criterion: harness results should first show which failure categories resist prompt-level fixes. Dice arbitration reliability was the lead candidate for a category that would, on the theory that reliable sequencing of request → resolution → narration is a control-flow problem a single prompt can't be made to solve.

The 4.6 → Sonnet 5 baseline is evidence against that theory for at least half the category. Under corrected applicability gating, `SYSTEM-ROLLED-PLAYER-ACTION` moved from 3/17 (0.18) to 18/20 (0.90) — with an unchanged prompt (`97feadbd`), unchanged fixture content, and no orchestration work of any kind. A category that responds that strongly to a model swap is not a category that resists non-structural fixes, and rebuilding the turn loop to solve something a model upgrade largely solved would have been the expensive answer to the wrong question.

Three reasons this doesn't close the question:

- **The residual is not cosmetic.** 2/20 means the Warden takes a player's declared action out of their hands roughly one combat turn in ten. In solo play, where the player has no table to appeal to, that's an agency violation rather than a polish item. "Mostly fixed" is a weaker result here than the rate suggests.
- **The measurement predates M7.2.** Both runs executed against an empty `rules_chunk` index, and the runaway-lookup errors show a Warden repeatedly unable to resolve what it was looking for. Rules availability plausibly affects when and how it reaches for dice. Re-measure after M7.5's re-baseline — not M7.2's, which no longer exists — before treating 0.90 as the model's actual ceiling.
- **The sequencing half is measured, and agrees.** `OUT-OF-ORDER-RESOLUTION` reads 0.39 (7/18)
  on 4.6 and 1.00 (20/20) on Sonnet 5 under the structural deferred-gate rule. Both
  dice-arbitration categories therefore respond to a model swap alone. The caveat is that only
  the deferred-gate half is measurable: the in-turn case reports `not_applicable` pending
  `gatedByRollId`. Sonnet 5 defers on every rep, so nothing is currently being missed for the
  model we'd be building against — but that is a property of this model's behaviour, not a
  guarantee, and it will need re-checking whenever roll behaviour moves.

Revised criterion for revisiting: re-baseline after M7.5 (the re-baseline moved there from M7.2), and try the cheaper structural option first — the deferred `rollType` / `gatedByRollId` / `actingEntityId` fields on `roll_dice`, which enforce sequencing at the tool schema without decomposing the loop. A graph becomes the right answer only if a measured residual survives both.

**Both conditions of that criterion have now been met, and the answer is: still no graph, but the case has stopped weakening.** (2026-08-09, `docs/rules-extraction-findings.md § S31`.)

The criterion was explicit that 0.90 should not be treated as a ceiling until re-measured against a populated index. Re-measured, `SYSTEM-ROLLED-PLAYER-ACTION` reads **0.45 (9/20)** — half what the deferral rested on. The second condition also fired: the structural fields landed in M7.5, and they did *not* fix this. `gatedByRollId` closed the in-turn sequencing case as designed, and `OUT-OF-ORDER-RESOLUTION` holds at 0.94; but no tool-schema field can express "this roll belongs to the player," because the tool being called is `roll_dice` and the correct behaviour is *not calling it*. A schema constrains the shape of an action taken, not the choice to take it.

So the residual survived both cheaper options, which is exactly the trigger this entry set. It still does not justify a graph, for a reason the criterion did not anticipate:

**The failure is not a control-flow failure.** The evidence for that is `UNSURFACED-CHECK` moving 0.70 → 1.00 in the same run. The Warden is not losing track of sequencing or forgetting to route a request; it correctly identifies that a check is warranted and then resolves it in the wrong place. Decomposing the turn loop into graph nodes would give that misjudgement a more elaborate structure to happen inside.

**The ownership rule is not missing from the prompt, and an earlier draft of this entry was wrong to say so.** `mothership-m7.txt:41` reads "WHEN TO CALL diceRequests — Any roll the player's character makes to resolve their own action," and `:22` gives the mirror rule for `roll_dice`. Both predate M7.5. The Warden is violating an explicit instruction on 9 of 10 reps, and every failing rep resolves the *whole* combat exchange server-side — the player's Combat check, the player's damage, then the NPC's return fire — emitting no `diceRequests` at all.

So the live hypothesis is prompt *structure*, not prompt *content*: M7.5 appended ~50 lines of mechanical primer after the tool-routing rules, written throughout in resolution voice ("call for a FEAR Save", "roll under it"), which never restates who rolls. "Call for a Save" is precisely ambiguous between issuing a request and rolling one. That would make this a recency-and-specificity failure, in which case the fix is placement and voice rather than a new rule.

**Revised criterion, third iteration.** Test the placement hypothesis before anything structural, and re-measure `SYSTEM-ROLLED-PLAYER-ACTION` against `UNSURFACED-CHECK` **as a pair** — the two moved in opposite directions on one prompt change and must be read together, or a fix that trades one for the other will read as progress. A graph becomes the right answer only if the rule, stated unambiguously *and* positioned where it governs the primer, still fails to move the rate. That would be the first real evidence the model understands the rule and cannot act on it — a distinction nothing measured so far supports, and which the presence of the rule at `:41` makes the more urgent question rather than a settled one.

An earlier version of this criterion also called for extending the `turn19`/`turn21` fixtures through the follow-up turn, on the theory that a model which splits a to-hit request from its resolution puts the ordering evidence on a turn the fixture doesn't contain. **That is withdrawn.** The violation window is the captured turn: once a gate is deferred, the turn ends, so any dependent roll landing on the follow-up turn is necessarily *after* the gate resolved. Extending the fixtures would have produced a structurally guaranteed PASS and read as evidence of correct sequencing.

### `rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice` stay deferred, but they are measurement infrastructure

> **Status: closed 2026-08-07.** The fields landed in M7.5, on the schedule this entry set.
> The heading is kept in its original wording because several documents link to it by title;
> read it as the question, and the "Landed" section below as the answer.

These three fields were introduced in the M7.4 spec as a fixture-schema compatibility example and carried forward as a candidate structural fix for the Warden's own sequencing — tighten the tool schema so a dependent roll must name its gate, and out-of-order resolution becomes unrepresentable rather than merely detectable. That framing is incomplete. The checker audit established that the same two fields are what two structural checks need in order to *measure* anything at all:

- `gatedByRollId` — `out-of-order-resolution` can adjudicate the deferred-gate case from a pending `dice_request`, but the in-turn case is undecidable without it. Sequence numbers record what happened first, not what gated what.
- `actingEntityId` — `system-rolled-player-action` cannot attribute a Warden-side roll without it, because `actorType` is `'gm'` for every such roll whether it stands in for an NPC or the player, which is exactly the distinction the check draws. The current binding is a prose convention and is the last prose dependency in the structural checks.

So the fields are not only a possible fix; they are the precondition for knowing whether a fix is needed. Until they land, both checks report `not_applicable` naming the missing field rather than approximating it with a regex — the deliberate cost being denominator, per "Structural checks report undecided rather than guessing" below.

**Still deferred**, and the reason is unchanged: adding fields to `roll_dice` changes the tool schema, which changes what reaches the Warden, which invalidates every frozen artifact and forces a fresh baseline on both models. That is affordable once, not repeatedly, and the rules-ingestion work is already going to force one — both existing baselines ran against an empty `rules_chunk` index. Re-check after M7.5, and land the fields with that re-baseline rather than paying for a second one. (The re-baseline moved from M7.2 to M7.5; M7.2 populated the index but deliberately bought no Warden-level measurement.)

**Landed 2026-08-07, in M7.5, exactly as this entry planned.** Schema and prompt together, ahead of the re-baseline, so the fields ride the one baseline the populated index was already forcing rather than buying a second. `docs/tools.md § roll_dice` documents all three.

What they bought, on the two checks that were waiting:

- `gatedByRollId` — `out-of-order-resolution` now decides the in-turn case by comparing a named gate's sequence number against the roll naming it. See `§ out-of-order-resolution reads the deferred gate` above for the three sub-cases and for the deferred-gate residual this does *not* close.
- `actingEntityId` — `system-rolled-player-action` attributes without reading `purpose`. This was the last prose dependency in the structural checks; on post-M7.5 output there is none left. **The first integration of this field was defective and shipped a false pass — see the entry immediately below, which is a correction to this bullet, not a footnote on it.**
- `rollType` — **no measurement role, and none was invented for it.** The entry above claims all three were "the precondition for knowing whether a fix is needed"; that was true of the other two and never of this one. Checked during M7.5 planning: it appears in `docs/specs/zoltar/011-eval-harness-multi-run.md § Part 6` only as a *hypothetical example* of a field some future check might need, is absent from the M7.4 spec entirely, and the two bullets above give it no job. It ships as a descriptive enum (`check` / `save` / `damage` / `panic_check` / `table` / `other`) read by no checker — telemetry and a reporting axis. The justification is this entry's own economics rather than a requirement: the re-baseline was being bought anyway, and discovering a use for it later would have meant buying another.

The prose paths are kept rather than deleted, and every consumer branches on field **presence** rather than on `fixtureSchemaVersion` — `eval:rescore` re-grades frozen `88fa84bd8329` artifacts that predate the fields, and version-gating would have been the obvious mechanism and the wrong one, since the fixture version records what `capture-fixture` captured and it captures no game events at all. **No `FIXTURE_SCHEMA_VERSION` bump was needed**, and no migration: `dice_roll` payloads are `jsonb`.

**Provenance note.** During M7.2 implementation planning this conclusion was briefly reversed — a plan document recorded "resolved with Alex: the fields do not ride along, a third baseline gets paid for separately" — and instructed that this entry be rewritten to match. That rewrite never happened here. The reversal was itself reversed during M7.5 spec review: the fields land with M7.5's re-baseline, per the original reasoning above, which was correct throughout. Noted so the now-stale reasoning in that plan document isn't mistaken for a second, independent decision.

### `actingEntityId` must resolve against a declared identifier set, and an unresolvable id is undecided

M7.5's first integration of `actingEntityId` compared it against `applicability.playerEntity` for equality. The field carries an entity **id** (`lt_alvarez`); `playerEntity` carries a display **name** (`Alvarez`). Nothing ever matched, and because "no roll belongs to the player" is `system-rolled-player-action`'s PASS condition, the check did not report *less* — it inverted. It graded ten violations clean, including a rep whose payload reads `system_generated` / `lt_alvarez` / `"Alvarez Combat Check to shoot contractor alpha"`. Full account in `docs/rules-extraction-findings.md § S30`.

Three rules come out of it, and they generalise past this field.

**An identifier comparison must name both namespaces.** The bug was not a typo; it was comparing two things that had never been the same kind of thing, in a codebase whose own convention (`docs/decisions.md § Entity and resource pool identifiers use underscores only`) makes ids and display names visibly distinct. `rollActsFor` now takes an explicit `AttributionContext` carrying `playerEntityIds`, `knownEntityIds`, and the display name for the legacy prose path, so the comparison cannot be written without stating which set is being consulted.

**A resolution failure is a third state, not a negative answer.** `rollActsFor` returns `'player' | 'other' | 'unknown'`. An id matching neither the declared player set nor the fixture's seeded entities is `'unknown'` — `NOT_APPLICABLE`, excluded from the denominator, never a pass. This is the same discipline as "Structural checks report undecided rather than guessing" above, applied to structured data rather than prose: the shipped bug's mechanism was a resolution failure silently collapsing into `'other'`. It is load-bearing, not defensive — Sonnet 4.6 emitted resource *pool* names in this field 13 times across one run.

**The runtime enforces one canonical id; the checker tolerates aliases.** `roll_dice` rejects an `actingEntityId` naming no known entity, modelled on the existing dangling-`gatedByRollId` rejection, with the valid ids named so the model corrects in-loop — and **skipped entirely when the known set is empty**, because `getPlayerEntityIds` reads `character_sheet` and a campaign without one would otherwise have every player roll rejected. The checker deliberately resolves against *every* declared id, because it also grades frozen artifacts from runs predating the validation that legitimately used an alias. The asymmetry is intentional and mirrors the prose fallback for pre-M7.5 payloads.

**Root cause, and what is still open.** The Warden is never told the player's entity id: `campaign_state.entities` holds NPCs, threats and features only, `gmContextBlob.playerEntityIds` exists for exactly this but is fed from a `character_sheet` table with zero rows, and `renderEntities` only *un-hides* ids already in the entities map — it is a filter override, not a source. So the model infers an id from resource pool names, which in the captured adventure carry two prefixes for one character. Seeding fixtures closes this for the eval; **the product path is not closed**, and rendering player entities into `<entities>` from `playerEntityIds` remains the real fix.

**Why the tests did not catch it.** All 60 structural specs passed throughout, because they pair `actingEntityId: 'alvarez'` with `playerEntity: 'Alvarez'` — the one id form that collides with the display name under `toLowerCase()`. The specs were written from the same misunderstanding as the implementation and were therefore not independent evidence. Regression tests now use the real captured id forms, taken from run artifacts rather than authored alongside the code.

**Amendment 2026-08-10 — the product path is closed; `<entities>` is a source now**

"Rendering player entities into `<entities>` from `playerEntityIds` remains the real fix" is done. `renderEntities` emits every declared player id whether or not `campaign_state.data.entities` carries it — which in practice is all of them, since that map holds NPCs, threats and features only — tagged `player_character` and listed first, so the canonical spelling is the first thing the block states. An id absent from the map reports `status=unknown`, the same value `buildEntityMap` gives every synthesized entity and the honest one here: nothing recorded a status. Live HP stays in `<resource_pools>`.

This changes the state snapshot and therefore the Warden prompt, so it invalidates `c45a142a` as a comparison point and forces a re-baseline. Tracked in `docs/eval-methodology.md § Current baseline N`.

**Two things the original paragraph got wrong, worth separating from what it got right.**

The diagnosis was right: the model had no id to read and inferred one from pool names. But the paragraph attributes the ambiguity it inferred *from* to a `character_sheet` table with zero rows, and that is the eval's condition, not the defect's cause. The duplicate prefixes were minted at synthesis time by a prompt that showed the model a display name and no `entityId` — they would have appeared in a campaign with a perfectly good sheet, because character creation writes `{entityId}_hp` while synthesis independently invents its own prefix. Zero rows explains why `playerEntityIds` was empty; it does not explain why the pools disagreed. That half is closed separately under `§ Player resource pools are derived at character creation, not at synthesis`, and the two fixes are independent: this one stops the Warden inferring an id, that one stops the state offering two to infer from.

The claim that seeding fixtures "closes this for the eval" also understates what the harness already does. `seedScratchAdventure` seeds exactly one `character_sheet` row from the *first* declared id, and `SessionService` overwrites the seeded blob's `playerEntityIds` with the repository's answer — so a fixture declaring `['lt_alvarez', 'alvarez']` has always resolved to one id at run time. The two-id declaration is read only by the checker, deliberately, per "the checker tolerates aliases" above. Fixtures therefore need no cleanup for this change to be safe; what they still carry is the duplicate *pools*, which is a separate open question about seeded state.

---

## Claude Integration — Continuity & Spatial

### Phase 1 spatial consistency is prose-based, not structured

The `grid_cell` and `grid_entity` tables exist and are migrated, but no generation pipeline populates them and no runtime system queries them. Phase 1 spatial consistency — making sure the ship layout stays coherent across turns — is handled by `worldFacts` entries authored by Claude during synthesis and maintained during play. The Warden prompt directs Claude to record the location's overall layout in `worldFacts` at synthesis time and to consult and extend those entries when narrating spatial relationships.

This matches how Mothership is designed to play: theater-of-the-mind, where the fiction is the map. It also matches the mechanism already validated in Playtest 3 for the same class of problem (corridor lengths, named spatial attributes) — the existing scratchpad generalizes cleanly to "overall layout" as one more first-mention detail that must stay consistent.

A structured map model — generated room graphs, cell grids, LOS computation — is a significant engineering investment with no playtest evidence that it's needed. Deferring it keeps M5 unblocked and avoids building against imagined rather than observed failure modes. The grid tables remain migrated but unused; they cost nothing to leave in place, and the `map_geometry` stub reservation still stands.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for spatial-consistency failures — contradictory room connections, forgotten deck assignments, layout drift across long sessions. If prose-based layout holds up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for a real spatial system, to be built with evidence rather than speculation. The M5 roadmap entry is updated accordingly: LOS computation service is removed, and the state snapshot builder's "no entity positions" note no longer points to a pending spec.

### Phase 1 continuity is carried by cached GM context and working-memory fields, not a rolling summary

The original M5 design included a rolling summary stored in `adventures.rolling_summary`, lazily generated at adventure resume to carry continuity across messages that age out of the rolling window. Dropped from M5 pending playtest evidence that the gap exists.

The cached GM context — which in Solo Blind mode accumulates auto-promoted canon as play progresses — plus `npcStates` and `worldFacts` in `campaign_state.data` already cover most of what the summary was specified to capture. The design doc's summarization guidance ("prioritize uncanonized improvised fiction, NPC behavior, lies told, relationships formed, specific physical details") maps almost entirely onto what the canon queue and the working-memory fields already preserve. The summary's unique contribution is narrow: narrative texture and sequence that didn't produce discrete canonizable facts, only relevant in adventures long enough that the message window can no longer hold the arc.

Shipping the summary now would add a second Claude call per resume, a new column for cutoff tracking, and a prompt that can't be tuned without evidence. Observing whether Phase 1 play actually suffers from narrative-continuity loss without the summary is a cheaper first step than engineering against a failure mode that may not occur.

The `adventure.rolling_summary` column from M1 remains in the schema and stays null through Phase 1. If the gap surfaces in playtest — contradictions about fiction that aged out of the window, forgotten relationships or lies, sequence errors across long adventures — the rolling summary can be added as its own milestone, likely alongside campaign canon promotion tooling in Phase 2 where the related "what persists across adventures" questions already need answering.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for narrative-continuity failures of the specific kind the summary was designed to prevent. If the cached GM context plus working-memory fields hold up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for the summary, to be built with evidence rather than speculation.

### The `<character_attributes>` snapshot block is specified but deferred until a data source exists

The M5 spec, the design doc's state-snapshot section, and the M5 roadmap bullet all reference a `<character_attributes>` block — persistent qualitative character state (armor mode, weapon loadout, active conditions) emitted in the per-turn snapshot. The M5 snapshot builder has no source to populate this block from: `MothershipCampaignState` carries no `characterAttributes` field, synthesis does not write one, and the Mothership character sheet shape (`equipment: string[]`, `saves.armor: number`) does not cleanly separate armor from loadout or carry conditions. The block is omitted in M5 per the spec's "omit an entire block if its source is empty or missing" rule.

This is not a question of whether the concept is right — it clearly is, and the design doc describes it correctly. The question is *what writes it*. Populating the block requires either a schema addition plus a synthesis write path, or a derivation from character-sheet data that would require extending the character-sheet shape to separate armor/loadout/conditions. Neither is load-bearing for M5's goal of closing the outer GM turn loop; all mechanically critical state lives in resource pools, entities, flags, and world facts.

The block becomes genuinely useful when the game engine starts reading armor/conditions mechanically — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor). Reactivate at the milestone that first needs the data. At that point the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now.

The three doc references stand unchanged — they describe the intended end state. The M5 snapshot builder simply does not render this block. When the data source lands, the builder is a two-line addition (one render function, one call site) following the same pattern as the other blocks.

**Amendment — the deferral scope was too broad; static build data was never blocked**

This entry conflated two different claims under one deferral: the qualitative `characterAttributes` block (armor mode, loadout, conditions), which genuinely lacks a data source, and character-sheet *build* data — stats, saves — which does not. `character_sheets.data` already carries `Strength`/`Speed`/`Intellect`/`Combat` and the saves as structured fields, populated at character creation (see `§ Player resource pools are derived at character creation, not at synthesis`), and rendering them into the snapshot requires no schema addition and no synthesis write path — only a render function and a call site, the same shape already anticipated above for the qualitative block.

"Reactivate at the milestone that first needs the data" was the intended trigger, and for this narrower slice it already fired: Phase 1 has no rule evaluator, so Claude adjudicates every stat check itself, and without these fields in the snapshot its only source for the check target is the player stating their own stat in the action text — the system asking the player for data the system already has. That gap has existed since M6/M7 started resolving checks, not from some future milestone.

Scheduled for M8.1. The qualitative block — armor mode, loadout, conditions — remains deferred exactly as described above; it is the part that actually needs new schema and a character-sheet shape extension to separate armor/loadout/conditions.

**Amendment — the deferral is over; both slices move to M7.6, and the blocker was never independent**

Superseding the two paragraphs above: the qualitative block is no longer deferred, and neither slice is scheduled for M8.1. Both now sit in **M7.6 — Character Sheet Fidelity**, ahead of the playtest.

The reasoning that closed the deferral is that its blocker was never a standalone problem. This entry describes the obstacle as a character-sheet shape that "does not cleanly separate armor from loadout or carry conditions" — and correcting that shape is exactly the goal of the character-creation rework already carried on the kanban board, which reworks the application-level sheet data structures and plausibly the table shape with them. So the "schema addition and character-sheet shape extension" this block has been waiting on since M5 is not a future batch to be scheduled against; it is work already committed to for independent reasons. Grouping them makes the block's dependency explicit instead of leaving it as an open-ended wait.

This also lets the entry's own closing instruction be followed literally. It asks that "the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now" — impossible under the M8.1 scheduling, whose charter is prompt-only and which would have forced the render and the schema into different milestones. M7.6 owns schema, so all three land together.

Two corrections to the amendment above, for the record. Its trigger analysis was right about the narrow slice and stopped short: **the qualitative block's trigger had also already fired.** "Reactivate at the milestone that first needs the data — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor)" names two milestones that have both shipped. The block was not waiting on a trigger; the trigger fired and nothing was watching. And the claim that the static slice needs "no schema addition" holds only against today's sheet — once the rework moves the stats/saves fields, that render reads whatever shape it settles, which is why M7.6 orders the rework first and the two renders after.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### Message ordering relies on `createdAt` only; no shared sequence key with `game_events`

The `messages` table has no `sequence_number` column, unlike `game_events`. Reconstruction and message-window ordering (`buildMessageWindow`) rely purely on `createdAt` timestamps. Player and GM messages for the same turn are not written in the same transaction — the player message commits first, in its own transaction, before the GM call runs (intentionally, so a retry can reproduce the player's action) — so there is no transactional guarantee of ordering either, only the practical guarantee that a player's message is always written before the GM's response to it.

This is adequate today and is not being changed. The current production shape — a single backend instance, self-hosted, solo async play with human-paced turns seconds-to-minutes apart — has essentially no exposure to ordering ambiguity: Postgres timestamp precision is far finer than the gap between any two real messages, and there is only one clock in play.

Two conditions would change that:

- **Multi-instance deployment** (Phase 3+ SaaS, per the stateless-scaling design), if `createdAt` values are ever assigned application-side (each Node process reading its own clock) rather than DB-side. Cross-instance clock skew becomes a live vector for inverted ordering only once there's more than one clock generating timestamps.
- **Synchronous multiplayer with tight timing** (Phase 2 — Ably, live typing preview, initiative-mode combat), where sub-second sequencing might actually matter for narrative correctness in a way solo async play never surfaces.

Deferred under uncertainty, consistent with the project's general bias against fixing failure modes that haven't been observed. Revisit — adding a per-adventure sequence key to `messages`, mirroring `game_events`' existing `(adventureId, sequenceNumber)` pattern — if or when multi-instance deployment or synchronous multiplayer work begins, rather than before.

---

## API & Data Model

### Narrative and dice-result submissions are separate endpoints, not a discriminated union under `POST /actions`

Earlier drafts of `docs/api.md` specified a single `POST /api/v1/campaigns/:id/adventures/:id/actions` endpoint with a discriminated-union request body: `{ type: 'narrative', content } | { type: 'diceResult', requestId, notation, results, source }`. The M7 implementation ships two separate endpoints instead: `POST /messages` for narrative turns and `POST /dice-results` for dice submissions. `docs/api.md` has been updated to match what actually ships; this entry records why.

The two operations turned out to diverge on every substantive axis — different Claude-invocation behaviour (narrative always calls, dice only when `autoAdvance` resolves the last pending request), different response shapes (turn payload vs. resolution metadata with an optional nested turn), different failure modes (`dice_pending` vs. `dice_request_conflict` / `dice_result_invalid`), different resource semantics (a GM turn vs. a resolution of a specific `dice_request`). A discriminated union would reconcile the request bodies but not the responses; the FE still branches on `type` to know what to render, so the union is ceremony rather than simplification.

Two endpoints with distinct error codes also self-document failure modes better than one endpoint with a union of error shapes. The controller already shares the turn-error translator (`translateTurnError`) and the `SendMessageResult → TurnPayload` serializer (`serializeTurn`) across both paths, so there is no duplication to amortize by merging the URLs.

The tradeoff accepted here: if M8 adds further player actions (caller transfer, advance initiative), those will live at their own nouns (`/caller`, `/initiative`, etc.) rather than being bundled under `/actions`. This is acceptable — the surface area stays small per endpoint, each gets its own test file and failure taxonomy, and the alternative (growing a union-typed action endpoint) would accumulate branch complexity inside one handler faster than it accumulates URL count. Revisit if the endpoint list becomes genuinely unwieldy (> 8–10 player-action endpoints) or if M8's caller/initiative work surfaces tight coupling that a unified endpoint would simplify.

### Campaign canon is separate from adventure canon

Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.

### One active adventure per campaign

Campaigns are limited to one adventure in a non-completed, non-failed state at a time. A new adventure cannot be created while another is `synthesizing`, `ready`, or `in progress`. This matches solo play conventions and simplifies the state model. Completed and failed adventures remain visible (toggled by default) but do not block new adventure creation.

**Addendum — one adventure per campaign, full stop, through `v0.1.0`**

The entry above permits a second adventure once the first is completed or failed:
"Completed and failed adventures remain visible (toggled by default) but do not block new
adventure creation." **That permission is withdrawn for `v0.1.0`.** A campaign may have
exactly one adventure, in any status.

**Why the original allowance does not survive contact with the rest of the roadmap.**
Creating a second adventure is permitted, and nothing behind it works:

- `campaign_canon` does not exist and synthesis does not read it — the roadmap places
  both in Phase 2 ("Campaign canon — second promotion step at adventure completion;
  `campaign_canon` table; synthesis reads campaign canon alongside oracle results for
  subsequent adventures"). Adventure 2 would be synthesized with no knowledge of
  adventure 1.
- `adventure.rolling_summary` stays null through Phase 1 by
  `§ Phase 1 continuity is carried by cached GM context and working-memory fields, not a
  rolling summary`, which defers it to Phase 2 for the same reason — "where the related
  'what persists across adventures' questions already need answering."
- Adventure-scoped state is not separated from campaign state, so adventure 2 inherits
  adventure 1's synthesized entities, pools, and flags. Overlapping entity ids across
  adventures collide silently in the flat pool map, and `buildResourcePools` preserves on
  conflict — the same failure shape as the `lt_alvarez` / `alvarez` incident.

So two recorded decisions point in opposite directions, and the combination actually
shipping — door open, nothing behind it — was chosen by neither. This addendum closes the
door rather than building the floor.

**The constraint is a data guarantee, not just a product limitation, and that is the
point.** With exactly one adventure per campaign in every self-hosted database at
`v0.1.0`, provenance is unambiguous *by construction*: every entity, pool, and flag in a
campaign belongs to its sole adventure. The Phase 2 migration into the separate adventure
state row is then mechanical. Without the constraint it would have to *infer* which
adventure each key came from, which for overlapping ids across two finished adventures is
not recoverable at all.

**Why not the cheaper intermediate.** Tagging entities and pools with an adventure id now
was considered and rejected: it ships self-hosters a format that is neither the current
shape nor the terminal one, and it obliges either a second migration or permanent support
for an interim shape. The single-adventure constraint achieves the same guarantee — no
ambiguity in shipped data — without shipping a transitional format at all. The
door-closing code is throwaway, and small.

**Scope of the closure.** It must block creation after `completed` and `failed`, not only
during an active adventure. The original entry explicitly allows the former, which is
what lets a campaign accumulate two adventures' worth of state today.

**What this costs.** Mothership's attrition model does not need `campaign_canon` —
character carry-forward alone ("Strength still 27, Maximum Wounds down to 2") is most of
what M7.6 is building toward, and this defers it. Accepted as a beta-stage limitation.
The counterweight is that character carry-forward across an adventure boundary is
currently broken in the ways listed above, so what is deferred is a feature that does not
work rather than one that does.

**Reversal condition.** Lift the constraint when the adventure state row exists,
`campaign_canon` feeds synthesis, and a dedicated boundary playtest has run — the last of
which must not be combined with a mechanical-coverage playtest, per the standing rule in
`docs/roadmap.md`.

### Adventure state gets its own row, not an adventure tag on campaign state

Given the placement rule above, adventure-scoped state has to be separable from
campaign-scoped state. Two shapes were available: tag each entity and pool entry in
`campaign_state.data` with the adventure it belongs to, or give adventures their own
state row with its own per-system Zod schema, mirroring `campaign_state`.

**Decided: a separate row.** Tagging makes the boundary a convention that every query and
the snapshot builder must remember to honour, and the two state defects this project has
actually hit were both exactly that failure. The `lt_alvarez` / `alvarez` incident was a
flat map plus a preserve-on-conflict merge, where the safety mechanism is what let the
duplicate through (`§ Player resource pools are derived at character creation, not at
synthesis`, amendment). The `<character_attributes>` block sat deferred for two
milestones past its own stated trigger because nothing structural was watching
(`§ The <character_attributes> snapshot block is specified but deferred until a data
source exists`, second amendment). A separate row makes scope structural rather than
remembered, gives the adventure lifecycle a natural place for cleanup, and bounds a blob
that is read on every turn and would otherwise grow without limit across a long campaign.

**What it costs, stated rather than glossed:** two Zod schemas per system instead of one,
two write paths, and a snapshot builder that merges two sources. That is real, and it is
the price of not relying on every future caller to remember a tag.

**Not implemented in Phase 1.** See the addendum to `§ One active adventure per campaign`
above — the single-adventure constraint is what makes deferring the implementation safe
rather than merely postponing it. This entry records the terminal shape now so that the
Phase 2 migration is written against a decided target rather than choosing one under
pressure.

### `adventure_telemetry` vs session export are distinct artifacts

These are two different things that were originally both called `adventure_log`. They serve different purposes and must not be conflated. `adventure_telemetry` is infrastructure-level diagnostic telemetry — one row per turn in a DB table, containing the full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, the state snapshot sent to Claude, and prompt/completion token counts. It exists to diagnose pipeline bugs and is not player-facing. The session export is the player-facing portable format — a single JSON file containing the message log (with turn numbers and timestamps), canon log, turn-level state deltas, final state snapshot, and GM context. It supports session restore and post-session analysis. It is produced on demand, not written per-turn to a DB table. Mixing these concerns into a single artifact would make `game_events` harder to query for its application-level purpose and would conflate player-facing data portability with internal diagnostic tooling.

---

## Frontend & Design System

### No utility framework — plain Svelte scoped styles

Tailwind and similar utility frameworks were considered and rejected. The atomic class approach makes HTML harder to read and works against a strong per-system visual identity. More importantly, genre-specific theming (horror for Mothership, high fantasy for OSE, etc.) requires styles that are closely coupled to a semantic token layer — a utility framework adds friction without meaningful benefit in that model. Component styles live in Svelte's scoped `<style>` blocks. No utility framework is a dependency.

### Two-tier CSS custom property token system

Theming is implemented via a two-tier CSS variable system. Primitive tokens (`--color-slate-950`, `--font-size-lg`) define the raw design vocabulary and never change between themes. Semantic tokens (`--color-surface`, `--color-text-primary`, `--color-accent`) map purpose to primitives and are what themes actually swap. Components reference semantic tokens only — never primitives directly. This ensures a theme swap is a single token layer substitution, not a component change.

### Theme switching via `data-theme` attribute

The active theme is applied by setting a `data-theme` attribute on the root element. Each theme is a CSS file defining the semantic token layer (e.g. `themes/mothership.css`, `themes/fantasy.css`). The primitive token definitions live in `themes/base.css` and are always loaded. This approach requires no JavaScript theming library and works naturally with Svelte's reactivity.

### Bits UI for headless accessibility primitives

No opinionated component library is used. Bits UI (the Svelte 5 headless primitive library, successor to Melt UI) is used for accessibility-critical interactive patterns — modals, dropdowns, tooltips, focus traps — where rolling bespoke implementations would be high-risk. All visual styling of Bits UI primitives is owned by the application. This gives accessibility correctness without importing a competing design language.

### Mobile-first design — layouts originate at mobile size

All UI layouts are designed at mobile size first and expanded for larger viewports. This applies from the pre-M3 design sprint forward and is a constraint on all subsequent frontend work. The M9 "layout pass" is a responsive polish pass, not the origin of mobile layout decisions. The play view in particular — message log, input field, character status, dice UI — is a constrained layout problem better solved small-to-large than large-to-small.

---

## Oracle Tables

### Oracle filtering data model includes count fields despite range UI being deferred

Each oracle category preference record stores `count_min` and `count_max` fields (defaulting to `1/1`) even though the range dial UI is not built in Phase 1. The activate/deactivate pool and the pick-count concept are cleanly separable — the pool model is identical regardless of how many entries are drawn. Adding the fields now avoids a schema migration when variable counts are introduced. The UI commitment is deferred until there is a concrete scenario requiring it (likely Phase 2).

### Oracle filtering UI: activate/deactivate only, no range controls in Phase 1

The oracle filtering UI exposes entry-level activation toggles, select all/deselect all per category, and a submission gate requiring at least one active entry per category. Range dial controls are out of scope for Phase 1. The data model supports variable counts from day one, but the UI will default to picking exactly one entry per category until range controls are designed and built. This keeps the MVP UI simple and avoids designing a UX pattern before there is a concrete use case to design against.

---

## Eval Harness

### `checkId` does not encode `checkMode`

A check's `id` (`out-of-order-resolution`, `hidden-info-leak`) is the failure-mode tag in lower-kebab, deliberately never including `structural`/`judged`. `UNSURFACED-CHECK` has already migrated modes once in this repo — its regex-based structural classifier missed a stakes-gating roll phrased as a question ("Does anything react to Alvarez moving...") rather than using a fixed keyword, so it moved to a judge call after a real-run false pass. `eval:compare` pairs history on `(fixtureId, checkId)`; if the id encoded mode, that migration would have silently un-paired every historical comparison for the check the moment it moved. `checkMode` stays its own column on the score row instead, so a check can migrate modes without breaking the very comparisons that would tell you whether the migration helped.

### One check per fixture today, but the row format is N-ready

`selectChecksForFixture` returns an array, and every downstream reader — score rows, rate computation, comparison — is built against "a fixture may have N checks." Today it always returns exactly one, because a judged check needs per-fixture `assertion.facts` (`perceptionBoundary`, `expectedScope`, …) that only exist for the fixture's own tag: running `HIDDEN-INFO-LEAK` against a `SCENE-JUMP` fixture has no boundary text to grade against, and would cost an API call per fixture-check pair to produce one that doesn't exist. The corpus is what's 1:1 today, not the format — giving a fixture a second check later is a registry change, not a schema migration.

### `warden-output.json` is the full serialized `TurnExecutionResult`, not just `submit_gm_response`

The spec describes the artifact as "full `submit_gm_response` payload." That's not enough on its own: `eval:judge-variance` re-runs judged checks against a frozen artifact with **no database at all** — the scratch campaign is torn down at the end of every fixture run by default — so the artifact has to carry everything a structural checker or the judge needs to re-evaluate the turn. The judge summarizes the whole tool-call sequence, not just the narration, so it needs `gameEvents`; structural checkers additionally need `telemetry`/`pendingCanon`/`diceRequests`/`campaignState`. `warden-output.json` is a strict superset of `submit_gm_response`'s payload — the serialized `TurnExecutionResult`, with the narration living inside its `gm_response` game event. Anything narrower makes `eval:judge-variance` impossible without either re-seeding a scratch campaign per re-evaluation or keeping every scratch campaign alive forever, which would defeat the reason `--keep-scratch` defaults to off.

### `harnessVersion` is the git short SHA, not a hand-maintained constant

Recorded per rep and per row as `git rev-parse --short HEAD`, with a `-dirty` suffix when `apps/zoltar-be` has uncommitted changes, and `unknown` outside a git checkout. Same argument as `corpusVersion` being a content hash rather than a hand-bumped string: a manually maintained version fails silently when someone forgets to bump it, and the failure mode — two reps labeled identically under different checker semantics — poisons exactly the weeks-apart append the field exists to disambiguate.

### `error` is a fourth verdict, not folded into `fail`

M7.4's `runHarness` mapped any turn that didn't complete — a live model call producing output that failed schema validation, the inner tool loop exhausting its iteration cap, a checker rejecting a malformed fixture — to a **failed** `FixtureResult`, with a comment explaining that aborting the whole run over one flaky turn was worse than mislabeling it. That comment was right about the tradeoff and wrong about the fix: a transient failure and a real regression are different events, and conflating them under `fail` corrupts the one number (`pass / (pass + fail)`) the harness exists to produce. `error` is its own verdict — excluded from the denominator but counted and surfaced in `eval:report`'s Errors section, so it can never be silently absorbed into a regression-looking rate. Confirmed for real during the multi-run harness's own manual verification: the inner tool loop hit its 20-iteration cap on a busy off-screen-combat turn, and the resulting row correctly read as `error`, not as a phantom SCENE-JUMP failure.

### `eval:judge-variance` writes beside the run, not into `reps/`

`reps/*/scores.jsonl` rows mean "one observation of generator and grader together" — every pass-rate denominator in `eval:report`/`eval:compare` assumes that. A grader-only re-run against frozen input is a different measurement and would corrupt those denominators if appended there. Its output lives in `<run-dir>/judge-variance/<timestamp>.jsonl` instead — an extension beyond the spec, which doesn't say where this command's output goes.

### `eval:harness` retired, not kept alongside `eval:run`

The multi-run harness's whole premise is separating execution from rendering — `eval:run` writes score rows, `eval:report` reads them, and nothing downstream parses markdown. Leaving `eval:harness` in place would have kept a second write path producing no score rows, which is the thing this milestone existed to eliminate. `eval:replay` survives — repointed at the unified check registry — and gained an artifact-based mode (`--run-dir --rep`, no database), covering the quick single-fixture-iteration use `eval:harness` was also serving.

### Judge verdicts stay binary — no confidence scoring

`judgeVerdictSchema` is `{passed, rationale}` and always has been. A row schema drafted for this milestone listed `judgeConfidence?: number` as a field a rubric could conditionally emit, but no rubric does, because self-reported LLM confidence was rejected earlier in this project's design. That decision predates the multi-run harness and was never written down anywhere except the shape of `judgeVerdictSchema` — recorded here because the new score row was the first place a reviewer might reasonably ask "where's the confidence column," and the honest answer is that a permanently-empty optional field reads as an invitation to fill it, not as a decision. JSONL rows are append-friendly, so if a rubric ever does emit one, adding the field later is non-breaking — old rows simply lack it.

### `eval:compare`'s mixed-rubric warning groups by `checkId`, and `--filter-rubric` is scoped to one check

`detectHeterogeneity` originally counted distinct `rubricHash` values across an entire run and warned whenever there was more than one. Since `rubricHashFor(checkId)` hashes one rubric template per judged check, any run covering more than one judged check spans more than one hash by construction — the warning fired on every multi-check run, unconditionally, and named nothing useful. Worse, `--filter-rubric <hash>` filtered every judged row in both runs against a single hash, so following the printed remedy silently dropped every judged check except one.

The fix groups rubric hashes per `checkId` (not per `tag`, though the M7.4 spec's "one rubric per tag" language and the two are 1:1 in the current corpus) and warns only when one check's own rows span more than one hash — the real signal of a rubric template edited mid-run. `--filter-rubric` became `CHECK=HASH`, repeatable, so a filter aimed at one drifting check can never zero out an unrelated check's rows; the bare-hash form is now a usage error. A filter that would still zero a fixture's denominator is reported on stderr rather than rendered as an unremarkable empty row. `checkId` was chosen over `tag` as the grouping key because the actual data model — `manifest.completedReps[].rubricHashes: Record<checkId, rubricHash>` and `rubricHashFor(checkId)` — is keyed on check, not tag; if a tag ever gains a second check, `tag`-based grouping would coarsen incorrectly where `checkId`-based grouping stays precise.

### A warning's suggested remedy must produce a correct comparison, not merely a homogeneous one

Three separate warnings in this harness converged on the same defect, which is worth naming as a class rather than fixing three times. Each detected a real inconsistency between the two sides of a comparison, and each printed a remedy that resolved the inconsistency by **deleting** it — making the sides *look* consistent without making the comparison correct:

- **The mixed-rubric warning** printed `--filter-rubric <hash>`, which filtered every judged row in both runs against one hash. Following it on a run covering four judged checks silently dropped three of them. The warning was about one check's rubric drifting mid-run; the remedy discarded the other three checks' results, which were never in question.
- **The harness-version warning** flagged rows scored under different `harnessVersion`s and effectively suggested reverting to a common one — which, after a checker-migration cycle, means throwing away every migration and re-reading the numbers the migrations were performed to correct.
- **A proposed `--filter-harness`** would have done the same thing structurally: shrink both denominators to the intersection, quietly, which is precisely the failure the `App` column was added to make visible.

The rule: a warning may only suggest a remedy that leaves the resulting comparison *valid*. Where no such remedy exists, the honest output is the warning plus an explanation of what the reader must do by hand — re-score both sides under one grading, re-run one side, or read the two sides separately — not a flag that restores apparent homogeneity. Homogeneity is a property of the row set; correctness is a property of what the rows mean, and only the second is what the warning was defending.

A related fix belongs to the same principle. Carried-forward rows (`eval:rescore` preserves rows for reps that errored before producing an artifact) are heterogeneous by construction and must never be counted as rubric or harness drift. That filtering now happens **inside `detectHeterogeneity`**, not at its call site. Filtering at the call site is correct exactly as long as every caller remembers to do it, which makes the invariant a convention rather than a property; moving it inside means a new caller cannot reintroduce the false alarm by omission.

### Applicability is fixture-authored, keyed by `checkId`, never inferred from the turn's own output

`system-rolled-player-action` and `out-of-order-resolution` originally decided applicability by asking "did this turn produce a `dice_roll` event?" — a consequence of the model's own choice, not a property of the fixture's scenario. When the correct behaviour was declining to roll (deferring to a pending `dice_request` instead), the harness scored the turn as `not_applicable` rather than as a pass, silently shrinking the denominator to exactly the reps where the model happened to roll — selection on the outcome variable. Confirmed against a real Sonnet 5 run: 38 of 40 reps across the two checks read `not_applicable` for this reason, and the two reps that didn't were themselves a false pass — a system-rolled to-hit roll the old pattern-only rule didn't match.

The fix adds `applicability: Record<checkId, {applies, playerEntity?, situation}>` to `evalFixtureSchema` (`FIXTURE_SCHEMA_VERSION` 1 → 2), authored once at fixture-capture time rather than derived at eval-run time from `campaignState` or the presence of any event. Keyed by `checkId`, not nested under `assertion` or flat on the fixture, because `selectChecksForFixture` already models "a fixture may carry more than one check" — turn19/turn21 exist as separate fixture *files* per tag today, but the schema shouldn't assume that stays true. `playerEntity` on the `applies: true` branch also replaces `system-rolled-player-action`'s old `campaignState.resourcePools`-key-guessing heuristic for identifying "the player" — the fixture author already knows who the player is.

Checks that need this declare `requiresFixtureSchema: 2` (the field existed, unused, since M7.4 anticipated exactly this situation) so a fixture below that version reports `not_applicable` through `runCheck`'s existing gate rather than a checker guessing or crashing. `capture-fixture` writes a fail-closed placeholder (`applies: false`, TODO reason) for every newly captured fixture, matching the existing `playerInput`/`assertion` placeholder convention — an unedited stub can never silently read as "situation confirmed."

`out-of-order-resolution` is only half-migrated: situation gating is real, but the in-turn ordering case needs a `gatedByRollId` the payload does not record, so the check reports `not_applicable` with a reason naming the missing field rather than the old model-artifact phrasing. An earlier version of this paragraph proposed extending turn19/21 through the follow-up turn to recover that evidence; that proposal is withdrawn — see "`out-of-order-resolution` reads the deferred gate, and declines the in-turn case" below.

### A structural check may read event and state structure; it may not classify prose

Structural checkers began as regexes over `purpose` and `playerText` because the alternative
looked like an API call per rep for questions that seemed mechanically answerable. Every
structural check that has ever produced a verdict has since been found to misreport, in all
three possible directions: `system-rolled-player-action` returned false PASS on a
system-rolled to-hit its damage-only matcher didn't recognize; `unauditable-mapping`'s
`MAPPING_STATED_PATTERN` is content-blind enough that any `digit + (:|=|means|indicates)`
satisfies it, while `NARRATIVE_SELECTION_PATTERN` returned false NOT_APPLICABLE on twelve
turns of `"Ambient station event check"` — the model's own dominant phrasing for exactly the
roll type the check exists to grade; `narrating-past-a-block` returns false FAIL on
commitment language (`"you put two rounds into..."` before the roll is issued), which its
own doc comment already flags as the class the `\bif\b` guard was added to fix. Patching
does not converge: `NARRATIVE_SELECTION_PATTERN` and `narrating-past-a-block` have each been
widened once after a real-run miss and failed again the same way, and `UNSURFACED-CHECK`
gave up and migrated to a judge call after its own false pass. The 4.6 → Sonnet 5 swap
quantified why: `NARRATIVE_SELECTION_PATTERN` reached a verdict on 15 of 20 reps under 4.6
and 4 of 20 under Sonnet 5, against an unchanged prompt. A regex over prose encodes the idiom
of whichever model was current when it was written, and silently stops matching when that
changes.

The dividing line is what the checker reads, not how hard the question sounds. Event and
state structure — does a pending `dice_request` exist, in what sequence did events land,
what changed in `resourcePools`, does a roll resolve an antecedent request — are facts the
backend produced, identical in shape across models and across prompt revisions. Narrative
prose is where model idiom lives. So structural remains the default wherever the question
can be answered from structure, since it is deterministic, free, and carries no judge
variance; it is simply not available for questions whose answer lives in wording. A single
check may span both: `unauditable-mapping` keeps a structural pre-filter on the shape of a
spontaneous GM-side roll (single die, no modifier, no `target`, resolving no pending
request) and sends only the remaining semantic question — does `purpose` enumerate outcomes
covering the notation's range — to the judge.

The line has a third case, discovered by applying it. Some questions are neither semantic nor
answerable from current structure: they would be structural if the payload recorded a fact it
doesn't. Ordering two rolls requires knowing which depends on which — sequence numbers show
what happened first, not what gated what — and attributing a Warden-side roll to the player
requires `actingEntityId`, since `actorType` is `'gm'` for every such roll whether it stands
in for an NPC or the player. Those wait on the deferred `roll_dice` fields, and the honest
interim verdict is `not_applicable` naming the missing field, not a regex approximating it.
That reframes those fields: they are measurement infrastructure as much as a candidate fix
for the Warden's own sequencing.

**Closed in M7.5 — the third case had a shelf life, and this is what the end of it looks
like.** `gatedByRollId` and `actingEntityId` landed on `roll_dice` with the prompt
instructions to populate them, and both questions moved from the third case into the first:
`out-of-order-resolution` decides in-turn ordering by comparing a named gate's sequence
number against the roll that names it, and `system-rolled-player-action` attributes through
`actingEntityId` without reading `purpose` at all. **On output produced after M7.5 there is
no prose left in the structural checks.**

Two things about *how* it closed are worth more than the fact that it did. First, the
interim verdict was the right instrument and not merely an honest one — `not_applicable`
naming the missing field is what made the gap countable, and a regex approximation would
have made the same turns read as graded and left nothing pointing at the fix. Second, the
prose path is **kept, not deleted**, and every consumer branches on field *presence* rather
than on `fixtureSchemaVersion`. Frozen artifacts from the `88fa84bd8329` runs predate the
fields entirely, and `eval:rescore` has to keep grading them the way it always did or the
comparison history `eval:compare` pairs on is silently severed. Version-gating would have
been the obvious mechanism and the wrong one: the fixture version records what
`capture-fixture` captured, and it captures no game events at all.

The residual, stated so it is not assumed closed: `out-of-order-resolution`'s deferred-gate
branch still has its known false FAIL. `gatedByRollId` records which *roll* gated a roll;
that branch asks whether a roll was gated by a pending *request*, which is a different link
and still unrecorded.

The line has a second constraint, running the other way. A judged verdict is binary, so a
judge cannot say "nothing to grade" — asked about a detail the narration never introduced, it
answers "it didn't" and returns a pass, converting an honest zero denominator into a spurious
1.00. Applicability gating therefore stays structural even on judged checks. `judgeGate` is
the mechanism, and `missing-canon-capture` is the case where that constraint decided against
migrating at all.

But `judgeGate` is only available where the applicability question is *itself* structurally
answerable, which is narrower than it first reads. `narrating-past-a-block` is the
counter-case. Its pre-migration gate was prose-dependent in both directions —
`BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN` over `playerText` to decide the Warden had
acknowledged a block, `STAT_CHECK_PATTERN` over `purpose` to decide a roll was the blocked
one — so there was nothing structural to port, and `ungated` is the honest declaration rather
than a gap someone forgot to fill. The binary-verdict hazard is genuinely live for that check;
it is managed by watching exclusion counts and applicability, not by manufacturing a gate.
Gating anyway, on "was there a block at all," would have cost `turn16` 19 of its 20 reps
across the two frozen runs — deleting the corpus's clearest surviving failure to guard against
a spurious pass that was not occurring.

Applying the line as it currently stands: `system-rolled-player-action` stays structural, and
reports undecided rather than guessing when its prose binding fails. `out-of-order-resolution`
stays structural for the deferred-gate case and declines the in-turn case as schema-blocked —
it was *not* structure-only when this entry was first written; `CONDITIONAL_DAMAGE_PATTERN`
was prose classification and was the only clause firing under 4.6. `unauditable-mapping` and
`narrating-past-a-block` migrated to judged with structural gates. `missing-canon-capture`
stays structural; its zero denominator is a fixture defect, not a checker one. Migration is
cheap by construction: `checkId` deliberately does not encode `checkMode` (see above), so a
check changes mode without un-pairing its own comparison history.

**Addendum — the harness writes a `character_sheet` row the sheet schema would reject, and
that is load-bearing**

`harness-runner.ts:326-328` inserts `data: { entityId: canonicalPlayerEntityId }` — one of
nine required fields. It works because **no read path anywhere parses
`character_sheet.data`**; the sheet is validated on write only
(`milestones/m7.6-code-inventory.md`, `e1cdaac`). The partial row is deliberate: without
it `getPlayerEntityIds` returns `[]` and the run measures a code path production doesn't
take (reasoning at `harness-runner.ts:195-207`).

**Recorded because it constrains a milestone whose whole subject is sheet fidelity.**
Adding read-side validation of `character_sheet.data` — the natural instinct when
correcting a schema — breaks every eval run. M7.6 must either leave the read path
unvalidated or change the harness seed in the same milestone; discovering this during
implementation would surface as the harness failing for reasons unrelated to the change
under test.

### `eval:rescore` re-grades frozen artifacts; re-score rows are a distinct row kind

A scoring-only corpus bump or a checker change leaves every `warden-output.json` exactly as valid as it was, so re-grading in place is a real measurement rather than an approximation. `eval:rescore` does that with no Warden calls and no database. It landed alone, before any checker changed, so that it could be validated against numbers derived independently — it reproduces the hand-derived `applicability`-fix corrections in `eval-methodology.md` exactly, including the specific finding that two Sonnet 5 passes on `turn21` flip to `FAILED`.

Rows extend `scoreRowSchema` rather than forking it, so `computeRates` / `rollupByTag` / `summarizeExclusions` consume a re-score unchanged — regenerating a run's rates under new checkers is the whole point, and a second aggregation implementation would be a second thing to keep in step. The cost is that half the inherited columns change tense: `model`/`promptHash` still describe generation, while `corpusVersion`/`harnessVersion` are recomputed and describe scoring. A `rowKind` discriminator keeps the two readers from ever accepting each other's files; it is optional on the run side specifically so `eval:run`'s on-disk format stays byte-identical to every row already written, since the command exists to reproduce historical numbers and a gratuitous format change would be one more thing to rule out when a rate moves.

Rows that cannot be re-graded — the turn errored before producing an artifact — are carried forward rather than dropped, so a re-score file is a complete replacement for a run's rows. Dropping them would silently shrink the error accounting and make a re-scored report look cleaner than the run it describes.

### `applicabilitySource` is declared per check, and the third value is `'ungated'`

Every check declares where its `not_applicable` verdicts come from: `'fixture'` (fixture-authored applicability — the scenario decides, denominator fixed before the model runs), `'artifact'` (the turn's own output — the outcome-selection hazard that made 38 of 40 reps read `not_applicable` across two checks), or `'ungated'` (reaches pass or fail every rep). Required rather than optional, with a lookup that throws on an unlisted check, so adding one forces the question rather than defaulting to a guess at the thing the field records. It goes on the row rather than being looked up from the check id at read time, because a migration changes it and a row must keep describing the rules it was scored under.

`'judged-check'` was considered for the third value and rejected. It would put a `mode` value on an applicability axis, and the two coincide only while no check is hybrid — which ended immediately: `narrating-past-a-block` and `unauditable-mapping` are both `mode: 'judged'` with artifact-sourced structural gates, so six checks are judged but only four gate on nothing. A reader would infer the value meant "this check is judged" and be wrong about a third of them. `'none'` was the first choice and was also rejected: an absence-shaped value reads as "not declared yet," which is the exact ambiguity the required field exists to eliminate.

### A judged check may carry a structural pre-filter (`judgeGate`), and gated reps are excluded from judge-variance

`decisions.md` already held that a single check may span both modes. `judgeGate` is the mechanism: an optional function run before the judge call that either settles the rep structurally or returns `null` to mean "the remaining question is genuinely semantic." `mode` stays `'judged'` because that is what `runCheck` dispatches on and what the row records; a third mode value would have forced a fixture-schema change for no gain.

The non-obvious consequence is in `eval:judge-variance`. It selects candidates by `check.mode`, so a gated judged check contributes frozen inputs whose verdicts are deterministic — re-running one N times yields N identical answers, a guaranteed non-flip sitting in the denominator and pulling the measured flip rate toward zero. That is the one number the command exists to produce, and the one that must never be quietly optimistic. Gated inputs are therefore tracked via `judgeInvoked`, excluded from the flip-rate denominator, counted as `gatedInputs`, and named in the headline: a rubric validated on two inputs because a gate absorbed the other eighteen has not been validated.

`judgeContext` is the companion field. When a gate narrows *which* events the semantic question is about — as `unauditable-mapping`'s does — the judge has to be told which ones. The alternative is a rubric describing the structural filter in prose for the model to re-apply, which is a second implementation of the same rule, free to drift, in the one check being rebuilt precisely because prose descriptions of roll classification do not hold.

### Structural checks report undecided rather than guessing when a prose dependency fails

`isAttributedTo` — binding a roll to the acting entity by the Warden's leading-name convention — is the last prose dependency in the structural checks, and it is not removable: nothing in `game_events` records who acted, and `actorType` is `'gm'` for every Warden-side roll whether it represents an NPC or the player, which is exactly the distinction being drawn. It waits on an `actingEntityId` on the roll payload.

What was fixable is how it fails. A prose match failing to match is indistinguishable from the thing genuinely being absent, and the two carry opposite verdicts, so `system-rolled-player-action` treated "no roll named the player" as a pass. It now reports `not_applicable` when nothing binds *and* unattributable system-side rolls are present. Measured across both frozen runs this costs 2 of 40 reps — both on `turn21` under 4.6, where they were that fixture's only two passes against seven fails — and leaves Sonnet 5 untouched at 1.00/0.80, because a model that properly issues `dice_request`s hits the structural branch instead. Costing a denominator is the point: a rep whose verdict rests on a prose match having failed is not evidence, and counting it as one is how a rate reaches 1.00 without the behaviour improving.

The same audit found that binding a `dice_request` by prose was simply wrong. A request is player-facing by construction — `roll_dice` is documented for GM rolls, `diceRequests` for player-facing ones — so a pending request is a deferred player roll whatever its purpose text says. A manually-verified clean turn had been failing because it deferred correctly with a request that never named the player, which a request addressed *to* the player has no reason to do.

### `out-of-order-resolution` reads the deferred gate, and declines the in-turn case

> **Status: the in-turn half closed 2026-08-07**, when `gatedByRollId` landed in M7.5. Title
> kept for the links that point at it; the resolution is inline below. The deferred-gate
> branch's known false FAIL is *not* closed.

A *pending* `dice_request` is an unresolved gate as a matter of structure: the backend surfaces it and the turn ends waiting on it, so anything resolved on the player's behalf while it sat pending was resolved ahead of its gate. That replaces `CONDITIONAL_DAMAGE_PATTERN`, the second regex this checker had tried, which failed the way prose matchers here always do — it flagged *NPC* damage rolls that were never gated by the player's request, on 4 of `turn19`'s 10 reps, which is most of why that fixture read 0/9.

When the turn resolves its gating roll in-turn instead, the check reported `not_applicable` naming the missing `gatedByRollId`. Sequence numbers show what happened first, not what depended on what; a to-hit followed by damage is correct and the reverse is not, the same two events either way, separable only by a link the payload does not record. Adjudicating that by regex is what the check was doing and what it stopped doing.

**Resolved 2026-08-07 (M7.5).** `gatedByRollId` landed, and the in-turn branch now decides: a roll whose named gate carries a *higher* sequence number than the roll itself had its consequence resolved before the thing it was contingent on. Two sequence numbers and a reference, nothing inferred from wording. The wait was the right call — the field cost one milestone of `not_applicable`, where each of the two regexes that preceded it cost a wrong verdict nobody could see.

Three sub-cases, kept distinct because collapsing any two of them re-creates a false pass:

- **No roll declares a gate** — `not_applicable`, and a *different* `actualCode` from the pre-M7.5 "the field doesn't exist" case, so an exclusions table never aggregates "nothing depended on anything" together with "we couldn't tell".
- **A `gatedByRollId` resolves to no roll in the turn** — `not_applicable`, never a pass. The tool loop rejects dangling references before they can persist, so this should be unreachable; it is pinned by a test anyway, because "found no violation" is exactly how an unresolvable link would otherwise read.
- **Otherwise** — a real PASS or FAIL.

**Extending `turn19`/`turn21` through the follow-up turn does not recover the missing half, and the idea is withdrawn wherever this log proposed it.** The reasoning that produced it was that a model deferring a to-hit across a turn boundary puts the ordering evidence outside the captured turn. But the violation window *is* the captured turn: a deferred gate ends the turn, so any dependent roll on the follow-up turn is after the gate resolved by construction. A two-turn fixture would therefore pass structurally no matter what the Warden did, and the pass would look like evidence of correct sequencing. The in-turn case waits on the schema field; it does not wait on a longer fixture.

A known false FAIL is accepted and pinned by a `[known limitation]` test rather than patched: a player stress check triggered by NPC fire that already resolved is properly ordered but structurally identical to a pre-rolled damage roll — both GM-initiated, both without `requestId`, both after the gate in sequence. It costs 1 of 18 decided reps. **M7.5 did not close this one**, and it is worth being precise about why: `gatedByRollId` records which *roll* gated a roll, while this branch asks whether a roll was gated by a pending *request*. Different link, still unrecorded. The available discriminators are notation (1d10 vs 1d100) and purpose wording, and reaching for either would re-import the "works on the data in front of me" failure that produced the regex being removed. A false FAIL also names the offending roll in the report, so it is diagnosable; the alternative readings risk a false PASS, which is not.

### OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be

*Opened 2026-08-10 from `docs/rules-extraction-findings.md § S33`. Not yet decided.*

The entry above governs *structural* checks. Judged checks were never brought under it, and one rep of the `c45a142a` re-baseline shows the gap. `turn24-over-resolution` is declared `applicabilitySource: 'ungated'` — it has no `not_applicable` path at all — and the judge's own rationale reports that the tool calls do not contain the Delta-vs-UNIT-7 off-screen encounter the rubric asks about, calling the comparison *"a mismatched comparison"*. It then returned `fail`.

**This is `§ actingEntityId must resolve against a declared identifier set` inverted.** There, a structural check that could not resolve its subject collapsed into its PASS condition and graded ten violations clean. Here, a judged check that cannot find its subject collapses into FAIL. The shared root is the one that entry already names — *a check that cannot decide must report undecided* — and the fact that it inverts in the other direction on the judged side is not reassuring. A false FAIL is more diagnosable than a false PASS, but it still poisons a rate, and nothing currently stops it.

Three things to settle, and deliberately not settled here:

- **Whether `ungated` is ever right for a judged check whose rubric names a specific scene.** `over-resolution`, `scene-jump`, `hidden-info-leak` and `narrating-past-a-block` are all `ungated`. A rubric pinned to content the turn may not reach is gated in substance whether or not it says so.
- **Whether the judge should be able to return a third verdict.** `missing-canon-capture` stays structural precisely because "a judge cannot say nothing to grade" — see the entry below. That was a reason to avoid judging, not a finding that judges are incapable of it, and the two readings have never been separated.
- **Whether the prompt caused it.** `c45a142a` tells the Warden to narrate up to the point the dice are needed and stop. If turns now end earlier, an ungated rubric can be starved of its subject as a *side effect of correct behaviour*. If that is the mechanism, the fix is the gate and not the prompt — but one rep and one rationale do not establish it, and the check is cheap to run again before anyone acts on it.

Until it is settled, read `OVER-RESOLUTION` at 0.90 as possibly 1.00 with one undecided rep, and do not treat the -0.10 as a measured cost of the roll-ownership change.

### `missing-canon-capture` stays structural, because a judge cannot say "nothing to grade"

Reviewed on the same grounds as the others — its marker-phrase gate is a prose dependency, and it had produced zero verdicts across 20 reps — and it is the one case where the conclusion runs the other way.

The verdicts are correct. All 20 reps report `not_applicable` because the narration genuinely never introduces the detail `turn02` asks about: normalising case, whitespace and dash shape finds it in 0 of 20, and a loose search for "veridian internal" alone finds 0 of 20. The near-miss hits are about a different subject entirely.

Migrating it would have made things worse. A judge asked "did the narration introduce the detail, and if so was it captured" would answer "it didn't" on all 20 reps, and — the verdict being binary — return 20 passes. An honest zero denominator would become a spurious 1.00. `not_applicable` is the right verdict and only the structural path can express it.

The real defect is in the fixture, which asks about a detail neither model reproduces and therefore grades nothing. Recapturing it, or authoring the expectation as something other than a literal phrase, is fixture work tracked separately. What the review did change: the marker now matches across dash shape and case, and `pending_canon` is attributed to the *winning* response rather than the first `gm_response`, a latent bug that would have read canon captured by a correction as a failure to capture.

### A rate that never moves is a harness suspect, not a finding

`eval-methodology.md` listed six fixtures as "confidently zero — n large enough that the result isn't just small-sample noise." Four were measuring the harness. `turn16-narrating-past-a-block` read 0/10 under both models because the check failed every rep on a `dice_request` the *fixture* seeded with `target: null`, a value fixed at capture time before the Warden under test ever ran.

The framing is what made it hard to see: the statistical confidence was entirely real and completely beside the point, because a large n does not make a checker correct. The practical rule is the same one already recorded for large rate jumps after a model swap, extended to its mirror image — a fixture sitting at exactly 0.0 or 1.0 across every rep more likely indicates a checker that cannot move than a model that never varies, and should be treated as a harness suspect before being recorded as a finding.

**This entry was written from `turn16`, so it reads as being about zeros. It is not.** A rate pinned at 1.00 is exactly as suspect and *materially less likely to be investigated*, because nobody audits good news. The asymmetry is worse than indifference: a pinned zero at least announces itself as a problem worth opening, and it tends to present with a shrunken or lopsided denominator that draws a second look. A pinned 1.00 presents with full applicability, a healthy denominator, and an `App` column reading `1.00` — the healthiest-looking row in the report. Every diagnostic built so far watches for denominators collapsing; none of them can see a verdict that cannot be reached. `turn21-narrating-past-a-block` (1.00 on both models) and `turn{19,21}-out-of-order-resolution` under Sonnet 5 (1.00, 20/20) are the current instances, and the reason each is currently believed is hand-review, not tooling. `docs/plans/900-fixture-check-reachability-design.md` is the design for closing that gap and is deferred, so for now the ceiling half of this rule is enforced by remembering it.

**Addendum — the ceiling half stops being enforced by memory, and the instance list should
never have been a list** (2026-08-11).

The paragraph above closes with "for now the ceiling half of this rule is enforced by
remembering it." That is no longer the plan, in two steps of increasing directness. A **Haiku 4.5
control arm** rides M7.6's re-baseline, scoped by `--fixtures` to the pinned checks: a weaker
model failing them is evidence they can reach a `fail` verdict at all (§ Warden model upgraded to
`claude-sonnet-5`, addendum). **M7.8 — Harness Meta-Eval** then asserts the same property
directly, with hand-authored fixtures engineered to fail a specific check and the assertion being
that the harness agrees — both directions, repeatable, and no Warden run. The arm is the interim
instrument and the fixtures are the actual one; both are scheduled rather than remembered, which
is the change this addendum records.

**Both are indirect in the way this entry is, and they retire the same way.** The heuristic, the
control arm, and hand-review are three probes standing in for not being able to read a checker
with confidence. Where a known-answer pair exists, all three are redundant for that check. Where
one doesn't — every check M8's caller and initiative work introduces, to start — all three still
apply. So the retirement is per check as coverage arrives, not a single date, and the heuristic's
surviving job is detecting checks nobody thought to pair, which is a narrower and more permanent
role than the one it has now.

**The instance list is already stale, and enumeration was the wrong shape for it.**
`turn28-hidden-info-leak` reads 1.00 (10/10) in the July table and its tag holds 1.00 (20/20) on
the M7.5 re-baseline; it belongs beside `turn21-narrating-past-a-block` and
`turn{19,21}-out-of-order-resolution` and is missing. A hand-maintained list of pinned rows decays
on every run by construction — the rows that qualify change whenever a rate moves, and this
document is edited per milestone. The list should be computed: `eval:report` already has every
per-fixture rate and denominator in hand, and flagging rows at exactly 0.0 or 1.0 with a full
denominator is a few lines. That is **not** the reachability analysis this entry says the tooling
can't do — it surfaces candidates, it does not prove a verdict unreachable — but it converts the
ceiling half from a thing to remember into a thing the report says, which is most of the value at
almost none of the cost.

**One thing deliberately not settled: how M7.8 relates to
`docs/plans/900-fixture-check-reachability-design.md`.** Both target this gap from opposite
directions — 900 analytically, by asking whether a check *can* emit a fail against a given fixture;
M7.8 empirically, by constructing an input that should make it. They may be complements, or M7.8
may make 900 unnecessary for less effort. That question should be answered by re-reading 900
against M7.8's scope before either is built, not assumed in either direction here.

### Applicability is reported alongside every rate, and errors are not in its denominator

`eval-methodology.md` already argued that a rate moving because its denominator moved looks identical to a rate moving because behaviour moved, and that reporting applicability is the only thing that separates them. The reports now do: `App` on the per-fixture and per-tag tables, `App A`/`App B`/`ΔApp` on every compare row, and an `Applicability shifts` section peer to Regressions/Improvements.

Applicability is `N / (N + NA)` — **errors are excluded from the denominator entirely.** A rep that errored never reached the point of determining whether the check applied, so counting it as "didn't apply" reports a lower applicability than the check earned and folds two different unknowns into one number. `turn14-unauditable-mapping` is the case that forced it: 7 `not_applicable`, 3 errors, `N` 0. It reads `0.00 (0/7)` with the 3 errors accounted for separately, not `0/10`. The exclusion is also what makes the fixture-gated diagnostic below sound — an errored rep can't break unanimity.

**The same applicability number carries opposite readings depending on `applicabilitySource`, so the reports render the source next to it.** For a `'fixture'`-gated check the scenario decides before the model runs, so every rep must agree: `0.00` and `1.00` are the only honest values, and anything strictly between is a harness defect — the checker is misclassifying or the fixture was mis-authored. For an `'artifact'`-gated check the same partial number is a real behavioural measure carrying the outcome-selection hazard. A `'ungated'` check reporting any `not_applicable` at all is a defect by definition: a gate fired where the registry says none exists. Reports classify each entry on those rules and separate **harness defects** from **how to read these numbers**, because the failure being prevented is a bug getting written up as a finding.

The compare report distinguishes a source *mismatch* (both sides declared, and they differ — a checker migrated between the runs) from an *indeterminate* source (either side is `'unknown'` or `'mixed'`). Only the first is a migration. `'unknown'` is the ordinary state of rows predating the field, including every row `eval:rescore` carries forward, and reporting it per check as a migration buries the real ones — the first run of this on the two frozen runs produced six such false alarms. Indeterminate pairs get one aggregated warning instead.

### `eval:report` and `eval:compare` name which grading they rendered, and share one default

Once `eval:rescore` exists a run directory holds several sets of verdicts over the same generator output: the run's own `reps/<nnn>/scores.jsonl` plus one file per re-score pass. "The report for this run" stopped being a well-defined request, and the failure mode is not a crash — it is two people quoting numbers graded by different checker code at each other.

`--scoring run | rescore | rescore=<timestamp>` selects. With no flag the most recent re-score wins, falling back to the run's own scores when there is none: a re-score exists precisely because the run's grades are known stale. That default is only defensible because it is never silent — the resolved grading appears in the report title, in a `- Scoring:` header bullet naming the exact file, and on stderr.

The flag lives on **both** commands, resolved by one shared `resolveScoring`. A default that changed `eval:report` while `eval:compare` kept reading `reps/` would have manufactured the exact cross-grader comparison the flag exists to prevent. `eval:compare` additionally warns when its two sides end up on different gradings — different kinds, or two re-scores under different harness versions — since one `--scoring auto` can still land differently on two runs.

---

## Monorepo, Tooling & Deployment

### Repo named `unicorn`, not `unicorn-vtt`

The monorepo houses Zoltar and Unicorn VTT. Zoltar is not a VTT — `unicorn-vtt` misrepresents the contents. `unicorn` names the product family correctly.

### npm workspaces over Turborepo

Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.

### Traefik routes defined in file provider, not Docker labels

Traefik routes for `app.zoltar.local` and `api.zoltar.local` are defined as file-based dynamic config (`infra/traefik/dynamic/host-routes.yml`) rather than as Docker labels on the `backend` and `frontend` compose services. Docker labels only exist on running containers — in Workflow B (the daily development loop), those containers aren't running, so label-based routes produce a 404. File-based routes pointing to `host.docker.internal` work in both workflows: in Workflow B the apps run directly on the host, and in Workflow A Docker publishes container ports to the host. One routing mechanism covers both cases.

### Single `main` branch

No `main`/`develop` split. The value of a develop branch is protecting a stable branch from in-progress work when there are multiple contributors or a CI/CD pipeline deploying from `main`. Neither applies for solo development at this stage. Tagged releases provide the stable reference point. Revisit when there are collaborators or a deployment pipeline that warrants it.

---

## Licensing & Business Strategy

### License: Elastic License 2.0

Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

### Open-source release proceeds as designed; no closed-source carve-out for prompts or graph orchestration

Considered and rejected: closing the Warden prompts, and/or any future LangGraph-style orchestration logic, as a competitive moat against a funded competitor forking the public repo.

Rejected on threat-model grounds, not technical ones. The TTRPG tooling space doesn't attract funded competition at this scale — campaign/worldbuilding tools have ~3 players with no direct head-to-head competition (e.g. Dungeon Scrawl), VTTs consolidate rather than multiply despite looking easy to enter, and the hobby's active resistance to AI shrinks the addressable market in a way that makes it a poor target for outside funding in the first place. A funded competitor materializing at all is judged unlikely.

Even granting a funded competitor with 3 FTEs, estimated time-to-market with full repo access (architecture, schemas, tool definitions, oracle table structure, and prompts) is ~4-7 months to reach current parity, versus ~7-11 months reverse-engineering from the live app alone — a gap of roughly 2-4 months. That gap is smaller than a plausible solo-dev hiatus and is mostly attributable to the architecture/schema decisions in this log, not the prompt text specifically — so a prompt-only closure wouldn't meaningfully close it anyway, and closing the architecture layer instead would break the self-hosted config-only story (`AUTH_PROVIDER`, `REALTIME_PROVIDER`, etc.) that depends on that layer staying legible.

Real protection against a funded competitor, if one ever appears, is shipping velocity and the eval harness / fixture corpus / failure-mode taxonomy — accumulated evidence that isn't copyable by reading code — plus per-user `campaign_canon` accumulation as a retention moat. These require no licensing decision and are being built regardless.

ELv2 remains the license for the reasons already in this log (managed-service restriction, consistency with other Automata Codex projects) — not as competitive protection, since it offers no real recourse against a "probably but not provably" copy in any case.

This closes the "open-source release decision" previously flagged as unresolved. Public repo, self-hosted-first build sequence, and M9 milestone scope (Docker Compose production config, self-hosted setup guide, DigitalOcean walkthrough) all stand as currently planned.

### SaaS service implementations stay closed source — enforcement rationale, not competitive secrecy

Unlike the Warden prompts and any future graph orchestration logic, the concrete SaaS implementations of the service interfaces (`ClerkAuthService`, `StripeEntitlementsService`, `AblyRealtimeService`, the RLS migration scripts and tenant-aware middleware, etc.) remain closed source when built. This is a different rationale from the open-source decision above and should not be read as contradicting it.

These implementations carry little competitive-secrecy value on their own — they are mostly integration glue against third-party APIs (Stripe, Clerk, Ably) that a competent engineer could reproduce in days regardless of prior access. The moat reasoning that justified keeping the Warden prompts and graph open does not argue for closing these; there was never much moat value here to protect.

The reason to keep them closed is that they are the literal technical mechanism that makes the ELv2 single-tenant restriction real. The open core is single-tenant by omission, not by enforcement — no RLS policies, no tenant-aware query layer, no `org_id` isolation, no billing wiring. If the multi-tenant RLS migrations and Stripe billing logic were included in the public repo, anyone would have the missing piece needed to stand up a competing managed service on top of Zoltar's own code — precisely the outcome the ELv2 restriction exists to prevent, and a more concrete risk than a competitor reading a prompt file.

This costs nothing to maintain, unlike a prompt/graph closed-source boundary would have: self-hosted already runs on structurally different implementations (Noop and local defaults per the service-interface table), so there is no shared artifact to split or distribution boundary to police. It is closed by the natural shape of the interface/implementation split, not by extra engineering effort spent defending it.

---

## Security

### Prompt injection risk acknowledged, not addressed at MVP

Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.
