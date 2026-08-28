# Decisions Log

Zoltar is an AI-GM platform for solo and small-group tabletop RPG play.

This log is a lightweight record of significant technical and architectural decisions made during design and development.

The design document (`docs/zoltar-design-doc.md`) captures the major product and architecture decisions; this log covers decisions made during implementation planning that aren't fully documented there.

Each entry records what was decided, what the alternatives were, and why.

---

<!--
  GENERATED FILE — DO NOT EDIT.

  Source of truth is one file per decision in `docs/decisions/`.
  Edit the entry there, then run `task docs:decisions:build`, which
  rewrites both this file and its sibling view.
  `task docs:decisions:check` fails if either is stale.
-->

**This is the full log** — every entry in its entirety. For the short version, see [`decisions-summary.md`](decisions-summary.md).

---

## Open

*No decision yet. Nothing here is safe to rely on.*

- [ADR-0080](decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md) — OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be

---

## Provisional

*Decided and in force, but on trial — follow it, and expect it may change.*

- [ADR-0106](decisions/0106-handoff-format.md) — Cross-Context Handoff Format

---

## Architecture & Backend

### [ADR-0001](decisions/0001-orm-drizzle-over-typeorm.md) — ORM: Drizzle over TypeORM

Drizzle's approach to Row Level Security is cleaner than TypeORM's — setting Postgres session variables and working with RLS policies requires less ceremony. Drizzle also produces more predictable SQL and infers TypeScript types directly from the schema definition at compile time, with no generation step. TypeORM is the NestJS default but not the right fit here.

### [ADR-0002](decisions/0002-migrations-flyway-over-drizzle-kit.md) — Migrations: Flyway over drizzle-kit

Flyway is ORM-agnostic and produces plain SQL migration files that are inspectable, version-controlled, and portable. Drizzle-kit generates SQL from schema diffs, which is useful during development but ties migration management to the ORM. Running Flyway from a Docker container in the Compose stack eliminates the JVM overhead concern. The two tools are not in conflict — drizzle-kit can be used for schema diffing during development while Flyway owns what actually gets applied.

### [ADR-0003](decisions/0003-no-circular-fk-between-adventure-and-gm-context.md) — No circular FK between `adventure` and `gm_context`

An earlier design put `gm_context_id` on `adventure` as well as `adventure_id` on `gm_context`, creating a circular FK that required a nullable column and a three-step insert (adventure → gm_context → update adventure). Dropped in favour of a unidirectional reference: `gm_context.adventure_id` with a unique index. Lookup in either direction is a single indexed query.

### [ADR-0004](decisions/0004-session-renamed-to-adventure.md) — `session` renamed to `adventure`

The domain concept is an adventure, not a session. Sessions in the traditional sense are a social scheduling artifact that dissolves in solo async play. Adventures are the first-class domain concept — they own the GM context, messages, and game events. The table is named `adventure` rather than `session` throughout.

### [ADR-0005](decisions/0005-no-nestjs-cqrs.md) — No `@nestjs/cqrs`

The API follows a CQRS-flavored pattern with clean separation between the command path (GM pipeline) and the query path (direct DB reads), enforced by NestJS module boundaries. The formal `@nestjs/cqrs` command/query bus infrastructure adds overhead without meaningful benefit at this scale. Module separation achieves the same discipline.

### [ADR-0006](decisions/0006-no-event-sourcing.md) — No event sourcing

ES is a natural fit for games in theory but awkward with an AI GM layer — Claude's responses aren't deterministic, so replaying events doesn't reproduce the same narrative. The message log plus state snapshot approach provides most of the practical ES benefits (audit trail, session reconstruction, correction without deletion) without the full ceremony.

### [ADR-0007](decisions/0007-uv-auth-core-and-uv-service-interfaces-are-separate-packages.md) — `@uv/auth-core` and `@uv/service-interfaces` are separate packages

Both packages exist so the future closed-source SaaS implementation repo can import abstract classes without depending on the open-source backend app. The split between the two packages reflects a difference in consumer profile: `AuthService` is a cross-cutting concern relevant to frontend-adjacent code (session validation, future SSR auth checks) and may be consumed outside a pure backend context. The six remaining service interfaces (`EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`) are backend-only concerns with no plausible frontend consumer. Keeping `auth-core` separate preserves the existing package boundary established in M1 and avoids mixing concerns that evolve at different rates.

### [ADR-0008](decisions/0008-explicit-status-column-on-adventures-table-no-inference-from.md) — Explicit `status` column on `adventures` table; no inference from `gm_context` row presence

An earlier design derived adventure status from whether a `gm_context` row existed for the adventure. Row absence is ambiguous: it could mean synthesis is in progress, synthesis failed, or a bug prevented row creation. There is no clean way to represent synthesis failure without an explicit status field. An explicit `adventure_status` enum column (`synthesizing`, `ready`, `completed`, `failed`) makes status queryable without a join and allows the `failed` state to be surfaced to users rather than leaving them with a stuck adventure. The column is added in V9 migration with a back-fill for any existing adventures.

### [ADR-0009](decisions/0009-magic-link-auth-is-backend-owned-auth-js-is-not-used.md) — Magic link auth is backend-owned; Auth.js is not used

Auth.js (`@auth/sveltekit`) requires SvelteKit's server-side hooks infrastructure to function. The frontend is a pure Svelte 5 SPA with no SSR or server-side hooks, so Auth.js cannot be used. Rather than pull in SvelteKit as a dependency for a single feature, magic link auth is implemented natively in the NestJS backend: the backend owns token generation, email delivery, session creation, and session validation. The `user`, `session`, and `verification_token` tables from V1 (originally created in the Auth.js schema format) are used as-is — we write to them directly. `AuthService.validateSession()` is unchanged: it reads the `session` table regardless of how the session was created.

### [ADR-0010](decisions/0010-frontend-is-svelte-5-spa-not-sveltekit.md) — Frontend is Svelte 5 SPA, not SvelteKit

SvelteKit's SSR and routing conventions add complexity without meaningful benefit for this product: the GM pipeline is entirely backend-driven, there is no SEO requirement, and the auth flow is owned by the backend. A plain Svelte 5 + Vite SPA is simpler to reason about, has no server-side rendering surface, and makes the frontend/backend boundary explicit. The tech stack entry in the design doc and README reflects this: "Svelte 5 (SPA)" not "SvelteKit."

### [ADR-0011](decisions/0011-embedding-model-voyage-4-lite-chosen-together-with-the-colum.md) — Embedding model: `voyage-4-lite`, chosen together with the column dimension

M7 shipped with `VOYAGE_EMBED_MODEL` defaulting to `voyage-3-lite` on the stated assumption that it matched the `vector(1024)` declaration on `rules_chunk.embedding`. It does not — `voyage-3-lite` emits 512 dimensions; `voyage-3` is the 1024-dimensional model of that generation. The error was invisible for the whole of M7 because the index is empty: `RulesRepository.findByCosineSimilarity` filters `embedding IS NOT NULL`, so pgvector never evaluated `<=>` against a row and never raised the dimension mismatch. It would have surfaced on the first M7.2 ingestion run.

The default is now `voyage-4-lite`, which emits 1024 dimensions by default and leaves the column, the `game_system.embedding_dim` seed, and every existing migration unchanged. Choosing it over `voyage-3` also avoids adopting a model Voyage now lists as legacy; the voyage-4 family is current, `voyage-4-lite` is the same $0.02/M as `voyage-3-lite`, and legacy models no longer carry a free-token allowance. `voyage-4` and `voyage-4-large` are drop-in step-ups if retrieval quality warrants the cost — same default dimension, no migration.

Two constraints follow, and neither is enforced by the type system: the ingestion model and the runtime `VOYAGE_EMBED_MODEL` must be the *same model*, not merely two models of the same width, or similarity scores are meaningless while looking healthy; and any future model swap must be checked against the column dimension before ingesting rather than after. M7.2's pipeline should validate the returned vector length against `game_system.embedding_dim` before insert — that check is the cheap guard that would have caught this at M7 time.

No eval re-baseline is owed for this change on its own. Both existing baselines ran against an empty index, so no graded turn ever consumed an embedding; the re-baseline that `ADR-0023` anticipates is owed to ingestion itself, not to the model swap.

### [ADR-0110](decisions/0110-dice-are-stored-as-rolled-and-offset-at-lookup.md) — Dice are stored as they fell; the 0-indexed table offset is applied at lookup

**Convention decided 2026-08-20, shipped 2026-08-21 as spec 018 Part 3.**

**The mismatch.** Mothership's creation tables — loadout, trinkets, patches — are indexed
`00`–`09` or `00`–`99`. `executeDiceRoll` is not: `dice.ts:57-64` returns
`randomInt(sides) + 1`, so `1d10` yields 1–10 against a table whose first row is `00`.

**Decision: store the dice as they fell and apply the `-1` at lookup time.** Two reasons,
both about keeping one convention rather than two:

- It preserves the dice-as-they-fell property that `creationRolls` is built on. A recorded
  roll means what the player saw on the table.
- It keeps the offset in one place rather than at every roll site.

**Shipped.** `tableIndexForRoll` (`packages/game-systems/src/dice.ts:88-95`) owns the offset
and throws on a die result below 1. `executeDiceRoll` is untouched. `loadout` joins `trinket`
and `patch` in `creationRolls` as the one optional roll, since a sheet written before the
field existed cannot retroactively acquire a roll nobody made.

**Consequence for `trinket` and `patch`.** Both have carried the same 1-based roll since
M7.6, and because the player reads those tables themselves the offset has never been applied
by anything. This is therefore a convention to establish going forward, not a bug to repair
on those two. See [[0109-trinket-and-patch-tables-are-not-repaired]], which is why nothing
in the app reads them.

---

## Rules Ingestion

### [ADR-0012](decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md) — Rules ingestion pipeline and retrieval quality are separate milestones

M7.2's original spec included post-ingestion validation — an eval re-baseline and a dedicated playtest — as its own Part 6. Both moved out to a new milestone, M7.5 (Rules Retrieval Quality), during M7.2 implementation.

**Why.** M7.5 exists to iterate on chunking quality, potentially as far as a hand-curated Markdown replacement for automated extraction. That iteration changes what's in the index. The re-baseline costs roughly 300 Warden turns plus judge calls (2 models × 15 fixtures × N=10) — buying it against an index about to be re-chunked means buying it twice. Same shape of waste the `roll_dice` schema-field deferral (below) was already guarding against, except worse: that was an unavoidable confound between two things worth measuring together; this would be pure waste, re-measuring the same thing after changing it out from under the measurement.

**What makes deferring the re-baseline safe rather than merely postponing it:** the retrieval eval harness (`task eval:retrieval`) reads index quality for the price of a few Voyage calls — no Anthropic spend at all. "Is this index worth baselining?" gets answered long before anyone pays to baseline it. Without that harness the deferral would just be procrastination with an extra step.

**The completion-criteria split, not just the reasoning, is why they're separate milestones rather than one milestone with a later Part 6.** M7.2's criteria are binary — the CLI runs, rows land, the harness scores. M7.5's is a quality bar — chunking iteration continues until the bar is met or a stopping rule fires. Milestones with quality-bar criteria absorb whatever is adjacent to them; folding the re-baseline into M7.2 would have made M7.2 itself open-ended, defeating the reason for having Done-When criteria at all.

**Consequence:** M7.2 ends with a populated index and a way to measure it — not with evidence the Warden is actually better off. That evidence is M7.5's. The three entries below waiting on a populated-index re-baseline (`ADR-0023`, `ADR-0044`, `ADR-0045`) stay open one milestone longer than an M7.2-only plan would have implied.

### [ADR-0013](decisions/0013-rules-ingestion-is-cli-only-in-phase-1.md) — Rules ingestion is CLI-only in Phase 1

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

### [ADR-0014](decisions/0014-chunk-extraction-is-block-based-with-footer-derived-provenan.md) — Chunk extraction is block-based with footer-derived provenance, not markdown headings

The design doc's chunking premise — treat each `###` Markdown heading as a candidate chunk boundary — does not survive contact with the actual extraction output. The PSG's whole-book heading histogram is 84 `#`, 3 `##`, 10 `###`, 55 `####` (`docs/rules-extraction-findings.md § S1.5`): 10 `###` headings against a 100–400-chunk target kills the approach on arithmetic alone, and the levels are assigned by font size rather than document structure — `#### ARMOR` and `# 14 ARMOR` are the same section at different levels, and reading order scrambles across the character-creation spread. Markdown output is also the wrong extraction format independent of the heading problem: it discards page attribution entirely, and the only page-marker mechanism it carries (`<span id="page-N-M">` anchors) covers 16 of 44 pages.

**Decided:** ingestion runs marker with `--output_format chunks`, not `markdown` — typed blocks (`Text`/`Table`/`ListGroup`, dropping headers/footers/pictures) carrying page and bbox metadata, merged toward a ~400-token chunk target with 50–100 tokens of overlap (`docs/rules-extraction-findings.md § S1.6`). Chapter boundaries force a chunk break.

Provenance is derived, not read from any marker field. `blocks[].page` is an internal id, not a page number (physical page 0 → `'7'`, 1 → `'512'` — plausible-looking and wrong, the exact failure mode worth guarding against in any future extraction work). The physical page number comes from the `/page/N/` prefix on each block's `id`; the printed page number and chapter name are read from the PDF's running footer via `pypdfium2` directly, which resolves chapter on 36 of 44 pages (`docs/rules-extraction-findings.md § S1.8`). `section_hierarchy`, marker's own structural field, was tested and rejected as a breadcrumb source — it records the last header seen at each visual level, which turns siblings into parents on scrambled multi-column pages (`STEP 5. GAIN STRESS > STEP 6. NOTE TRAUMA RESPONSE`).

**Edition-specific, not general.** The `printed page = physical page + 1` offset and the footer-parsing approach are verified only against the PSG 1e. Any second Mothership book needs its own check before ingestion (`docs/rules-extraction-findings.md § Open questions`).

### [ADR-0015](decisions/0015-reading-order-requires-an-explicit-column-aware-sort-an-llm.md) — Reading order requires an explicit column-aware sort; an LLM may validate it, never perform it

Marker's emitted block order is not reading order on multi-column pages. Of the 16 pages carrying two or more numbered section headers, 8 emit them out of order, including full reversals (`docs/rules-extraction-findings.md § S6.2`); the true rate is plausibly higher since that test can't see unnumbered headings. A chunker that merges blocks in emitted order — the design doc's implicit assumption — would concatenate roughly half the book's body pages backwards.

Two approaches were on the table: an LLM pass that reads the page image and proposes correct ordering, or a deterministic geometric sort using the bbox coordinates every block already carries. LLM-assisted flagging was piloted first for a different purpose (auditing extraction defects generally) and, as a side effect, demonstrated it could recover correct order by eye — but that's the wrong place for the capability to live: routing per-page ordering through an LLM call at ingestion time would make a Python-only, no-LLM-calls pipeline (`docs/rules-ingestion.md`, hard constraint) depend on a model call for every multi-column page, forever, on every re-ingestion.

**Decided:** a ~25-line deterministic sort. Full-width blocks (≥60% of page width) flush the current column band and stand alone; everything else is banded by `y0` position and split left/right by bbox x-centre against the page midline (`docs/rules-extraction-findings.md § S7.2`). This recovered 15 of 16 measurable pages with nothing regressed. The one residual failure (physical page 17, a boxed callout whose heading is narrower than its full-width body) is understood and local, not a case against the approach.

**The boundary that follows from this:** the sort must be deterministic and live in `ingest.py`. An LLM may validate the result — flagging pages where the sort still looks wrong, informed by the page image rather than geometry alone — but must never perform the reordering itself. Where geometry genuinely can't resolve a page, the escape hatch is a hand-blessed ordering recorded once per edition in `fixups.json`, keyed on block `id`; that's an explicit, reviewed exception, not a runtime dependency.

**Coverage caveat carried forward, not resolved here.** The numbered-header test that validates the sort only sees 16 of 44 pages. The LLM-flagging pass is the intended instrument for validating the other 28 (unnumbered headings), not yet run at that scope.

### [ADR-0016](decisions/0016-character-creation-content-is-excluded-from-the-rules-index.md) — Character-creation content is excluded from the rules index — structurally unreachable by the Warden

Physical pages 4, 41, and 42 cover Mothership character creation. Confirmed via tool-array and query-log inspection that `rules_lookup` is wired only into the play-loop tool array — character creation runs its own flow and makes no Anthropic calls at all, so nothing the Warden does can retrieve these pages regardless of what the index contains (`docs/rules-extraction-findings.md § S2`).

**Decided:** exclude physical pages 4, 41, 42 from the rules index. This also resolves the duplicate-spread question for that trio without needing dedup logic: 41 and 42 are byte-identical duplicates of page 4's character-creation spread, and both drop with it. Page 4 also carries the worst provenance in the corpus — its footer doesn't resolve to a chapter — so exclusion removes a hard case rather than requiring a fallback-chapter decision for it.

**Extended to page 3 on 2026-08-07, but on different grounds — and the difference is the point.** The character-profile sheet is now excluded too (`ingestion/mothership/system.json` carries `drop_pages: [3, 4, 41, 42]`), measured as M7.5 iteration round 2 in `docs/rules-extraction-findings.md § S18`.

This entry previously guessed page 3 was "the same category" as 4/41/42. **It is not.** Pages 4/41/42 are excluded because the Warden *structurally cannot reach them* — an argument from the tool array that holds regardless of what the index contains or how well retrieval works. Page 3 is perfectly reachable and is excluded because it is *actively harmful*: it held **10 of 147 top-3 slots** across the fixture set and sat at **rank 1 ahead of the correct page** for two answerable combat queries (`rq-003`, `rq-017`), on stat-name density alone. Removing it promoted both and cost no recall. (It also lifted MRR by roughly 0.02, but see `docs/rules-extraction-findings.md § S22`: that metric alternates between 0.842 and 0.856 across repeated runs at one configuration, so it is colour here rather than evidence.)

Same action, two different justifications, and conflating them would have been expensive for the next page anyone asks about: **reachability is confirmed by reading the tool array; harm has to be measured.** A page that is reachable and merely useless costs nothing and needs no decision. A page that is reachable and *attractive to the wrong queries* costs a top-3 slot every time, and only a scored fixture set can tell the two apart.

**Method note worth carrying forward.** Round 2's decision criterion was fixed before the run as "exclude if recall holds *and unanswerable top-1 similarity falls*." Recall held; unanswerable similarity did not move at all. The second clause was a proxy for false-positive pressure that pointed at the wrong fixtures — page 3's false positives were landing on *answerable* queries, displacing pages that genuinely answered, which an unanswerable-set aggregate cannot see. The exclusion stands on the direct per-fixture evidence instead. Recorded rather than quietly reinterpreted, per `§ S18.4`.

### [ADR-0017](decisions/0017-fixup-match-schema-keyed-on-block-id-not-section-contains.md) — Fixup match schema keyed on block `id`, not `{section, contains}`

`docs/rules-ingestion.md § Step 2` specifies fixup entries matched by `{section, contains}` — e.g. `{"section": ["Combat", "Panic"], "contains": "1-10Roll"}`. Neither key can express the confirmed extraction defects. `contains` needs text to match against, and the defect is 14 of 32 `Table` blocks extracting as empty (`<p></p>`) — there's nothing there to match on. `section` was meant to derive from `section_hierarchy`, already rejected above as unreliable ancestry.

**Decided:** match fixup entries on the block `id` (e.g. `/page/11/Table/5`) instead — stable, unique, and already the fallback every other part of this pipeline uses once `page` and `section_hierarchy` proved unreliable (`docs/rules-extraction-findings.md § S6.5`). `ingestion/mothership/fixups.json` remains empty pending the table-defect scoping decision in `roadmap.md` M7.2; this entry fixes the schema those fixups will eventually use, not the defects themselves.

### [ADR-0109](decisions/0109-trinket-and-patch-tables-are-not-repaired.md) — The garbled trinket and patch tables are not repaired — nothing queries them

**Found 2026-08-20, not fixed by decision the same day.**

An audit of the printed-p.7 loadout tables for the wide-table truncation signature
(`docs/rules-extraction-findings.md § S27.4`) came back clean — 40 of 40 rows present across
four class tables × `00`–`09`. The defect turned up one page over instead. `TRINKETS`
(printed p.8) has 4 orphan continuation rows and 2 comma-terminated ones; `PATCHES`
(printed p.9) has 6 orphans.

**All 100 indices survive in each, so this is reassembly damage rather than loss.** Both are
three-column tables, and extraction interleaves the columns across lines. Nothing is missing;
the rows are assembled wrongly.

**`§ S11.2` calls these tables "intact", which is true at the token level and wrong at the
row level.** That is worth correcting in the findings document even though no repair follows
from it.

**No fixup entry, by decision.** Character creation rolls the number and the player enters
the result from their own copy of the book. Nothing in the app resolves a d100 against these
tables, and the character sheet schema itself records both as *"narrative, never mechanical"*
(`character-sheet.schema.ts:132-135`). A garbled table nobody queries costs nothing, and the
fixup mechanism exists for defects that reach a reader.

**Revisit only if** something starts resolving trinkets or patches mechanically.

### [ADR-0111](decisions/0111-footer-less-pages-inherit-the-preceding-chapter.md) — Footer-less pages inherit the preceding chapter; reference cards carry none by design

**Decided 2026-08-26, closing the last open question M7.2 shipped with.**

Chapter attribution is read from the PSG's running footer
(`footer_format: "page-number-then-chapter"`). Eight of 44 physical pages carry
no parseable footer, and M7.2 shipped a placeholder policy — page citation, no
chapter breadcrumb — while the real answer was deferred. Three of the eight were
already resolved by dropping them
([[0016-character-creation-content-is-excluded-from-the-rules-index]]). This
settles the remaining five.

**They are not one problem, and the whole decision is in separating them.**

- **Physical 0 and 2** — the cover (23 chars) and the credits / content-warning
  page. No rules content. **Dropped**, the same way page 4 was.
- **Physical 1 and 43** — the inside-cover and back-cover reference cards. These
  belong to no chapter *in the printed book*. Their footer is not missing; there
  is nothing for it to say. **They carry no chapter, by design**, recorded as
  `chapterless_pages` in `ingestion/mothership/system.json`. They stay in the
  index per [[0107-reference-cards-stay-in-the-rules-index]].

  **Why this is not just `drop_pages`.** The two keys answer different questions.
  `drop_pages` says *this content should not be findable* — it is unreachable,
  or actively harmful to ranking. `chapterless_pages` says *this content is
  findable and has no chapter*. The cards are retrieved and useful: printed p.2
  and p.44 both appear in top-3 results across the fixture set. Dropping them to
  avoid an attribution question would discard content to tidy up metadata.

**On naming each footer-less page's chapter in config instead** — rejected, though **not** because it is per-page manual data that goes stale, which is exactly what `chapterless_pages` is. What separates them is what each asserts: a chapter name is a positive claim that must track the book's contents, while non-membership is a negative one that survives reorganization. The volume argument was carrying nothing either — inheritance serves exactly one page.
- **Physical 10** — equipment continuation, printed p.11. Genuine body content
  mid-chapter that happens to have lost its running footer, and reachable
  content the Warden queries. **Inherits the preceding page's chapter**, which
  resolves `EQUIPMENT` on physical 9.

**Blank stays a signal; inherited is a claim.** The reason `chapterless_pages` is
an explicit list rather than "inherit everywhere" is that a future footer-parsing
regression should present as a gap, not as plausible-looking wrong attributions.
`read_page_chapters` logs the resolved count before filling — 36 of 44 on this
edition — because taken after filling that number would read a clean 44 of 44 on
a book whose footers had stopped parsing entirely.

**That diagnostic needed hardening, and this is the change review forced.** Once
pages inherit, the index no longer shows the gap and the log is the only place it
survives — so the log's threshold has to be worth something. It was "warn below
half", which on a 44-page book tolerates 36 resolving pages falling to 22 without
a word. `expected_chapter_pages` now pins the count per edition beside the PDF
hash, and any deviation warns. The old fraction remains as the fallback for a
system that has not pinned one, and says so.

**Enumeration rather than derivation, and this is settled rather than open.** The
obvious alternative — classify front and back matter by position — is the same
shape as trusting a block's page attribute: plausible, wrong on the next book,
and silent about being wrong. It is not even coextensive, since an errata insert
or fold-out plate is chapterless mid-book while front matter can sit inside
chapter 1. An explicit list fails visibly, which is the property being bought. A
book with no such pages carries an empty key, and that is the correct cost.

**Honest scope: inheritance serves exactly one page today.** Of the eight
footer-less pages, five are dropped and two are the cards, leaving physical 10.
The rule is still the right one — it is the general answer to "a body page lost
its footer" — but it should not be read as covering a class.

**A chapterless page is skipped, not a barrier.** It takes no chapter itself and
does not reset the carry.

*This entry originally said the opposite — that a chapterless page stops the
carry — and was corrected on review the same day.* The argument that killed it:
a chapterless page either sits at a chapter boundary, where the next page
resolves its own footer and stopping changes nothing, or it sits mid-chapter —
an errata insert, a fold-out plate — where stopping strips a correct attribution
off the next page. **No-op or wrong, with no third case.** The justification
offered here (*"the back-cover card cannot hand the last chapter to anything
following it"*) described a situation that cannot arise: nothing follows the back
cover. Simulated across all 44 PSG pages, the two behaviours differ on **zero**
pages — the original rule was unfalsifiable against the only book we have, which
is precisely why it survived authoring.

**Implementation.** `fill_chapter_gaps` in `ingestion/pipeline/extract.py`, pure
and unit-tested without a PDF; called from `read_page_chapters` so the document
is opened once.

**This is a lever, not a metadata tidy-up, and the manifest says so.**
`chunk_blocks` prefixes each chunk with its chapter breadcrumb, so attribution
changes the indexed text. `chapterlessPages` joins `droppedPages`,
`targetTokens`, `overlapTokens` and `includeSectionHeaders` in the ingest
manifest — a retrieval score is only comparable against a build with the same
value.

**Physical 11 and 12 are dropped in the same change, for an unrelated reason.**
`FIREARMS` and `INDUSTRIAL EQUIPMENT` restate the inside-cover reference card in
a different format — confirmed against the printed book by the maintainer, not
inferred from the extraction. Their `Table` blocks all extract empty
(`docs/rules-extraction-findings.md § S3.2`), so today they contribute nothing;
dropping them also stops `--include-section-headers` resurrecting them as bare
topic labels with no table body, which is the false-positive shape
[[0016-character-creation-content-is-excluded-from-the-rules-index]]'s addendum
describes for physical page 3. This closes M7.2's other known gap.

**Cost, and what it turned out to be.** Re-ingested and re-measured 2026-08-26
(`mothership__2026-08-26T13-46-20Z`). The caution written here in advance — that
`drop_pages` going from 4 pages to 8, plus a breadcrumb on every physical-10
chunk, would leave the M7.5 baseline measuring an index that no longer exists —
was worth stating and did not come true.

**Every aggregate reproduced the baseline exactly:** `recall@3` 97.3%,
`recall@5` 97.3%, MRR 0.883, `authored` 100.0%, `warden-observed` 95.7%. Not one
rank moved — an identical MRR to three decimals across 37 answerable queries is
what no rank changing looks like. The corpus went 61 → 60 chunks.

**That is the result the change was designed to have, and it is worth saying why
rather than filing it as luck.** The four newly dropped pages were a 23-character
cover, a credits page, and two pages whose `Table` blocks all extract empty — they
were contributing nothing to drop. The breadcrumb added to physical 10 is a short
prefix on a ~400-token chunk, and no fixture's expected page is printed p.11. So
the attribution gap closed at zero retrieval cost, and `§ S28`'s figures stand
rather than being superseded.

**The mechanism was confirmed separately, and it had to be.** Identical
aggregates are also what a silently no-op'd inheritance would produce, so the
scores alone cannot tell "worked and cost nothing" from "did nothing". The dry
run reports which pages carry no chapter by name: it listed **printed p.2 and
p.44 only** — the two reference cards — with printed p.11 absent, which is
physical 10 having inherited `EQUIPMENT`. That is the pass condition, and it is
why `print_dry_run` names the pages rather than counting them.

**The similarity distributions still overlap** — answerable-correct-hit
0.330–0.601 against unanswerable 0.271–0.426 — so [[0020-no-similarity-floor-for-rules-lookup-the-distributions-overl]]
is unchanged by this.

---

## Rules Retrieval

### [ADR-0018](decisions/0018-rules-retrieval-mechanism-dense-embeddings-over-fts-or-llm-a.md) — Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex

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

### [ADR-0019](decisions/0019-query-preprocessing-for-rules-lookup-promoted-from-optional.md) — Query preprocessing for `rules_lookup` promoted from optional to critical path

Shortening a `rules_lookup` query to its 2–3 distinctive terms puts the
correct page at rank 1 on *both* FTS and dense retrieval, for all three real
recorded queries — including the one query no other configuration on either
backend ever retrieved (`docs/rules-extraction-findings.md § S4`, `§ S5.3`).
This is the single largest effect measured across the whole retrieval
investigation, larger than the FTS-vs-embeddings choice itself (`ADR-0018`, above).

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

### [ADR-0020](decisions/0020-no-similarity-floor-for-rules-lookup-the-distributions-overl.md) — No similarity floor for `rules_lookup` — the distributions overlap, and the free-looking threshold is fitted to noise

M7.5 Part 4, decided 2026-08-07 against the final index (61 chunks, `drop_pages: [3, 4, 41, 42]`), per `docs/rules-extraction-findings.md § S20`. `RulesLookupService.lookup()` is unchanged: it returns whatever `findByCosineSimilarity` gives back, with no threshold.

**The distributions overlap and interleave.** Answerable-with-a-correct-hit spans 0.342–0.600 (n=35); unanswerable spans 0.270–0.416 (n=12). The overlap zone 0.342–0.416 contains 5 correct answers and 6 unanswerable queries, mixed rather than merely abutting. That is the spec's stated criterion for "no honest floor exists yet," and it is not met.

**The part worth recording is the threshold that looks free.** A floor at 0.34 — just under the answerable minimum — discards **0 of 35** correct answers and suppresses **5 of 12** unanswerable queries. It is the obvious thing to ship.

It is rejected because its measured cost is zero *by construction*. 0.342 is not the lowest similarity a correct answer has; it is the lowest one had in a 35-point sample, and a threshold placed just beneath a sample minimum is fitted to an order statistic. The quantity that would justify it — the distribution's true left tail — is exactly what 35 points cannot estimate.

The asymmetry settles it. A suppressed unanswerable query costs nothing: the Warden already handles empty results correctly, with a prompt block for it and a `gmUpdates.notes` convention for recording the gap. A suppressed *correct* chunk costs a wrong ruling with no trace that anything was withheld. **Recorded rather than merely decided, because the table is persuasive and will be persuasive to the next person who builds it.**

**What would actually make a floor derivable, and it is not chunking.** Three iteration rounds moved these distributions by 0.001 (`§ S15.4` measured 0.342–0.416 on the M7.2 index; `§ S20.1` measures the same on the final one). They could not have moved it: the excluded pages were displacing correct answers on *answerable* queries, while an unanswerable query's top hit was already a legitimate topically-adjacent chunk. Unanswerable queries score 0.27–0.42 because they ask about absent mechanics in *present* vocabulary — `flanking` and `opposed rolls` are not in the book, but `combat`, `armor`, and `cover` are — so the embedding is measuring real proximity and is not wrong.

A floor becomes available when the unanswerable distribution shifts down, and the only lever that moves it is upstream of retrieval: stop generating concept-absent queries, which `§ S9.3` measured at 130 of 344 out-of-corpus queries (37.8%). That is the mechanical-model primer in M7.5 Part 4.6. **Re-derive the floor after the primer has been measured, not after the next chunking change.**

### [ADR-0021](decisions/0021-the-d-d-5e-bias-hypothesis-has-a-confirmed-instance-in-the-s.md) — The D&D-5e-bias hypothesis has a confirmed instance, in the schema rather than in retrieval

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
  `ADR-0019`
  (amendment) splits 157 wrong-word / 130 concept-absent out of 344, and *which* lexicon
  those out-of-corpus terms come from is still unmeasured. Confirming the hypothesis in
  one artifact does not confirm it in another, and the mechanical-model primer's design
  should not start assuming 5e as the source.
- The cheap test remains available and is still not run: classify the 130 concept-absent
  queries by whether the named mechanic exists in 5e. Flanking, suppressive fire, opposed
  rolls and DCs all do. That is a labelling pass over data already in `unicorn-artifacts`,
  with no Warden run and no API spend.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### [ADR-0022](decisions/0022-the-retrieval-stopping-rule-is-measured-on-the-metrics-with.md) — The retrieval stopping rule is measured on the metrics with headroom, not on the saturated one

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

### [ADR-0107](decisions/0107-reference-cards-stay-in-the-rules-index.md) — The reference-card duplicates stay in the rules index — a close call settled on a pre-fixed criterion

**Decided 2026-08-09.** Mothership's printed pp. 1 and 44 are cheat sheets that restate
body content, so their chunks are near-duplicates competing with the pages they summarize
in cosine ranking. The question was whether dropping them improves retrieval enough to
justify losing the cards themselves.

**Run as chunking round 4** (`docs/rules-extraction-findings.md § S28`): physical p.43 —
printed p.44, the back-cover cheat sheet — dropped, paired with
`--include-section-headers`, against a criterion **fixed before the run**: keep the change
only if `recall@3` holds at 97.3% or better and no fixture regresses.

**Every aggregate came back identical.** `recall@3` 97.3%, `warden-observed` 95.7%, MRR
0.883. The mechanism worked exactly as intended — p.44's share of the 147 top-3 slots went
14 → 0. But `rq-010` regressed rank 1 → 2, deterministically: verified across five
pre-round-4 runs and three round-4 runs, so it is not the run-to-run reordering `§ S22`
catalogued.

**Reverted on the criterion.** One fixture regressed, the criterion said no fixture may,
and the criterion was written down first. The revert is explicitly to avoid a close call
being settled by whoever most wanted the result — every aggregate was neutral, which is
precisely the condition under which a pre-registered rule earns its keep.

**Standing decision:** `drop_pages: [3, 4, 41, 42]` in
`ingestion/mothership/system.json`. The reference cards stay in the index. Pages 3, 4, 41
and 42 are excluded for unrelated reasons — see [[0016-character-creation-content-is-excluded-from-the-rules-index]].

**What would settle it properly, and why it is not scoped here.** The real conclusion is
that this fixture set can no longer discriminate at this level: 36 of 37 passing leaves one
fixture of headroom, so any change is being judged on a single data point. `§ S28.4` records
the remedy — re-run round 4 once the fixture set is extended with equipment coverage. That
extension is retrieval-fixture work, and was deliberately left outside M7.5's scope.

---

## Claude Integration — Tool Schemas & State

### [ADR-0023](decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md) — Warden model upgraded to `claude-sonnet-5`

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

**What this decision does not claim.** All figures are single-grader. Both baselines executed against an empty `rules_chunk` index, so nothing here accounts for how rules availability changes reach-for-dice behaviour; the M7.5 re-baseline is the real test of these numbers (moved from M7.2 — see ADR-0012). At N=10 the 95% CI half-width at p=0.5 is ~±31pp, so individual rates near the middle are unsettled even where the direction is not. And a first run against a new model audits the harness as much as the model — the two defects that audit surfaced are recorded in `eval-methodology.md`, and the rates above are the post-correction ones.

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

Also retired: 0.90 was measured with a checker that could not see the failure. The M7.5 `actingEntityId` integration shipped a false pass that graded ten violations clean (ADR-0046, below). The July figure is unaffected — those artifacts predate the field and take the prose path, verified bit-identical on re-score — but every figure produced between 2026-08-07 and 2026-08-09 on this tag was wrong.

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
(ADR-0082; that entry's instance list is
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

**Addendum — a Sonnet 5 behavioural regression this entry did not measure, and the reason the
`max_tokens` instruction above was unfollowable.** Recorded 2026-08-17; see `ADR-0097` for the
defect and the guard.

Sonnet 5 intermittently terminates the `playerText` parameter with a fabricated closing tag and
serializes the remaining parameters as text inside it, producing a schema-valid `submit_gm_response`
that silently discards every state change. Across every eval run on disk the split is clean and
tracks the model rather than the prompt: **4.6 leaked 0 of 245 outputs, Sonnet 5 48 of 916 (~5%)**,
spanning all four prompt hashes since the earliest Sonnet 5 run on 2026-07-29. Prompt `0bdd1306`
gives a same-fixture head-to-head at 0/106 against 12/150. Under a 5% rate, 0-of-245 has probability
~2×10⁻⁶.

This does not reopen the upgrade. Every gain in the tables above is real and none of it is an
artifact of the defect — the leak suppresses `stateChanges`, and the structural checks that carried
the largest gains read event structure that a leaked turn simply does not produce, so its effect on
those rates is to *withhold* observations rather than to inflate them. It is recorded here because
this is the entry that decided the model, the defect is a property of that model, and it went
unnoticed through four baselines including M7.6's.

**It also went unnoticed for a reason this entry is directly responsible for.** The closing paragraph
above asks a reader to "watch for `stop_reason: 'max_tokens'` on long combat turns." That instruction
was unfollowable from the day it was written: `adventure_telemetry` recorded only the *parsed*
`SubmitGmResponse`, never the response envelope, so `stop_reason` existed nowhere in the archive.
The M7.7 investigation could not settle whether the API had returned a malformed tool call or a text
block from stored data at all, and had to answer it indirectly. `stop_reason`, content-block types
and tool names are now recorded per turn for both the original and correction rounds. Watch
instructions that name a field the telemetry does not keep are not watch instructions.

### [ADR-0024](decisions/0024-tool-use-over-prompt-instructions-for-structured-output.md) — Tool use over prompt instructions for structured output

Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

**Addendum — the guarantee is narrower than this entry states, and the gap cost 39 turns.** Recorded 2026-08-17 on the evidence of the 2026-08-16 playtest (`ADR-0097`).

Tool use enforces *the schema*. It does not enforce that the model put its content in the right field, and the category of malformed response this entry claims to eliminate did not disappear — it relocated inside a valid parameter, where schema enforcement cannot reach it by construction. `playerText` is the only required field on `submitGmResponseSchema`, so a response that serialized its remaining parameters as text inside the narration is a *valid* tool call carrying a malformed payload. The API accepted it, Zod accepted it, and the turn committed while discarding every state change the Warden had computed.

The sentence above still holds against its actual alternative: prompt-instructed JSON in a text block would have failed more often and more visibly. What it must not be read as is a guarantee that a `tool_use` block is well-formed. Schema validity is a floor, not a proof, and the fields a schema marks optional are precisely where a malformed response can hide without tripping anything. Payload-level well-formedness is a separate check, and it now exists (`ADR-0097`).

### [ADR-0025](decisions/0025-hp-and-all-numeric-resources-in-resourcepools-not-a-separate.md) — HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field

An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

### [ADR-0026](decisions/0026-state-placement-is-decided-by-the-lifetime-of-the-referent-n.md) — State placement is decided by the lifetime of the referent, not the lifetime of the value

There are three places a piece of state can live — the character sheet, campaign state,
and adventure state — and until now there was no rule for choosing between them. The
sheet/campaign line was settled once, for HP and current Stress, in
`ADR-0027`. The
campaign/adventure line was never stated at all: `adventures` carries `mode`,
`initiative_order`, `caller_id` and `rolling_summary`, and everything else defaults into
`campaign_state.data` because that is where the blob is.

**The rule**, two axes applied in order:

1. **Does the value change during play?** No → **character sheet**. Name, pronouns, class, the creation rolls as rolled.
2. **For values that do change, how long does the thing they describe last?** Outlives the adventure → **campaign state** (anything attached to a character, a recurring NPC, or the party's ship). Created and destroyed with the adventure → **adventure state** (a derelict's reactor integrity, a synthesized threat's HP, a countdown timer, initiative order, scenario flags).

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
(`ADR-0036`);
synthesis writes NPC, threat, and timer pools. If synthesis wrote it, it is adventure
state.

**Known limit, recorded rather than pre-solved.** Some systems scope finer than an
adventure. Infinity 2d20's Momentum is a shared party pool that resets between *scenes*;
Feng Shui 2's Fortune resets per session while Marks of Death are permanent. The referent
rule still holds — Momentum's referent is the scene — but the three-destination model has
no home for it. Revisit at Phase 3–4 when those systems land, not before.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### [ADR-0027](decisions/0027-character-sheet-stores-identity-and-build-not-live-mutable-s.md) — Character sheet stores identity and build, not live mutable state

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
`ADR-0026`.

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
`null`, which is what makes `ADR-0028` work as written (the goblin at −2 HP). For stress it fires at zero. If M7.6
routes Stats and Saves through pools, each one needs an explicit reject-or-clamp decision
rather than inheriting whichever behaviour its `min` happens to produce.

**Three further shape defects the inventory found, beyond the four this entry's first
addendum lists:**

- **`stats` has six fields and should have four.** `sanity` is a Save (§18.2), not a Stat;
  `instinct` is a Contractor stat (§40.1) and not a player-character attribute at all.
  `saves` correspondingly lacks Sanity.
- **Wounds are entirely absent** — no `maxWounds`, no wounds pool. See
  `ADR-0021` for what the code does instead.
- **`level` exists, is written by nothing and read by nothing**, in a game with no levels.

**Addendum 3 — considered and rejected: writing state back to the sheet at adventure end**

Once the placement rule leaves the sheet holding only immutable creation data, an obvious
question follows: should end-of-adventure state be written back to the sheet, so the next
adventure starts from a clean derivation rather than from accumulated campaign state?
Superficially attractive — each adventure would begin from a single tidy source.

**Rejected. The derivation it would avoid does not exist.** `campaign_state` is
campaign-scoped and nothing clears it between adventures, so player pools already persist
across the boundary. `deriveMothershipCharacterResourcePools` has exactly two call sites,
both in `CharacterService`, and neither is on the adventure-creation path — a character at
7/20 HP already begins adventure 2 at 7/20
(`docs/plans/m7.6-code-inventory.md`, commit `e1cdaac`). A write-back would copy values
that are already in the right place, and the moment a copy diverged there would be two
authorities for one number, which is the drift this entry's rule exists to prevent.

Worth stating plainly because the correct carry-forward behaviour was arrived at by
accident rather than by design, and it is easy to mistake for a gap. The defect the code
inventory found at the adventure boundary was never character carry-forward; it was that
*scenario* state carries forward too, which
`ADR-0054` addresses.

**It would also serve no system on the roadmap.** 5e resets at *rests*, Feng Shui 2's
Fortune per *session*, Infinity 2d20's Momentum per *scene*. None of those is an adventure
boundary. This is `ADR-0026`'s "reset is a rule, not a lifecycle" applied one level down: a sync
mechanism keyed to adventure completion would encode a reset assumption no supported
system actually has.

**Two further problems with no obvious answers**, recorded so that a future revisit starts
from them rather than rediscovering them: adventures terminate as `completed`, `aborted`
*or* `failed`, so a write-back needs a policy per terminal status; and a dead character has
nothing to carry forward.

**A different thing worth having later, under a different name.** An *append-only* snapshot
of character state at each adventure's end has real value — character history, and the
"how did I lose 15 Strength" question that motivated the `reason` field on pool deltas. That
adds a row rather than overwriting an authority, so it composes with delta provenance
instead of competing with it. Not Phase 1, and not this mechanism.

### [ADR-0028](decisions/0028-pool-validator-applies-full-delta-before-threshold-detection.md) — Pool validator applies full delta before threshold detection

When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.

### [ADR-0029](decisions/0029-pool-behavior-defined-in-system-zod-schema-not-hardcoded-in.md) — Pool behavior defined in system Zod schema, not hardcoded in validator

Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.

### [ADR-0030](decisions/0030-typed-system-specific-fields-on-tool-schemas-are-acceptable.md) — Typed system-specific fields on tool schemas are acceptable while one system is supported

`damageType` on the pool-delta object (M7.6) is the first **rules-semantic** field on a
tool schema — a field whose permitted values come from one book. `rollType` is arguably
system-flavoured, but it names a category of interaction; `damageType` names five specific
columns of Mothership's Wounds Table (PSG §29.1): Blunt Force, Bleeding, Gunshot, Fire &
Explosives, Gore & Massive.

The generic alternative is `properties: Record<string, unknown>`, validated per system.
**Deferred, for the same reason the synthesis driver registry is deferred**
(`ADR-0037`): until a second system
exists, any interface is a guess shaped entirely by Mothership's needs, and the second
system is likelier to reveal the right abstraction than to conform to a premature one.

**What the typed field buys that a container does not.** The value is not only schema
shape — it is a prompt instruction and a closed enum the Warden selects from. Typed,
`gore_massive` is checkable and `slashing` is rejected at the tool boundary. Under
`properties`, that validation moves into a per-system Zod refinement or it disappears.
The first is fine; the second reintroduces `UNAUDITABLE-MAPPING` through a side door.
Note also that the machinery which would dispatch per-system validation does not exist in
this path today: pool behaviour is selected by pool key
(`ADR-0029`), not by
campaign system.

**The trigger to generalize is the second system needing a *different* field, not this
system needing a second field.** If Mothership later wants `woundSeverity` alongside
`damageType`, that is two typed fields and still fine. When OSE needs `saveCategory` and
Infinity needs `momentumSpend`, the object carries three mutually exclusive fields each
null for two systems out of three — and at that point the container is cheaper than the
union. Phase 2 is when this is discovered, and deferring costs nothing because the change
is additive either way.

**One asymmetry that argues for watching this closely rather than filing it.** The
pool-delta object is precisely where four fields landed simultaneously in M7.6 to avoid
paying for two re-baselines. Every future change to it carries that same cost. So the
question is not only whether `damageType` is the right shape, but how many more times this
object will be opened — and if the answer turns out to be once per system, the container
is cheaper than it looks today.

Recorded now as a recognised boundary with a named trigger, so that the Phase 2
implementer meets a decision rather than a surprise.

### [ADR-0031](decisions/0031-entity-death-does-not-auto-zero-prefixed-pools.md) — Entity death does not auto-zero prefixed pools

When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.

### [ADR-0032](decisions/0032-entity-and-resource-pool-identifiers-use-underscores-only.md) — Entity and resource pool identifiers use underscores only

Dots in identifier strings cause subtle bugs when code uses dot-notation property access on JSON keys. Hyphens are legal but inconsistent with TypeScript naming conventions. Underscores are unambiguous. Resource pools follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `vasquez_stress`.

**Addendum — the composite pool key is retired; the underscore rule for identifiers is not**

M7.6 nests resource pools by entity —
`resourcePools: { [entityId]: { hp: { current, max }, … } }` — replacing the
`{entity_id}_{pool_name}` composite key this entry specifies. `dr_chen_hp` becomes
`resourcePools.dr_chen.hp`.

**The rule this entry states is unaffected.** No identifier gains a dot: `dr_chen` and `hp`
are separate keys, each still underscores-only, and the dot-notation hazard the entry
describes does not arise because nothing parses a composite string. What lapses is only the
naming *pattern* in the final sentence.

**Why nest.** The composite key made pool identity a convention enforced by suffix matching
— `getMothershipPoolDefinition` tests `*_hp` and `*_stress`, correct only while no entity id
ends in a pool name. At ten pools per character that guarantee thins, and a `_max_hp`-shaped
key would break it outright. Nesting removes the parse rather than hardening it: the
selector receives the pool name directly.

Two defects close as a side effect. `CharacterService.delete` left derived pools orphaned
because removing them meant a prefix scan; nested it is `delete pools[entityId]`. And the
`alvarez` / `lt_alvarez` duplicate this entry's neighbouring amendment describes becomes
*visible* — two sibling keys with overlapping pool sets read as obviously wrong in a
rendered snapshot, where eight scattered flat keys did not. It does not prevent that defect,
which was two entity ids rather than a key-format failure.

**The cost, recorded because it is easy to miss.** Merges must become **deep**.
`mergePlayerResourcePools` (preserve-on-conflict) and `applyValidatedTurn` (plain shallow
spread) both operate at the top level. Nested, a shallow spread at the entity level clobbers
every pool that entity owns when one is written. The pre-existing disagreement between those
merge points acquires a much larger blast radius per key.

**The tool payload does not nest.** `stateChanges.resourcePools` becomes an array of
self-describing entries — `{ entityId, pool, delta, maxDelta?, reason, damageType? }` —
rather than a keyed map. Nested state does not require a nested payload, and the array
avoids string parsing on ingest without asking the Warden to generate nested JSON.

*(Member names corrected from `state_changes.resource_pools` — a transcription slip. The
five existing `stateChanges` members are camelCase, `session.schema.ts:15-45`, and no
decision here was choosing a naming convention. Spec §2.1 carries the same slip and is
amended alongside.)*

**Amendment.** This addendum describes the nesting as keyed "by entity," written before D1
was settled. D1-A constrains nothing about ownership: `resourcePools` nests by **owner**,
and pools with no entity owner take the reserved owner `_scenario`
(`docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md` D1-A.1). Entity ids
may not begin with `_`; reserved owners must. See also
`ADR-0054`, addendum, on why owner and scope are orthogonal.

Spec: `docs/specs/zoltar/016-m7.6-character-sheet-fidelity.md` §1.3, §2.1.

### [ADR-0033](decisions/0033-dicerequests-ids-assigned-by-the-backend-not-claude.md) — `diceRequests` IDs assigned by the backend, not Claude

An earlier design had Claude generate UUIDs for dice request entries. Claude doesn't generate UUIDs reliably. The backend assigns IDs after receiving `submit_gm_response` and returns them in the action response. Claude omits the ID field entirely.

### [ADR-0034](decisions/0034-state-snapshot-field-consolidation-deferred-to-milestone-1-2.md) — State snapshot field consolidation deferred to Milestone 1.2

The snapshot has accumulated fields across playtesting — `initialState` counters, `world_facts` scratchpad, character state, entity positions, and flags — each solving a distinct problem as it was discovered. At 1.2, when the tool schema is being locked, both sides of the read/write contract should be rationalized together: what Claude reads in the snapshot and what it writes via tools. Doing this earlier would be premature; the playtest data doesn't exist yet to inform good consolidation decisions.

### [ADR-0035](decisions/0035-flags-structure-merges-value-and-trigger-into-a-single-objec.md) — `flags` structure merges value and trigger into a single object

An earlier design kept flags and flag triggers as two parallel top-level maps in campaign state: `flags: Record<string, boolean>` and `flagTriggers: Record<string, string>`. These were merged into a single structure keyed by flag name:

```typescript
flags: Record<string, { value: boolean, trigger: string }>
```

Keeping them parallel required maintaining two maps in sync — a flag with no corresponding trigger entry was an invisible bug waiting to happen. The merged structure makes each flag self-contained. The trigger is immutable after initialization (it describes the in-fiction condition that flips the flag, which doesn't change). `stateChanges.flagTriggers` on the `submit_gm_response` write path only carries the new value (`{ flagName: newValue }`) — it does not restate the trigger.

### [ADR-0036](decisions/0036-player-resource-pools-are-derived-at-character-creation-not.md) — Player resource pools are derived at character creation, not at synthesis

Player HP and stress pools (e.g. `vasquez_hp`, `vasquez_stress`) are written into `campaign_state.data.resourcePools` at the moment the character sheet is created — not later, and not re-derived by synthesis. The derivation is a pure function in `@uv/game-systems` (`deriveMothershipCharacterResourcePools`) that maps `{ currentHp, maxHp, stress }` from the sheet onto the canonical `{entity_id}_{pool_name}` naming convention. `CharacterService.create` calls `CampaignRepository.mergePlayerResourcePools` immediately after inserting the sheet; the merge is transactional and preserves any existing pools on key conflict.

An earlier approach deferred the derivation to the synthesis write path, on the theory that state-population should happen in one place. This coupled synthesis to character-sheet internals across systems and created an ordering hazard: if synthesis ever runs before character creation (e.g. pre-generated adventures, Collaborative mode), the player pools would never exist. Doing the write at character creation makes the invariant easy to state — "once a character sheet exists, its pools exist" — and means the synthesis path only writes NPC/threat/timer pools generated by Claude. `buildResourcePools` in the synthesis write path preserves any pool keys already present, so the two writers never race each other.

**Amendment 2026-08-10 — the closing sentence was wrong, and it is how the M7.5 capture acquired two prefixes for one character**

"`buildResourcePools` … preserves any pool keys already present, so the two writers never race each other" states a real mechanism and draws a false conclusion from it. Preservation settles a **collision** — the same key written twice. The failure that actually occurred is the opposite one: the two writers spell the player's id *differently*, collide with nothing, and both spellings persist. The captured adventure carries `lt_alvarez_hp` at 20/20, pristine, beside `alvarez_hp` at 7/20 with all the damage, plus an `alvarez_armor` that no derivation produces. The safety argument in this entry is precisely what let that through.

The cause was upstream of the merge, in the prompt. `formatMothershipCharacterProse` rendered `sheet.name` and never `sheet.entityId`, so synthesis was shown "Lt. Alvarez" and nothing else and had to invent an identifier to build pool names from — and that display name derives equally well to `lt_alvarez` or `alvarez`. Character creation had already written the canonical pair under the real id. Two writers, two spellings, no collision.

Three changes close it, and the split between them is deliberate:

- **The prompt now names the id.** `formatMothershipCharacterProse` emits `Entity ID:`, and a `PLAYER CHARACTER:` section states that the player's HP and stress pools already exist and must not appear in `initialState`. This is the actual fix; the two below exist because a prompt instruction is not an invariant.
- **The synthesis write path drops impersonating keys and logs them.** A key naming a pool of a kind the player already owns, under a prefix resolving to neither the player's id nor an entity the payload declares, is dropped. It is redundant by construction, so dropping loses nothing — but it is logged, because a drop means the model re-spelled the id after being handed it, which is worth seeing before a playtest rather than after.
- **The play-time validator rejects rather than drops.** `applyResourcePool`'s bootstrap branch applies the same rule and pushes a rejection naming the valid id, so the model corrects inside the tool loop. Rejection is right here and wrong at synthesis: mid-turn there is a loop to correct in, and failing an expensive synthesis over a naming quirk is not.

**The rule is suffix-collision, not prefix-must-resolve.** A stricter "every pool prefix must name a declared entity" would reject `station_power_reserve` and `contamination_spread_timer` — legitimate scenario-level pools that attach to no entity and never will. Only a pool that duplicates a kind the player already owns is refused, which is exactly the observed defect and nothing else. The check is disabled entirely when no player ids are declared, mirroring `roll_dice`'s empty-known-set behaviour under `ADR-0046` — a campaign with no character sheet must not have every pool bootstrap rejected.

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
  (`ADR-0046`).
- The `assertNoActiveAdventure` guard on update and delete blocks only `synthesizing`,
  `ready`, and `in_progress` — sheets are editable once an adventure is `completed`,
  `aborted`, or `failed`.

**Addendum, 2026-08-15 — a standing constraint on read-side validation, recorded because
the thing that makes it safe today is deliberate and undocumented.**

M7.6 reconciled the pools with the character-creation rework and added **no** read-side
validation of `character_sheet.data`. That was a choice, and it has a tripwire attached:

**Do not add read-side validation of `character_sheet.data` without changing the harness
seed in the same change.** `harness-runner.ts:326` writes 1 of 9 required fields
deliberately, and the eval harness works only because no read path parses the sheet. A
validator added on its own turns every fixture into a seeding error, and the failure will
present as a corpus problem rather than as this.

**What M7.6 settled alongside it.** Pools nest by owner, eleven per character. The stress
pool carries the three-axis correction — seeds 2, floors at Minimum Stress by prompt
instruction, no ceiling, because the 20 cap converts overflow rather than rejecting it.
Below-`min` deltas are rejected rather than clamped, and `hp` exercises that path now that
it carries `min: 0`.

### [ADR-0037](decisions/0037-synthesis-prompts-are-system-specific-no-driver-registry-yet.md) — Synthesis prompts are system-specific; no driver registry yet

Each supported game system owns its own synthesis prompt module under `apps/zoltar-be/src/synthesis/<system>/synthesis.prompts.ts` (currently only `mothership/`). System-specific exports — system prompt, character-sheet prose formatter, synthesis user prompt, coherence check prompt, and the canonical oracle-category list — are all prefixed with the system name (`MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT`, `formatMothershipCharacterProse`, etc.) so names never falsely suggest cross-system generality. Universals — the `submit_gm_context` and `report_coherence` tool definitions and the coherence report Zod schema — live in `src/synthesis/synthesis.tools.ts` and `synthesis.schema.ts` and are imported by every system module.

A generic prompt module was rejected because oracle category counts, character sheet structure, and tonal framing all differ across systems; a single parameterized builder would either be the least common denominator or a tangle of per-system branches. A `synthesisDrivers[systemId]` registry was also considered and deferred: until a second system exists, any interface we define is a guess shaped entirely by Mothership's needs, and the second system is more likely to reveal the right abstraction than to conform to a premature one. When UVG (or the next system) lands, the registry pattern can be introduced at that moment with two concrete implementations to compare against.

### [ADR-0038](decisions/0038-m7-6-pool-and-character-state-contract-resolved-decisions.md) — M7.6 pool and character-state contract — resolved decisions

*Closing out `docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md`,
whose D1–D4 were open when it was written. The reasoning lives in the plan; what
follows is what was actually built, plus what was deliberately left out.*

**D1 — `resourcePools` nests by owner, and ownership is unconstrained.**
`resourcePools[owner][poolName]`. Most owners are entity ids; pools belonging to
no entity take the reserved owner `_scenario`. No pools move to `scenarioState`,
which has no producer at all — `submitGmContextSchema.structured` has four
members and none is `scenarioState`, and play-time writes to undeclared keys are
rejected, so no key can enter it by any path that exists. Relocating live pools
into a write-only bucket would also have moved them out of the delta stream this
milestone exists to build: no `reason`, no `maxDelta`, no `sum(deltas)` audit
property, no per-pool rejection telemetry.

**D1-A.1 — `_scenario` is reserved by its leading underscore.** Entity ids may
not begin with `_`; reserved owners must. One narrow assertion enforces it —
reject an `_`-prefixed owner that is not a known reserved owner — on both write
paths. **General identifier-format validation is still not built anywhere**, and
is on the roadmap rather than here: enforcing format across entity creation,
synthesis and the tool boundary is its own change with its own failure modes,
and `_scenario` works as a convention whether or not collisions are prevented.

**D2 — `creationChoices.adjustedStat` records the class Stat choice.** The
Android's −10 and the Scientist's +5 land on a Stat the player picks, so without
it the acceptance criterion — rolls plus class arithmetic reconcile to each
starting ceiling — cannot be computed at all. It is the missing *input* to that
audit, not a second copy of a value living elsewhere, which is the same argument
that admits `creationRolls`. The schema requires it for those two classes and
rejects it for the other two.

**D3 — `stateChanges` gains `characterState`, and its five families stay
outside the delta stream.** Six operations discriminated on `op` — conditions
add/remove, armor damage, bleeding, pending Death Save, minimum stress — because
the sheet has no write path from a turn and a Panic result granting a Condition
would otherwise have nowhere to land.

**The exclusion is the half a later reader will need, and a schema alone does
not record it.** Bleeding, minimum stress and the pending Death Save are numeric
counters that change during play; each would fit the pool mechanism and would
inherit `reason`, in-order folding and rejection telemetry for free. They were
**identified as candidates and left out, not overlooked**. Nobody has asked to
audit a bleeding counter, and building an audit path for a hypothesis is the
thing this project does not do.

Two consequences, which are the price:

- **The M7.6 re-baseline measures nothing about `characterState`.** The
  rejection telemetry is per-pool. The milestone establishes a floor for
  pool-delta behaviour and no floor at all for these five families — including
  whether the Warden writes bleeding reliably. The one exception is the
  absolute-vs-delta count, in scope precisely because prompt instruction 3 is
  where the contract is inconsistent with itself.
- **Reversal trigger, stated because "if interest is expressed" never fires:** a
  playtest produces a bleeding, minimum-stress, or armor value nobody can
  explain. That is the same shape as the Strength question that motivated
  `reason`, and it will arrive in a playtest report rather than as a feature
  request.

**D4 — rejection is all-or-nothing per turn, and the fold runs on a working
copy.** `resourcePools` entries are folded in order against a running state, so
the wounds chain is expressible. A rejected entry aborts the whole array,
`characterState` aborts with it, and nothing is applied.

**The guarantee is validate-all-then-apply, and it is stronger than the
transactional one.** `validateStateChanges` accumulates across every
`stateChanges` member and returns one pass/fail; `SessionService` throws before
`applyValidatedTurn` runs; and when a correction round succeeds it is the
correction's applied set that is used, round one's being discarded entirely. So
nothing reaches the applier on rejection and transaction atomicity never comes
into it. Recorded rather than left implicit, per
`roadmap.md § M8 — Multiplayer Foundation`, whose turn-path lock audit exists for
this reason: a guarantee that holds by accident is one refactor away from not
holding, and that item exists because exactly this went unrecorded once already.

**Still open:** whether a pool rejection should also abort `entities`, `flags`,
`scenarioState` and `worldFacts`. It does not today, and there is a test
pinning that so the behaviour is visible rather than assumed.

**Payload field name: `owner`, not `entityId`.** The plan and the spec §2.1 both
write `entityId` on the pool-change entry. Both predate D1-A's amendment from
entity-keyed to owner-keyed, and a field named `entityId` that legally holds
`_scenario` contradicts itself in the document the model reads most carefully.
`characterState` entries keep `entityId`, where it really is one.

**Deferred and worth naming: `armor_repair`.** A Patch Kit sets a vaccsuit to
AP 1 and replacement swaps the item — both are equipment operations, and
equipment has no write path in M7.6. Armor can be damaged and destroyed this
milestone, never restored.

**Addendum — D4's granularity within an `entities` entry, stated because it was read as unstated.** Recorded 2026-08-21 while drafting `docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md`, which first proposed applying the valid fields of a rejected entity change and was wrong to.

D4 settles rejection granularity *across* `stateChanges` members and says nothing about granularity *within* one entry, so `applyEntity`'s behaviour looked like an open question. It is not: **within-entry rejection is all-or-nothing by inheritance.** `validateStateChanges` returns one pass/fail, `SessionService` discards the entire `applied` set whenever `rejections` is non-empty and runs a correction round (`session.service.ts:377-406`), so applying the valid fields of a rejected entry would be unreachable code. Verified by direct call: an entity carrying a valid `visible` and an invalid `status` yields the rejection with `applied.entities` empty.

**What was genuinely wrong is reporting, not application.** `applyEntity` returned at the first invalid field without examining the rest, so a Warden told about `status`, fixing it, and failing on an unreported sibling received no second correction — the correction path is single-shot and the turn is thrown. With `status` the only rejectable field this was theoretical. Spec 019 adds `revealed` (monotonic) and `npcState` and rejects unknown ids, which makes an entry with two independently invalid fields ordinary. `applyEntity` now accumulates every field-level rejection before returning.

The distinction is worth keeping in mind wherever D4 is cited: *validate-all-then-apply* is a claim about what reaches the database, not a licence to stop validating once one thing has failed.

### [ADR-0039](decisions/0039-the-m7-6-migration-drops-and-recreates-rather-than-transform.md) — The M7.6 migration drops and recreates rather than transforming

**Confirmed 2026-08-14, built 2026-08-15.** `V19__character_sheet_m76_reset.sql`
deletes every `character_sheet` and `campaign_state` row rather than migrating
them.

Recorded here because **the migration file is disposable and this reasoning is
not.** The pre-`v0.1.0` Flyway consolidation pass collapses V1–Vn into a single
baseline and discards the file, taking its comments with it.

Three facts made the call safe: local dev was empty, the eval droplet runs only
the harness (which seeds its own rows per run), and no eval fixture carries
sheet data.

**A defensive transform could not have worked in any case.** The reduced sheet
requires `creationRolls`, and there is no way to recover what the dice showed
from a stored total — the old sheet held sums and derived values, never the
rolls. Any transform would have had to invent them.

Both tables, not just `character_sheet`: `campaign_state.data.resourcePools`
changed shape in the same milestone, and a sheet reset that left the old pools
behind leaves a campaign whose pools no reader can address.

**`schema_version` deliberately stays at 1.** There is no row to distinguish,
and a bump would make `synthesis.write.ts`'s parse reject exactly the rows this
migration removes.

### [ADR-0040](decisions/0040-armor-points-are-a-threshold-not-a-pool-the-m7-6-spec-was-wr.md) — Armor Points are a threshold, not a pool — the M7.6 spec was wrong about this

**Found during implementation, 2026-08-15.** The M7.6 spec §1.3 and the
reconciled diff §5 both state that "AP is consumed", and the implementation plan
builds `armor_damage` around AP being ground down hit by hit.

That is not the rule. `docs/rules-extraction-findings.md § S25.6`, recorded from
reading PSG p.28 directly, states it plainly: a character ignores all Damage
**less than** their AP, a single hit at or above AP destroys the armor and the
remainder lands, and **armor is never worn down across several hits.** That
finding is what corrected the Warden primer in M7.5, and the live prompt has
said so since.

The primary-source reading beats a derived spec line, so the built behaviour
follows the finding: `armor_damage` keeps the plan's `{ apDelta, destroyed }`
shape, but `destroyed` is `literal(true)` and the validator rejects an `apDelta`
that leaves AP above zero, naming the rule in the rejection. A hit below AP is
not a state change at all and must not be sent.

**Damage Reduction is the opposite in kind and is a separate field for exactly
this reason:** it applies first, and survives both armor destruction and
Anti-Armor. A single number could not express "the armor is gone but the
reduction is not", which is why `wornArmor` carries `dr` alongside `apCurrent`
and why `<character_attributes>` renders DR even at zero.

Recorded here because a reader hitting the spec first will find the opposite
claim, and because "subtract armor from each hit" is named in the S25.6 finding
as the error a Warden defaults to — the code should not make the same one.

### [ADR-0100](decisions/0100-npc-crew-role-skills.md) — Contractor NPCs get a rolled Instinct and a `crewRole`-mapped skill bonus — a Zoltar house rule, not RAW

**Status:** accepted 2026-08-20, **M7.7** — riding 018's re-baseline rather than buying one (`ADR-0094`). Schema section amended the same day against the codebase; see `§ Amendment 2026-08-20`.

## Context

Mothership's Warden's Operations Manual resolves nearly every Contractor check against a single Instinct score. That's the right abstraction for disposable mooks and crew filler, but it breaks down for a scenario-critical specialist NPC — e.g. a solo player relying on an NPC engineer to do the job a party-slot specialist PC would normally cover. Instinct is a flat, undifferentiated number; a Contractor has no way to be *especially* good at anything the way a PC is via Stat + Skill. In solo/small-group play, where an NPC specialist is often standing in for a missing party role rather than just flavor, that gap is a real party-balance problem, not just a modeling nicety.

**A second gap, found while planning 018: there is no Instinct.** `entitySchema` is `id`, `type`, `startingPosition`, `visible`, `tags` (`synthesis.schema.ts:3-15`). NPCs carry no mechanical stats at all, and the only occurrences of the word in the tree are a test fixture and a comment recording that `INST` must never be rendered for player characters (`synthesis.prompts.ts:55`). This entry cannot extend Instinct with a skill layer without first introducing Instinct.

## Decision

**Instinct.** Every `npc`-type entity gets an Instinct score, **rolled** — `2d10 + 25 + role adjustment`, the same shape as a player Stat (`character-pools.ts:22-24`). The dice are stored as they fell; the `+25` and the adjustment are arithmetic applied at derivation, stored nowhere.

Rolled rather than assigned from `crewRole` for two reasons. **The mapping has to be total over `npc` entities and `crewRole` is not** — most NPCs carry a role, but a frightened passenger or a corporate observer is still an `npc` and still needs an Instinct, so assignment would need a default for the uncovered cases anyway. And **assignment gives two pilots on the same ship identical Instinct**, which is the flatness this entry exists to fix, reintroduced one level up.

**`npc` is the carrier, and it is the whole of it.** There is no Contractor type in the schema and none is being added: `entitySchema`'s enum stays `npc | threat | feature`, and "Contractor-type NPC" throughout this entry means `type: 'npc'`. `threat` entities have no Instinct score and do not gain one here; `feature` entities are not actors at all.

**The backend rolls it, not Claude.** `SYNTHESIS_TOOLS` is `[SUBMIT_GM_CONTEXT_TOOL]` (`synthesis.tools.ts:23`) — synthesis has no `roll_dice`. A number Claude puts in the payload is not a roll, it is a fabrication, and it is unauditable in exactly the way the dice-request infrastructure exists to prevent. Claude declares the NPC and its role; the backend rolls at synthesis-write time via `executeDiceRoll`, already used server-side by `DiceService` (`dice.service.ts:43`).

**Skills.** A Contractor-type NPC may carry a `crewRole`, drawn from a fixed enum of 20 roles (below). Each role maps, via a static lookup table, to an ordered Mothership skill chain — Trained → Expert → Master, following each skill's real prerequisite chain per the PSG v1.2 skill tree. When the Warden calls for a check that falls within one of a Contractor's mapped skills' domain, the check resolves as **Instinct + that skill tier's bonus** (+10 / +15 / +20, standard Mothership tiers — holding a higher tier implies holding, and being able to use, the tiers below it). A check outside any mapped skill's domain resolves as Instinct alone, per RAW.

This is **always-on** for the initial build — every Contractor is eligible for a `crewRole`, no RAW-strict/Instinct-only toggle yet.

### Role → skill mapping

| Crew Role          | Skill Chain (Trained → Expert → Master)                              |
|--------------------|----------------------------------------------------------------------|
| Captain            | Zero-G → Piloting → Command                                          |
| Cargo Handler      | Zero-G; Athletics                                                    |
| Chief Engineer     | Industrial Equipment → Mechanical Repair → Engineering; Jury-Rigging |
| Comms Officer      | Computers → Hacking                                                  |
| Corporate Liaison  | Linguistics → Psychology; Computers                                  |
| Counselor          | Linguistics → Psychology                                             |
| Doctor             | Zoology → Field Medicine → Surgery                                   |
| Engineer           | Industrial Equipment → Mechanical Repair → Engineering               |
| Executive Officer  | Zero-G → Piloting → Command                                          |
| Geologist          | Geology → Asteroid Mining                                            |
| Life Support Tech  | Industrial Equipment; Botany → Ecology                               |
| Machinist/Mechanic | Jury-Rigging → Mechanical Repair                                     |
| Medic              | Zoology → Field Medicine                                             |
| Miner              | Geology → Asteroid Mining; Zero-G                                    |
| Navigator          | Zero-G → Piloting → Hyperspace                                       |
| Pilot              | Zero-G → Piloting                                                    |
| Scientist          | Mathematics → Physics                                                |
| Security Chief     | Military Training → Firearms → Command                               |
| Security Officer   | Military Training → Firearms                                         |
| Xenobiologist      | Zoology → Pathology → Exobiology                                     |

Chief Engineer and Doctor (the senior half of each senior/junior pair) get the full three-tier chain; Engineer and Medic get the same chain truncated at Expert. Security Chief/Officer mirror this pattern via Command.

### Role → Instinct adjustment

**These numbers are invented, extrapolated from the Contractors rules rather than read out of them.** That is the same footing as the skill layer above, and it is deliberate — see `§ Deviation from RAW`. Nothing here should be cited as a PSG or WOM figure.

`BASE` is **25**, matching a player Stat's `2d10 + 25` (`character-pools.ts:22-23`). Adjustment is by seniority tier rather than per role: twenty bespoke numbers would be twenty separate inventions, while three tiers reuse the senior/junior structure already implicit in the skill table above, where Chief Engineer/Engineer, Doctor/Medic and Security Chief/Security Officer are already paired.

| Tier | Roles | Adjustment |
|---|---|---|
| Senior | Captain, Executive Officer, Chief Engineer, Doctor, Security Chief | **+15** |
| Skilled | Pilot, Navigator, Engineer, Medic, Scientist, Geologist, Xenobiologist, Comms Officer, Corporate Liaison, Counselor, Machinist/Mechanic, Life Support Tech | **+10** |
| Unskilled | Miner, Cargo Handler | **+5** |
| *(no `crewRole`)* | — | **+0** |

The `+0` row is deliberately distinct from Unskilled rather than merged into it. Miner and Cargo Handler are *roles* that happen to need no specialist training; a role-less NPC — a frightened passenger, a corporate observer — is not crew at all and is undifferentiated rather than unskilled.

**Most `npc` entities carry a role**, so the tier adjustment is the common path and `+0` is the exception. What varies per adventure is which *roles* are filled, not whether NPCs have them: a given ship uses a handful of the twenty, and the rest simply never appear.

## Schema

**Amended 2026-08-20.** The original section placed `crewRole` in `initial_state` as a sibling of `instinct`. Neither exists; see `§ Amendment 2026-08-20` for why that location would have failed silently.

`instinct` and `crewRole` live on the **entity record** — the per-entity structure that already exists and is already persisted per entity (`entitySchema` in `synthesis.schema.ts`, `EntitySchema` in campaign state). `crewRole` is Zod-enum-validated.

```typescript
// submit_gm_context, structured.entities[]
{
  id: string,
  type: 'npc' | 'threat' | 'feature',
  visible: boolean,
  tags: string[],
  instinctRoll?: number[],   // dice as they fell; backend-written, never Claude-written
  crewRole?: CrewRole        // most npc entities carry one; optional because some NPCs are not crew
}

type CrewRole =
  | 'captain' | 'executive_officer' | 'pilot' | 'navigator'
  | 'chief_engineer' | 'engineer' | 'machinist_mechanic' | 'life_support_tech'
  | 'doctor' | 'medic'
  | 'scientist' | 'geologist' | 'miner' | 'xenobiologist'
  | 'comms_officer' | 'corporate_liaison' | 'counselor'
  | 'security_chief' | 'security_officer'
  | 'cargo_handler'
```

### Store the role; never store the chain it implies

The skill chain is **derived at read time and persisted nowhere.** `crewRole` is the input; the chain is arithmetic over it. Storing both would repeat the duplication M7.6 removed: `maxHp` was a stored copy of a derived ceiling — "one fact in two places, free to diverge, and it did" (`character-sheet.schema.ts:38-43`).

The same rule puts the Instinct *roll* on the opposite side, and consistently so: a roll is an input nothing can recompute, so the dice are stored exactly as `creationRolls` stores a PC's. `BASE` and the role adjustment are derived and stored nowhere.

**Player and Contractor skills share a reader, not a storage location.** A PC's skills are stored in `characterState.skills` because a player *chose* them and nothing can recompute a choice; a Contractor's are derived. One accessor returns `MothershipSkillEntry[]` for either, so `MOTHERSHIP_SKILL_BONUS`, the snapshot render, and `loss_of_confidence` each have one implementation. `loss_of_confidence` then works on Contractors for free.

### The condition deriving carries

Deriving at read time means an edit to the role table changes what the Warden sees **for frozen eval fixtures whose files did not change**. `corpusVersion` is a content hash over fixture files, so it does not move — the corpus looks identical and is not. That is the gap `assemblyHash` exists to close (`ADR-0099`), and `ASSEMBLY_PROBE`'s own rule already covers it: "a section this probe never populates is a section whose shape the hash cannot see" (`session.assembly.ts:48-50`).

`probe_npc_one` today is `{ id, type: 'npc', visible: true, tags: ['crew'] }` (`session.assembly.ts:74`) — no role, no Instinct. **Both of these are required before the derivation ships**, not optional:

1. `ASSEMBLY_PROBE` carries a Contractor with a `crewRole` and an Instinct roll.
2. The whole role table folds into the hash — a golden rendering all 20 role → chain mappings. One probe NPC gives partial coverage only: with a `pilot` in the probe, editing `xenobiologist` still moves nothing.

Without both, a table edit is an input-affecting change that moves no run identity at all.

### Seeding

`characterState` is seeded only by `CharacterService.create`, for the player; synthesis writes none (`campaign.repository.ts:165`). Rolling Instinct adds a stored per-NPC field, so NPC seeding at synthesis-write time is required work, not something a pure-derivation design could have skipped.

**Rejected:** a free-text `crew_role:*` tag inside the generic `tags` array. A near-miss string (`crew_role:field_medic` vs. the enum's `medic`) wouldn't error — it would silently fail to match the lookup table, and the NPC would quietly revert to Instinct-only with nothing surfaced. An enum-validated field rejects a bad value at the schema boundary instead of failing silently at resolution time.

## Prompt instructions — two separate surfaces

- **Synthesis** (`submit_gm_context`): give a `crewRole` to any NPC who is crew, which is most of them. The optionality runs the other way from a checklist — **never invent an NPC to cover an unfilled role.** A given ship uses a handful of the twenty and the rest simply do not appear; an NPC exists for narrative reasons first and takes whichever role fits. Leave `crewRole` unset for an NPC who is not crew at all. **Never supply `instinctRoll`** — the backend rolls it.
- **Play** (Warden prompt / `submit_gm_response`): when resolving a Contractor's check, look up `crewRole`'s mapped chain; if the check falls in a mapped skill's domain, add that skill's tier bonus to Instinct; otherwise roll Instinct alone.

The Warden must not be expected to hold the 20-row table in memory — the derived skills and tiers render into the state snapshot, the same argument the Wounds Table instructions make ("YOU DO NOT KNOW THE WOUNDS TABLE FROM MEMORY", `mothership-m7.txt:304`). Today the snapshot renders no skills for anyone, player included, so that render is new work.

Both halves change Warden-visible behavior and should ship together, on a re-baseline already scheduled rather than one bought for this alone (`ADR-0094`).

## Deviation from RAW

**Everything mechanical in this entry is invented.** It is built *from* the Contractors rules by extrapolation, not applied *from* them. Three separate deviations, listed so none of them can later be mistaken for a lookup:

1. **The skill layer.** PSG Contractors resolve on Instinct alone; the 20-role table and its tier bonuses have no source.
2. **Rolling Instinct.** The book assigns Contractor Instinct by role; rolling it `2d10 + 25` borrows the player Stat shape instead.
3. **The seniority adjustment.** +15 / +10 / +5 / +0 is a scheme of this entry's own devising.

Keep this entry, and any documentation derived from it, explicitly labeled as a Zoltar house rule. The failure mode this guards against is specific and cheap to fall into: a later reader lifting `2d10 + 25` or a tier bonus into player-facing text as though it were sourced, the way `INST` was once rendered for player characters until M7.6 removed it (`synthesis.prompts.ts:55`).

## Rejected alternatives

- **Assigning Instinct from `crewRole`** — the mapping is not total (a non-crew NPC has no role but still needs an Instinct), and it would give every pilot on a ship the same number, reintroducing at the role level exactly the flatness this entry exists to fix.
- **Letting Claude supply Instinct at synthesis** — synthesis has no `roll_dice`, so the number would be fabricated and unauditable.
- **Storing the derived skill chain** — see `§ Store the role`. Also costs a re-key of every Contractor-carrying fixture on a table edit, M7.6's D5 again.
- **Placing `crewRole` in `initial_state`** — see `§ Amendment 2026-08-20`.
- **Full PC-equivalent stat block for specialist NPCs** — disproportionate for a hireling; would require a second character-sheet-shaped schema path for what's still meant to be a disposable role.
- **Free-text role tag** — see Schema above.
- **Toggleable RAW-strict mode** — deferred, not rejected. Revisit if playtesting shows demand for a harsher, Instinct-only variant.

## Amendment 2026-08-20 — why the original schema location does not exist

Found while planning `docs/specs/zoltar/018-post-playtest-character-creation-and-mechanics.md`. Three findings, in increasing order of severity:

1. **There is no `entities[].initial_state`.** `initialState` is a *sibling* of `entities` under `structured` (`synthesis.schema.ts:36`), and it is a flat map keyed by the two-part pool address `{owner}.{poolName}` whose values are `{current, max}` pools (`synthesis.prompts.ts:125`). It is not a per-entity object and has never held per-entity attributes.

2. **There is no `instinct` field to be a sibling of.** See `§ Context`.

3. **The chosen location has the exact failure mode this entry rejects the free-text tag for.** `synthesis.write.ts:43` records that non-pool entries in `initialState` are silently skipped at merge time. A `crew_role` string there would pass Zod (`z.unknown()`), pass `validateSubmitGmContextForWrite`, and then be **dropped with no error** — the NPC reverting to Instinct-only with nothing surfaced. That is this entry's own argument against the tag, arriving through a different door.

## Resolved

*All 2026-08-20.*

- **Milestone placement: M7.7**, both halves together, per the M7.6 precedent that schema changes and prompt instructions ship together. It does not wait for M8.1 and it does not split schema-early / prompt-later. `ADR-0094` is satisfied without buying a run: 018 already owes a re-baseline for three other Warden-visible changes, and this rides it. The cost is the one 018 § Ordering already accepts — four Warden-visible changes on one run means no honest per-change delta, so predictions go in writing before the run (`ADR-0085`).
- **`BASE` is 25 and the tier adjustments are +15 / +10 / +5 / +0**, all invented rather than sourced (`§ Role → Instinct adjustment`).
- **`npc` is the only type that rolls Instinct**; `threat` does not, and no new enum value is added (`§ Decision`).

### [ADR-0103](decisions/0103-entity-merge-preserves-schema-fields.md) — Entity merge preserves all schema fields rather than a hand-enumerated set

## Context

`session.validator.ts:861-882` builds the merged entity record for every
`stateChanges.entities` write. The merged object is a fresh literal with a closed,
hand-enumerated field list:

```ts
const merged: {
  visible: boolean;
  revealed: boolean;
  status: EntityStatus;
  npcState?: string;
} = {
  visible: change.visible ?? existing.visible,
  revealed: change.revealed ?? existing.revealed,
  status: proposedStatus ?? existing.status,
};

const nextNpcState = change.npcState ?? existing.npcState;
if (nextNpcState !== undefined) merged.npcState = nextNpcState;

result.applied.entities[entityId] = merged;
```

The merge-from-prior-state logic is present and correct — each field reads
`change ?? existing` — but it operates only on the four fields the literal names.
Any other field on the entity record is absent from `merged` and is therefore
absent from `applied.entities`, and the TypeScript annotation declares those fields
out of existence rather than surfacing their omission.

`ADR-0100` (shipped 2026-08-21 as 018 Parts 9–10) introduced the first entity fields
that only synthesis writes and the Warden never proposes: `crewRole` and
`instinctRoll`. These are *authored-only* fields — the play loop has no path to set
them and no reason to, so they never appear in a `change` object and were never added
to the literal.

The consequence is that **any `entities` write naming an entity destroys every field
on that entity outside the enumerated four**, permanently, with no error and no log
entry.

### Evidence

Observed in adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b` (playtest 2026-08-24,
52 turns). `mara_odinsen` was authored at synthesis with
`{crewRole: "cargo_handler", instinctRoll: [5,5]}`. Both fields rendered correctly to
the Warden through turn 18 — the `<entities>` block showed `instinct 40, role
cargo_handler, skills Zero-G trained (+10), Athletics trained (+10)`, and both numbers
reconcile against `crew-roles.ts`.

The adventure contains exactly four entity writes: seq 30, 66, 99, 122. Seq 99
(turn 31) names `mara_odinsen` with an empty delta; the record emerges as
`{status, visible, revealed}` and both authored fields are gone. Turns 32–52 ran with a
statless Mara.

Seq 122 (turn 38) is the decisive case. The Warden proposed a *partial* delta —
`npcState` only — and the validator emitted the same four fields. Had a guard rejected
the empty delta at seq 99, the authored fields would have survived seven further turns
and been destroyed at seq 122 instead. The defect is not specific to empty deltas.

Independent confirmation without reference to the code: `crewRole` and `instinctRoll`
appear in **zero rows** of the adventure's `game_event` log — not in any proposal, not
in any applied payload. The output shape cannot carry them.

### The applier is not the cause

The loss was initially attributed to `session.applier.ts:47`
(`entities: { ...prior, ...applied.entities }`) and its documented replace-outright
semantics. That attribution is wrong. The fields are absent from `applied.entities`
before the applier runs; line 47 delivers faithfully what the validator produced. The
rationale at `session.applier.ts:37-42` — that array-valued operations cannot be
diffed without re-deriving the fold — stands and is not revisited here.

### This is the second instance of the same defect

`npcState` was added to the merge literal in M7.6 for this exact reason, and carries a
comment recording it as "schema-defined, commented and preserved on merge since M7.6."
The class has bitten before and was closed one field at a time. Under the standing
principle of deferring generalization until a second concrete case justifies it, the
second case has now occurred.

## Decision

The merged entity record is seeded from the prior record, overlaid with the validated
fields, and parsed through `EntitySchema` before being written to
`result.applied.entities`.

```ts
const merged = EntitySchema.parse({
  ...existing,
  visible: change.visible ?? existing.visible,
  revealed: change.revealed ?? existing.revealed,
  status: proposedStatus ?? existing.status,
  ...(nextNpcState !== undefined ? { npcState: nextNpcState } : {}),
});
```

Preservation becomes the default. A field added to `EntitySchema` survives entity
writes without anyone remembering this call site. The `EntitySchema.parse` is
load-bearing and not decoration: spreading `existing` alone would also preserve fields
that have been *removed* from the schema, indefinitely and invisibly. Parsing converts
that into a validation failure at the write, which is the same reasoning that types
`structuralCheckers` as `Record<StructuralTag, ...>` so a missing entry is a
compile-time error rather than a silent runtime `undefined`.

The fix is forward-only. Records already stripped are not restored by it.

## Alternatives considered

**Reject or ignore empty entity deltas.** The narrow fix, and the one the initial
applier-centric diagnosis suggested. Rejected on evidence: seq 122 demonstrates that a
partial delta destroys the same fields, so the guard relocates the bug rather than
closing it. Would have moved the observed loss from turn 31 to turn 38 and left the
class live.

**Add `crewRole` and `instinctRoll` to the merge literal.** Matches existing style and
is the same patch `npcState` received in M7.6. Rejected because it is the third
application of a one-field-at-a-time remedy to a defect whose shape is now clear, and
it leaves every future `EntitySchema` field a live landmine until someone recalls this
literal exists. The M7.6 precedent is the argument against repeating it, not for.

**Deep-merge in the applier.** Rejected on two grounds: it addresses the wrong file,
and `session.applier.ts:37-42` gives a sound reason why generic deep merge is unsafe
for array-valued operations.

## Consequences

**Warden-visible.** Preserved fields render into the `<entities>` block, so the fix
changes the Warden's input. Under the alpha code-freeze rule it is a cohort boundary
requiring explicit tagging, and it is an input-affecting change for eval purposes —
it belongs in the same re-baseline batch as any fixtures captured alongside it.

**Regression coverage must span both shapes.** A test asserting only the empty-delta
case would pass against the rejected narrow fix. Cover: empty delta preserves authored
fields; partial delta preserves authored fields; complete delta still overwrites the
validated four. Seq 99 and seq 122 supply concrete inputs and expected outputs for the
first two.

**Not an eval fixture.** The turn 31 / turn 32 pair is deterministic — fixed input,
fixed expected output, no Warden in the loop — and belongs in unit tests beside the
fix. Placing it in the eval corpus would spend Warden budget re-proving what a unit
test asserts for free.

**Replay is affected.** `reconstructStateAsOfTurn` folds `state_update` payloads
through `applyValidatedTurn`, so the validator sits in the capture path as well as the
harness path. Fixtures captured from folds that cross an entity write may resolve
differently before and after the fix. See open item 1.

## Open items

1. **Fix-invariance of the pending captures has not been established.** Clean capture
   candidates from the 2026-08-24 playtest (turns 19, 29, the 1/8/9/14 geography
   sequence, and the 20/21 retcon pair) fold at most seq 30 and seq 66, both writes to
   `falsified_maintenance_logs`. That entity carries neither `crewRole` nor
   `instinctRoll`, so those two fields are not at stake. But the relocated diagnosis
   puts *every* non-enumerated `EntitySchema` field at stake, not just those two, so
   invariance now depends on the full schema field list rather than on `ADR-0100`'s
   pair. Confirm that the four non-Mara entities carry no field outside
   `{status, visible, revealed, npcState}` at synthesis before treating the captures as
   fix-invariant.

   **Resolved 2026-08-27 (M7.7), and by a stronger route than this item asked for.**
   The check as written passes: at synthesis `cryo_bay_feature`,
   `falsified_maintenance_logs`, `hull_breach_cascade` and `parasitic_organism` carry
   exactly `{status, visible, revealed}` — nothing outside the enumerated set, and no
   `npcState` yet. But the decisive fact is about the *writes* rather than the records.
   The adventure contains four committed entity writes in total: seq 30 and seq 66
   (`falsified_maintenance_logs`) and seq 99 and seq 122 (`mara_odinsen`). Every write
   below seq 99 targets an entity with nothing non-enumerated to lose, so a capture
   folding only below it is fix-invariant whatever the full schema field list turns out
   to be. The five fixtures taken from this adventure — turns 8 (seq 22), 14 (seq 40),
   15 (seq 43), 21 (seq 64) and 29 (seq 90) — all qualify.

   **The two writes where the fields are at stake are seq 99 and seq 122**, which is
   the turn 31/32 pair this entry already names as its diagnosis and consigns to unit
   tests rather than the corpus. A capture folding past seq 99 re-opens the question and
   should not be taken before the fix lands.

   **The fix has not landed**, and this resolution does not depend on it having landed.
   The merge in `session.validator.ts` is still the closed literal
   `{visible, revealed, status, npcState?}`. `mara_odinsen`'s `crewRole` and
   `instinctRoll` survive in the captured fixtures because nothing wrote her below
   seq 99 — not because the merge preserves them.

2. **There is no way to remove a field from an entity record, and this decision makes
   that consequential.** The inability predates this ADR: `change.x ?? existing.x`
   treats an omitted value and an explicit `null` identically as "no opinion," so
   deletion is already inexpressible. For the three non-optional fields this is moot.
   For `npcState` it is a real gap — once set, it can be overwritten but never cleared,
   and the closest approximation is an empty string.

   What changes is the visibility of the gap. Under copy-by-list, a field that should
   no longer be present is indistinguishable from one that was silently dropped, because
   both are simply absent. Under preserve-by-default, a stale field persists and is
   observable. That is the better failure, but it means the question stops being
   hypothetical the first time a field genuinely needs removing.

   **No mechanism now**, per the standing principle of deferring generalization: no
   current entity field requires deletion. `crewRole` and `instinctRoll` are
   authored-once and must never be removed — preserving them is the entire point of
   this ADR — and `npcState` is overwrite-in-place by nature. There is not yet a first
   case, let alone a second.

   **When one arrives, the shape is already established.** `characterState.rollModifiers`
   uses explicit add/remove operations rather than inferring intent from payload
   presence (`session.validator.ts:471-496`), and that is the precedent to follow.

   **Explicitly rejected in advance: a sentinel value.** Treating `null` or `""` as
   "delete" would require `null` to mean "no opinion" on some fields and "remove" on
   others, and would make "the Warden omitted this" indistinguishable from "the Warden
   wants this gone." That ambiguity is the precise shape of the defect this ADR exists
   to close, and reintroducing it one field over would be a regression in reasoning even
   where it happened to work.

3. **`capture-fixture` cannot emit `playerEntityIds`, and the harness treats its
   absence as `[]`.** *(Resolved 2026-08-27 (M7.7) — see below.)*
   `reconstructStateAsOfTurn` returns `gmContextBlob` from the synthesis snapshot,
   where the field is never persisted; `harness-runner.ts:179`
   reads it and resolves empty, which — per the comment in `seedScratchAdventure` —
   silently disables `actingEntityId` validation and grades a code path production does
   not take. All 21 existing fixtures carry hand-added values. This is a tooling defect
   reproducing on every capture, not a discipline lapse, and it is the mechanism behind
   the voided 2026-08-20 re-baseline. Two changes: `capture-fixture` should derive and
   emit the field from `character_sheet.data->>'entityId'` as
   `session.service.ts:280` already does, and `harness-runner` should fail loudly on an
   empty resolution rather than proceed. Tracked separately from this ADR.

   **Resolved 2026-08-27 (M7.7).** Both changes landed, and they close different
   populations rather than the same one twice. `capture-fixture` derives the field
   from `character_sheet.data.entityId` — joined through the adventure's campaign,
   ordered by `user_id` so a frozen file's canonical-first ordering does not depend
   on the planner — and refuses the capture outright when the answer is empty, since
   writing `[]` is what produced the defect. That closes the production side: no new
   capture can arrive without it. It cannot reach the corpus that already exists,
   which is hand-authored and hand-edited, so `seedScratchAdventure` now also rejects
   a fixture declaring none, as a precondition before any row is written. All 21
   fixtures already carry values, so the guard changes no current run.

   Two details worth keeping. **Aliases stay a hand-edit**: derivation yields the
   canonical id only, because the second id in `['alvarez', 'lt_alvarez']` exists for
   the checker's leniency toward old artifacts and has no counterpart in
   `character_sheet`. And the seeding path **had no test coverage at all** before
   this, which is a fair part of why one editing slip became a voided re-baseline
   nobody could see from the report; it has some now.

4. **`gm_context_blob.entities` and `campaign_state.data->'entities'` disagree at
   synthesis.** The duplicate copy carries `crewRole` for `mara_odinsen` but not
   `instinctRoll`. Rendering reads `campaign_state`, so `ADR-0100` verified end-to-end
   only because the complete copy is the one consumed. The synthesis write path
   populates the two copies inconsistently, and a divergent duplicate of the same
   record is the shape M7.6 was meant to have eliminated. Separate defect; separate
   entry.

5. **`ADR-0100` status.** Verified end-to-end in the negative direction only — turns 15
   and 18 show the Warden correctly declining to apply Zero-G/Athletics out of domain,
   and both the Instinct arithmetic and the role→skill mapping reconcile against
   `crew-roles.ts`. The positive direction — an in-domain check where the tier bonus
   appears in the roll target — remains unexercised by any turn or fixture.

---

## Claude Integration — Turn Loop & Correction

### [ADR-0041](decisions/0041-correction-loop-bounded-at-one-re-prompt.md) — Correction loop bounded at one re-prompt

When Claude's proposed state changes fail validation, the backend re-prompts once with a structured `tool_result` describing the rejections and waits for a corrected `submit_gm_response`. If that second response also fails validation, the turn aborts with 502 and the entire turn transaction rolls back — leaving only the player-message row that was persisted before the Claude call. Not two retries, not a budget — a hard cap at one re-prompt.

The cost of a correction round is one extra Claude API call on a path that should be rare in practice; compounding two rounds doubles that cost and masks the real problem, which is either a bug in the validator rules or a model that needs prompt work. Playtest evidence should drive validator tuning and prompt revision, not a larger retry budget. If the cap proves too aggressive, loosen it only after identifying a specific class of rejection that a second retry would have fixed without just papering over a validator-or-prompt bug.

### [ADR-0042](decisions/0042-the-correction-loop-does-not-re-enter-the-inner-tool-loop.md) — The correction loop does not re-enter the inner tool loop

M7 introduces an inner tool-use loop in `SessionService.sendMessage`: Claude may call `roll_dice` and `rules_lookup` any number of times before issuing `submit_gm_response`. When the M6 validator subsequently rejects the proposed `stateChanges`, the correction pass re-prompts Claude with `tool_choice: { type: 'tool', name: 'submit_gm_response' }` — explicitly narrowing away from `{ type: 'any' }` — so the correction cannot invoke additional tools. The rejection is handed to Claude as a `tool_result { is_error: true }` and Claude must resubmit directly.

Rationale: dice and rules retrieval are inputs to Claude's reasoning. By the time `submit_gm_response` arrives, those tools have already done their work against the live fiction. If the proposed state changes are invalid, the fix is narrative (restate the same fiction with a valid delta), not mechanical (re-roll). Letting the correction path re-invoke `roll_dice` would also make dice-outcome manipulation possible ("that wasn't the result I wanted, reroll until validation passes") — a principle violation that's easy to avoid by construction.

Implementation: `buildCorrectionRequest` in `session.correction.ts` hardcodes `toolChoice: { type: 'tool', name: 'submit_gm_response' }` in its return, overriding whatever was on the original request. The unit test `session.correction.spec.ts` asserts this override explicitly.

### [ADR-0043](decisions/0043-rules-lookup-calls-are-captured-in-adventure-telemetry-paylo.md) — `rules_lookup` calls are captured in `adventure_telemetry.payload.rulesLookups`, not in `game_events`

Every `roll_dice` call writes a `dice_roll` row to `game_events` — dice are mechanically consequential, part of the turn's audit trail, and rolls (like player actions and GM responses) carry sequence numbers so the full turn can be replayed from the event log.

`rules_lookup` calls are different in kind. They are metadata about how Claude arrived at a ruling, not state changes. The player is not entitled to see every query the Warden made; the tool is a reasoning aid. Recording lookups in `game_events` would (a) pollute the player-visible event stream with Warden internals, (b) require inventing a "lookup" actor_type / payload shape for data that never affects state, and (c) couple the lookup-telemetry schema to the game_events sequence-number contract for no operational benefit.

Instead, `rulesLookups: RulesLookupRecord[]` lives in `adventure_telemetry.payload` alongside the turn's prompt snapshot, Claude request/response metadata, and validator output. Playtest review tooling (M7.1) reads from that row and can surface lookups — including empty-result ones, which are the primary signal for M7.2 ingestion prioritization — without touching the event log.

The record carries `query`, `limit`, `resultCount`, `topSimilarity`, and `sources` (citation strings). Full chunk text is deliberately omitted: re-running the query at review time reproduces the chunks deterministically until the index is re-ingested, and storing them inline would bloat the telemetry JSONB without marginal benefit. If Phase 2 review surfaces a need for full-text capture, a `texts: string[]` field can be added.

### [ADR-0044](decisions/0044-agentic-graph-decomposition-stays-deferred-dice-arbitration.md) — Agentic graph decomposition stays deferred; dice-arbitration evidence weakens the case without closing it

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

### [ADR-0045](decisions/0045-rolltype-gatedbyrollid-actingentityid-on-roll-dice-stay-defe.md) — `rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice` stay deferred, but they are measurement infrastructure

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

- `gatedByRollId` — `out-of-order-resolution` now decides the in-turn case by comparing a named gate's sequence number against the roll naming it. See `ADR-0079` above for the three sub-cases and for the deferred-gate residual this does *not* close.
- `actingEntityId` — `system-rolled-player-action` attributes without reading `purpose`. This was the last prose dependency in the structural checks; on post-M7.5 output there is none left. **The first integration of this field was defective and shipped a false pass — see the entry immediately below, which is a correction to this bullet, not a footnote on it.**
- `rollType` — **no measurement role, and none was invented for it.** The entry above claims all three were "the precondition for knowing whether a fix is needed"; that was true of the other two and never of this one. Checked during M7.5 planning: it appears in `docs/specs/zoltar/011-eval-harness-multi-run.md § Part 6` only as a *hypothetical example* of a field some future check might need, is absent from the M7.4 spec entirely, and the two bullets above give it no job. It ships as a descriptive enum (`check` / `save` / `damage` / `panic_check` / `table` / `other`) read by no checker — telemetry and a reporting axis. The justification is this entry's own economics rather than a requirement: the re-baseline was being bought anyway, and discovering a use for it later would have meant buying another.

The prose paths are kept rather than deleted, and every consumer branches on field **presence** rather than on `fixtureSchemaVersion` — `eval:rescore` re-grades frozen `88fa84bd8329` artifacts that predate the fields, and version-gating would have been the obvious mechanism and the wrong one, since the fixture version records what `capture-fixture` captured and it captures no game events at all. **No `FIXTURE_SCHEMA_VERSION` bump was needed**, and no migration: `dice_roll` payloads are `jsonb`.

**Provenance note.** During M7.2 implementation planning this conclusion was briefly reversed — a plan document recorded "resolved with Alex: the fields do not ride along, a third baseline gets paid for separately" — and instructed that this entry be rewritten to match. That rewrite never happened here. The reversal was itself reversed during M7.5 spec review: the fields land with M7.5's re-baseline, per the original reasoning above, which was correct throughout. Noted so the now-stale reasoning in that plan document isn't mistaken for a second, independent decision.

### [ADR-0046](decisions/0046-actingentityid-must-resolve-against-a-declared-identifier-se.md) — `actingEntityId` must resolve against a declared identifier set, and an unresolvable id is undecided

M7.5's first integration of `actingEntityId` compared it against `applicability.playerEntity` for equality. The field carries an entity **id** (`lt_alvarez`); `playerEntity` carries a display **name** (`Alvarez`). Nothing ever matched, and because "no roll belongs to the player" is `system-rolled-player-action`'s PASS condition, the check did not report *less* — it inverted. It graded ten violations clean, including a rep whose payload reads `system_generated` / `lt_alvarez` / `"Alvarez Combat Check to shoot contractor alpha"`. Full account in `docs/rules-extraction-findings.md § S30`.

Three rules come out of it, and they generalise past this field.

**An identifier comparison must name both namespaces.** The bug was not a typo; it was comparing two things that had never been the same kind of thing, in a codebase whose own convention (`ADR-0032`) makes ids and display names visibly distinct. `rollActsFor` now takes an explicit `AttributionContext` carrying `playerEntityIds`, `knownEntityIds`, and the display name for the legacy prose path, so the comparison cannot be written without stating which set is being consulted.

**A resolution failure is a third state, not a negative answer.** `rollActsFor` returns `'player' | 'other' | 'unknown'`. An id matching neither the declared player set nor the fixture's seeded entities is `'unknown'` — `NOT_APPLICABLE`, excluded from the denominator, never a pass. This is the same discipline as "Structural checks report undecided rather than guessing" above, applied to structured data rather than prose: the shipped bug's mechanism was a resolution failure silently collapsing into `'other'`. It is load-bearing, not defensive — Sonnet 4.6 emitted resource *pool* names in this field 13 times across one run.

**The runtime enforces one canonical id; the checker tolerates aliases.** `roll_dice` rejects an `actingEntityId` naming no known entity, modelled on the existing dangling-`gatedByRollId` rejection, with the valid ids named so the model corrects in-loop — and **skipped entirely when the known set is empty**, because `getPlayerEntityIds` reads `character_sheet` and a campaign without one would otherwise have every player roll rejected. The checker deliberately resolves against *every* declared id, because it also grades frozen artifacts from runs predating the validation that legitimately used an alias. The asymmetry is intentional and mirrors the prose fallback for pre-M7.5 payloads.

**Root cause, and what is still open.** The Warden is never told the player's entity id: `campaign_state.entities` holds NPCs, threats and features only, `gmContextBlob.playerEntityIds` exists for exactly this but is fed from a `character_sheet` table with zero rows, and `renderEntities` only *un-hides* ids already in the entities map — it is a filter override, not a source. So the model infers an id from resource pool names, which in the captured adventure carry two prefixes for one character. Seeding fixtures closes this for the eval; **the product path is not closed**, and rendering player entities into `<entities>` from `playerEntityIds` remains the real fix.

**Why the tests did not catch it.** All 60 structural specs passed throughout, because they pair `actingEntityId: 'alvarez'` with `playerEntity: 'Alvarez'` — the one id form that collides with the display name under `toLowerCase()`. The specs were written from the same misunderstanding as the implementation and were therefore not independent evidence. Regression tests now use the real captured id forms, taken from run artifacts rather than authored alongside the code.

**Amendment 2026-08-10 — the product path is closed; `<entities>` is a source now**

"Rendering player entities into `<entities>` from `playerEntityIds` remains the real fix" is done. `renderEntities` emits every declared player id whether or not `campaign_state.data.entities` carries it — which in practice is all of them, since that map holds NPCs, threats and features only — tagged `player_character` and listed first, so the canonical spelling is the first thing the block states. An id absent from the map reports `status=unknown`, the same value `buildEntityMap` gives every synthesized entity and the honest one here: nothing recorded a status. Live HP stays in `<resource_pools>`.

This changes the state snapshot and therefore the Warden prompt, so it invalidates `c45a142a` as a comparison point and forces a re-baseline. Tracked in `docs/eval-methodology.md § Current baseline N`.

**Two things the original paragraph got wrong, worth separating from what it got right.**

The diagnosis was right: the model had no id to read and inferred one from pool names. But the paragraph attributes the ambiguity it inferred *from* to a `character_sheet` table with zero rows, and that is the eval's condition, not the defect's cause. The duplicate prefixes were minted at synthesis time by a prompt that showed the model a display name and no `entityId` — they would have appeared in a campaign with a perfectly good sheet, because character creation writes `{entityId}_hp` while synthesis independently invents its own prefix. Zero rows explains why `playerEntityIds` was empty; it does not explain why the pools disagreed. That half is closed separately under `ADR-0036`, and the two fixes are independent: this one stops the Warden inferring an id, that one stops the state offering two to infer from.

The claim that seeding fixtures "closes this for the eval" also understates what the harness already does. `seedScratchAdventure` seeds exactly one `character_sheet` row from the *first* declared id, and `SessionService` overwrites the seeded blob's `playerEntityIds` with the repository's answer — so a fixture declaring `['lt_alvarez', 'alvarez']` has always resolved to one id at run time. The two-id declaration is read only by the checker, deliberately, per "the checker tolerates aliases" above. Fixtures therefore need no cleanup for this change to be safe; what they still carry is the duplicate *pools*, which is a separate open question about seeded state.

### [ADR-0097](decisions/0097-a-schema-valid-submit-gm-response-is-not-necessarily-well-fo.md) — A schema-valid `submit_gm_response` is not necessarily well-formed

`playerText` is the only required field on `submitGmResponseSchema`. A response carrying nothing else validates cleanly, so a payload whose remaining parameters were serialized as *text inside the narration* is indistinguishable, to every consumer downstream of the Zod parse, from a turn that genuinely had no state changes. The turn commits, the markup reaches the player, and `stateChanges` / `gmUpdates` / `diceRequests` are discarded — with no rejection, no correction event, and no log line. There was no discard point to instrument: nothing in the code believed anything had gone wrong.

The 2026-08-16 playtest applied state changes on 3 of 58 turns. On 39 it shipped raw tool-call markup inside `playerText` and dropped the payload. The anti-correlation is perfect across all 58 — every turn carrying markup applied nothing, and the discarded payloads were not junk: turn 52 lost an HP delta of −12, a carryover reset with `maxDelta: 0`, and `characterState: [{op: "death_save_pending", entityId: "dr_kennedy", roundsRemaining: 2}]`, all of it mechanically correct.

**The defect is model-side, and the extraction path was never at fault.** The API returned a well-formed `tool_use` block whose only parameter was `playerText`. One response — eval rep `008/turn24-hidden-info-leak` on the `ccac7d1c` re-baseline — carried the markup inside `playerText` *and* a correctly structured `gmUpdates` parameter in the same tool call, which rules out a parameter-boundary parse failure: the parser demonstrably closed the parameter and parsed a subsequent real one. What the model did was write the tag as content.

**It tracks the model, not the prompt, and predates the playtest by two and a half weeks.** Across every eval run on disk, `claude-sonnet-4-6` leaked 0 of 245 outputs and `claude-sonnet-5` 48 of 916 (~5%), spanning all four prompt hashes since 2026-07-29. Prompt `0bdd1306` gives a same-fixture head-to-head: 4.6 at 0/106, Sonnet 5 at 12/150. Under a 5% rate, 0-of-245 has probability ~2×10⁻⁶. `mothership-m7.txt` contains no tool-call examples to imitate, so prompt-induced mimicry is not the seed.

**The playtest's 67% is amplification of that ~5%, not a second defect.** Leaked `playerText` is persisted to `message` verbatim and replayed as assistant history on the next turn, where the model imitates it. Turn 12 leaked with zero contaminated messages in window — the spontaneous seed — and the rate thereafter tracks in-window contamination density (8% at turn 13, 44% at turn 23, 87–100% from turn 42) rather than prompt tokens, which is why turn 13 leaked at 6,952 tokens while turn 50 stayed clean at 15,799. Any single-turn measurement of this defect will read ~5% and understate what a long session does with it.

## Reject and retry, rather than fail the turn

`ADR-0041` caps the correction loop at one re-prompt on the reasoning that a larger retry budget masks a validator-or-prompt bug. This guard retries and does not violate that, because the two are rejecting different things. `ADR-0041` governs *semantic* rejection — the Warden proposed a delta the validator disagrees with — where a second attempt papers over a real disagreement. This is *structural* malformation: the model computed the right payload and put it in the wrong place. Turn 52 is the proof. Retrying recovers a correct answer rather than negotiating for a different one, and there is no outcome to launder, because the guard reads no game state.

So the inner tool loop hands back an error `tool_result` naming the failure and the corrective action, and re-enters — the same machinery a malformed payload already uses, bounded by the same `INNER_TOOL_LOOP_CAP`. A turn that never recovers exhausts the cap and 502s, which is loud. The correction pass throws instead: it is single-shot by construction (`ADR-0042`), so there is nowhere to retry to, and applying a response whose state changes were serialized into prose is worse than failing.

The alternative — flag and pass through — was rejected outright. The whole defect is that a broken payload was indistinguishable from a valid one; preserving that indistinguishability while adding a log entry keeps the data loss and merely annotates it.

## Structural matching, not a semantic classifier

The detector (`apps/zoltar-be/src/session/session.tool-syntax.ts`) matches literal markup only: the canonical tool-call element names as whole tags, plus a tag built from each **top-level property name on the schema itself**. Deriving that half from `submitGmResponseSchema.shape` rather than listing it by hand is what stops the token set and the tool drifting apart when a field is added — a hand-maintained list would go stale silently, in a detector whose entire job is catching things that fail silently.

A "looks like internals" heuristic was rejected. It would be non-deterministic against narration, and this check sits on the path of every turn: a false positive costs a real player a real turn. Deterministic matching also makes the check re-runnable against frozen artifacts, which is what lets the eval harness reuse it (`ADR-0096`) rather than reimplement it — `eval/` already imports from `src/`, so the shared boundary is a wrapper, not a port.

Validated against every playtest turn and every eval `gm_response` on disk — 1,228 real responses — at 87 true positives and 1,141 true negatives, with zero false positives and zero false negatives.

## Only `playerText` is scanned

`gmUpdates.notes` is Warden-private reasoning where naming schema fields is legitimate and frequent — turn 52's notes discuss `resourcePools` and `characterState` by name at length, correctly. Scanning it would trade the real signal for false positives on the field most likely to produce them. The accepted consequence is that markup leaking into `notes` alone goes undetected; it is not player-visible and it does not discard state.

## What this does not claim

The guard catches the symptom. It does not stop the model emitting the markup, and it does not reduce the ~5% base rate — it converts those turns from silent data loss into an extra tool-loop iteration. Expect `toolLoopIterations` to rise slightly and `UNAUDITABLE-MAPPING` applicability to rise with it, since state changes that previously vanished now land; both are the defect clearing, not a regression.

Mitigating the emission is Warden-visible and needs a re-baseline, so it is deferred to M8.1's backlog under `ADR-0085` unless the retry rate proves unacceptable in practice. Nothing here was measured against a model other than the two named above, and the Haiku 4.5 control arm's 9 outputs are far too few to say whether it exhibits the defect at all.

The detector cannot see a leak that uses markup it does not know — a differently-shaped fabricated tag would pass. That is the accepted cost of matching on structure instead of guessing at intent, and the schema-derived half of the token set is what keeps the known surface from shrinking as the tool grows.

**Addendum — the emission mitigation landed rather than being deferred, and the harness can now see the failure.** Recorded 2026-08-17, the same day, on the decision to put it in front of the next playtest rather than behind M8.1's backlog.

The paragraph above routed the Warden-visible half to M8.1 under `ADR-0085` on the grounds that it needs a re-baseline. That reasoning was sound and the scheduling premise it rested on was wrong: a re-baseline was already owed and already being run by hand, so the prompt change rides it at no additional Warden spend, and shipping the guard alone would have meant playtesting a known ~5% emission rate with a recovery path instead of a reduced one. `ADR-0094`'s rule is not to pay twice; batching onto a run already scheduled is the shape it prescribes.

`mothership-m7.txt` gains a `WHAT GOES IN playerText` block under `TOOLS`, and the prompt hash moves **`ccac7d1c` → `d8791e8d`** — Warden-visible, so `eval:compare` across that boundary is meaningless in the usual way. Two of its three paragraphs state the rule and its consequence; the third is the one carrying the load, and it exists only because of the amplification finding above: it tells the Warden that earlier turns in its own conversation may show narration ending in that markup, and that it is the defect rather than a format to copy. A prompt that only forbade emitting the markup would leave the contamination loop intact, since the model is imitating what it was shown rather than inventing it.

The guard is unchanged and stays. Prompt work reduces a rate; it does not make a rate zero, and the failure mode is silent data loss — the case for a deterministic backstop is unaffected by how well the prompt performs.

On the eval side, `TOOL-SYNTAX-LEAK` is registered as a **universal** check rather than the tag-independent one anticipated when this work was scoped: `applicability`'s `applies: true` branch requires a `playerEntity` the check has no use for, and `capture-fixture`'s fail-closed stub would ship it switched off on every new capture. See `ADR-0098`. The check imports this entry's detector rather than restating its token set.

**The number to expect.** Re-scoring the frozen `ccac7d1c` baseline would put `TOOL-SYNTAX-LEAK` at 4 failures in 150 (~2.7%) — the four occurrences already identified in that run's artifacts, every one of which the existing checks scored `pass` or `not_applicable`. That is the pre-mitigation figure for the tag, available without a Warden run, though not without judge spend: `eval:rescore` re-grades every check on every row, judged ones included.

**Addendum 2 — the prompt block did not work and has been removed; the mitigation moved to the tool schema.** Recorded 2026-08-18. Supersedes the paragraph in Addendum 1 describing the `WHAT GOES IN playerText` block and the `d8791e8d` prompt hash.

The block shipped on 2026-08-17 and did not reduce the emission rate. It is deleted, and `mothership-m7.txt` is back to **`ccac7d1c`** byte-for-byte — the same prompt the last baseline ran, which makes the tool schema the only Warden-visible change going into the next run.

**Adding a fourth statement to the prompt would have been volume, not signal.** `mothership-m7.txt` is ~19 KB and already forbade this in three places; stacking emphasis is the pattern that produces over-application rather than compliance. What the investigation had not checked was whether the model was being told anything *at the point where it generates the parameter* — and it was not. Dumping the generated `input_schema` showed all five top-level properties of `submit_gm_response` carrying **no description at all**:

```
playerText       *** NO DESCRIPTION ***
stateChanges     *** NO DESCRIPTION ***
gmUpdates        *** NO DESCRIPTION ***
diceRequests     *** NO DESCRIPTION ***
adventureMode    *** NO DESCRIPTION ***
```

All fourteen descriptions in the 6.4 KB schema were nested under `stateChanges` — the `resourcePools` and `characterState` fields M7.6 added. The model's entire view of the field it was leaking into was `"playerText": { "type": "string" }`. That is a gap, not a volume problem, which is why the same instruction is expected to behave differently here than it did in the prompt.

The five properties now carry descriptions (via `.describe()` in `session.schema.ts`, which `zodToJsonSchema` carries into the tool definition; schema 6,402 → 8,126 bytes, 14 → 19 descriptions). **The boundary statement appears once**, in `playerText`'s own description, rather than repeated on all five — four copies of one prohibition is the repetition-as-reinforcement pattern that the prompt block already failed with. The other four state their content plainly and let the contrast carry it; `stateChanges` closes with "a change described only in the narration is a change that did not happen."

**Two costs worth knowing.** Tool definitions render at position 0 of the cached prefix, ahead of both system blocks, so editing them invalidates every breakpoint — where a prompt edit keeps the tools cache. One extra prefix write per conversation, which for a fresh playtest adventure is nothing. And a tool-schema change is Warden-visible while leaving `promptHash` untouched, so two runs with materially different tool definitions would carry identical run identities. That gap is what `ADR-0099` closes.

**Addendum 3 — the retry does not work, and the turn is now abandoned after one.** Recorded 2026-08-18 on the evidence of the re-baseline run `claude-sonnet-5__ccac7d1c__2026-08-18T11-48-47Z`. Supersedes the retry reasoning in the body of this entry.

The body argued for handing the rejection back and re-entering the loop, on the grounds that Claude recovers from a malformed payload that way (the 2026-07-14 precedent) and that recovering a turn beats failing it. The first half of that is now falsified for this failure mode. On `turn24-scene-jump` rep 9 the same leaked payload came back **ten consecutive times** — the whole remaining loop budget — and the turn died on cap exhaustion regardless. Ten model calls at 13k+ prompt tokens each to reach the outcome the second call already predicted. Once Claude enters this mode within a turn, it stays there.

So `TOOL_SYNTAX_RETRY_BUDGET` is **1**: one rejection is handed back, a second consecutive leak throws `SessionToolSyntaxError` (502 `gm_tool_syntax_unrecoverable`). That is the number `ADR-0041` already argues for on the correction loop, and the argument transfers intact — more attempts hide the failure rather than fixing it.

**A separate error class rather than reusing `SessionToolLoopError`.** Both end at 502, and they mean opposite things: the loop error means Claude was still working and ran out of room, this one means it finished the same wrong way twice. Under one code, a genuinely stuck combat turn and an unrecoverable formatting failure are indistinguishable in the logs, and the operator response to each differs.

**Failing here also decouples the two budgets, which matters more than it looks.** Riding `INNER_TOOL_LOOP_CAP` meant the retries available depended on how much legitimate work the turn had already done — the rep-9 turn had spent ten iterations on rolls and lookups before the first leak, so it got ten retries where a quiet turn would have got nineteen. A busy turn getting *fewer* attempts to recover is backwards, and the count is now independent of what came before it.

The counter is consecutive rather than cumulative, resetting on a submit that fails some other way, so a turn alternating between a malformed payload and a leaked one still gets a fresh budget for each mode.

**What the run says about the emission itself, stated carefully.** `TOOL-SYNTAX-LEAK` read 1.00 across 149 graded turns, and an independent scan of every `warden-output.json` with the original oracle regex found zero markup in 149 outputs — the guard did its job completely, and nothing reached a player or committed silently. But the check reads 1.00 partly *because* the one occurrence became an `error` row: a turn that never produces a `gm_response` leaves the denominator, so the rate is computed over the turns that survived the behaviour being measured. The honest figure is **emission 4/150 → 1/150**, suggestive at p≈0.09 rather than the clean sweep that would have settled it. The property descriptions look like a real improvement; they are not shown to have eliminated the emission, and this tag now belongs on `ADR-0082`'s list of rates to distrust at 1.00 for a reason of its own.

This fix changes recovery, not what the Warden reads: `promptHash` stays `ccac7d1c` and `assemblyHash` stays `0bb41002`, so the run's numbers remain valid and the next run is comparable to it.

---

## Claude Integration — Continuity & Spatial

### [ADR-0047](decisions/0047-phase-1-spatial-consistency-is-prose-based-not-structured.md) — Phase 1 spatial consistency is prose-based, not structured

The `grid_cell` and `grid_entity` tables exist and are migrated, but no generation pipeline populates them and no runtime system queries them. Phase 1 spatial consistency — making sure the ship layout stays coherent across turns — is handled by `worldFacts` entries authored by Claude during synthesis and maintained during play. The Warden prompt directs Claude to record the location's overall layout in `worldFacts` at synthesis time and to consult and extend those entries when narrating spatial relationships.

This matches how Mothership is designed to play: theater-of-the-mind, where the fiction is the map. It also matches the mechanism already validated in Playtest 3 for the same class of problem (corridor lengths, named spatial attributes) — the existing scratchpad generalizes cleanly to "overall layout" as one more first-mention detail that must stay consistent.

A structured map model — generated room graphs, cell grids, LOS computation — is a significant engineering investment with no playtest evidence that it's needed. Deferring it keeps M5 unblocked and avoids building against imagined rather than observed failure modes. The grid tables remain migrated but unused; they cost nothing to leave in place, and the `map_geometry` stub reservation still stands.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for spatial-consistency failures — contradictory room connections, forgotten deck assignments, layout drift across long sessions. If prose-based layout holds up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for a real spatial system, to be built with evidence rather than speculation. The M5 roadmap entry is updated accordingly: LOS computation service is removed, and the state snapshot builder's "no entity positions" note no longer points to a pending spec.

### [ADR-0048](decisions/0048-phase-1-continuity-is-carried-by-cached-gm-context-and-worki.md) — Phase 1 continuity is carried by cached GM context and working-memory fields, not a rolling summary

The original M5 design included a rolling summary stored in `adventures.rolling_summary`, lazily generated at adventure resume to carry continuity across messages that age out of the rolling window. Dropped from M5 pending playtest evidence that the gap exists.

The cached GM context — which in Solo Blind mode accumulates auto-promoted canon as play progresses — plus `npcStates` and `worldFacts` in `campaign_state.data` already cover most of what the summary was specified to capture. The design doc's summarization guidance ("prioritize uncanonized improvised fiction, NPC behavior, lies told, relationships formed, specific physical details") maps almost entirely onto what the canon queue and the working-memory fields already preserve. The summary's unique contribution is narrow: narrative texture and sequence that didn't produce discrete canonizable facts, only relevant in adventures long enough that the message window can no longer hold the arc.

Shipping the summary now would add a second Claude call per resume, a new column for cutoff tracking, and a prompt that can't be tuned without evidence. Observing whether Phase 1 play actually suffers from narrative-continuity loss without the summary is a cheaper first step than engineering against a failure mode that may not occur.

The `adventure.rolling_summary` column from M1 remains in the schema and stays null through Phase 1. If the gap surfaces in playtest — contradictions about fiction that aged out of the window, forgotten relationships or lies, sequence errors across long adventures — the rolling summary can be added as its own milestone, likely alongside campaign canon promotion tooling in Phase 2 where the related "what persists across adventures" questions already need answering.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for narrative-continuity failures of the specific kind the summary was designed to prevent. If the cached GM context plus working-memory fields hold up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for the summary, to be built with evidence rather than speculation.

### [ADR-0049](decisions/0049-the-character-attributes-snapshot-block-is-specified-but-def.md) — The `<character_attributes>` snapshot block is specified but deferred until a data source exists

The M5 spec, the design doc's state-snapshot section, and the M5 roadmap bullet all reference a `<character_attributes>` block — persistent qualitative character state (armor mode, weapon loadout, active conditions) emitted in the per-turn snapshot. The M5 snapshot builder has no source to populate this block from: `MothershipCampaignState` carries no `characterAttributes` field, synthesis does not write one, and the Mothership character sheet shape (`equipment: string[]`, `saves.armor: number`) does not cleanly separate armor from loadout or carry conditions. The block is omitted in M5 per the spec's "omit an entire block if its source is empty or missing" rule.

This is not a question of whether the concept is right — it clearly is, and the design doc describes it correctly. The question is *what writes it*. Populating the block requires either a schema addition plus a synthesis write path, or a derivation from character-sheet data that would require extending the character-sheet shape to separate armor/loadout/conditions. Neither is load-bearing for M5's goal of closing the outer GM turn loop; all mechanically critical state lives in resource pools, entities, flags, and world facts.

The block becomes genuinely useful when the game engine starts reading armor/conditions mechanically — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor). Reactivate at the milestone that first needs the data. At that point the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now.

The three doc references stand unchanged — they describe the intended end state. The M5 snapshot builder simply does not render this block. When the data source lands, the builder is a two-line addition (one render function, one call site) following the same pattern as the other blocks.

**Amendment — the deferral scope was too broad; static build data was never blocked**

This entry conflated two different claims under one deferral: the qualitative `characterAttributes` block (armor mode, loadout, conditions), which genuinely lacks a data source, and character-sheet *build* data — stats, saves — which does not. `character_sheets.data` already carries `Strength`/`Speed`/`Intellect`/`Combat` and the saves as structured fields, populated at character creation (see `ADR-0036`), and rendering them into the snapshot requires no schema addition and no synthesis write path — only a render function and a call site, the same shape already anticipated above for the qualitative block.

"Reactivate at the milestone that first needs the data" was the intended trigger, and for this narrower slice it already fired: Phase 1 has no rule evaluator, so Claude adjudicates every stat check itself, and without these fields in the snapshot its only source for the check target is the player stating their own stat in the action text — the system asking the player for data the system already has. That gap has existed since M6/M7 started resolving checks, not from some future milestone.

Scheduled for M8.1. The qualitative block — armor mode, loadout, conditions — remains deferred exactly as described above; it is the part that actually needs new schema and a character-sheet shape extension to separate armor/loadout/conditions.

**Amendment — the deferral is over; both slices move to M7.6, and the blocker was never independent**

Superseding the two paragraphs above: the qualitative block is no longer deferred, and neither slice is scheduled for M8.1. Both now sit in **M7.6 — Character Sheet Fidelity**, ahead of the playtest.

The reasoning that closed the deferral is that its blocker was never a standalone problem. This entry describes the obstacle as a character-sheet shape that "does not cleanly separate armor from loadout or carry conditions" — and correcting that shape is exactly the goal of the character-creation rework already carried on the kanban board, which reworks the application-level sheet data structures and plausibly the table shape with them. So the "schema addition and character-sheet shape extension" this block has been waiting on since M5 is not a future batch to be scheduled against; it is work already committed to for independent reasons. Grouping them makes the block's dependency explicit instead of leaving it as an open-ended wait.

This also lets the entry's own closing instruction be followed literally. It asks that "the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now" — impossible under the M8.1 scheduling, whose charter is prompt-only and which would have forced the render and the schema into different milestones. M7.6 owns schema, so all three land together.

Two corrections to the amendment above, for the record. Its trigger analysis was right about the narrow slice and stopped short: **the qualitative block's trigger had also already fired.** "Reactivate at the milestone that first needs the data — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor)" names two milestones that have both shipped. The block was not waiting on a trigger; the trigger fired and nothing was watching. And the claim that the static slice needs "no schema addition" holds only against today's sheet — once the rework moves the stats/saves fields, that render reads whatever shape it settles, which is why M7.6 orders the rework first and the two renders after.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.

### [ADR-0050](decisions/0050-message-ordering-relies-on-createdat-only-no-shared-sequence.md) — Message ordering relies on `createdAt` only; no shared sequence key with `game_events`

The `messages` table has no `sequence_number` column, unlike `game_events`. Reconstruction and message-window ordering (`buildMessageWindow`) rely purely on `createdAt` timestamps. Player and GM messages for the same turn are not written in the same transaction — the player message commits first, in its own transaction, before the GM call runs (intentionally, so a retry can reproduce the player's action) — so there is no transactional guarantee of ordering either, only the practical guarantee that a player's message is always written before the GM's response to it.

This is adequate today and is not being changed. The current production shape — a single backend instance, self-hosted, solo async play with human-paced turns seconds-to-minutes apart — has essentially no exposure to ordering ambiguity: Postgres timestamp precision is far finer than the gap between any two real messages, and there is only one clock in play.

Two conditions would change that:

- **Multi-instance deployment** (Phase 3+ SaaS, per the stateless-scaling design), if `createdAt` values are ever assigned application-side (each Node process reading its own clock) rather than DB-side. Cross-instance clock skew becomes a live vector for inverted ordering only once there's more than one clock generating timestamps.
- **Synchronous multiplayer with tight timing** (Phase 2 — Ably, live typing preview, initiative-mode combat), where sub-second sequencing might actually matter for narrative correctness in a way solo async play never surfaces.

Deferred under uncertainty, consistent with the project's general bias against fixing failure modes that haven't been observed. Revisit — adding a per-adventure sequence key to `messages`, mirroring `game_events`' existing `(adventureId, sequenceNumber)` pattern — if or when multi-instance deployment or synchronous multiplayer work begins, rather than before.

### [ADR-0101](decisions/0101-visible-is-line-of-sight-not-discovery-only-position-is-stru.md) — `visible` is line of sight, not discovery — only position is structurally withheld

**Confirmed 2026-08-21.** `docs/hidden-information-findings.md` recorded an unplanned M7.7 finding and left five open questions, the first of which — *is the resource-pool leak a defect, or is the design doc's claim too strong?* — was framed as a binary. It resolves to neither. **`visible` is overloaded**, and once the two concepts inside it are separated, the leak stops being a leak and four of the five questions close with it.

**`visible` means line of sight, and line of sight is transient and bidirectional.** The design doc's own example is a goblin that ducks behind a column: it was visible, now it is not, and it can be visible again next turn. That is a per-moment fact about what a player character can currently perceive. **What the playtest actually used the field for was discovery** — `signal_source_entity` sat `visible: false` for all 58 turns as a marker that the mystery had not been solved yet, which is a monotonic narrative gate and a different thing entirely. Under line-of-sight semantics that entity should have flipped `true` when Dr. Kennedy entered its chamber and `false` again on leaving.

**The field is described nowhere, so both readings were available and the model picked one.** `visible` is a bare `z.boolean()` in the synthesis schema (`synthesis.schema.ts:25`) and a bare `z.boolean().optional()` in `submit_gm_response` (`session.schema.ts:275`); neither carries a `.describe()`, `mothership-m7.txt` never mentions visibility, and no synthesis prompt does either. Every model that reads or writes the field is inferring its meaning from the word. This is the shape `ADR-0097` addendum 2 named on the top-level response properties — an absent description is a gap, not brevity.

**The synthesis model reconstructed the missing concept in the flags namespace.** The playtest campaign carries `secret_signal_origin_revealed: false` and `secret_cut_corners_revealed: true` alongside `signal_source_entity.visible: false`. It modelled discovery *and* perception, and the entity schema had a slot for only one, so discovery leaked into flags. A schema that makes its writers invent the same field twice is describing a shape it does not have.

**Decision, in three parts.**

- **`visible` is line of sight.** Transient, bidirectional, Warden-authored, meaningful only about entities a player character could perceive right now.
- **A new `revealed` field carries discovery**, and it is monotonic — `false` to `true` and never back. Entity-scoped secrets live here; narrative secrets with no entity (`secret_cut_corners_revealed` is about a denied parts requisition, not a thing on the ship) stay flags. The two are complementary, not a migration of one into the other.
- **The whole entity map is emitted to the Warden every turn, `visible` and `revealed` included.** `renderEntities`' visibility filter (`session.snapshot.ts:309`) is removed.

**Removing that filter discloses far less than it appears to, because the structural mechanism was already not operating.** `formatGmContextBlob` (`session.prompt.ts:52`) emits every entity in the GM context blob — hidden ones tagged `starts hidden` in as many words — into the first cached system block on every turn, ahead of the state snapshot. The entity's existence, id, type and tags are already in the prompt, along with a `hidden_truth` line carrying the mystery in prose. The only genuinely new information the removal adds is **the current value of the flag**, which is precisely what a Warden adjudicating line of sight cannot work without: to decide whether the goblin steps out of the shadow it has to know the goblin is in one.

**The design doc is amended rather than the code.** `docs/zoltar-design-doc.md § The Hidden Layer` (line 263) claims *"The goblin isn't in the prompt."* That is too strong about the entity's **existence** and exactly right about its **position**. The amended claim is narrower and survives contact with the code: an entity's existence, identity and state are GM context, withheld **behaviourally**; an entity's **position** is withheld **structurally**. The two-mechanism model stands — the boundary between the mechanisms moves.

**Structural secrecy is narrowed, not abandoned, and the narrowing is deliberately forward-looking.** No renderer emits grid position and the M7 snapshot has no spatial block at all, so today the structural half is vacuous. It stops being vacuous when the 2D renderer ships: `grid_entity` already carries its own `visible` column, written at synthesis by `buildGridEntityRows` (`synthesis.write.ts:300`), and filtering position rows by line of sight is where structural secrecy will actually live. Stating the decision as "entity data is always visible" without this scoping would foreclose that.

**Four of the five open questions in `hidden-information-findings.md` close as consequences, not as separate calls.** (2) — where does a pool filter belong — is moot, because there is no filter. (4) — the other unfiltered renderers — is answered: they are correct, and were never wrong. (5) — does the fixture corpus need re-capture — resolves to **no**, which is the most valuable consequence: the four fixtures freezing a hidden entity's pools are freezing correct behaviour, and no `corpusVersion` bump or re-scoring is owed. (3) was answered by measurement on 2026-08-21 and is recorded in that document.

**Two costs, both accepted.**

- **A re-baseline.** `visible` gaining a description, `revealed` appearing, and `<entities>` changing shape are all Warden-visible, so `assemblyHash` and `promptHash` both move (`ADR-0099`). This does not buy its own run: it batches, per `ADR-0094`. It was the natural occupant of the tool-schema batch M8.1 deferred to twice and never allocated; M7.7 paid for it instead.
- **`applyEntity` reports only the first bad field on an entity, and there is one correction shot.** A failed `status` returns before any other field is examined (`session.validator.ts:613-621`). This is *not* data loss — `ADR-0038 § D4`'s validate-all-then-apply guarantee discards the whole `applied` set whenever any rejection exists, and `SessionService` runs a correction round rather than committing a partial turn — but it does mean a Warden that fixes the reported problem can fail on an unreported sibling, and the correction path is single-shot, so the turn is then thrown. Adding `revealed` makes a second rejectable field on the same entity, which is what turns this from theoretical into likely.

**Scheduled into M7.7**, against the open bullet this finding already had there. M8.1 was the wrong home twice over — it is prompt-only by its own preamble, and the tool-schema batch it defers to has never been allocated. M7.7 is already paying for a re-baseline and already owns the playtest this was found in. The spec at `docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md` carries the work.

**Addendum, 2026-08-21 — `gmUpdates.npcStates` destroys the agenda it merges into, and that is why `npcState` must exist on the entity.** The two are *not* the same concept under two names. `narrative.npcAgendas` holds durable authored motivation; `gmUpdates.npcStates` holds volatile per-turn disposition; and `session.applier.ts:57` merges the second over the first, keyed by entity id, silently. In the 2026-08-16 playtest the cartographer's synthesized agenda — *"withholding what they know out of guilt and fear of being blamed — they will only reveal it if pushed hard or if the situation becomes lethal enough that silence is worse than confession"* — was overwritten by *"Panic check passed (rolled 15 vs stress ~4) … shaken, voice thin, but still functional."* The conditions governing the NPC's central secret were replaced by a mood note, and every subsequent turn read the mood note under an `npc_agendas:` heading. Nine of 58 turns wrote `npcStates`. The original survives only in `adventure_synthesis_snapshots`. This makes the entity-scoped `npcState` field load-bearing rather than tidy: disposition needs a home that is not the agenda.

**Addendum, 2026-08-25 — the structural half was vacuous for *grid* position and not for
*narrative* position, and the entry did not distinguish them.**

This entry narrowed structural secrecy to position and then observed that *"no renderer
emits grid position and the M7 snapshot has no spatial block at all, so today the
structural half is vacuous."* Every clause of that is still true of the grid.
`grid_entity` holds five rows for the 2026-08-24 playtest campaign, all `z=0`, all
synthesis-assigned, Danny among the absent — player entities never enter that map — and
nothing reads any of it into the prompt. The 2D renderer remains the thing that makes
grid position load-bearing, exactly as scoped.

**What the entry did not anticipate is that Phase 1 already has a spatial model, and it
is vertical, narrative, and load-bearing without a grid.** A three-deck ship with a
single ladder shaft is a topology. The Warden narrates movement through it every turn,
and in the 2026-08-24 playtest (adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b`, 52
turns) it got that movement wrong five times. "Vacuous" was read off the absence of a
grid; what it should have been read off is whether any position reasoning was occurring
at all. It was.

**The errors are two kinds, and conflating them points the fix at the smaller half.**

*Destination-deck errors* — three instances — are failures to recall which deck a named
place is on. Turn 8: Danny leaves the bridge, stated in the same paragraph, then climbs
*down to the deck below* and arrives at the engineering records terminal, which
`worldFacts.ship_layout` places on the upper deck aft of the bridge. Turn 14: from that
same terminal alcove, *past mid-deck and on toward the lower deck* to Mara's berth;
berths are mid. Turn 19: *back down to the lower deck* to Mara's hatch, two messages
after correctly treating the cryo bay as above the lower deck. These need no position
term. The layout was in the prompt — `ship_layout` renders verbatim in all 52 snapshots,
`ladder shaft` and all — and the lookup failed against it.

*Distance-computation errors* — two instances — genuinely require position and layout
together. Turn 21 places the cryo bay *two decks from here* and the bridge *two decks
up* in one sentence; both cannot hold from one spot. Turn 28 puts the cryo bay *two decks
away* from a scene explicitly set in the mess hall, which is the same deck.

**The first kind manufactures the false premises the second kind then reasons from
correctly.** Turn 21 was narrated from Mara's berth — which turn 14 had wrongly placed
on the lower deck seven turns earlier. From the lower deck, *bridge two decks up* is
right. The distance arithmetic was sound; the position it operated on was a fiction the
Warden had authored itself and never recorded. That ordering matters for the fix: the
lookup failures are upstream.

**Why the lookups fail is form, not absence.** `ship_layout` is a single ~700-character
prose run carrying roughly fifteen spatial facts with no deck list and no adjacency
structure, so answering "how many decks from the mess to the cryo bay" means re-parsing
that paragraph on every turn. The errors cluster on the mid deck, which is the middle
clause of the sentence. **Eviction is not the explanation for this class** — turns 8 and
14 are early, and turn 19's error sits two messages after the same turn got the adjacent
geometry right. It compounds the second class, where it is real: messages total 95.7 KB
against a 40 KB window, prompt tokens plateau near 13.1k from turn 28 on, and
`rolling_summary` is never read, so current deck is recoverable only by reading back
through narration that is being dropped.

**One field actively misleads.** `gm_context.narrative.location` ships in the cached
system block every turn as a scenario-level descriptor fixed at synthesis — *"The colony
transport ESV Halbrecht, three weeks out from the nearest relay beacon…"*. It occupies
the slot a reader checks for *where are we* and answers *what is this scenario about*.
An absent field would be less misleading than this one. Renaming it (`scenario_premise`
or similar) is nearly free and should not wait for the rest.

**Fix ordering, and one correction to the obvious fix.** Restructuring `ship_layout`
from prose into a deck-indexed list comes first: no schema change, no snapshot section,
no write path, and it addresses the larger error class and the upstream one. Adding a
`current_location` the Warden writes through `stateChanges` — `scenarioState` is `{}`
today and already in the snapshot pipeline — comes second, **but not for the reason it
first appears.** The Warden authors that field, and no independent position source
exists to validate it against, so at turn 14 it would have written *lower deck* and
every subsequent turn would have read that back as authoritative. A wrong value in a
structured field is worse than a wrong sentence in prose, because everything downstream
treats structured fields as trustworthy — the same failure shape as a Warden supplying
its own Instinct score. The field is still worth having, and what it buys is
**auditability**: position becomes a visible value in the event log rather than an
inference from narration, and a wrong one becomes a gradeable defect.

**Consequence for the checker taxonomy.** The destination-deck class is judge-gradeable
today — a named place, a claimed deck, and `ship_layout` as ground truth in the fixture —
and becomes substantially more tractable once the layout is a lookup rather than a
paragraph. The distance class is not gradeable at all, because the position term does not
exist in state. It is a clean instance of the third structural-checker category: a
question that would be structural if the tool schema recorded an additional field. The
interim answer is `not_applicable` naming `current_location`, and if that field ships the
tag converts from judged to structural — the first worked example of that category
resolving in the direction it was defined for.

**What this does not change.** `visible` as line of sight, `revealed` as monotonic
discovery, the removal of `renderEntities`' filter, and the conclusion that no fixture
needed re-capture all stand. The two-mechanism model stands. What moves is the claim that
the structural half is presently vacuous: it is vacuous for the grid, and it was never
vacuous for the vertical topology Phase 1 has been narrating since M1.

---

## API & Data Model

### [ADR-0051](decisions/0051-narrative-and-dice-result-submissions-are-separate-endpoints.md) — Narrative and dice-result submissions are separate endpoints, not a discriminated union under `POST /actions`

Earlier drafts of `docs/api.md` specified a single `POST /api/v1/campaigns/:id/adventures/:id/actions` endpoint with a discriminated-union request body: `{ type: 'narrative', content } | { type: 'diceResult', requestId, notation, results, source }`. The M7 implementation ships two separate endpoints instead: `POST /messages` for narrative turns and `POST /dice-results` for dice submissions. `docs/api.md` has been updated to match what actually ships; this entry records why.

The two operations turned out to diverge on every substantive axis — different Claude-invocation behaviour (narrative always calls, dice only when `autoAdvance` resolves the last pending request), different response shapes (turn payload vs. resolution metadata with an optional nested turn), different failure modes (`dice_pending` vs. `dice_request_conflict` / `dice_result_invalid`), different resource semantics (a GM turn vs. a resolution of a specific `dice_request`). A discriminated union would reconcile the request bodies but not the responses; the FE still branches on `type` to know what to render, so the union is ceremony rather than simplification.

Two endpoints with distinct error codes also self-document failure modes better than one endpoint with a union of error shapes. The controller already shares the turn-error translator (`translateTurnError`) and the `SendMessageResult → TurnPayload` serializer (`serializeTurn`) across both paths, so there is no duplication to amortize by merging the URLs.

The tradeoff accepted here: if M8 adds further player actions (caller transfer, advance initiative), those will live at their own nouns (`/caller`, `/initiative`, etc.) rather than being bundled under `/actions`. This is acceptable — the surface area stays small per endpoint, each gets its own test file and failure taxonomy, and the alternative (growing a union-typed action endpoint) would accumulate branch complexity inside one handler faster than it accumulates URL count. Revisit if the endpoint list becomes genuinely unwieldy (> 8–10 player-action endpoints) or if M8's caller/initiative work surfaces tight coupling that a unified endpoint would simplify.

### [ADR-0052](decisions/0052-campaign-canon-is-separate-from-adventure-canon.md) — Campaign canon is separate from adventure canon

Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.

### [ADR-0053](decisions/0053-one-active-adventure-per-campaign.md) — One active adventure per campaign

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
  `ADR-0048`, which defers it to Phase 2 for the same reason — "where the related
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

### [ADR-0054](decisions/0054-adventure-state-gets-its-own-row-not-an-adventure-tag-on-cam.md) — Adventure state gets its own row, not an adventure tag on campaign state

Given the placement rule above, adventure-scoped state has to be separable from
campaign-scoped state. Two shapes were available: tag each entity and pool entry in
`campaign_state.data` with the adventure it belongs to, or give adventures their own
state row with its own per-system Zod schema, mirroring `campaign_state`.

**Decided: a separate row.** Tagging makes the boundary a convention that every query and
the snapshot builder must remember to honour, and the two state defects this project has
actually hit were both exactly that failure. The `lt_alvarez` / `alvarez` incident was a
flat map plus a preserve-on-conflict merge, where the safety mechanism is what let the
duplicate through (`ADR-0036`, amendment). The `<character_attributes>` block sat deferred for two
milestones past its own stated trigger because nothing structural was watching
(`ADR-0049`, second amendment). A separate row makes scope structural rather than
remembered, gives the adventure lifecycle a natural place for cleanup, and bounds a blob
that is read on every turn and would otherwise grow without limit across a long campaign.

**What it costs, stated rather than glossed:** two Zod schemas per system instead of one,
two write paths, and a snapshot builder that merges two sources. That is real, and it is
the price of not relying on every future caller to remember a tag.

**Not implemented in Phase 1.** See the addendum to `ADR-0053`
above — the single-adventure constraint is what makes deferring the implementation safe
rather than merely postponing it. This entry records the terminal shape now so that the
Phase 2 migration is written against a decided target rather than choosing one under
pressure.

**Addendum — the Phase 2 relocation spans both state buckets, because ownership and scope
are orthogonal**

The entry above decides the terminal shape without naming what moves into it. The obvious
reading — that `scenarioState` is the adventure-scoped bucket and `resourcePools` the
campaign-scoped one — is wrong, and worth writing down before it becomes a working
assumption.

**The two axes are independent.** `resourcePools` versus `scenarioState` is a distinction
of *ownership*: per-entity numerics versus non-entity numerics
(`campaign-state.schema.ts:26`). Campaign versus adventure is a distinction of *scope*, per
`ADR-0026`. They cross:

| | Entity-owned | Not entity-owned |
|---|---|---|
| **Campaign-scoped** | player character pools | — |
| **Adventure-scoped** | synthesized threat and NPC pools | station power, countdown timers |

**Both cells of the bottom row sit in campaign state today**, because the adventure row
does not exist yet. A synthesized threat's HP is in `resourcePools` and a hull-breach timer
would be in `scenarioState`, and both die with the adventure that produced them. Neither is
campaign state by the rule; they are there because there is nowhere else.

**So Phase 2 relocates all of `scenarioState` *and* a subset of `resourcePools`** — the
owners synthesis created — while player-character owners stay. The adventure row will need
both an owned and an unowned bucket, for the same reason campaign state has both.

**M7.6 leaves a clean handle for that.** Under D1-A, `resourcePools` nests by owner and
unowned pools take the reserved owner `_scenario`
(`docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md` D1). The Phase 2
migration then moves whole owner keys rather than classifying individual pools: `_scenario`
and every synthesis-created owner go to the adventure row, player owners stay. That is a
bucket move per owner, not an inference per key — which matters, because the inference is
exactly what the M7.6 verification pass could not do reliably. Of six non-resolving pool
keys examined, two were ambiguous and one (`android_memory_integrity`) turned out to have
an entity referent after being classified as not having one.

**A related fact, recorded because it is the mechanism behind the defect this entry
addresses:** nothing anywhere resets `entities`, `flags`, `scenarioState`, or `worldFacts`
between adventures (`docs/plans/m7.6-code-inventory.md` @ `e1cdaac`). The single-adventure
constraint in `ADR-0053` (addendum) is what keeps that from
mattering before Phase 2.

**Not settled here.** `entities` mixes recurring NPCs with synthesized threats and needs
per-entry classification. `flags` and `worldFacts` are unexamined. And whether
`scenarioState` should continue to exist at all is open: under D1-A an unowned pool works
fine in `resourcePools`, and `scenarioState` has no producer at synthesis
(`submitGmContextSchema.structured` has four members and none is `scenarioState`), so it is
`{}` in every fixture and every dump. It may be a bucket whose purpose was superseded
before it was ever filled.

### [ADR-0055](decisions/0055-adventure-telemetry-vs-session-export-are-distinct-artifacts.md) — `adventure_telemetry` vs session export are distinct artifacts

These are two different things that were originally both called `adventure_log`. They serve different purposes and must not be conflated. `adventure_telemetry` is infrastructure-level diagnostic telemetry — one row per turn in a DB table, containing the full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, the state snapshot sent to Claude, and prompt/completion token counts. It exists to diagnose pipeline bugs and is not player-facing. The session export is the player-facing portable format — a single JSON file containing the message log (with turn numbers and timestamps), canon log, turn-level state deltas, final state snapshot, and GM context. It supports session restore and post-session analysis. It is produced on demand, not written per-turn to a DB table. Mixing these concerns into a single artifact would make `game_events` harder to query for its application-level purpose and would conflate player-facing data portability with internal diagnostic tooling.

---

## Frontend & Design System

### [ADR-0056](decisions/0056-no-utility-framework-plain-svelte-scoped-styles.md) — No utility framework — plain Svelte scoped styles

Tailwind and similar utility frameworks were considered and rejected. The atomic class approach makes HTML harder to read and works against a strong per-system visual identity. More importantly, genre-specific theming (horror for Mothership, high fantasy for OSE, etc.) requires styles that are closely coupled to a semantic token layer — a utility framework adds friction without meaningful benefit in that model. Component styles live in Svelte's scoped `<style>` blocks. No utility framework is a dependency.

### [ADR-0057](decisions/0057-two-tier-css-custom-property-token-system.md) — Two-tier CSS custom property token system

Theming is implemented via a two-tier CSS variable system. Primitive tokens (`--color-slate-950`, `--font-size-lg`) define the raw design vocabulary and never change between themes. Semantic tokens (`--color-surface`, `--color-text-primary`, `--color-accent`) map purpose to primitives and are what themes actually swap. Components reference semantic tokens only — never primitives directly. This ensures a theme swap is a single token layer substitution, not a component change.

### [ADR-0058](decisions/0058-theme-switching-via-data-theme-attribute.md) — Theme switching via `data-theme` attribute

The active theme is applied by setting a `data-theme` attribute on the root element. Each theme is a CSS file defining the semantic token layer (e.g. `themes/mothership.css`, `themes/fantasy.css`). The primitive token definitions live in `themes/base.css` and are always loaded. This approach requires no JavaScript theming library and works naturally with Svelte's reactivity.

### [ADR-0059](decisions/0059-bits-ui-for-headless-accessibility-primitives.md) — Bits UI for headless accessibility primitives

No opinionated component library is used. Bits UI (the Svelte 5 headless primitive library, successor to Melt UI) is used for accessibility-critical interactive patterns — modals, dropdowns, tooltips, focus traps — where rolling bespoke implementations would be high-risk. All visual styling of Bits UI primitives is owned by the application. This gives accessibility correctness without importing a competing design language.

### [ADR-0060](decisions/0060-mobile-first-design-layouts-originate-at-mobile-size.md) — Mobile-first design — layouts originate at mobile size

All UI layouts are designed at mobile size first and expanded for larger viewports. This applies from the pre-M3 design sprint forward and is a constraint on all subsequent frontend work. The M9 "layout pass" is a responsive polish pass, not the origin of mobile layout decisions. The play view in particular — message log, input field, character status, dice UI — is a constrained layout problem better solved small-to-large than large-to-small.

---

## Oracle Tables

### [ADR-0061](decisions/0061-oracle-filtering-data-model-includes-count-fields-despite-ra.md) — Oracle filtering data model includes count fields despite range UI being deferred

Each oracle category preference record stores `count_min` and `count_max` fields (defaulting to `1/1`) even though the range dial UI is not built in Phase 1. The activate/deactivate pool and the pick-count concept are cleanly separable — the pool model is identical regardless of how many entries are drawn. Adding the fields now avoids a schema migration when variable counts are introduced. The UI commitment is deferred until there is a concrete scenario requiring it (likely Phase 2).

### [ADR-0062](decisions/0062-oracle-filtering-ui-activate-deactivate-only-no-range-contro.md) — Oracle filtering UI: activate/deactivate only, no range controls in Phase 1

The oracle filtering UI exposes entry-level activation toggles, select all/deselect all per category, and a submission gate requiring at least one active entry per category. Range dial controls are out of scope for Phase 1. The data model supports variable counts from day one, but the UI will default to picking exactly one entry per category until range controls are designed and built. This keeps the MVP UI simple and avoids designing a UX pattern before there is a concrete use case to design against.

---

## Eval Harness

### [ADR-0063](decisions/0063-checkid-does-not-encode-checkmode.md) — `checkId` does not encode `checkMode`

A check's `id` (`out-of-order-resolution`, `hidden-info-leak`) is the failure-mode tag in lower-kebab, deliberately never including `structural`/`judged`. `UNSURFACED-CHECK` has already migrated modes once in this repo — its regex-based structural classifier missed a stakes-gating roll phrased as a question ("Does anything react to Alvarez moving...") rather than using a fixed keyword, so it moved to a judge call after a real-run false pass. `eval:compare` pairs history on `(fixtureId, checkId)`; if the id encoded mode, that migration would have silently un-paired every historical comparison for the check the moment it moved. `checkMode` stays its own column on the score row instead, so a check can migrate modes without breaking the very comparisons that would tell you whether the migration helped.

### [ADR-0064](decisions/0064-one-check-per-fixture-today-but-the-row-format-is-n-ready.md) — One check per fixture today, but the row format is N-ready

`selectChecksForFixture` returns an array, and every downstream reader — score rows, rate computation, comparison — is built against "a fixture may have N checks." Today it always returns exactly one, because a judged check needs per-fixture `assertion.facts` (`perceptionBoundary`, `expectedScope`, …) that only exist for the fixture's own tag: running `HIDDEN-INFO-LEAK` against a `SCENE-JUMP` fixture has no boundary text to grade against, and would cost an API call per fixture-check pair to produce one that doesn't exist. The corpus is what's 1:1 today, not the format — giving a fixture a second check later is a registry change, not a schema migration.

### [ADR-0065](decisions/0065-warden-output-json-is-the-full-serialized-turnexecutionresul.md) — `warden-output.json` is the full serialized `TurnExecutionResult`, not just `submit_gm_response`

The spec describes the artifact as "full `submit_gm_response` payload." That's not enough on its own: `eval:judge-variance` re-runs judged checks against a frozen artifact with **no database at all** — the scratch campaign is torn down at the end of every fixture run by default — so the artifact has to carry everything a structural checker or the judge needs to re-evaluate the turn. The judge summarizes the whole tool-call sequence, not just the narration, so it needs `gameEvents`; structural checkers additionally need `telemetry`/`pendingCanon`/`diceRequests`/`campaignState`. `warden-output.json` is a strict superset of `submit_gm_response`'s payload — the serialized `TurnExecutionResult`, with the narration living inside its `gm_response` game event. Anything narrower makes `eval:judge-variance` impossible without either re-seeding a scratch campaign per re-evaluation or keeping every scratch campaign alive forever, which would defeat the reason `--keep-scratch` defaults to off.

### [ADR-0066](decisions/0066-harnessversion-is-the-git-short-sha-not-a-hand-maintained-co.md) — `harnessVersion` is the git short SHA, not a hand-maintained constant

Recorded per rep and per row as `git rev-parse --short HEAD`, with a `-dirty` suffix when `apps/zoltar-be` has uncommitted changes, and `unknown` outside a git checkout. Same argument as `corpusVersion` being a content hash rather than a hand-bumped string: a manually maintained version fails silently when someone forgets to bump it, and the failure mode — two reps labeled identically under different checker semantics — poisons exactly the weeks-apart append the field exists to disambiguate.

### [ADR-0067](decisions/0067-error-is-a-fourth-verdict-not-folded-into-fail.md) — `error` is a fourth verdict, not folded into `fail`

M7.4's `runHarness` mapped any turn that didn't complete — a live model call producing output that failed schema validation, the inner tool loop exhausting its iteration cap, a checker rejecting a malformed fixture — to a **failed** `FixtureResult`, with a comment explaining that aborting the whole run over one flaky turn was worse than mislabeling it. That comment was right about the tradeoff and wrong about the fix: a transient failure and a real regression are different events, and conflating them under `fail` corrupts the one number (`pass / (pass + fail)`) the harness exists to produce. `error` is its own verdict — excluded from the denominator but counted and surfaced in `eval:report`'s Errors section, so it can never be silently absorbed into a regression-looking rate. Confirmed for real during the multi-run harness's own manual verification: the inner tool loop hit its 20-iteration cap on a busy off-screen-combat turn, and the resulting row correctly read as `error`, not as a phantom SCENE-JUMP failure.

### [ADR-0068](decisions/0068-eval-judge-variance-writes-beside-the-run-not-into-reps.md) — `eval:judge-variance` writes beside the run, not into `reps/`

`reps/*/scores.jsonl` rows mean "one observation of generator and grader together" — every pass-rate denominator in `eval:report`/`eval:compare` assumes that. A grader-only re-run against frozen input is a different measurement and would corrupt those denominators if appended there. Its output lives in `<run-dir>/judge-variance/<timestamp>.jsonl` instead — an extension beyond the spec, which doesn't say where this command's output goes.

### [ADR-0069](decisions/0069-eval-harness-retired-not-kept-alongside-eval-run.md) — `eval:harness` retired, not kept alongside `eval:run`

The multi-run harness's whole premise is separating execution from rendering — `eval:run` writes score rows, `eval:report` reads them, and nothing downstream parses markdown. Leaving `eval:harness` in place would have kept a second write path producing no score rows, which is the thing this milestone existed to eliminate. `eval:replay` survives — repointed at the unified check registry — and gained an artifact-based mode (`--run-dir --rep`, no database), covering the quick single-fixture-iteration use `eval:harness` was also serving.

### [ADR-0070](decisions/0070-judge-verdicts-stay-binary-no-confidence-scoring.md) — Judge verdicts stay binary — no confidence scoring

`judgeVerdictSchema` is `{passed, rationale}` and always has been. A row schema drafted for this milestone listed `judgeConfidence?: number` as a field a rubric could conditionally emit, but no rubric does, because self-reported LLM confidence was rejected earlier in this project's design. That decision predates the multi-run harness and was never written down anywhere except the shape of `judgeVerdictSchema` — recorded here because the new score row was the first place a reviewer might reasonably ask "where's the confidence column," and the honest answer is that a permanently-empty optional field reads as an invitation to fill it, not as a decision. JSONL rows are append-friendly, so if a rubric ever does emit one, adding the field later is non-breaking — old rows simply lack it.

### [ADR-0071](decisions/0071-eval-compare-s-mixed-rubric-warning-groups-by-checkid-and-fi.md) — `eval:compare`'s mixed-rubric warning groups by `checkId`, and `--filter-rubric` is scoped to one check

`detectHeterogeneity` originally counted distinct `rubricHash` values across an entire run and warned whenever there was more than one. Since `rubricHashFor(checkId)` hashes one rubric template per judged check, any run covering more than one judged check spans more than one hash by construction — the warning fired on every multi-check run, unconditionally, and named nothing useful. Worse, `--filter-rubric <hash>` filtered every judged row in both runs against a single hash, so following the printed remedy silently dropped every judged check except one.

The fix groups rubric hashes per `checkId` (not per `tag`, though the M7.4 spec's "one rubric per tag" language and the two are 1:1 in the current corpus) and warns only when one check's own rows span more than one hash — the real signal of a rubric template edited mid-run. `--filter-rubric` became `CHECK=HASH`, repeatable, so a filter aimed at one drifting check can never zero out an unrelated check's rows; the bare-hash form is now a usage error. A filter that would still zero a fixture's denominator is reported on stderr rather than rendered as an unremarkable empty row. `checkId` was chosen over `tag` as the grouping key because the actual data model — `manifest.completedReps[].rubricHashes: Record<checkId, rubricHash>` and `rubricHashFor(checkId)` — is keyed on check, not tag; if a tag ever gains a second check, `tag`-based grouping would coarsen incorrectly where `checkId`-based grouping stays precise.

### [ADR-0072](decisions/0072-a-warning-s-suggested-remedy-must-produce-a-correct-comparis.md) — A warning's suggested remedy must produce a correct comparison, not merely a homogeneous one

Three separate warnings in this harness converged on the same defect, which is worth naming as a class rather than fixing three times. Each detected a real inconsistency between the two sides of a comparison, and each printed a remedy that resolved the inconsistency by **deleting** it — making the sides *look* consistent without making the comparison correct:

- **The mixed-rubric warning** printed `--filter-rubric <hash>`, which filtered every judged row in both runs against one hash. Following it on a run covering four judged checks silently dropped three of them. The warning was about one check's rubric drifting mid-run; the remedy discarded the other three checks' results, which were never in question.
- **The harness-version warning** flagged rows scored under different `harnessVersion`s and effectively suggested reverting to a common one — which, after a checker-migration cycle, means throwing away every migration and re-reading the numbers the migrations were performed to correct.
- **A proposed `--filter-harness`** would have done the same thing structurally: shrink both denominators to the intersection, quietly, which is precisely the failure the `App` column was added to make visible.

The rule: a warning may only suggest a remedy that leaves the resulting comparison *valid*. Where no such remedy exists, the honest output is the warning plus an explanation of what the reader must do by hand — re-score both sides under one grading, re-run one side, or read the two sides separately — not a flag that restores apparent homogeneity. Homogeneity is a property of the row set; correctness is a property of what the rows mean, and only the second is what the warning was defending.

A related fix belongs to the same principle. Carried-forward rows (`eval:rescore` preserves rows for reps that errored before producing an artifact) are heterogeneous by construction and must never be counted as rubric or harness drift. That filtering now happens **inside `detectHeterogeneity`**, not at its call site. Filtering at the call site is correct exactly as long as every caller remembers to do it, which makes the invariant a convention rather than a property; moving it inside means a new caller cannot reintroduce the false alarm by omission.

### [ADR-0073](decisions/0073-applicability-is-fixture-authored-keyed-by-checkid-never-inf.md) — Applicability is fixture-authored, keyed by `checkId`, never inferred from the turn's own output

`system-rolled-player-action` and `out-of-order-resolution` originally decided applicability by asking "did this turn produce a `dice_roll` event?" — a consequence of the model's own choice, not a property of the fixture's scenario. When the correct behaviour was declining to roll (deferring to a pending `dice_request` instead), the harness scored the turn as `not_applicable` rather than as a pass, silently shrinking the denominator to exactly the reps where the model happened to roll — selection on the outcome variable. Confirmed against a real Sonnet 5 run: 38 of 40 reps across the two checks read `not_applicable` for this reason, and the two reps that didn't were themselves a false pass — a system-rolled to-hit roll the old pattern-only rule didn't match.

The fix adds `applicability: Record<checkId, {applies, playerEntity?, situation}>` to `evalFixtureSchema` (`FIXTURE_SCHEMA_VERSION` 1 → 2), authored once at fixture-capture time rather than derived at eval-run time from `campaignState` or the presence of any event. Keyed by `checkId`, not nested under `assertion` or flat on the fixture, because `selectChecksForFixture` already models "a fixture may carry more than one check" — turn19/turn21 exist as separate fixture *files* per tag today, but the schema shouldn't assume that stays true. `playerEntity` on the `applies: true` branch also replaces `system-rolled-player-action`'s old `campaignState.resourcePools`-key-guessing heuristic for identifying "the player" — the fixture author already knows who the player is.

Checks that need this declare `requiresFixtureSchema: 2` (the field existed, unused, since M7.4 anticipated exactly this situation) so a fixture below that version reports `not_applicable` through `runCheck`'s existing gate rather than a checker guessing or crashing. `capture-fixture` writes a fail-closed placeholder (`applies: false`, TODO reason) for every newly captured fixture, matching the existing `playerInput`/`assertion` placeholder convention — an unedited stub can never silently read as "situation confirmed."

`out-of-order-resolution` is only half-migrated: situation gating is real, but the in-turn ordering case needs a `gatedByRollId` the payload does not record, so the check reports `not_applicable` with a reason naming the missing field rather than the old model-artifact phrasing. An earlier version of this paragraph proposed extending turn19/21 through the follow-up turn to recover that evidence; that proposal is withdrawn — see "`out-of-order-resolution` reads the deferred gate, and declines the in-turn case" below.

### [ADR-0074](decisions/0074-a-structural-check-may-read-event-and-state-structure-it-may.md) — A structural check may read event and state structure; it may not classify prose

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

### [ADR-0075](decisions/0075-eval-rescore-re-grades-frozen-artifacts-re-score-rows-are-a.md) — `eval:rescore` re-grades frozen artifacts; re-score rows are a distinct row kind

A scoring-only corpus bump or a checker change leaves every `warden-output.json` exactly as valid as it was, so re-grading in place is a real measurement rather than an approximation. `eval:rescore` does that with no Warden calls and no database. It landed alone, before any checker changed, so that it could be validated against numbers derived independently — it reproduces the hand-derived `applicability`-fix corrections in `eval-methodology.md` exactly, including the specific finding that two Sonnet 5 passes on `turn21` flip to `FAILED`.

Rows extend `scoreRowSchema` rather than forking it, so `computeRates` / `rollupByTag` / `summarizeExclusions` consume a re-score unchanged — regenerating a run's rates under new checkers is the whole point, and a second aggregation implementation would be a second thing to keep in step. The cost is that half the inherited columns change tense: `model`/`promptHash` still describe generation, while `corpusVersion`/`harnessVersion` are recomputed and describe scoring. A `rowKind` discriminator keeps the two readers from ever accepting each other's files; it is optional on the run side specifically so `eval:run`'s on-disk format stays byte-identical to every row already written, since the command exists to reproduce historical numbers and a gratuitous format change would be one more thing to rule out when a rate moves.

Rows that cannot be re-graded — the turn errored before producing an artifact — are carried forward rather than dropped, so a re-score file is a complete replacement for a run's rows. Dropping them would silently shrink the error accounting and make a re-scored report look cleaner than the run it describes.

### [ADR-0076](decisions/0076-applicabilitysource-is-declared-per-check-and-the-third-valu.md) — `applicabilitySource` is declared per check, and the third value is `'ungated'`

Every check declares where its `not_applicable` verdicts come from: `'fixture'` (fixture-authored applicability — the scenario decides, denominator fixed before the model runs), `'artifact'` (the turn's own output — the outcome-selection hazard that made 38 of 40 reps read `not_applicable` across two checks), or `'ungated'` (reaches pass or fail every rep). Required rather than optional, with a lookup that throws on an unlisted check, so adding one forces the question rather than defaulting to a guess at the thing the field records. It goes on the row rather than being looked up from the check id at read time, because a migration changes it and a row must keep describing the rules it was scored under.

`'judged-check'` was considered for the third value and rejected. It would put a `mode` value on an applicability axis, and the two coincide only while no check is hybrid — which ended immediately: `narrating-past-a-block` and `unauditable-mapping` are both `mode: 'judged'` with artifact-sourced structural gates, so six checks are judged but only four gate on nothing. A reader would infer the value meant "this check is judged" and be wrong about a third of them. `'none'` was the first choice and was also rejected: an absence-shaped value reads as "not declared yet," which is the exact ambiguity the required field exists to eliminate.

### [ADR-0077](decisions/0077-a-judged-check-may-carry-a-structural-pre-filter-judgegate-a.md) — A judged check may carry a structural pre-filter (`judgeGate`), and gated reps are excluded from judge-variance

`decisions.md` already held that a single check may span both modes. `judgeGate` is the mechanism: an optional function run before the judge call that either settles the rep structurally or returns `null` to mean "the remaining question is genuinely semantic." `mode` stays `'judged'` because that is what `runCheck` dispatches on and what the row records; a third mode value would have forced a fixture-schema change for no gain.

The non-obvious consequence is in `eval:judge-variance`. It selects candidates by `check.mode`, so a gated judged check contributes frozen inputs whose verdicts are deterministic — re-running one N times yields N identical answers, a guaranteed non-flip sitting in the denominator and pulling the measured flip rate toward zero. That is the one number the command exists to produce, and the one that must never be quietly optimistic. Gated inputs are therefore tracked via `judgeInvoked`, excluded from the flip-rate denominator, counted as `gatedInputs`, and named in the headline: a rubric validated on two inputs because a gate absorbed the other eighteen has not been validated.

`judgeContext` is the companion field. When a gate narrows *which* events the semantic question is about — as `unauditable-mapping`'s does — the judge has to be told which ones. The alternative is a rubric describing the structural filter in prose for the model to re-apply, which is a second implementation of the same rule, free to drift, in the one check being rebuilt precisely because prose descriptions of roll classification do not hold.

### [ADR-0078](decisions/0078-structural-checks-report-undecided-rather-than-guessing-when.md) — Structural checks report undecided rather than guessing when a prose dependency fails

`isAttributedTo` — binding a roll to the acting entity by the Warden's leading-name convention — is the last prose dependency in the structural checks, and it is not removable: nothing in `game_events` records who acted, and `actorType` is `'gm'` for every Warden-side roll whether it represents an NPC or the player, which is exactly the distinction being drawn. It waits on an `actingEntityId` on the roll payload.

What was fixable is how it fails. A prose match failing to match is indistinguishable from the thing genuinely being absent, and the two carry opposite verdicts, so `system-rolled-player-action` treated "no roll named the player" as a pass. It now reports `not_applicable` when nothing binds *and* unattributable system-side rolls are present. Measured across both frozen runs this costs 2 of 40 reps — both on `turn21` under 4.6, where they were that fixture's only two passes against seven fails — and leaves Sonnet 5 untouched at 1.00/0.80, because a model that properly issues `dice_request`s hits the structural branch instead. Costing a denominator is the point: a rep whose verdict rests on a prose match having failed is not evidence, and counting it as one is how a rate reaches 1.00 without the behaviour improving.

The same audit found that binding a `dice_request` by prose was simply wrong. A request is player-facing by construction — `roll_dice` is documented for GM rolls, `diceRequests` for player-facing ones — so a pending request is a deferred player roll whatever its purpose text says. A manually-verified clean turn had been failing because it deferred correctly with a request that never named the player, which a request addressed *to* the player has no reason to do.

### [ADR-0079](decisions/0079-out-of-order-resolution-reads-the-deferred-gate-and-declines.md) — `out-of-order-resolution` reads the deferred gate, and declines the in-turn case

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

### [ADR-0080](decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md) — OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be

*Opened 2026-08-10 from `docs/rules-extraction-findings.md § S33`. Not yet decided.*

The entry above governs *structural* checks. Judged checks were never brought under it, and one rep of the `c45a142a` re-baseline shows the gap. `turn24-over-resolution` is declared `applicabilitySource: 'ungated'` — it has no `not_applicable` path at all — and the judge's own rationale reports that the tool calls do not contain the Delta-vs-UNIT-7 off-screen encounter the rubric asks about, calling the comparison *"a mismatched comparison"*. It then returned `fail`.

**This is `ADR-0046` inverted.** There, a structural check that could not resolve its subject collapsed into its PASS condition and graded ten violations clean. Here, a judged check that cannot find its subject collapses into FAIL. The shared root is the one that entry already names — *a check that cannot decide must report undecided* — and the fact that it inverts in the other direction on the judged side is not reassuring. A false FAIL is more diagnosable than a false PASS, but it still poisons a rate, and nothing currently stops it.

Three things to settle, and deliberately not settled here:

- **Whether `ungated` is ever right for a judged check whose rubric names a specific scene.** `over-resolution`, `scene-jump`, `hidden-info-leak` and `narrating-past-a-block` are all `ungated`. A rubric pinned to content the turn may not reach is gated in substance whether or not it says so.
- **Whether the judge should be able to return a third verdict.** `missing-canon-capture` stays structural precisely because "a judge cannot say nothing to grade" — see the entry below. That was a reason to avoid judging, not a finding that judges are incapable of it, and the two readings have never been separated.
- **Whether the prompt caused it.** `c45a142a` tells the Warden to narrate up to the point the dice are needed and stop. If turns now end earlier, an ungated rubric can be starved of its subject as a *side effect of correct behaviour*. If that is the mechanism, the fix is the gate and not the prompt — but one rep and one rationale do not establish it, and the check is cheap to run again before anyone acts on it.

Until it is settled, read `OVER-RESOLUTION` at 0.90 as possibly 1.00 with one undecided rep, and do not treat the -0.10 as a measured cost of the roll-ownership change.

### [ADR-0081](decisions/0081-missing-canon-capture-stays-structural-because-a-judge-canno.md) — `missing-canon-capture` stays structural, because a judge cannot say "nothing to grade"

Reviewed on the same grounds as the others — its marker-phrase gate is a prose dependency, and it had produced zero verdicts across 20 reps — and it is the one case where the conclusion runs the other way.

The verdicts are correct. All 20 reps report `not_applicable` because the narration genuinely never introduces the detail `turn02` asks about: normalising case, whitespace and dash shape finds it in 0 of 20, and a loose search for "veridian internal" alone finds 0 of 20. The near-miss hits are about a different subject entirely.

Migrating it would have made things worse. A judge asked "did the narration introduce the detail, and if so was it captured" would answer "it didn't" on all 20 reps, and — the verdict being binary — return 20 passes. An honest zero denominator would become a spurious 1.00. `not_applicable` is the right verdict and only the structural path can express it.

The real defect is in the fixture, which asks about a detail neither model reproduces and therefore grades nothing. Recapturing it, or authoring the expectation as something other than a literal phrase, is fixture work tracked separately. What the review did change: the marker now matches across dash shape and case, and `pending_canon` is attributed to the *winning* response rather than the first `gm_response`, a latent bug that would have read canon captured by a correction as a failure to capture.

### [ADR-0082](decisions/0082-a-rate-that-never-moves-is-a-harness-suspect-not-a-finding.md) — A rate that never moves is a harness suspect, not a finding

`eval-methodology.md` listed six fixtures as "confidently zero — n large enough that the result isn't just small-sample noise." Four were measuring the harness. `turn16-narrating-past-a-block` read 0/10 under both models because the check failed every rep on a `dice_request` the *fixture* seeded with `target: null`, a value fixed at capture time before the Warden under test ever ran.

The framing is what made it hard to see: the statistical confidence was entirely real and completely beside the point, because a large n does not make a checker correct. The practical rule is the same one already recorded for large rate jumps after a model swap, extended to its mirror image — a fixture sitting at exactly 0.0 or 1.0 across every rep more likely indicates a checker that cannot move than a model that never varies, and should be treated as a harness suspect before being recorded as a finding.

**This entry was written from `turn16`, so it reads as being about zeros. It is not.** A rate pinned at 1.00 is exactly as suspect and *materially less likely to be investigated*, because nobody audits good news. The asymmetry is worse than indifference: a pinned zero at least announces itself as a problem worth opening, and it tends to present with a shrunken or lopsided denominator that draws a second look. A pinned 1.00 presents with full applicability, a healthy denominator, and an `App` column reading `1.00` — the healthiest-looking row in the report. Every diagnostic built so far watches for denominators collapsing; none of them can see a verdict that cannot be reached. `turn21-narrating-past-a-block` (1.00 on both models) and `turn{19,21}-out-of-order-resolution` under Sonnet 5 (1.00, 20/20) are the current instances, and the reason each is currently believed is hand-review, not tooling. `docs/plans/900-fixture-check-reachability-design.md` is the design for closing that gap and is deferred, so for now the ceiling half of this rule is enforced by remembering it.

**Addendum — the ceiling half stops being enforced by memory, and the instance list should
never have been a list** (2026-08-11).

The paragraph above closes with "for now the ceiling half of this rule is enforced by
remembering it." That is no longer the plan, in two steps of increasing directness. A **Haiku 4.5
control arm** rides M7.6's re-baseline, scoped by `--fixtures` to the pinned checks: a weaker
model failing them is evidence they can reach a `fail` verdict at all (ADR-0023, addendum). **M7.8 — Harness Meta-Eval** then asserts the same property
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

**Addendum — `turn16` never had a satisfiable block, and the Warden was right every time**
(2026-08-16, from M7.6's re-baseline `claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z`).

This entry opens by naming `turn16-narrating-past-a-block` as a check that could not move, and
locates the cause at the `dice_request` the fixture seeded with `target: null`. That was right and
stopped one level short. **`target` is null because the stat the roll names does not belong to the
character it is attached to.** The fixture's `blockDescription` asks the Warden to stall until it
learns "Alvarez's Instinct score". The corpus gives Instinct as a *Contractor* stat — "only have
four Stats: Combat … Instinct: This is a catchall Stat for Fear, Sanity, Body, Speed, Intellect,
and everything else" — and the primer's own stat line, byte-identical across `c45a142a` and
`ccac7d1c`, gives player characters Strength / Speed / Intellect / Combat with Sanity / Fear / Body
saves. Alvarez is the player character. No value the player could supply would unblock the turn, so
no run can pass it.

**The Warden's rationale is rules-correct and it recorded it in the artifact**: "treated the
ambiguous 'instinct roll' (62) as governing the contractor's search outcome rather than an Alvarez
action roll." There is a contractor in the scene, mid-sweep. It attributed the roll to its correct
owner and was failed for it in 49 of 50 reps, across five runs, two prompts, two grading modes, and
both an empty and a populated index. The judge is behaving correctly — it grades against a fact the
fixture asserts and the rulebook denies.

**What this changes about the rule above.** "A pinned rate is a harness suspect" holds, and the tail
is longer than "the checker cannot move": the checker moved fine, the *fixture* encoded a rules
error, and no reachability analysis over checker code would have found it.
`docs/plans/900-fixture-check-reachability-design.md` asks whether a check can emit a fail; here it
always could. The unasked question is whether the fixture's asserted world is one the rules permit,
which is answerable only against the corpus. **A pinned fixture warrants a rules-level read of its
assertion, not only a code-level read of its checker.**

**Cost of not having asked.** `NARRATING-PAST-A-BLOCK` has reported 0.50–0.55 for five runs and both
halves were misleading: `turn21` is pinned at 1.00 and already listed above as a ceiling suspect,
`turn16` could never pass. The tag has had no working fail-direction coverage at any point while
presenting as a stable mid-range rate — the failure this file catalogues as "a tag rate can certify a
fixture rather than the corpus", arrived from the third direction. Re-authoring or retiring `turn16`
goes with M7.7's fixture work; the class goes to M7.8.

**Addendum, 2026-08-23 — `turn16` is retired, and a removal turns out to be a third kind of
corpus bump.**

The addendum above settled why `turn16-narrating-past-a-block` could never pass and left the
choice between re-authoring and retiring it to M7.7. **Retirement chosen.**

**The two options were not equivalent.** Re-authoring the block against something a player
character can actually be blocked on keeps a third instance but needs a fresh capture.
Retiring costs a corpus bump and no Warden spend. Retirement stops the fixture gating the
playtest, and the tag no longer rests on it alone — `turn21` and the `5c34991b-turn10`
capture both pass every rep, so the rate should read 1.00 on a smaller denominator. What
made this cheaper than it was in M7.6 is that second instance arriving.

[[0100-npc-crew-role-skills]] has since made the underlying category error explicit rather
than interpretive: Instinct is a rolled field on `npc` entities and on nothing else, and
`mothership-m7.txt`'s NPC instruction is now conditional on the snapshot actually carrying
one. The fixture asked a player character for a field the schema gives only to NPCs.

**Retired 2026-08-23.** Fixture removed, 22 → 21. Corpus `abbce198026c` →
`ead033182d6a`.

**That bump is a third kind, and naming it was the general lesson.** A removal is neither
input-affecting nor scoring-only: survivors' inputs and grading are untouched, so
`eval:rescore` is legitimate, but the denominators move. `docs/eval-methodology.md § Two
kinds of corpus bump` had no name for it, and its "re-run when the kind is unclear" default
would have bought a full Warden run to answer a question arithmetic answers. The kind is now
named there.

The checker's comments keep the `turn16` evidence as history, with a pointer recording that
the fixture is gone.

### [ADR-0083](decisions/0083-applicability-is-reported-alongside-every-rate-and-errors-ar.md) — Applicability is reported alongside every rate, and errors are not in its denominator

`eval-methodology.md` already argued that a rate moving because its denominator moved looks identical to a rate moving because behaviour moved, and that reporting applicability is the only thing that separates them. The reports now do: `App` on the per-fixture and per-tag tables, `App A`/`App B`/`ΔApp` on every compare row, and an `Applicability shifts` section peer to Regressions/Improvements.

Applicability is `N / (N + NA)` — **errors are excluded from the denominator entirely.** A rep that errored never reached the point of determining whether the check applied, so counting it as "didn't apply" reports a lower applicability than the check earned and folds two different unknowns into one number. `turn14-unauditable-mapping` is the case that forced it: 7 `not_applicable`, 3 errors, `N` 0. It reads `0.00 (0/7)` with the 3 errors accounted for separately, not `0/10`. The exclusion is also what makes the fixture-gated diagnostic below sound — an errored rep can't break unanimity.

**The same applicability number carries opposite readings depending on `applicabilitySource`, so the reports render the source next to it.** For a `'fixture'`-gated check the scenario decides before the model runs, so every rep must agree: `0.00` and `1.00` are the only honest values, and anything strictly between is a harness defect — the checker is misclassifying or the fixture was mis-authored. For an `'artifact'`-gated check the same partial number is a real behavioural measure carrying the outcome-selection hazard. A `'ungated'` check reporting any `not_applicable` at all is a defect by definition: a gate fired where the registry says none exists. Reports classify each entry on those rules and separate **harness defects** from **how to read these numbers**, because the failure being prevented is a bug getting written up as a finding.

The compare report distinguishes a source *mismatch* (both sides declared, and they differ — a checker migrated between the runs) from an *indeterminate* source (either side is `'unknown'` or `'mixed'`). Only the first is a migration. `'unknown'` is the ordinary state of rows predating the field, including every row `eval:rescore` carries forward, and reporting it per check as a migration buries the real ones — the first run of this on the two frozen runs produced six such false alarms. Indeterminate pairs get one aggregated warning instead.

### [ADR-0084](decisions/0084-eval-report-and-eval-compare-name-which-grading-they-rendere.md) — `eval:report` and `eval:compare` name which grading they rendered, and share one default

Once `eval:rescore` exists a run directory holds several sets of verdicts over the same generator output: the run's own `reps/<nnn>/scores.jsonl` plus one file per re-score pass. "The report for this run" stopped being a well-defined request, and the failure mode is not a crash — it is two people quoting numbers graded by different checker code at each other.

`--scoring run | rescore | rescore=<timestamp>` selects. With no flag the most recent re-score wins, falling back to the run's own scores when there is none: a re-score exists precisely because the run's grades are known stale. That default is only defensible because it is never silent — the resolved grading appears in the report title, in a `- Scoring:` header bullet naming the exact file, and on stderr.

The flag lives on **both** commands, resolved by one shared `resolveScoring`. A default that changed `eval:report` while `eval:compare` kept reading `reps/` would have manufactured the exact cross-grader comparison the flag exists to prevent. `eval:compare` additionally warns when its two sides end up on different gradings — different kinds, or two re-scores under different harness versions — since one `--scoring auto` can still land differently on two runs.

### [ADR-0085](decisions/0085-prompt-work-during-a-re-baseline-is-triggered-by-attribution.md) — Prompt work during a re-baseline is triggered by attribution, not by a number falling

Recorded 2026-08-16, while M7.6's re-baseline was still running and before any of its numbers were readable. That ordering is the point, and it is the same one as `ADR-0022`: a trigger written after the results are in is indistinguishable from picking the trigger that licenses what you already wanted to do.

**The default is no.** M8.1 is the prompt-iteration milestone, sequenced after M8 so iteration runs against the complete Phase 1 corpus rather than the pre-multiplayer one. A tag reading low on this run and going onto M8.1's list is the expected outcome, not a deferral that needs justifying.

**The default is not the whole rule, because M7.5 already ran this case.** `0bdd1306` surfaced `SYSTEM-ROLLED-PLAYER-ACTION` at 0.45 against 0.90, that got a prompt ownership/voice change, and `c45a142a` re-measured it at 1.00 (`ADR-0023`, addendum). The milestone paid for three runs instead of one and that was correct. So the question is never "is the prompt in scope this milestone" — it is which of four things a moved number is:

1. **A check M7.6 introduced, failing.** The wounds chain, `characterState`, `CARRYOVER-ARITHMETIC`. This is not deferred prompt iteration; it is M7.6 not being finished. Fixed in the milestone, by prompt or otherwise. Where a number could be read as both this and (2) — a new mechanic moving an old tag — the check id decides: if M7.6 introduced the check, it is category 1.
2. **A pre-existing tag regressing, attributable to something M7.6 changed.** The M7.5 precedent. Fix, then re-measure.
3. **A pre-existing tag low, with no attribution.** M8.1's backlog, unchanged.
4. **Not a score at all.** `error` verdicts, and specifically D6 — without the PSG ingested on enceladus every Wounds fixture fails for infrastructure reasons indistinguishable from Warden failures. Asked first, before any number is interpreted.

**Category 2 is the hard one, and it is harder here than it was at M7.5.** That run had re-scored `88fa84bd8329` rows to compare against. This one has nothing: six Warden-visible changes plus an input-affecting `corpusVersion` bump ride a single run, `eval:compare` across the boundary is meaningless, and §6.3's predictions are sanity checks read off new numbers rather than a diff. So a regression cannot be argued from a delta, because no honest delta exists. It has to be argued from a violated §6.3 prediction, or from an absolute rate low enough to matter whatever it was before. At N=10 the 95% CI half-width near p=0.5 is ~±31pp, which disqualifies small moves from being either kind of evidence.

**`SYSTEM-ROLLED-PLAYER-ACTION` and `UNSURFACED-CHECK` are read as a pair, per `§ S33`.** They moved in opposite directions on one prompt change, and a fix that trades one for the other reads as progress if either is read alone.

**What this costs when it fires.** A category-2 fix supersedes M7.6's re-baseline number and buys a second graded run — affordable when the regression is real, and exactly the waste `ADR-0094` names when it is noise. The categories exist so that call is made against a rule written before the numbers were visible rather than against the numbers themselves.

### [ADR-0094](decisions/0094-don-t-pay-for-the-same-re-baseline-twice.md) — Don't pay for the same re-baseline twice

A graded re-baseline is the expensive instrument in this project — roughly 300 Warden turns plus judge calls (2 models × 15 fixtures × N=10). The rule: a change that will force a re-baseline waits for one that is already being bought, rather than triggering its own.

**This entry records a rule that was already operating, not a new one.** It was cited by name in `ADR-0085` before it existed as an entry, and it is applied, in almost these words, in three others:

- `ADR-0012` defers M7.2's re-baseline to M7.5 because "buying it against an index about to be re-chunked means buying it twice," and identifies the same shape of waste already being guarded against by the `roll_dice` field deferral.
- `ADR-0045` lands those deferred `roll_dice` fields on a re-baseline that was being bought anyway, "rather than paying for a second one" — the fields ride the baseline the populated index was already forcing.
- `ADR-0030` records that four pool-delta fields landed simultaneously in M7.6 "to avoid paying for two re-baselines," and that every future change to that object carries the same cost.

**What the rule is not.** It is not a reason to defer a fix worth measuring on its own. A category-2 regression under `ADR-0085` supersedes the current number and buys a second graded run, and that is affordable when the regression is real. The waste named here is narrower: re-measuring the same thing after changing it out from under the measurement. Two things worth measuring separately are worth two runs.

**The practical form.** Schema changes, prompt changes, and index changes that move Warden-visible behaviour are batched onto the next re-baseline already on the calendar. When none is scheduled, the question becomes whether the change alone justifies buying one — usually it does not, and the change waits for company. The corollary, recorded in `ADR-0030`: an object that has already absorbed a batch of changes to amortise one re-baseline makes every later change to it expensive, which is an argument for watching it rather than for filing the concern away.

**Why it took this long to write down.** The rule was legible enough in application that four entries leaned on it without anyone noticing it had no home. It surfaced only when a reference migration found the citation in `ADR-0085` resolving to nothing.

### [ADR-0096](decisions/0096-a-check-may-be-attached-to-a-fixture-whose-tag-it-is-not-via.md) — A check may be attached to a fixture whose `tag` it is not, via fixture-authored `applicability`

`selectChecksForFixture` returned exactly the check whose id matched the fixture's `tag`, so a check was measured only on fixtures named after it. `ADR-0073` had already made applicability fixture-authored and keyed by `checkId`, and the schema comment already said a fixture "can in principle carry more than one check" — but nothing consumed that, and the corpus stayed 1:1 by construction rather than by choice.

The cost is recorded in `docs/rules-extraction-findings.md § S34`: the `c45a142a` re-baseline accepted `SYSTEM-ROLLED-PLAYER-ACTION` at 1.00 (20/20) while the same run's artifacts contain six turns where the Warden resolved the player's declared action system-side. Every one of them landed on a `turn24-*` fixture, which the check was not pointed at. **A tag rate is a claim about the fixtures carrying that check, and selection-by-tag made "which fixtures carry it" a consequence of what each fixture was named at capture time.** A fixture's `tag` records the failure mode it was captured to *reproduce*; it says nothing about which other failure modes its turn is capable of provoking.

So selection is now the tag's check plus every **tag-independent** check the fixture authors an `applicability` entry for, and the three `turn24-*` fixtures carry `system-rolled-player-action` that way. Attaching a check stays a fixture-authoring act — the author states the scenario calls for it and names the player entity — which keeps `ADR-0073`'s rule intact: applicability is still declared before the model runs, never inferred from what it produced. `capture-fixture` writes a fail-closed stub for every tag-independent check into each new fixture, not just for the fixture's own tag, so the authoring act is prompted rather than remembered — a check that reaches fixtures only through authored entries is one omission away from the hole this entry closes.

**`tagIndependent` is hand-declared on the check, not derived.** The load-bearing property is what the checker *reads*, which is a fact about checker code and derivable from nothing on the registry entry. `system-rolled-player-action` qualifies because `ADR-0073` already re-gated it purely onto `applicability[checkId]`; it reads no `assertion` at all. Every other check does: a judged check grades against `assertion.facts` (`perceptionBoundary`, `expectedScope`, ...), and `missing-canon-capture` parses `assertion.check` prose. Those exist only for the fixture's own tag, so attaching one to a foreign fixture would grade one question against another question's boundary text. The registry throws at build time if a judged check is ever listed, and `selectChecksForFixture` throws on an `applicability` key naming an unregistered or non-tag-independent check — silently skipping it would mean a fixture edit made to close a coverage hole opens no rows and reports nothing, which is the same failure shape as the hole.

Deliberately **not** derived from `applicabilitySource === 'fixture'`, which the two values coincide with today. They answer different questions — where a check's `not_applicable` verdicts come from, versus whether it reads the fixture's assertion — and `out-of-order-resolution` separates them: it is `'artifact'` because it has an artifact-dependent branch, yet it reads no assertion and would be portable on the merits. Whether it should be attached to more fixtures is a corpus decision, and is not made here.

**Three alternatives, and each is smaller on the page than in the corpus.**

**Retagging the three `turn24-*` fixtures is not available at all.** It is the first thing to reach for, and the file stops loading: `tag` holds a single value, and `evalFixtureSchema`'s refine ties `assertion.mode` to it, so `SYSTEM-ROLLED-PLAYER-ACTION` on a fixture carrying a judged assertion fails validation outright. Making it parse means replacing that assertion with a structural one — discarding the `SCENE-JUMP` / `OVER-RESOLUTION` / `HIDDEN-INFO-LEAK` coverage the fixtures were captured for. One hole closed by opening three.

**Capturing three new `turn24-system-rolled-player-action` fixtures** reaches the same coverage at three times the Warden spend per rep — the existing `turn24-*` trio already replays one captured turn, and a fourth copy of it would run on every rep of every future run — for files whose `seededState` is byte-identical to fixtures already on disk. It also leaves the underlying rule, a check is measured where its name appears, in place to be paid for again by the next check. And it saves less than it appears to: `system-rolled-player-action` calls `requireApplicability` and declares `requiresFixtureSchema: 2`, so a new fixture would need the same `applicability` block, naming the same `playerEntity`, that the existing three now carry. **The fixture-side work is common to both routes; the registry change is the whole of the difference between them.**

**Selecting every check a fixture names in `applicability`, with no `tagIndependent` flag at all**, is about ten lines and works against today's corpus. Rejected on one case: `missing-canon-capture` guards its `assertion.check` read with a runtime `throw` on non-structural mode, so attaching it to a judged fixture type-checks, builds, and fails at eval time as one `error` row per rep — naming the checker, never the fixture that misdeclared it. The flag and its throws turn that into a single message at selection time carrying the fixture id, the tag, and the fix. `ADR-0046`, `ADR-0073` and `§ S30` are three tellings of one story — a check that cannot resolve its subject reporting something other than undecided — and the guard is priced against that history, not against the ten lines it replaces.

### [ADR-0098](decisions/0098-a-check-may-run-on-every-fixture-with-no-applicability-entry.md) — A check may run on every fixture, with no applicability entry to author

`ADR-0096` opened selection beyond the fixture's own `tag`, but kept every attachment an authoring act: a tag-independent check reaches a fixture only through an `applicability` entry someone wrote. That is right for the check it was built for and wrong for `tool-syntax-leak`, which grades whether the narration the player was shown contains raw tool-call markup. So selection is now the tag's check, plus tag-independent checks the fixture authors an entry for, plus every **universal** check unconditionally.

The distinction is whether the check's subject is conditional. `system-rolled-player-action` is portable across tags but still scenario-conditional — it means nothing where the scenario has the player declare no action — so an author states that it applies and names the player entity. A universal check has no precondition to state: every turn has narration, and that narration either contains tool-call markup or it does not. There is no fixture for which the question is not asked, and no answer an author could supply that the turn output does not already contain.

**Routing it through `applicability` anyway was the obvious move, and it fails three ways.** `applicabilityEntrySchema`'s `applies: true` branch requires `playerEntity` — a field a check about narration has no use for and would have to fabricate, in the one place the corpus records who the player is. `capture-fixture` stubs every attachable check **fail-closed** (`applies: false`), which is correct for a conditional check and exactly inverted for one that should always run: every new capture would arrive with it switched off, and `ADR-0096`'s own closing observation — that a check reaching fixtures only through authored entries is one omission away from the hole it closed — becomes a certainty rather than a risk. And an `applies: false` entry would let a single fixture opt out of a correctness check that has no scenario-shaped reason to be opted out of, which is not a knob the corpus should have.

So `capture-fixture` deliberately does **not** stub universal checks, and `selectChecksForFixture` throws on an `applicability` key naming one. A silently-ignored entry is the worse failure here than in `ADR-0096`'s case: an author who wrote `applies: false` would believe they had opted out, and would be wrong in the direction that hides a defect.

**What this costs: a universal check cannot be scoped to part of the corpus.** That is the intended trade rather than a limitation worked around. A leak rate is a claim about every turn the Warden takes, and a corpus-scoped denominator would understate it precisely where coverage was never authored — the same shape of error as `§ S34`, arriving through a different door. A check that genuinely needs scoping is evidence that it is conditional, which means it is tag-independent and belongs in the other list.

**Universal and tag-independent are alternatives, not a spectrum, and the registry enforces that.** Listing an id in both throws at build time, as does listing a judged check as universal — a judge call grades against `assertion.facts`, which exists only for the fixture's own tag, so "runs on every fixture" and "grades against this fixture's assertion" cannot both hold. The guards are priced the same way `ADR-0096`'s are: the failure they prevent is a check reporting nothing while appearing to be registered.

**Read `tool-syntax-leak`'s rate with its applicability, as always, but expect the two to be near-identical.** It declares `applicabilitySource: 'artifact'` rather than `'ungated'` under the weakest-link rule `out-of-order-resolution` established, because one branch reports `not_applicable`: a turn that produced no `gm_response` at all, which is the `diceResult`-without-auto-advance path. The selection hazard that label warns about is weak here — that branch means the turn did not happen, not that the Warden chose something — but `'ungated'` would assert a `not_applicable` is impossible, and it is not.

**The check grades the same detector the turn path enforces** (`src/session/session.tool-syntax.ts`, `ADR-0097`), imported rather than reimplemented. A checker with its own copy of the token set would drift from the guard, and both directions of drift are bad: the harness reporting clean while production rejects, or the harness failing runs that production would accept, which reads as a Warden regression when it is a harness disagreement.

### [ADR-0099](decisions/0099-the-code-built-prompt-surfaces-get-their-own-identity-separa.md) — The code-built prompt surfaces get their own identity, separate from `promptHash`

Four things reach the Warden, and until now exactly one of them had a recorded identity. `promptHash` covers `mothership-m7.txt`. The tool definitions, the GM context block and the state snapshot are produced by `session.tools.ts`, `formatGmContextBlob` and `buildStateSnapshot` — nothing anywhere recorded what shape they were in when a run executed. A rewritten tool description, an added snapshot section, or a formatter that started emitting `openingNarration` would change what the model reads while every field the run manifest prints stayed identical, and the difference would surface only in the rates, attributed to the model.

So `manifest.assemblyHash` now fingerprints those three, alongside `promptHash` rather than replacing it.

**`harnessVersion` was already there and could not do this job.** It is the git SHA, so it moves on every commit; `eval:compare` warns on a mismatch and will therefore warn on essentially every pair of runs anyone ever compares. It can say "the repo differs", never "what the model sees differs", and a signal that fires every time is one people learn to skip. The distinction this entry exists to draw is the one a commit id cannot make: a pure refactor of a formatter must not move the identity, and a one-word edit to a tool description must.

**Widening `promptHash` instead was rejected on the historical record.** `97feadbd`, `0bdd1306`, `c45a142a` and `ccac7d1c` appear in run directory names, in `ADR-0023`, in `ADR-0085`, and in roadmap prose going back to July. Redefining what that token covers would silently reinterpret every one of those values in hindsight — the `corpusVersion` trap from `§ S35`, applied retroactively across the whole record rather than to one comparison. The split is also principled rather than merely conservative: **hash the file when the thing is a file, use a golden when what you care about is what code produces.** The Warden prompt's content is its identity; a formatter's is not.

## A frozen probe, three goldens, a live hash

`ASSEMBLY_PROBE` (`apps/zoltar-be/src/session/session.assembly.ts`) is a synthetic adventure — two NPCs, a hidden threat, a set flag and an unset one, pools, armor, a condition, a scenario counter, a world fact. It is rendered through the real formatters, and the hash is taken over that render. Because the input is frozen, the output moves when and only when the *shape* moves. Fixture data changing is a different question and `corpusVersion` already answers it.

The probe is parsed through `MothershipCampaignStateSchema` rather than asserted into the type. That makes it a valid state by construction — it rejected four wrong guesses about field shapes while it was being written — and it picks up any defaulted field a future schema version adds, which is correct, since a new default can change what the snapshot renders.

The rendered text is committed as three `.txt` goldens and asserted by `session.assembly.spec.ts`. **The goldens are the reason to do this with a probe rather than by hashing source.** Two properties follow from them and from nothing else:

- **It is loud at edit time, not only at compare time.** Changing any of the three surfaces fails a test, and the fix is committing an updated golden — so the change arrives in review as a diff of the text the Warden actually receives, rather than as a formatter edit whose effect a reviewer has to simulate. This is precisely the check that was missing when M7.6 added fourteen descriptions under `stateChanges` and nobody noticed the five properties above it had none (`ADR-0097`).
- **A refactor that produces identical text moves nothing.** Rename a variable, reorder a function: hash stable, test green, nobody disturbed.

Updating is an explicit `UPDATE_ASSEMBLY_GOLDENS=1` run rather than something the suite does for itself. A golden that self-heals asserts nothing.

**The hash is computed live from the render, never read from the goldens**, so it cannot go stale relative to the code — the goldens are the human-readable artifact and the test is what keeps them honest. It is 8 hex chars from `hashPromptText`, matching `promptHash` so the two read alike in a manifest. Current value: `0bb41002`.

Verified by mutation rather than by argument: adding four words to the `submit_gm_response` description moved the hash to `22d3aa3f` and failed the `tools.txt` golden by name.

## Absent is reported as unknown, never as a match

The manifest field is optional and `schemaVersion` stays at `1`, so the runs already on disk keep parsing. Every one of them predates the field, and `eval:compare` says so explicitly rather than pairing them silently — "whether the two sides saw the same tool definitions, GM context and state snapshot is unknown rather than confirmed". Rendering an absent value as agreement is the failure the field exists to prevent, arriving through the back door.

`assertManifestMatches` checks it too, which is the smaller half of this entry and the one with teeth today: `--run-dir` appends reps to an existing run, and doing that after a tool-schema edit would put two different prompts under one run id. The guard already covered `model` and `promptHash`; this belongs beside them, and it is skipped — not failed — when the manifest carries no hash, because a mismatch that cannot be observed must not be asserted.

## What it deliberately does not cover

**The Warden prompt.** `promptHash`, unchanged. A golden of it would be a copy of the file.

**Fixture data.** `corpusVersion`, unchanged — a content hash over fixture bytes. Note it does *not* move when a checker changes, which is why the `TOOL-SYNTAX-LEAK` addition left it at `1c2a418cf68c`; that gap is `harnessVersion`'s to fill and it fills it badly, for the reasons above. Extending this mechanism to the checker registry is a reasonable next step and is not taken here.

**Playtest telemetry.** `adventure_telemetry` records `snapshotSent` but stores the GM context render as a *count* (`originalRequest.systemBlocks`), so the assembled prompt is only half recoverable for a playtest — where eval runs archive it in full in `warden-request.json`. That asymmetry is backwards, since the playtest is what fixture capture reads from, and it is left open rather than fixed here: the proportionate shape is probably a per-turn hash plus the full text once per adventure, not 7.5 KB × 58 turns.

**Naming.** `assemblyHash`, not `promptShapeHash`. `buildSessionRequest` is the assembly step and that is exactly what is fingerprinted; a name beginning with `prompt` would read as a variant of `promptHash` when the two are "the file" and "everything else".

**Addendum — `assemblyHash` is a function of the build, not of the commit, and a stale workspace package produces a hash no commit corresponds to.** Recorded 2026-08-21 from the spec 019 re-baseline, `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`.

That run recorded `harnessVersion 1458aaf` and `assemblyHash 8e332e38`. The same commit produces **`6dc28608`** on a machine with a current workspace build, which is the value spec 019 pre-registered. The gap is `@uv/game-systems`: the eval host was running a `dist` built before `ADR-0101` added `revealed` to `EntitySchema`, and `ASSEMBLY_PROBE.campaignStateData` is constructed with `MothershipCampaignStateSchema.parse` — so Zod stripped the unknown key and the probe rendered `undiscovered` for entities that carry `revealed: true`. Reproduced exactly: deleting `revealed` from the probe's entities before rendering yields `8e332e38` to the character.

**Nothing the Warden read was wrong, which is what makes this worth recording rather than merely fixing.** The probe feeds the hash and the goldens and is never sent; fixtures reach the turn path through a cast (`session.service.ts:282`) rather than a parse, so `revealed` rendered correctly in every request — verified against the archived `warden-request.json`, and the run's tool definitions are byte-identical to the committed `tools.txt`. The measurement stands. What is wrong is the label on it.

**Two holes this exposes.**

- **The hash absorbed a dependency version silently, which is the failure mode this entry exists to prevent, one level out.** `ADR-0099` reasoned about edits to *our* source moving the hash. It did not consider that the same source can render two different surfaces depending on what `node_modules` and the workspace `dist` hold, and a hash that varies with the build cannot serve as run identity — `eval:compare` pairs on it and will call two runs incomparable, or comparable, for reasons no commit explains.
- **The goldens would have caught it and were not run.** `session.assembly.spec.ts` asserts the rendered surfaces match the committed files; against a stale `@uv/*` build it fails. A green `npm test` on the eval host is therefore a precondition for a run being labelled, and nothing enforces that today.

**Not fixed here.** The obvious candidates — fold resolved `@uv/*` versions into the hash, or have `eval:run` refuse to start unless the assembly goldens pass — are a change with its own design questions, and the entry that records the requirement should not also invent the mechanism. **Resolved in M7.7 by the second candidate** — `assertAssemblyGoldensCurrent` refuses `eval:run` against a stale workspace build; see the addendum below and [[0102-the-judge-contract-gets-its-own-identity-and-the-verdict-fol]].

**Addendum, 2026-08-23 — the playtest-telemetry gap is closed, and the shape this entry
proposed for it was wrong.**

This entry left the GM context render *"only half recoverable for a playtest"* and suggested
*"a per-turn hash plus the full text once per adventure."* That shape assumed the blob is
essentially static. Spec 019 Part 4a established that it is not.

**Recomputing after the fact does not work either.** `gm_context` (`db/schema.ts:202`) is a
single mutable row with an `updatedAt` and no history: turn 0 survives in
`adventure_synthesis_snapshots`, the current value is live, and every intermediate state is
gone. Nine of 58 turns of the 2026-08-16 playtest wrote `npcStates`, which destroyed the
cartographer's authored agenda ([[0101-visible-is-line-of-sight-not-discovery-only-position-is-stru]]),
and nothing can now say which turns read the original and which read the mood note that
replaced it.

**So the once-per-adventure copy would have been actively misleading.** The hash would tell
you the text changed while the single stored copy is the wrong text — leaving a reader
certain they had lost something and unable to recover it.

**Store-on-change instead, and that is what shipped.** `adventure_telemetry.payload` is
JSONB, so the render lands as `originalRequest.gmContext: { hash, text? }` — hash every turn,
`text` only when it moves off the previous turn, and always on a turn whose predecessor is
unknown, which is the safe direction. The previous hash is read inside the same transaction
before the insert (`latestGmContextHash`), in the repository layer. `systemBlocks` stays as a
count beside it; it answers a different question. **Absent `text` means identical to the last
turn that carried text, never unknown**, and that is asserted rather than assumed.

One copy on a quiet adventure, ten on the 2026-08-16 playtest, and this entry's 7.5 KB × 58
worst case only for an adventure that genuinely rewrote its context every turn — which would
itself be worth seeing.

**The asymmetry this closes was backwards.** Eval runs archive the whole assembled request in
`warden-request.json` and are replays of things that already happened; the playtest is what
fixture capture reads *from*, so the artifact needing the most provenance had the least.

### [ADR-0102](decisions/0102-the-judge-contract-gets-its-own-identity-and-the-verdict-fol.md) — The judge contract gets its own identity, and the verdict follows the reasoning

`ADR-0099` gave the code-built Warden surfaces an identity and, in its addendum, recorded that the identity varies with the build rather than the commit. Both halves of that entry turn out to be one defect with two faces, and the second face is on the grading side: **an identity that does not cover the surface it names.** `assemblyHash` missed the build; `rubricHash` missed the judge contract. Both were invisible in the same run, `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`.

`rubricHashFor` (`eval/checks/registry.ts:595`) is `hashPromptText(rubricTextFor(checkId))` — the rubric template and nothing else. Outside it sat `JUDGE_VERDICT_TOOL`, the judge system prompt, `JUDGE_MODEL`, and the closing instruction, which no prior write-up listed and which states the order the model is asked to work in. Changing any of them changes how every judged tag is graded and moved **no identity at all**: `manifest.completedReps[].rubricHashes` unchanged, `eval:compare --filter-rubric CHECK=HASH` still matching, the "graded by different checker code" warning silent. A before/after boundary that reads as like-for-like and is not.

## A separate hash, not a wider `rubricHash`

`ADR-0099` rejected widening `promptHash` on the historical record. The case here is stronger, because rubric hashes are not merely quoted in prose — they are **filenames on disk** (`rubrics/<hash>.txt`, `eval/runs/paths.ts:91`) and the right-hand side of `--filter-rubric CHECK=HASH`. Redefining what the token covers would reinterpret every recorded value in hindsight *and* rename every artifact carrying one.

`ADR-0099`'s rule settles which mechanism each half gets: **hash the file when the thing is a file, use a golden when what you care about is what code produces.** A rubric template is authored text and its content is its identity — `rubricHash`, unchanged. The tool schema, the system prompt and the closing instruction are assembled by `judge.ts`, so they get the `assemblyHash` treatment: a live hash over a labelled render, backed by a committed `.txt` golden. `JUDGE_MODEL` is folded in despite being neither a file nor a surface — it is the largest single determinant of a verdict, and a run graded by a different model is not comparable to one that was not.

**This is a new entry rather than an `ADR-0099` addendum** because that entry's scope is *the code-built prompt surfaces* — what the Warden reads. The judge is the grader, and a reader looking for "which judge graded this run" would not search there. It extends `ADR-0099`'s reasoning rather than replacing it; neither is superseded.

## Scoring identity is recorded, not asserted

`judgeContractHash` lives on the score row, the completed rep, the judge artifact and the variance row — **not** at the manifest top level, and **not** in `assertManifestMatches`.

`assemblyHash` is *input* identity: frozen for a run, and asserted, because appending reps across a change would mix two prompts under one run id. The judge contract is *scoring* identity, and scoring is re-doable — `eval:rescore` re-grades frozen artifacts into `rescore/<timestamp>/` while `manifest.json` keeps its creation-time values, so a manifest-level field would describe the original grading and mislabel every re-score. `harnessVersion` is already per-row for exactly this reason. `rubricHashes` set the precedent that scoring identity is made visible rather than asserted, and this follows it.

Re-graded rows take the current contract; **carried-forward rows keep the source's**, or every re-score containing one would look like it spanned a judge change.

`eval:compare` warns at **run level** rather than per check, and that asymmetry with the mixed-rubric warning is the point: the harness ships one rubric per judged check, so several rubric hashes in a run is normal. The contract is process-wide, so two of them means the whole run was graded two ways — no subset to filter to, and the remedy is `eval:rescore` rather than a flag. An absent hash reports as **unknown**, never as a match.

## The goldens now gate the runs

`ADR-0099`'s addendum left two candidate fixes for the build-varying hash and chose neither. The cheaper and more honest one is taken here: the goldens already detect a stale `@uv/*` build exactly, and nothing required them to have been run. `assertAssemblyGoldensCurrent` refuses `eval:run`; `assertJudgeContractGoldenCurrent` refuses `eval:run`, `eval:rescore` and `eval:judge-variance` — every entry point that can spend judge calls. Neither is covered by `--skip-preflight`, following `assertNoStubCheckers`: that flag is for assertions about the environment, and these are about whether the label being written is true.

Folding resolved `@uv/*` versions into the hash was rejected. A hash that moves on every dependency bump reintroduces `harnessVersion`'s failure — a signal that fires every time is one people learn to skip.

## `rationale` before `passed`

The tool call is forced (`toolChoice: { type: 'any' }`) and a model emits an object's fields in schema order, so with `passed` first the boolean was produced before a word of reasoning existed and could not be retracted once the rationale talked its way out of it. A scan of all 1,341 `judge-*.json` on disk found six verdicts contradicting their own rationale — every one a `fail` under a rationale arguing the turn was fine, with **zero** in the converse direction across 940 passes. That asymmetry is the hypothesis showing up in the data.

**Shipped on measurement rather than on the argument**, because it is not obviously a pure win: a verdict conditioned on reasoning is better calibrated, but a long rationale can also talk itself into a conclusion. `eval:judge-variance` ran on both sides of the change against 38 frozen inputs, 114 judge calls each, under a decision rule pre-registered before either run.

**The result, and the single strongest piece of it.** `roll-result-inversion` rep 004 carried *both* contradictions on the before side, closing on *"there is nothing confirmable as inverted"* and *"this does not fail the rubric on the stated criteria"* — under `verdict: fail`. After the swap the same frozen input returns `pass` three times, reasoning the same way. Same argument, verdict now following it. Contradictions across the after side: **zero**, by direct read of the one failure and a converse scan of all 112 passes.

Two things kept honest rather than tidied away. `hidden-info-leak`'s flip rate moved 0.00 → 0.10, passing the rule by exactly zero margin. And one trial in 114 errored where the before side had none — plausibly a model running long on the rationale and omitting the now-last `passed` field, equally plausibly a transient API failure, and one event cannot separate them. `judgeVarianceRowSchema` now persists `errorMessage` so the next run can attribute what this one could not.

## What this deliberately does not cover

**The structural checkers.** `corpusVersion` hashes fixture files and says nothing about the code that grades them; this covers the judged half only. Declined on repair cost rather than severity — `eval:rescore` regrades deterministic checkers for free, so a structural mislabelling is undoable at zero spend, where the judged half has no such hatch. Recorded in full as
[[0108-no-identity-for-the-structural-checkers]].

**Accuracy.** Flip rate measures grader stability against frozen input; a judge that is stably wrong scores perfectly on it. Nothing here establishes that a verdict is *correct*, which is `§ M7.8`'s remit and needs known answers.

**The six other judged checks.** The change applies to all nine; the evidence covers three. The trigger for buying the rest is recorded in the spec rather than pre-emptively spent.

### [ADR-0104](decisions/0104-spatial-errors-two-failure-modes.md) — Spatial narration errors are two failure modes, not one

**The 2026-08-24 playtest narrated ship movement wrongly six times, and the six look
like one failure mode.** Adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b`, 52 turns.
Turn 8 has Danny leave the bridge and climb *down to the deck below* to reach the
engineering records terminal, which `worldFacts.ship_layout` places on the upper deck aft
of the bridge. Turn 14 takes him from that terminal *past mid-deck and on toward the
lower deck* to Mara's berth; berths are mid. Turn 18 repeats it. Turn 21 places the cryo
bay *two decks from here* and the bridge *two decks up* in one sentence, which cannot both
hold from one position. Turn 24 places Petrov *two decks from the engine room* when
`worldFacts.crew_roster` puts him in it. Turn 28 puts the cryo bay *two decks away* from a
scene explicitly set in the mess hall, which is the same deck.

**They are two, and the line between them is whether the fixture contains the answer.**
`worldFacts.ship_layout` states which deck each place is on and renders verbatim in all
52 snapshots, so it is seeded into any fixture captured from this adventure. Danny's
current deck is stated nowhere in state at all — the snapshot emits four sections
(`<resource_pools>`, `<entities>`, `<flags>`, `<world_facts>`) and none is spatial,
`grid_entity` is unread and does not contain the player, and `narrative.location` is a
scenario descriptor fixed at synthesis. A checker can compare a claimed deck against
`ship_layout`. Nothing can evaluate *two decks from here* without knowing where *here* is.
That is the difference between a gradeable tag and a category-three tag, and it is why one
finding produces two registrations.

**The first kind manufactures the false premises the second kind then reasons from
correctly.** Turn 21 was narrated from Mara's berth, which turn 14 had wrongly placed on
the lower deck seven turns earlier. From the lower deck, *bridge two decks up* is right.
The arithmetic was sound and the position it operated on was a fiction the Warden had
authored itself and never recorded. Scoring both under one tag would double-count one root
cause and erase the ordering, which is the most actionable thing the playtest produced
about this failure: the lookup errors are upstream, and fixing them removes some of the
distance errors without touching distance reasoning at all.

**Decision, in two parts.**

- **`SEEDED-CANON-CONTRADICTION`** — narration asserts something contradicting a concrete
  value resident in the fixture's seeded state or seeded opening narration. Judged, not
  structural: extracting the claim from prose is classification, and structural checks may
  read event and state structure only. A response making no such claim is
  `not_applicable`, not a pass.
- **`SPATIAL-RELATION-ERROR`** — the Warden asserts a relative spatial claim that is wrong
  given the layout and the acting entity's actual position. Registered as **category
  three**: a question that would be structural if the schema recorded an additional field.
  Every rep returns `not_applicable` naming `current_location` as the missing field, until
  that field exists.

**`SEEDED-CANON-CONTRADICTION` is deliberately scoped wider than the spatial cases.** The
unifying property is not that a claim is spatial; it is that its referent lives in the
fixture, which is what makes the tag gradeable at all. Two subtypes are attested. Layout
contradictions against `ship_layout` (turns 8, 14, 18), and a timeline contradiction at
turn 1, which places the mid-deck lighting failure *since day four* against a seeded
opening narration saying the fixtures went dark *two nights ago*, aboard a ship three weeks
out. A third subtype appears at turn 24, where the contradicted value is where a *person*
is (`crew_roster`) rather than where a *place* is (`ship_layout`). Five instances across
three kinds of case. Registering `DECK-LOOKUP-ERROR` and a
timeline sibling separately would mean generalising later against a corpus already
committed to the narrow shape, and the standing defer-until-a-second-case principle is
satisfied here by a second *kind* rather than a repeat.

**The judge cannot see seeded state, so the ground truth has to be injected.**
`runJudgeCall` builds the rubric text, the winning response's `playerText`, a dump of this
turn's `gameEvents`, and an optional `judgeContext` block. No `seededState`, no
`campaignState`, no `worldFacts` — and since `summarizeGameEvents` shows only what the turn
*wrote*, a seeded value never appears there either. The mechanism is `judgeContext`, which
receives the fixture and can render `fixture.seededState.campaignState.worldFacts` into the
scope block; `unauditableMappingJudgeContext` is the existing precedent.

**The rubric is authored with `requiredFacts: []`, and that is a durability decision
rather than a shortcut.** Rubric text lives in `eval/checks/judged/rubrics.ts` and is
outside `corpusVersion`, so a rubric revision is scoring-only — frozen artifacts stay valid
and `eval:rescore` re-grades them in place. `assertion.facts` lives inside the fixture file
and is not. Putting the contradicted value in `requiredFacts` would therefore pin the
fixture files to the provisional rubric's fact set, so any later revision changing that set
costs a `corpusVersion` bump. With an empty fact set and the ground truth injected through
`judgeContext`, the first rubric is a revisable draft rather than a permanent commitment,
and getting it wrong is cheap.

**The injection sits in a hash blind spot, which is a separate defect and gets a separate
entry.** `judgeContext` output is covered by neither `rubricHash` (which hashes the
template alone) nor `judgeContractHash` (model, system prompt, closing instruction, verdict
tool) nor `corpusVersion`. Two runs can therefore carry identical identities on every axis
while the judge read different material — the shape `ADR-0099`'s addendum exists to
prevent, and pre-existing, since `unauditable-mapping` already sits in it. Mitigated here by
sourcing the injected data from `fixture.seededState`, so the *data* falls under
`corpusVersion` and only the renderer is unhashed, plus a committed golden on the renderer.
Hashing the output directly is the wrong instrument: it varies per fixture and per run, so
it would not be a stable contract identity in the way `rubricHash` and `judgeContractHash`
are, and what needs coverage is the renderer's behaviour rather than its output.

**Considered and rejected.**

- **One tag covering all six errors.** Rejected on the causal argument above: it
  double-counts turn 14 as turn 21 and hides which fix comes first.
- **A narrow `SEEDED-CANON-CONTRADICTION` restricted to spatial claims.** Rejected because
  the turn 1 timeline case has the identical gradeable property and would force the
  generalisation later at higher cost.
- **Deferring `SPATIAL-RELATION-ERROR` until `current_location` exists.** Rejected because
  registration is free — the registry is harness-side and moves neither `promptHash` nor
  `assemblyHash` — and because registering it now means the tag converts when the field
  ships rather than being invented late. Note the report must distinguish a tag gated by a
  *declared* missing schema field from one gated by accident; `MISSING-CANON-CAPTURE`'s
  three runs of 0/10 are the second kind, and reading them the same way at a glance is the
  hazard.
- **A third tag for turn 9's silent retcon.** Asked directly whether he had changed decks,
  the Warden asserts Danny is on the upper deck and *never had to take the ladder shaft down
  at all* — restoring `ship_layout` correctly while flatly denying turn 8's narration. The
  correction is right; the failure is that it is unacknowledged. One instance, entangled
  with a defensible behaviour, and a different mechanism from the turn 20/21 retcon defect
  which is about state committed and not reversed. Logged, not registered. Revisit on a
  second instance, and do not merge the two on the strength of both containing the word
  retcon.

**Measurement hazard this decision creates.** The `ADR-0101` addendum of the same date
recommends restructuring `ship_layout` from a ~700-character prose run into a deck-indexed
list — a Warden-visible intervention aimed at precisely what
`SEEDED-CANON-CONTRADICTION` measures. If it lands in the same batch as the fixtures, the
tag's first number is post-intervention with nothing to compare against, and the effect of
the one intervention most worth knowing about is unrecoverable. The restructure is a
`worldFacts` edit with no schema change and does not need to ride any particular milestone,
so the cheap resolution is to measure first. Whichever order is chosen, the §6.3 prediction
is written before the run: a prediction too loose to be violated makes category-2
attribution unreachable by construction.

**Cost.** New fixtures are a set-membership `corpusVersion` bump — survivors' artifacts
stay valid and no Warden call is owed for them — and because both tags are new, no existing
tag's denominator moves. The fixtures × N reps are owed whenever they are captured, so
deferring saves nothing and forfeits the coverage — and the candidate set is larger than the
three the roadmap bullet names, since turns 18 and 24 are also fail-direction instances. The provisional rubric's first figures
become citable, so a bump note is written when the rubric is authored rather than when it is
first revised.

**Addendum — `SPATIAL-RELATION-ERROR` is not a category-three tag, and its registration is
deferred.** Recorded 2026-08-25 while annotating the playtest report for fixture extraction.

The claim above is that this tag "would be structural if the schema recorded an additional
field," and that adding `current_location` converts it. `ADR-0074`'s third case does not
admit it. The test that case sets is not that a field is missing; it is that once the field
lands the check reads **no prose at all** — `out-of-order-resolution` compares a named gate's
sequence number, `system-rolled-player-action` attributes through `actingEntityId` "without
reading `purpose` at all," and both cleared it because the fact being graded already lived in
the `roll_dice` payload and the new field completed it.

The fact graded here does not. *"Four hundred and twelve people are asleep two decks away"*
exists only in narration. `current_location` supplies where the acting entity stands; it does
not supply the assertion, and extracting the assertion is classification — the same argument
this entry makes one paragraph earlier to send `SEEDED-CANON-CONTRADICTION` to a judge. So
the field moves this tag from ungradeable to *judged with a better fact injected*, which is
not what category three means: every prior third-case example resolved into the first case,
not into a better-informed judge call.

**Two different checks were conflated.** Grading the prose claim is judged permanently, and
`current_location` improves the `judgeContext` injection exactly as `worldFacts` does for the
sibling tag. Grading the *state writes* — are consecutive `current_location` values
adjacency-legal against `ship_layout` — is genuinely structural, but it is a narrower
question that catches turn 14's misplacement and misses turns 21 and 28 entirely, because a
prose distance claim need not correspond to any state write. Those two turns are the
instances that motivated the tag. This entry describes the first and promises the second.

**Registration is therefore deferred**, reversing the "considered and rejected" bullet above
on its own terms. That bullet rejected deferral because registration is free. It is not free
in the way that assumed: registering forces a choice between `structuralFailureModeTags` and
`judgedFailureModeTags` now, and that is precisely the question that is unsettled. Registering
structural and later moving to judged is the `MISSING-DELTA` / `ROLL-RESULT-INVERSION`
migration, which required an `assertion.mode` edit inside every fixture file carrying the tag
and therefore a `corpusVersion` bump.

Deferral also keeps the guardrail mechanical rather than procedural. `capture-fixture`
validates `--tag` against `failureModeTagSchema` and refuses an unregistered value, so while
the tag is unregistered a fixture cannot be captured against it by accident. Registering it
replaces that gate with a note asking people to remember. Nothing is lost by waiting: the
`SEEDED-CANON-CONTRADICTION` fixtures are unaffected, and no fixture was planned for this tag
in the same batch. Annotating the playtest report with the tag is safe and stays — nothing
reads those annotations, and the 2026-08-16 report already carries unregistered tags.

**`SEEDED-CANON-CONTRADICTION` is unaffected.** Register it, author the rubric with
`requiredFacts: []`, and capture its fixtures as planned.

**One correction to the body above, applied in place.** The third layout contradiction is
**turn 18**, not turn 19 — *"You head back down to the lower deck ... and rap a knuckle
against Mara's hatch"* — and turn 19 contains no deck claim at all. The same error is in the
M7.7 roadmap bullet and in the capture list, which name turn 19 for this instance; the
roadmap bullet has since been corrected. Two further counts moved when turn 24 was added to
the body as a third subtype, and are corrected in place: the playtest narrated ship movement
wrongly **six** times rather than five, and the opening paragraph now enumerates turn 24
alongside the other five. `SEEDED-CANON-CONTRADICTION` stands at five instances across three
subtypes; the six counts all spatial errors including the two that belong to the deferred
tag.

### [ADR-0105](decisions/0105-judgecontext-golden-not-hash.md) — `judgeContext` output is covered by a golden, not a hash

**Four surfaces reach the judge and three of them have a recorded identity.** `runJudgeCall`
assembles the rubric text (template plus `assertion.facts` interpolated), the winning
`gm_response`'s `playerText`, a JSON dump of this turn's `gameEvents`, an optional
`--- Scope of this check ---` block produced by the check's `judgeContext`, and the closing
instruction. Of those, `rubricHashFor(checkId)` hashes `rubric.template` — the
uninterpolated template alone; `corpusVersion` covers `assertion.facts`, since it is a field
inside the fixture file; `serializeJudgeContract` covers the model, the system prompt, the
closing instruction and the verdict tool; and narration and event summary are derived from
the run itself. **`judgeContext` output is covered by nothing.**

**The consequence is that two runs can carry identical identities on every axis while the
judge read materially different material.** `judgeContext` is
`(result: TurnExecutionResult, fixture: EvalFixture) => string` — it receives the fixture and
can render anything it likes into the prompt, including seeded state the judge otherwise
never sees. Editing that function changes what the grader reads and moves `rubricHash`,
`judgeContractHash` and `corpusVersion` not at all. This is the shape `ADR-0099`'s addendum
exists to prevent — a Warden-visible or judge-visible surface built by code and carrying no
identity — reproduced inside the machinery built to prevent it.

**The severity is not "a missing test."** `eval:compare` treats matching identity hashes as
license to compare two runs, and reports a *missing* hash as unknown rather than as a match
precisely so that license is not issued on absent evidence. A surface that is present, that
varies, and that no hash covers means the license can be issued falsely: the comparison
reports like-for-like and is not. Every other gap in the hash coverage produces a warning;
this one produces silence.

**Pre-existing rather than introduced.** `unauditableMappingJudgeContext` has sat in this
gap since `UNAUDITABLE-MAPPING` shipped. It surfaced now because
`SEEDED-CANON-CONTRADICTION` (`ADR-0104`, drafted 2026-08-25) is definitionally a comparison
against seeded state, the judge cannot see seeded state, and `judgeContext` is therefore the
only available injection point — which made the gap load-bearing for a new check rather than
latent in an old one.

**Partially mitigated already, in one direction only.** The rendered output is recorded
per-run in the artifacts (`eval/runs/artifacts.ts:144-150`), so a reader of a given run can
see exactly what was injected. That makes any single run **auditable**. It does not make two
runs **comparable**, because nothing surfaces a difference between them without a manual
read of both artifact sets — and comparability is the property `eval:compare` exists to
assert.

**Decision: a committed golden on the renderer, and no hash over its output.**

Same instrument as `assemblyHash`'s three committed `.txt` goldens: a frozen input rendered
through the real function, the result committed, and a refactor producing identical text
moving nothing while a one-word edit fails a golden by name. Verified by mutation rather
than by argument.

**Hashing the output is the obvious move and it is wrong.** `judgeContext` output varies per
fixture and per run by construction — it is a function of both. A hash over it would move
whenever the corpus or the run moved, which is what `corpusVersion` and the run identity
already express, and it would therefore not be a stable contract identity in the way
`rubricHash` and `judgeContractHash` are. Those hash a *contract*: a thing that is fixed
across fixtures and changes only when someone changes it. The renderer is the contract here;
its output is not. What needs coverage is the renderer's behaviour, and a golden covers
behaviour where a hash would only re-express variability that is already labelled.

**Where the injected data should come from, as a corollary.** Data rendered from
`fixture.seededState` falls under `corpusVersion`, because the fixture file is hashed. Data
constructed inside the renderer does not fall under anything. So a `judgeContext` that
*selects* from the fixture leaves only the selection logic uncovered, while one that
*authors* content leaves the content uncovered too. Prefer selection, which is also what the
field's own doc comment endorses — *"One implementation selects; the judge grades what it
hands over."*

**Alternatives considered.**

- **Hash the rendered output.** Rejected above: not a contract identity, and re-expresses
  variability already carried by `corpusVersion` and the run identity.
- **Fold `judgeContext` into the rubric template.** Would inherit `rubricHash` coverage for
  free, and is impossible: the template is static text and the whole purpose of
  `judgeContext` is to render per-fixture data into the prompt.
- **Move the injected values into `assertion.facts`.** Would inherit `corpusVersion`
  coverage, and is rejected on a cost that falls elsewhere: `assertion.facts` lives inside
  the fixture file, so pinning a check's ground truth there commits every fixture carrying
  that tag to the current rubric's fact set, and any later revision changing that set costs
  a `corpusVersion` bump on all of them. Recorded at length in `ADR-0104`, where the
  `requiredFacts: []` decision for `SEEDED-CANON-CONTRADICTION` turns on exactly this.
- **Leave it and rely on the artifacts.** Rejected: auditability after the fact is not
  comparability, and the failure this gap produces is a silent false match rather than a
  missing record.

**Scope.** Two goldens are owed — one for the new `SEEDED-CANON-CONTRADICTION` renderer,
landing with its capture work in M7.7 because it is a prerequisite for using the mechanism
honestly there, and one for `unauditableMappingJudgeContext`, which is this entry's own work
in M7.8. Any future check adding a `judgeContext` adds a golden with it. Whether that is
enforceable by construction — the way `structuralCheckers` is typed
`Record<StructuralTag, ...>` so a missing checker is a compile error rather than a silent
`undefined` — is an open question worth answering while the goldens are being written, since
a convention that depends on remembering is the same class of thing this entry is
correcting.

**Incidental, found in the same read.** The comment in `fixture.schema.ts` stating that the
stub refusal *"is currently in force for the whole corpus"* is stale: `STUB_CHECK_IDS` has
been empty since 2026-08-20 and `assertNoStubCheckers` no longer blocks a full run. Correct
at the source rather than patching around it.

### [ADR-0108](decisions/0108-no-identity-for-the-structural-checkers.md) — Structural checkers get no identity hash — the repair hatch is what makes them different

**Decided 2026-08-22, and recorded so the omission reads as a decision rather than an
oversight.**

**The gap is real.** `corpusVersion` hashes fixture *files*, so it answers "did the inputs
change" and says nothing about the code that grades them. Adding `TOOL-SYNTAX-LEAK` left
`corpusVersion` at `1c2a418cf68c` while the runs began measuring something they had not
measured before. [[0099-the-code-built-prompt-surfaces-get-their-own-identity-separa]] named
this and declined it — *"extending this mechanism to the checker registry is a reasonable
next step and is not taken here"* — and spec 020 covers only the judged half, via
`judgeContractHash` ([[0102-the-judge-contract-gets-its-own-identity-and-the-verdict-fol]]).
The structural half (`system-rolled-player-action`, `out-of-order-resolution`,
`tool-syntax-leak`) still carries no identity. `harnessVersion` cannot serve as one, for the
reason it never could: it is the git short SHA and would fire on every comparison
([[0066-harnessversion-is-the-git-short-sha-not-a-hand-maintained-co]]).

**Decision: no hash. The reason is repair cost, not severity.** Structural checkers are
deterministic and `eval:rescore` regrades them for free — no Warden calls, no judge calls.
A run mislabelled by a checker edit is therefore repairable after the fact at zero spend,
by rescoring both sides under today's registry and comparing those.

**The judged half has no such hatch.** That is precisely why the two known data corrections
in `docs/eval-methodology.md` are still prose corrections rather than repaired numbers. The
two halves look symmetrical and are not, and that asymmetry is the whole justification.

**Revisit if** a structural checker edit ever lands that `eval:rescore` cannot undo. A
checker that reads something no longer present in the archived artifact would be that case.

### [ADR-0112](decisions/0112-unreversed-retcon-is-judged-and-the-reversed-turn-s-committe.md) — `UNREVERSED-RETCON` is judged, and the reversed turn's committed deltas are captured

## Context

**Turn 20 of the 2026-08-24 playtest adjudicated a check against the wrong target, and
turn 21 fixed the fiction without fixing the world.** Danny attempts to crack an
insurance file; the roll comes in at 48. The player's own message says *"I have
Computers +10"* — in the same turn, before the adjudication — and the Warden resolves it
against an unmodified Intellect 40, narrates a hard failure with a tamper alert, and
commits two things for that outcome: `stress +1` on `danny`, whose `reason` names the
failed check, and `insurance_scam_exposed` held at `false`.

The player says so: *"I have computers +10, so that 48 would be under the total of 50."*
Turn 21 agrees, and it is right to — Trained is +10, the target is 50, and 48 clears it.
It narrates the moment again as a clean success, flips the flag to `true`, and writes an
`npcState`. The stress point stays. The turn's own notes state the reason it stays:

> Overwrote the prior narrated failure/lockout outcome this turn since **no lasting
> state had been committed to it beyond narrative flavor**.

That claim is false, and the fixture carries the `state_update` proving it. Every
subsequent turn is built from a `danny.stress` of 3, one point of which was charged for
an event the fiction no longer contains.

**`ADR-0104` had already isolated this mechanism and declined to name it.** Reviewing six
continuity errors from the same playtest, it registered `SEEDED-CANON-CONTRADICTION`,
deferred `SPATIAL-RELATION-ERROR`, and set turn 9's silent retcon aside as "one instance,
entangled with a defensible behaviour, and a different mechanism from the turn 20/21
retcon defect which is about state committed and not reversed." This entry registers that
second mechanism.

## Decision

**Register `UNREVERSED-RETCON` on its single instance, as a judged check, graded against
a newly captured fixture field.**

### Registered on one instance, which is a departure worth stating

`ADR-0104`'s own bar was a second instance before registering turn 9's retcon, and this
tag clears no such bar. Three things separate them. The roadmap already commits to this
one as an M7.7 deliverable. The failure is a state-integrity defect rather than a
narrative one — a wrong number in the world that every later turn compounds, not a
paragraph a reader might disagree about. And the behaviour that produces it is not
entangled with anything defensible: the retcon itself is correct and is explicitly
excluded from the rubric, so the tag names only the half that has no argument for it.

### Judged, not structural

The subject of the check — that a turn reversed an outcome an earlier turn narrated —
lives in the narration and nowhere else. `ADR-0074` bars a structural check from
classifying prose, and "you reel the moment back the way it should've gone" is prose. The
comparison that follows a detected reversal is mechanical, and both sides of it are now
captured data, but reaching the comparison is the part that is not.

**A structural version was designed and is recorded here because it is the obvious
move.** It would gate on the one structural trace a reversal leaves — this turn writing a
key the preceding turn also wrote, `insurance_scam_exposed` going `false` → `true` — and
then grade whether the preceding turn's other committed deltas were offset. It is
deterministic, free, and non-lexical, and it fails on coverage: a reversal that overwrites
nothing leaves no trace at all. A turn can narrate the failure away and simply emit less,
which is the shape a Warden that believes "no lasting state was committed" will most often
produce. Gating on the overwrite measures the subset of retcons that happen to touch the
same key, and reports it as the rate for all of them.

The alternative structural framing — stipulate the reversal in the fixture and grade only
whether the stress was offset — was rejected for the opposite failure. A Warden that
re-examines the arithmetic and declines to retcon has committed no violation, and would
score a `fail` for the absence of a delta it correctly did not owe.

### Graded against `seededState.precedingCommittedTurn`, a new v3 capture field

**Nothing in a fixture carried what the reversed turn committed.** Everything under
`seededState` is state *as of* the target turn, which is the fold of every prior delta:
by construction it records where the world ended up and not who moved it there. The
folded `campaignState` carries `danny.stress = 3` and no trace that a turn added 1 of it,
for a reason that no longer applies. `seededState.messages` are narration only — `role`
and `content`, no `stateChanges`. So the check's ground truth was absent from both modes,
not just from the judged one.

`capture-fixture` now records the last **committed** turn before the target: the winning
`gm_response`/`correction` payload's `stateChanges`, paired with the `applied` block of
the `state_update` that committed it, plus that response's sequence number.
`FIXTURE_SCHEMA_VERSION` moves 2 → 3 and `unreversed-retcon` declares
`requiresFixtureSchema: 3`, so a v2 fixture — whose `null` means *never captured* rather
than *nothing was committed* — reports `not_applicable` instead of an exclusion it never
earned. This is the first judged check to declare the field, which surfaced that
`buildChecks` read `REQUIRES_FIXTURE_SCHEMA` only in the structural loop; `runCheck`
applies the gate before dispatching on mode, so the omission would have been a silently
ignored declaration rather than a type error.

**Both halves are captured, because they answer different questions.** `stateChanges` is
what the Warden emitted — the deltas, and the `reason` text on each, which is where the
causal link to the reversed outcome lives. `applied` is what the validator committed —
resulting values, which is what "committed" means and what a rejected change would be
missing from. The prior value is the difference between them, and is deliberately left as
a difference: see the renderer note below.

### Every kind of committed state counts

Pools, flags, entities, world facts, character state — not only numeric pools. The
instance in hand is a pool, and a rubric scoped to pools would name the tag after its
first example. The cost is a judgment the rubric has to carry explicitly: state the
reversed turn committed *for reasons that survive the reversal* is not owed an undo, and
the rubric says so rather than leaving the judge to infer a scope.

## Consequences

**A `judgeContext` golden ships with the renderer**, per `ADR-0105`. This is the third,
after `SEEDED-CANON-CONTRADICTION` and `UNGROUNDED-CONTRACTOR-TARGET`;
`unauditableMappingJudgeContext` remains the one uncovered renderer and remains M7.8's
work. The catalog reports the state per check (`task docs:eval-tags`), so the gap is
visible rather than remembered.

**The renderer selects and computes nothing.** `ADR-0105`'s corollary is load-bearing
here in a way it was not for `SEEDED-CANON-CONTRADICTION`: the interesting number is the
*prior* value of a changed pool, and that is arithmetic. Computing it inside the renderer
would put an arithmetic claim in front of the judge as ground truth, carrying no identity
and answerable to no hash — so the two blocks are rendered verbatim and the difference is
left for the judge to take. A spec asserts the absence.

**`corpusVersion` moves**, as it does for any corpus addition — one new fixture,
`2c0ba938-turn21-unreversed-retcon`. The check's `applicabilitySource` is `'artifact'`
under the weakest-link rule, and carries the same caveat `SEEDED-CANON-CONTRADICTION`
does: a turn that reverses nothing is `not_applicable` in principle and a pass in
practice, because a judged check has no route to `not_applicable` except through its gate
and deciding that case means reading prose. The rubric requires the judge to name it in
those terms so the artifacts stay separable.

**The prior narration reaches the judge from `messages`, not from the new field.** The
renderer takes the last `gm` message in the seeded window, which is not provably the same
turn as the captured deltas — `precedingCommittedTurn` skips back past a turn that
committed nothing, while `messages` carries every narration. They coincide on every
fixture captured so far. The renderer labels the section as the last narration the player
was shown rather than asserting a pairing it cannot verify.

## Alternatives considered

- **Hand-author the reversed turn's deltas into `assertion.facts`.** Free — the fixture
  file falls under `corpusVersion` already — and rejected on the cost `ADR-0104` records
  for `SEEDED-CANON-CONTRADICTION`'s `requiredFacts: []`: pinning ground truth there
  commits every future fixture carrying this tag to the current fact set, and a later
  rubric revision changing that set costs a `corpusVersion` bump on all of them. It also
  moves a transcription step into fixture authoring, where a typo becomes ground truth.
- **Grade against the folded state alone, with no capture change.** Rejected as
  unreachable rather than expensive: the fold has already destroyed the distinction the
  check is about.
- **Capture the `state_update` payload only.** Cheaper, and loses the `reason` text —
  which is the only field linking a committed delta to the outcome being reversed. A
  judge shown `stress: 3` with no stated cause cannot tell what the reversal owes.
- **A structural check.** Recorded above at length, in both its gated and stipulated
  forms.
- **Fold this into `MISSING-DELTA`.** Superficially close — both are about a gap between
  narration and emitted state — and wrong in direction. `MISSING-DELTA` asks whether a
  turn failed to emit a change it described; this asks whether a turn failed to emit a
  change it *un*-described. Merging them would make one tag's rate mean two things, which
  is the objection `ADR-0104` raises against a single tag for six errors and
  `fixture.schema.ts` raises against merging `SCENE-JUMP` into `OVER-RESOLUTION`.

## Open items

1. **The tag has one fixture and will report a rate on one turn.** `ADR-0082`'s reading
   applies in advance: a rate that never moves is a harness suspect before it is a
   finding. A second instance is worth capturing when a playtest produces one, and the
   scenario is cheap to steer toward — tell the Warden its arithmetic was wrong on a roll
   that already cost something.
2. **Whether a `judgeContext` renderer without a golden should be a compile error** is
   still the open question `ADR-0105` left, and is now three-for-four rather than
   two-for-three. A convention that depends on remembering is the thing that entry was
   correcting.

### [ADR-0113](decisions/0113-the-duplicate-turn19-turn21-fixtures-are-kept-as-tripwires-a.md) — The duplicate turn19/turn21 fixtures are kept as tripwires at `repOverride: 1`, not retired

## Context

`turn19-out-of-order-resolution` and `turn19-system-rolled-player-action` are the same
turn — sequence 82 of adventure `18be155e`, identical `playerInput`, and `seededState`
differing only in `capturedAt`, which is provenance and never read at eval time. The
turn21 pair is the same at sequence 95.

**They exist because selection used to be 1:1 with `tag`.** Covering two failure modes on
one turn required two files. `ADR-0096` removed that constraint, and the widening recorded
in `docs/eval-findings.md § S37` acted on it: both `-out-of-order-resolution` fixtures now
carry a `system-rolled-player-action` check. That makes each sibling's check set a **strict
subset** of its partner's — `{system-rolled-player-action, tool-syntax-leak}` against
`{out-of-order-resolution, system-rolled-player-action, tool-syntax-leak}` — on the same
turn, from the same seeded state.

**The duplication is real spend, not a filing quirk.** `eval-run.core.ts:350-391` seeds a
fresh scratch campaign per fixture per rep and calls `sessionService.sendMessage` for each,
with no memoisation on seeded state. Two fixtures with identical input are two independent
draws costing two Warden turns. At N=10 the two siblings cost 20 turns per full-corpus run.

## The evidence, and why it points both ways

Across all seventeen archived runs the two siblings have produced **28
`SYSTEM-ROLLED-PLAYER-ACTION` failures** — 19 on turn19, 9 on turn21. The behaviour is
real and both scenarios provoke it.

It has also been absent for a long time:

| Period | Failures |
|---|---|
| 2026-07-29 (Sonnet 4.6) | 14 / 17 |
| 2026-08-09 | 11 / 20 |
| 2026-08-10 → 08-16 | 3 across four runs |
| **2026-08-18 → 08-24, seven runs** | **0 / 134** |

**The recurrence pattern is what decides this.** On 2026-08-09 the fixtures were clean at
`14-37-36Z` and produced eleven failures at `21-23-39Z` — the same day. A behaviour that
can return within one day after a clean run is not settled by seven clean runs; it is
dormant. `§ A model swap audits the harness as much as the model` records the same shape
one level up: the 4.6 → Sonnet 5 swap surfaced defects no number of 4.6 runs could show.

## Decision

**`repOverride: 1` on `turn19-system-rolled-player-action` and
`turn21-system-rolled-player-action`.** They stay in the corpus, keep their ids, and run
once per full-corpus pass instead of ten times.

`repOverride` is consumed at `eval-run.core.ts:284` as
`Math.min(args.reps, fixture.repOverride)`, resolved into a map *before* the rep loop
begins, which is what makes "no adaptive mode" a structural property rather than a
promise. The mechanism already existed and was tested; nothing is built here.

**What this buys.** Cost falls from 20 Warden turns per run to 2. The fixture ids stay in
the corpus, so `eval:compare` keeps pairing them on `(fixtureId, checkId)` against every
archived run. And a regression that returns at anything like the historical rate meets a
live fixture rather than a deleted one.

**What it costs, stated plainly.** At N=1 a fixture's own rate is uninterpretable — one
rep is a tripwire, not a measurement, and anyone reading `SYSTEM-ROLLED-PLAYER-ACTION`'s
per-fixture breakdown must read these two rows as present-or-absent rather than as a rate.
The thin denominator is at least visible, because `ADR-0083` puts applicability beside
every rate.

## Alternatives considered

- **Keep both at full N.** 20 turns per run for a second draw on a behaviour with no live
  signal in 134 consecutive reps. The insurance is worth something; it is not worth ten
  times the cheapest version of itself.
- **Retire the two siblings.** The first instinct, and it discards two things that cost
  nothing to keep: the `(fixtureId, checkId)` pairing that lets `eval:compare` reach every
  archived run, and the tripwire. Retirement is right when a fixture is *measuring the
  harness* — `turn16-narrating-past-a-block`, `turn02-missing-canon-capture` — and these
  are not; they measure the Warden and have caught it 28 times.
- **Consolidate onto one fixture per turn.** Identical in effect to retiring, since the
  survivor would have to be the `-out-of-order-resolution` file — `out-of-order-resolution`
  is not tag-independent and can only reach a fixture carrying its tag — so the sibling's
  id is what disappears either way.
- **Retire them and rely on the `turn24-*` trio for this tag.** Rejected on the same
  evidence that motivated `ADR-0096`: a tag measured on a narrow set of scenarios is a
  claim about those scenarios. Nineteen of the 28 failures are on turn19, a scenario the
  `turn24-*` fixtures do not reproduce.

## Consequences

**This is a fourth kind of corpus bump, and `§ Two kinds of corpus bump` names three.**
Editing `repOverride` changes the fixture file, so `corpusVersion` moves — but no input
reaching the Warden changed, no grading of existing output changed, and no fixture was
added or removed. What changes is the **sample size going forward**. Frozen artifacts stay
exactly as valid as they were and `eval:rescore` is unaffected; future denominators shrink,
so a rate compared across this change needs the same like-for-like-on-shared-fixtures
treatment a set-membership bump needs. Worth adding to that section as a named kind rather
than left to be re-derived.

**The tripwire has to be read to work.** A fixture at N=1 contributes one row, and one row
among hundreds is easy to skim past. This is only insurance if someone looks at the
per-fixture breakdown after a run — which `ADR-0082`'s "a rate that never moves is a
harness suspect" already asks for, and which this decision now depends on.

**What would reverse it.** A single failure on either sibling means the behaviour is back
and the fixtures should return to full N to measure it. So would a model swap or a prompt
change touching roll ownership: this decision is calibrated on seven clean runs under one
model and one prompt family, and neither is a permanent condition.

---

## Monorepo, Tooling & Deployment

### [ADR-0086](decisions/0086-repo-named-unicorn-not-unicorn-vtt.md) — Repo named `unicorn`, not `unicorn-vtt`

The monorepo houses Zoltar and Unicorn VTT. Zoltar is not a VTT — `unicorn-vtt` misrepresents the contents. `unicorn` names the product family correctly.

### [ADR-0087](decisions/0087-npm-workspaces-over-turborepo.md) — npm workspaces over Turborepo

Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.

### [ADR-0088](decisions/0088-traefik-routes-defined-in-file-provider-not-docker-labels.md) — Traefik routes defined in file provider, not Docker labels

Traefik routes for `app.zoltar.local` and `api.zoltar.local` are defined as file-based dynamic config (`infra/traefik/dynamic/host-routes.yml`) rather than as Docker labels on the `backend` and `frontend` compose services. Docker labels only exist on running containers — in Workflow B (the daily development loop), those containers aren't running, so label-based routes produce a 404. File-based routes pointing to `host.docker.internal` work in both workflows: in Workflow B the apps run directly on the host, and in Workflow A Docker publishes container ports to the host. One routing mechanism covers both cases.

### [ADR-0089](decisions/0089-single-main-branch.md) — Single `main` branch

No `main`/`develop` split. The value of a develop branch is protecting a stable branch from in-progress work when there are multiple contributors or a CI/CD pipeline deploying from `main`. Neither applies for solo development at this stage. Tagged releases provide the stable reference point. Revisit when there are collaborators or a deployment pipeline that warrants it.

### [ADR-0095](decisions/0095-plans-and-specs-are-committed-to-the-repo.md) — Plans and specs are committed to the repo

`docs/plans/` and `docs/specs/zoltar/` are tracked in the repository and stay tracked.

**This records current practice, not a fresh decision.** An earlier practice kept plans and specs out of the repo. That reversed at some point without either the original policy or the reversal being written down, and the reasoning behind either is not recoverable — so this entry states what is true rather than reconstructing why it became true.

**What made the gap visible.** A bullet in M9's documentation-reorganization item proposed pruning accumulated `docs/specs/zoltar/` entries on the grounds that they are "ephemeral by policy," citing a policy that exists nowhere in `docs/`. The citation had been dangling since it was written, because the policy it named had been reversed and the reversal never recorded. The clause was removed rather than repointed on 2026-08-16, since with specs committed and kept there is no standing policy that makes them sweepable.

**Why they stay, as observable from how they are used rather than as remembered rationale.** Decisions entries and specs cite plan files by path, so removing them would break references that the validator now enforces. A CC session loads them as working context; they are a substantial part of what makes a fresh thread productive. And a plan's git history is the record of how a milestone was actually sequenced, which the milestone's own commits do not capture.

**What this does not settle.** Whether plans and specs are *public* artifacts is a separate question and stays open in the M9 bullet, which notes that `decisions.md` is arguably the most valuable thing to publish and `docs/plans/` the least. Tracked in the repo and published to a `v0.1.0` audience are different commitments; this entry makes only the first.

### [ADR-0106](decisions/0106-handoff-format.md) — Cross-Context Handoff Format

## Purpose

Zoltar development runs across two Claude contexts: **Claude Code** (CC), which
has repo and database access and — as of this experiment — authors decisions,
ADRs, eval methodology, and implementation; and **Claude Web** (CW), which
reviews CC's work. Work moves between them by copy/paste of individual turns.

This format exists so that a pasted turn is unambiguously a handoff, states what
response is wanted, and bounds what the receiver should do. Its main job is
keeping review substantive: CC authors from inside the code, so the risk is not
factual error but unexamined framing — alternatives never considered, principles
that cost effort now to save it later, reasoning that evaporates with the session.

## Envelope

Every handoff opens with a fenced `handoff` block containing the header, followed
by unfenced body sections.

    ```handoff
    from: CC | to: CW
    re: ADR-0107 draft
    ask: review-decision
    scope: reasoning only — implementation plan is settled
    limit: 300 words
    ```

### Header fields

| Field | Required | Meaning |
|---|---|---|
| `from` / `to` | yes | `CW` or `CC`. |
| `re` | yes | Subject. Prefer a stable identifier (`ADR-NNNN`, spec number, milestone). |
| `ask` | yes | What response is wanted. Closed set, below. |
| `scope` | no | Explicit bound on what the receiver should do. |
| `limit` | no | Word cap on the response. |

### `ask` values

- `review-decision` — argue with the reasoning. The primary path.
- `verify-claims` — check the stated claims against the code; report verdicts only.
- `sanity-check` — open-ended; flag anything that looks wrong.
- `fyi` — no response needed.

Anything not on this list means the sender hasn't decided what they want.

---

## Primary path: `review-decision` (CC → CW)

### Outbound body

    DECISION
    <what was decided, in one or two sentences>

    REASONING
    <why — the argument, not a restatement of the decision>

    ALTERNATIVES
    A1. <option considered> — rejected because <reason>
    A2. <option considered> — rejected because <reason>

    PRESSURE
    <what CW should push hardest on, or "open">

`ALTERNATIVES` is the section most likely to be skipped and the one most worth
keeping. An implementer writing from inside the code records what was chosen and
drops what was dismissed, because the dismissal happened in a session that then
evaporates. `decisions.md` is supposed to hold both.

`PRESSURE` names the part the author is least sure of. Without it, review
gravitates to whatever is easiest to comment on.

### Return body

    BLOCKING — <the decision does not hold as written; say why>
    CONCERN  — <the decision holds but something is unaddressed>
    NOTE     — <minor, take it or leave it>
    UNCHECKED — <a premise CW cannot verify without the code; CC should confirm>

    VERDICT: proceed / revise / blocked

Severity first, one entry per line, no preamble. `UNCHECKED` is the reviewer's
counterpart to a wrong claim: CW cannot see the repo, so any point resting on
what the code actually does is flagged and handed back rather than asserted.

An empty return is a legitimate outcome. `VERDICT: proceed` with no entries above
it means the reasoning holds.

---

## Secondary path: `verify-claims` (CW → CC)

For the cases where CW does draft something — an ADR, a methodology note — that
rests on assertions about the current codebase.

### Outbound body

    CLAIMS
    C1. `session.validator.ts` seeds entity writes from a hand-enumerated field list.
    C2. The advisory lock spans `applyTurnAtomic` only, not the full turn cycle.

    BODY
    <the ADR, decision, or question>

Each claim is one checkable assertion about the code, stated separately from the
reasoning that depends on it. Separating them makes verification mechanical and
makes the document honest about what it assumes.

More than three or four claims means the artifact should have been drafted in CC,
where the code is. This format is for checking work, not transmitting specs.

### Return body

    C1 CONFIRMED — `entity.merge.ts:88`, list at L40–52.
    C2 WRONG — lock acquired in `turn.service.ts:210`, released after event
       emit. Spans the full cycle.
    C3 (unstated) — `judgeContext` renderer is invoked before the lock.

    VERDICT: revise C2, then proceed.

One line per claim. Verdict first (`CONFIRMED` / `WRONG` / `PARTIAL` / `UNVERIFIABLE`),
then `file:line` evidence. `PARTIAL` and `UNVERIFIABLE` carry a one-line reason.

`(unstated)` entries are for premises the sender got wrong that do not block the
plan. Without a slot for them they go unmentioned, and false premises accumulate
in the record reading as settled fact.

---

## Rules

1. **Correct at the source.** A `BLOCKING` or `WRONG` verdict means the originating
   document is edited. Working around it downstream leaves the record wrong.
2. **Do not exceed `scope`.** If the scope looks mistaken, say so in the return
   rather than acting outside it.
3. **`fyi` means no reply.** Returning a review to an `fyi` handoff is noise.
4. **Review is not comprehensive.** CW sees what it is shown. A decision whose
   reasoning is not written down cannot be reviewed, and framing that both
   contexts share will not be caught by either.

## Open questions

- Whether `review-decision` returns stay useful without code access, or degrade
  into restating the argument back. This is the load-bearing question for the
  experiment; `UNCHECKED` is the early-warning signal — if most entries are
  `UNCHECKED`, review is running on guesses.
- Whether `ALTERNATIVES` survives contact with implementer-authored ADRs, or has
  to be reconstructed after the fact.
- Whether the block should be recorded in `decisions.md` when a verdict changes an
  ADR, or whether the corrected ADR is sufficient record.

---

## Licensing & Business Strategy

### [ADR-0090](decisions/0090-license-elastic-license-2-0.md) — License: Elastic License 2.0

Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

### [ADR-0091](decisions/0091-open-source-release-proceeds-as-designed-no-closed-source-ca.md) — Open-source release proceeds as designed; no closed-source carve-out for prompts or graph orchestration

Considered and rejected: closing the Warden prompts, and/or any future LangGraph-style orchestration logic, as a competitive moat against a funded competitor forking the public repo.

Rejected on threat-model grounds, not technical ones. The TTRPG tooling space doesn't attract funded competition at this scale — campaign/worldbuilding tools have ~3 players with no direct head-to-head competition (e.g. Dungeon Scrawl), VTTs consolidate rather than multiply despite looking easy to enter, and the hobby's active resistance to AI shrinks the addressable market in a way that makes it a poor target for outside funding in the first place. A funded competitor materializing at all is judged unlikely.

Even granting a funded competitor with 3 FTEs, estimated time-to-market with full repo access (architecture, schemas, tool definitions, oracle table structure, and prompts) is ~4-7 months to reach current parity, versus ~7-11 months reverse-engineering from the live app alone — a gap of roughly 2-4 months. That gap is smaller than a plausible solo-dev hiatus and is mostly attributable to the architecture/schema decisions in this log, not the prompt text specifically — so a prompt-only closure wouldn't meaningfully close it anyway, and closing the architecture layer instead would break the self-hosted config-only story (`AUTH_PROVIDER`, `REALTIME_PROVIDER`, etc.) that depends on that layer staying legible.

Real protection against a funded competitor, if one ever appears, is shipping velocity and the eval harness / fixture corpus / failure-mode taxonomy — accumulated evidence that isn't copyable by reading code — plus per-user `campaign_canon` accumulation as a retention moat. These require no licensing decision and are being built regardless.

ELv2 remains the license for the reasons already in this log (managed-service restriction, consistency with other Automata Codex projects) — not as competitive protection, since it offers no real recourse against a "probably but not provably" copy in any case.

This closes the "open-source release decision" previously flagged as unresolved. Public repo, self-hosted-first build sequence, and M9 milestone scope (Docker Compose production config, self-hosted setup guide, DigitalOcean walkthrough) all stand as currently planned.

### [ADR-0092](decisions/0092-saas-service-implementations-stay-closed-source-enforcement.md) — SaaS service implementations stay closed source — enforcement rationale, not competitive secrecy

Unlike the Warden prompts and any future graph orchestration logic, the concrete SaaS implementations of the service interfaces (`ClerkAuthService`, `StripeEntitlementsService`, `AblyRealtimeService`, the RLS migration scripts and tenant-aware middleware, etc.) remain closed source when built. This is a different rationale from the open-source decision above and should not be read as contradicting it.

These implementations carry little competitive-secrecy value on their own — they are mostly integration glue against third-party APIs (Stripe, Clerk, Ably) that a competent engineer could reproduce in days regardless of prior access. The moat reasoning that justified keeping the Warden prompts and graph open does not argue for closing these; there was never much moat value here to protect.

The reason to keep them closed is that they are the literal technical mechanism that makes the ELv2 single-tenant restriction real. The open core is single-tenant by omission, not by enforcement — no RLS policies, no tenant-aware query layer, no `org_id` isolation, no billing wiring. If the multi-tenant RLS migrations and Stripe billing logic were included in the public repo, anyone would have the missing piece needed to stand up a competing managed service on top of Zoltar's own code — precisely the outcome the ELv2 restriction exists to prevent, and a more concrete risk than a competitor reading a prompt file.

This costs nothing to maintain, unlike a prompt/graph closed-source boundary would have: self-hosted already runs on structurally different implementations (Noop and local defaults per the service-interface table), so there is no shared artifact to split or distribution boundary to police. It is closed by the natural shape of the interface/implementation split, not by extra engineering effort spent defending it.

---

## Security

### [ADR-0093](decisions/0093-prompt-injection-risk-acknowledged-not-addressed-at-mvp.md) — Prompt injection risk acknowledged, not addressed at MVP

Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.
