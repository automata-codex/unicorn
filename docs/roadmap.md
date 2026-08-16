# Roadmap

This document tracks planned work by phase. Per-feature specs live in `docs/specs/` and are written when a feature is about to be built. This roadmap is scope-focused — no time estimates.

Phase 1 is organized in two sections:

- **Feature Requirements** — the inventory of *product* scope, organized by domain. These are the canonical task lists for what the application does. Development tooling — playtest review, replay infrastructure, the eval harness, rules ingestion — is deliberately not inventoried here; it appears only as delivery milestones, because it is scope that exists to support building the product rather than scope the product ships.
- **Delivery Milestones** — the sequence in which work is built and shipped. Each milestone is independently testable and represents a meaningful step toward the phase target. Most milestones include both frontend and backend work. Unplanned work that extends a shipped milestone is noted in that milestone's summary rather than given an entry of its own.

---

## Phase 1 — MVP (Open Core, Self-Hosted)

Target: a playable solo Mothership adventure on a personal Droplet.

---

### Completed

#### Milestone 1.0 — Manual GM Context Prototyping

Validate the campaign creation and play loop manually before building any pipeline. This milestone produces no shippable code — it produces confidence that the GM context design is right and that oracle table entries are rich enough to sustain a session. Discoveries here are cheap to act on. Discoveries after the pipeline is built are not.

- [x] Write a rough synthesis prompt by hand
- [x] Select oracle results manually (no filtering UI — just pick entries)
- [x] Paste in a Mothership character sheet
- [x] Ask Claude to produce a GM context blob in a plain conversation
- [x] Run one or two sessions manually — construct the state snapshot by hand each turn, no backend
- [x] Evaluate: is the GM context rich enough? Does the oracle entry `claude_text` produce strong output or generic output? Are the interface hints doing useful work? How long does the GM context get in practice?
- [x] Revise oracle table entries and synthesis prompt until output is consistently good
- [x] Document what the structured section needs to contain based on what the manual sessions revealed
- [x] Document the gold-standard GM context quality bar based on playtest findings — what the Persephone's Wake context got right, as a written rubric for evaluating future synthesis outputs

---

### Feature Requirements

#### Backend Foundation

The NestJS application structure, database connectivity, and core data model. No game logic — just the skeleton everything else hangs on.

- NestJS module hierarchy established (`CampaignModule`, `AdventureModule`, `GridModule`, `AuthModule`, etc.)
- PostgreSQL connection via Drizzle ORM with `node-postgres` driver
- Flyway migration setup in Docker Compose (`infra/db/migrations/`)
- Initial migration: core relational tables (`campaigns`, `adventures`, `messages`, `gm_context`, `character_sheets`, `campaign_state`)
- Initial migration: grid tables (`grid_cells`, `grid_entities`)
- Initial migration: `game_events` audit table
- Initial migration: `adventure_telemetry` table (append-only, one row per turn, JSONB payload column) — infrastructure-level diagnostic telemetry, distinct from the player-facing session export format
- `map_geometry` stub table (not implemented, reserved for Phase 3)
- Docker Compose setup for local development (Postgres + NestJS + Svelte + Flyway)
- Environment config loading and validation

#### Auth & CRUD

- Magic-link auth (`AuthService` interface + backend-owned session management)
- Signup mode config (`SIGNUP_MODE`: `open` | `invite_only` | `disabled`; `INVITE_TOKEN` for invite_only mode) — enforced at registration time via `AuthService`; admin UI and per-user invite tokens deferred to Phase 3 SaaS account management
- Service interface stubs: `EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`
- Noop implementations for all deferred service interfaces
- Mothership Zod schemas — campaign state shape and character sheet shape
- Basic CRUD endpoints for campaigns and adventures
- Frontend: auth flow (login, adventure management), campaign list, adventure list shell

#### Oracle Tables & Character Creation

- Mothership oracle tables — survivors, threats, secrets, vessel type, tone (versioned JSON files)
- Oracle table filtering data model — active/inactive entries per category, range dials
- Character creation flow — Mothership mechanical character creation producing a character sheet that seeds oracle weighting
- Frontend: oracle filtering UI (activate/deactivate entries, range dials), character creation UI

#### Campaign Creation (Solo Blind)

The Solo Blind campaign creation pipeline: oracle table filtering, coherence check, and GM context synthesis. This is a significant Phase 1 feature — the adventure is only as good as the GM context that seeds it. Milestone 1.0 must be complete before this pipeline is built.

- `submit_gm_context` tool definition (Zod schema)
- Rationalize state snapshot fields and finalize read/write contract between snapshot and tool schema
- Coherence check — three-tier resolution (silent reroll, silent synthesis resolution, player surfacing)
- GM context synthesis — Claude constructs GM context blob from resolved oracle results and calls `submit_gm_context`
- `submit_gm_context` write path — validates structured section, writes GM context blob and initial entities to DB
- Entity ID alignment — entity identifiers in the structured section match what session tools reference from turn one
- Pending canon queue — auto-promote in Solo Blind; queue infrastructure in place for other modes (Phase 2)
- Frontend: full Solo Blind adventure creation flow wired end-to-end

#### Claude API Client & Prompt Assembly

- `submit_gm_response` tool definition (Zod schema) including `proposed_canon` field
- State snapshot builder — visibility-filtered, GM context injected; must include `flagTriggers` object adjacent to flag values (mutable, updated when new flags are added during play via `stateChanges.flagTriggers`), `characterAttributes` block for persistent qualitative character state (armor mode, weapon loadout, active conditions); must omit entity position fields.
- Claude API client with prompt caching for GM context blob
- Prompt structure: `[GM context blob] → [state snapshot] → [last N kb of messages]`
- Rolling N-kb message window — measure in kb not message count; threshold TBD in spec (32–48 kb likely)

#### GmService & State Management

- `GmService` orchestrating the full request/response cycle
- Backend state change validation (resource deductions, HP thresholds, flag changes)
- State change application to DB
- `proposed_canon` routing — write entries to pending canon queue; auto-promote in Solo Blind
- `game_events` write path (all state changes logged with sequence numbers)
- Correction mechanic (`superseded_by` write path)
- `adventure_telemetry` write path — per-turn record of player input, full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, prompt and completion token counts
- Frontend: play view (message log, input field)

#### Tools

> **Adjudication scope note:** Phase 1 has no formal rule evaluator. Mechanical adjudication for Mothership is Claude's responsibility, informed by the rules lookup tool rather than confabulation. The backend enforces structural constraints only (resource availability, HP thresholds, death triggers). The full constraint module system and rule evaluation engine are Phase 3 work. This is an acceptable tradeoff for Mothership — it's a slim ruleset and the horror is in the fiction more than the mechanics.

- `roll_dice` tool — dice notation parser, server-side execution, audit log write; audit log records player-entered vs system-generated rolls
- Rules lookup tool — vector embedding pipeline for Mothership rules text; pgvector extension on Postgres; query endpoint
- Tool call routing in `GmService`
- Frontend: dice entry UI — "roll for me" button and manual raw roll entry (with explicit modifier language: "enter the number showing on the die")

#### Multiplayer Foundation

- Caller role enforcement — only the caller can submit input
- Voluntary caller transfer
- Caller request with configurable auto-approve timeout
- Offline claim (caller disconnected)
- Narrative transfer via `caller_transfer` in `submit_gm_response`
- Initiative mode — adventure mode flip, initiative order stored in adventure record
- `advance_initiative` handling in `GmService`
- Frontend: caller indicator and transfer UI, initiative order display and active player highlighting

#### Self-Hosted Deployment

- Docker Compose production configuration
- Environment variable documentation
- Signup mode documentation — `SIGNUP_MODE` options, `INVITE_TOKEN` usage, and recommended configuration per deployment persona (personal, friend group, semi-public)
- Self-hosted setup guide
- DigitalOcean Droplet deployment walkthrough
- Responsive polish pass on frontend (thumb reach, viewport refinement)
- First tagged release (`v0.1.0`)

---

### Delivery Milestones

#### M1 — Dev Environment & Data Model

*Infrastructure only — no game logic, no UI. Everything else depends on this.*

- [x] Docker Compose local dev setup (Postgres + NestJS + Svelte + Flyway)
- [x] NestJS module hierarchy, DB connection via Drizzle ORM + `node-postgres`
- [x] Flyway migration setup; all Phase 1 migrations (core tables, grid tables, audit/telemetry tables, `map_geometry` stub)
- [x] Environment config loading and validation
- [x] Service interface stubs + noop implementations for all deferred services

#### M2 — Auth, Campaign & Adventure CRUD

*First shippable frontend + backend slice.*

- [x] Magic-link auth (`AuthService` interface + backend-owned session management)
- [x] Add Traefik to local dev stack
- [x] Mothership Zod schemas (campaign state, character sheet)
- [x] Basic CRUD endpoints for campaigns and adventures
- [x] Frontend: auth flow, campaign list, adventure list shell

#### M2.5 — Design Sprint

*Establish visual foundation before any feature UI is built. Mobile-first throughout.*

- [x] Primitive token definitions (`themes/base.css`)
- [x] Mothership theme — semantic token layer (`themes/mothership.css`)
- [x] Base component set: button, input, panel, typography scale — styled against Mothership theme, mobile-first
- [x] Mobile layout sketches for play view (message log, input, character status, dice UI)
- [x] Mobile layout sketches for oracle filtering and character creation flows

#### M3 — Oracle Tables & Character Creation

*The raw material for GM context synthesis.*

- [x] Mothership oracle tables — versioned JSON files (survivors, threats, secrets, vessel type, tone)
- [x] Oracle table filtering data model (active/inactive entries, range dials)
- [x] Character creation flow (mechanical Mothership character creation, seeds oracle weighting)
- [x] Frontend: oracle filtering UI (activate/deactivate, range dials), character creation UI

#### M4 — Solo Blind Campaign Creation Pipeline

*End-to-end adventure creation: from oracle picks to GM context in DB.*

- [x] `submit_gm_context` tool definition + write path
- [x] State snapshot fields rationalized; read/write contract between snapshot and tool schema finalized
- [x] Coherence check (three-tier resolution: silent reroll, silent synthesis resolution, player surfacing)
- [x] GM context synthesis (Claude constructs blob from resolved oracle results, calls `submit_gm_context`)
- [x] Entity ID alignment
- [x] Pending canon queue + auto-promote for Solo Blind
- [x] Frontend: full Solo Blind adventure creation flow wired end-to-end

#### M5 — Claude API Client & Prompt Assembly

*Get a coherent GM response back from Claude. No state changes applied yet. Spatial system and rolling summary deferred; see decisions.md.*

- [x] Migrate client-side router to `svelte-spa-router` v5 (prerequisite for M6 play view layout; see hash URL tradeoff note in M3 spec)
- [x] `submit_gm_response` tool definition (including `proposed_canon` field)
- [x] State snapshot builder (visibility-filtered, GM context injected, `flagTriggers`, no entity positions; `characterAttributes` deferred — `MothershipCampaignState` has no source field for it yet, block is omitted per the spec's "omit if empty" rule, see `docs/decisions.md`)
- [x] Claude API client with prompt caching for GM context blob
- [x] Prompt structure: `[GM context blob] → [state snapshot] → [last N kb of messages]`
- [x] Rolling N-kb message window (measure in kb; threshold per spec)

#### M6 — GmService & State Management

*Apply GM responses to game state and close the play loop. Spec: [`docs/specs/zoltar/006-m6-state-management.md`](specs/zoltar/006-m6-state-management.md).*

- [x] `GmService` orchestrating request/response cycle (lives on `SessionService`; the `GmService` name is retired — one session service, not two)
- [x] Backend state change validation (resource deductions, HP thresholds, flag changes) + application to DB
- [x] `proposed_canon` routing + auto-promote in Solo Blind
- [x] `game_events` write path (all state changes, sequence numbers)
- [x] Correction mechanic (`superseded_by` write path)
- [x] `adventure_telemetry` write path (per-turn: player input, full `submit_gm_response` payload, token counts; `roll_dice` records remain an empty-array stub until M7)
- [x] Frontend: play view (message log, input field, character status strip, threshold banner)

#### M7 — Tools

*Dice and rules lookup wired into the play loop.*

- [x] `roll_dice` tool (dice notation parser, server-side execution, audit log; records player-entered vs system-generated rolls)
- [x] Rules lookup tool (vector embedding pipeline, pgvector, query endpoint)
- [x] Tool call routing in `GmService`
- [x] Frontend: dice entry UI — "roll for me" button and manual raw roll entry paths

#### M7.1 — Playtest Review Tooling

*Turn-by-turn readback of `game_events` and `adventure_telemetry` for playtest analysis. Scoped here rather than M6 because M7 is the first milestone that produces playtest-worthy adventures — review tooling earns its keep against runs with dice and rules lookups in place, not M6's smoke-test turns. No web UI; a CLI script is the deliverable.*

- [x] SQL views joining `game_events` and `adventure_telemetry` (per-turn, per-state-history, per-correction)
- [x] CLI script that produces a turn-by-turn markdown report for a given adventure id
- [x] Sanity-check the `adventure_telemetry` payload shape against a real Mothership run and adjust if fields are missing or redundant
- [x] Warden prompt versioning in production: persist version on each telemetry row, surface in M7.1 review output (parity with the playtest app's Setup dropdown — deferred from M7, see `docs/specs/zoltar/007-m7-ai-tools.md § Deferrals Introduced in M7`). Versioning is filename + content-hash rather than a semantic version number.

#### M7.2 — Rules Ingestion Pipeline

*Populate the `rules_chunk` index for Mothership. M7 ships runtime plumbing (`rules_lookup` tool, `VoyageService`, pgvector query) but leaves the index empty so playtest evidence from M7 can prioritize ingestion coverage. Separate milestone because the pipeline is Python, not TypeScript, and is independently testable. Spec: [`docs/specs/zoltar/012-m7.2-rules-ingestion.md`](specs/zoltar/012-m7.2-rules-ingestion.md).*

- [x] Python ingestion pipeline under `ingestion/` (marker extraction, `chunks` output format → column-aware block sort → footer-derived page/chapter attribution → block-based merge toward a ~400-token target → Voyage document-mode embedding → SQL insert). Supersedes the original `###`-heading-boundary design, a confirmed dead end at 10 headings against a 100–400 chunk target (`docs/rules-extraction-findings.md § S1.5`)
- [x] One-time local seed of Mothership rules chunks from the PDF
- [x] Column-aware block sort ahead of chunk merging — marker's emitted block order is not reading order on multi-column pages, scrambled (including full reversals) on roughly half the measurable pages (`docs/rules-extraction-findings.md § S6.2`); a geometric sort on each block's bbox recovers 15 of 16 measurable pages (`§ S7`). Blocking: the chunker's "merge in order" step is wrong without it
- [x] Query preprocessing for `rules_lookup` — document-frequency-based term-dropping before matching, per `docs/decisions.md § Query preprocessing for rules_lookup promoted from optional to critical path`. Mechanical, no LLM call, proven on both FTS and dense retrieval (`docs/rules-extraction-findings.md § S4`, `§ S5.3`) — the largest retrieval-quality effect measured in the whole M7.2 investigation
- [x] Fixup patch scaffolding for chunk-level corrections, matched on block `id` (e.g. `/page/11/Table/5`), not `{section, contains}` — `contains` has no text to match on empty `Table` blocks, and `section` derives from `section_hierarchy`, a confirmed dead end (`docs/rules-extraction-findings.md § S6.5`)
- [ ] **Deliberately unresolved in M7.2 — shipped as a known gap, not an oversight.** Resolve the 14/32 empty `Table` blocks (physical pp. 11–12, FIREARMS and INDUSTRIAL EQUIPMENT, lost entirely) — fixup-file entry vs. a second extraction pass on table regions; not yet scoped (`docs/rules-extraction-findings.md § S3.2`)
- [ ] **Deliberately unresolved in M7.2 — a placeholder policy ships (page citation, no chapter breadcrumb).** Fallback chapter attribution for the 5 footer-less pages (physical 0, 1, 2, 10, 43) — page 10 (equipment continuation) is reachable body content and most needs an answer before ingestion can attribute it correctly (`docs/rules-extraction-findings.md § Open questions`)
- [x] Hash-verification step to detect source-document drift between re-ingestions
- [x] Ingestion smoke tests (chunk count, embedding dimensions, system_id tagging)
- [x] Retrieval eval harness — page-labeled fixtures scored deterministically for recall@3/@5 and MRR, with unanswerable questions included so a similarity floor is derivable. Voyage calls only, no judge, so it is cheap enough to run on every chunking change. This is the ruler M7.5 iterates against; without it, "did that chunking change help?" is unanswerable. **Fixture queries must reflect real Warden phrasing (verbose, sometimes off-vocabulary), not hand-authored tidy questions — a harness built on idealized queries cannot detect the failure mode `docs/rules-extraction-findings.md § S4`–`S5` found, and would report a quality bar the Warden's actual queries never clear.** 596 real `rules_lookup` queries are already recorded in `unicorn-artifacts` (`§ S8`) and are the intended source — they need page labels added, and the eval-run sample skews toward combat (fixture design, not play), so draw across fixture tags rather than by raw frequency

**M7.2 closed 2026-08-07.** Shipped: the Python pipeline (`ingestion/`, `task
ingest`), 66 chunks indexed for Mothership, query preprocessing, and the
retrieval eval harness (`task eval:retrieval`) with a 49-fixture labelled set.
**Baseline handed to M7.5: recall@3 94.6%, MRR 0.811 over 37 answerable
queries — authored 100.0%, warden-observed 91.3%** (`docs/rules-extraction-findings.md § S15`).

Three results M7.5 inherits rather than has to rediscover: document-frequency
query trimming has no useful setting on this corpus, so the shipped threshold
is deliberately inert (`§ S15.3`); no similarity floor separates answerable
from unanswerable queries at current quality (`§ S15.4`); and one migration was
needed after all — `V18__rules_chunk_hnsw_index.sql`, because an ivfflat index
built by a migration against an empty table silently under-returned (`§ S14`).

#### M7.3 — Turn-State Replay Infrastructure

*Prerequisite for M7.4 (Warden Eval Harness): automatic, no-action-required capture of an adventure's true starting state, plus a way to fold that state forward through the existing event log to reconstruct any later turn. Replaces the M7.1 `save-synthesis` script, which only ever handled the zero-turn case. Spec: [`docs/specs/zoltar/009-m7.3-turn-state-replay-spec.md`](specs/zoltar/009-m7.3-turn-state-replay-spec.md).*

- [x] Automatic turn-0 capture — new `adventure_synthesis_snapshots` table, written once per adventure inside the existing synthesis-commit transaction; `save-synthesis` removed as redundant
- [x] `load-synthesis` sources its starting state from `adventure_synthesis_snapshots` by adventure id, not a hand-supplied JSON file
- [x] One-off script to import the pre-M7.3 playtest adventures' legacy `save-synthesis` output into the new table
- [x] Consolidate `applyToCampaignState` and `mergeNpcAgendas` into one pure `applyValidatedTurn` function covering both `campaign_state.data` and `gm_context.blob`
- [x] `sequence_number` column added to `pending_canon`, populated from the same per-adventure counter `game_events` uses
- [x] `reconstructStateAsOfTurn(db, adventureId, targetSequenceNumber)` — folds turn-0 state forward through `game_events` (plus `pending_canon`, plus `messages`) to reconstruct state going into any turn of any adventure

#### M7.4 — Warden Eval Harness

*Regression suite for Warden prompt candidates against known failure modes surfaced by real playtests (out-of-order tool resolution, hidden-info leaks, unauditable state changes, etc.). Drives the real turn pipeline in-process rather than reimplementing it; seeds each fixture's starting state via M7.3's `reconstructStateAsOfTurn` rather than any bespoke save/load mechanism. Spec: [`docs/specs/zoltar/010-m7.4-eval-harness-spec.md`](specs/zoltar/010-m7.4-eval-harness-spec.md). **Extended after shipping** by unplanned multi-run infrastructure — reps, machine-readable score rows, paired comparison, and re-scoring of frozen artifacts — spec: [`docs/specs/zoltar/011-eval-harness-multi-run.md`](specs/zoltar/011-eval-harness-multi-run.md), referred to as M7.4.1 in `Taskfile.yml` and `docs/eval-methodology.md`. That work was never a planned milestone and deliberately has no entry of its own.*

- [x] `EvalFixture` format — adventure id + target sequence number, player input, structural and/or judge-graded assertions, failure-mode tag. Shipped as `sourceAdventureId` / `sourceSequenceNumber` plus a `seededState` block captured statically at authoring time, rather than a live `savePointRef` the harness re-derives per run — see `eval/fixture.schema.ts`. Also carries fixture-authored `applicability`, `fixtureSchemaVersion`, and `repOverride`, none of which the spec anticipated
- [x] Structural assertion checkers — deterministic, no second LLM call (e.g. tool-call ordering)
- [x] Judge-graded assertions — single grading call per fixture, Claude Sonnet 5, one rubric per failure-mode tag (not per fixture)
- [x] Harness CLI — shipped as `eval:run` (execution) + `eval:report` (rendering), not the single `eval:harness` named here; see `docs/decisions.md § eval:harness retired, not kept alongside eval:run`. `--fixtures` and `--output` as specified, `--prompt` rather than `--prompt-variant`, and no `--tag` — a second overlapping selector was deliberately not built (`scripts/eval-run.ts`). A/B comparison is still two invocations, though `eval:compare` now renders the diff instead of leaving it manual
- [x] Markdown output report (summary by tag, per-fixture failure detail) — `eval/runs/report-multi.ts`: per-fixture rates, per-tag rollup, errors, exclusions, applicability findings
- [ ] Fixtures for each failure-mode tag identified in real playtests, at least 2 confirmed instances per tag where the fixture-count bar requires it — 15 fixtures cover all 9 tags, but `MISSING-CANON-CAPTURE`, `UNSURFACED-CHECK`, `OVER-RESOLUTION`, and `SCENE-JUMP` each still sit at a single instance. The first three are the ones the spec flagged as needing a second confirmed instance before the category counts as covered; `SCENE-JUMP` was added after the spec and inherits the same bar. Blocked on playtest evidence, not on code
- [x] One deliberately-broken counterexample per structural checker, to prove the checker actually fails bad behavior and isn't silently passing everything

#### M7.5 — Rules Retrieval Quality

*Takes the populated-but-unmeasured index from M7.2 and makes retrieval good enough to trust, then buys the Warden-level measurement once, against an index that is not about to change again. Separate from M7.2 because the two have different kinds of completion criteria — M7.2's are binary (the CLI runs, rows land, the harness scores), M7.5's is a quality bar, and quality-bar milestones absorb whatever is adjacent to them. Spec: [`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md`](specs/zoltar/013-m7.5-rules-retrieval-quality.md).*

- [x] Retrieval quality bar set against M7.2's first measurement rather than guessed in advance, with separate targets for authored and Warden-observed query styles, recorded in `docs/eval-methodology.md`. **Set 2026-08-07** — `docs/eval-methodology.md § The retrieval quality bar`, baselined on `§ S15.2` and confirmed to reproduce in `§ S16.1` before the bar was written down. Three targets, never averaged: `authored` recall@3 holds 100.0%, `warden-observed` recall@3 ≥ 95.6%, answerable MRR ≥ 0.85. The deliverable is the bar, not clearing it — the iteration that ran against it closed on the stopping rule (bullet below), and the closing figures plus the "set retrieval bars on recall; report MRR as colour" lesson are recorded alongside it
- [x] Chunking iteration against `task eval:retrieval` — one change per round, each logged in `docs/rules-extraction-findings.md`, including the rounds that made things worse. Closes on the bar or on the stopping rule, whichever comes first. **Three rounds run (`§ S17`, `§ S18`, `§ S19`); closed on the stopping rule with one of three bar metrics met, one missed, one indeterminate** — `authored` held at 100.0%; `warden-observed` recall@3 91.3% against 95.6%; MRR reads 0.842–0.856 across repeated runs at the identical configuration and so straddles its 0.85 bar, which `§ S22` shows cannot be claimed either way. The shortfall is 21 of 23 where the bar asks 22, and both misses are now diagnosed rather than open
- [x] Exclude the character-creation spread (physical pp. 4, 41–42) from the rules index — confirmed unreachable by the Warden: `rules_lookup` is wired only into the play-loop tool array, and character creation makes no Anthropic calls at all. Removes the worst-provenanced pages in the corpus (page 4's footer doesn't resolve; 41–42 are byte-identical duplicates of it) without needing the fallback-chapter question answered for them. (`docs/rules-extraction-findings.md § S2`). **Landed as iteration round 1** (`§ S17`): 66 → 63 chunks, no recall change (these pages answer no fixture), and the 7 of 147 top-3 slots they were consuming recovered
- [x] Check whether physical page 3 (character profile sheet) belongs in the same exclusion as pp. 4/41–42 — not yet confirmed unreachable like those were, but a likely false-positive magnet if left in: it ranked top-3 for two of three queries in `§ S3.7` on pure stat-name density alone (`§ S2`, `§ Open questions`). **Excluded as iteration round 2** (`§ S18`) — but on measured harm, not reachability: it held 10 of 147 top-3 slots and outranked the correct page for two answerable combat queries. Removing it cost no recall and lifted MRR by roughly 0.02 — not, as first recorded, cleanly past the 0.85 bar: `§ S22` found the same configuration alternates between 0.842 and 0.856 across runs
- [x] Vocabulary bridging for `rules_lookup` — test whether prompt-side guidance (steering the Warden's query phrasing toward book vocabulary) closes enough of the gap `docs/rules-extraction-findings.md § S5.3` measured, before committing to a per-system synonym/thesaurus table. Per `docs/decisions.md § Query preprocessing for rules_lookup...`, the prompt-side option is free; the synonym table is real ongoing per-system authoring cost. Not yet decided which is needed
- [x] Mechanical-model primer for the Warden's system prompt — teach Mothership's actual resolution model (roll-under-stat, no DC/target number, no opposed rolls, no flanking) so the Warden stops generating concept-absent `rules_lookup` queries in the first place, rather than merely rephrasing them toward book vocabulary. Distinct from the vocabulary-bridging item above: that targets the wrong-word bucket (S5.3); this targets the concept-absent bucket, which S9 measured at 130 of 344 out-of-corpus queries (37.8%) and found no vocabulary mapping can retrieve (`docs/rules-extraction-findings.md § S8.3`, `§ S9.4`). Evaluate via concept-absent query rate (applicability-style measurement), same pattern already used for `unauditable-mapping` tracking in M8.1
- [x] Test whether including `SectionHeader` blocks in the corpus changes retrieval ranking — currently excluded (169 blocks, 2,632 chars of topic labels), and an untested confound in every `S3`–`S5` measurement so far (`docs/rules-extraction-findings.md § S9.1`). Cheap: rerun `S5`'s ranking method with headers included. **Tested as iteration round 3 and rejected** (`§ S19`): recall@3 91.9% vs 94.6%, and the first change ever to knock an `authored` question off rank 1. It works in both directions — it resurrected printed p.12, whose tables all extract empty so the page was absent from the index entirely, and it handed the p.44 reference card the topic labels it needed to outrank the body pages it restates. Shipped as an opt-in `--include-section-headers` flag, off by default
- [x] Decide whether to dedupe the page 1/43 reference-card duplicates against the body pages they restate, to avoid near-duplicate chunks competing in cosine ranking. **Decided 2026-08-09 and the answer was no** (`docs/rules-extraction-findings.md § S28`). Run as round 4, physical p.43 (printed p.44, the back-cover cheat sheet) dropped and paired with `--include-section-headers`, against a criterion fixed before the run: keep only if `recall@3` holds at 97.3% or better and no fixture regresses. Every aggregate came back identical (`recall@3` 97.3%, `warden-observed` 95.7%, MRR 0.883) and p.44's share of the 147 top-3 slots went 14 → 0 as intended, but `rq-010` regressed rank 1 → 2 — deterministically, verified across five pre-round-4 and three round-4 runs, not the run-to-run reordering `§ S22` catalogued. **Reverted on the criterion**, explicitly to avoid a close call being settled by whoever most wanted the result. Standing decision: `drop_pages: [3, 4, 41, 42]` in `ingestion/mothership/system.json` — the reference cards stay in the index. S28.4 records what would settle it properly: the real conclusion is "this fixture set can no longer discriminate at this level" (36 of 37 passing, one fixture of headroom), so re-run round 4 once the fixture set is extended with equipment coverage. That extension is retrieval-fixture work, not M7.5 scope
- [x] `--markdown` curated-input path on `ingest.py`, bypassing extraction. The capability ships; a curated Mothership Markdown cannot, per `docs/rules-ingestion.md § Licensing Posture`. Format documented in `ingestion/README.md § Curated Markdown input`; `ingestion/tests/test_markdown.py` runs a synthetic document through to finished chunks, which is the first end-to-end pipeline test that needs no marker model weights
- [x] Similarity floor for `rules_lookup` derived from the answerable/unanswerable distributions — or a recorded finding that they do not separate and no honest floor exists yet. Must land before the re-baseline, since it changes what reaches the Warden. **No floor** (`§ S20`, `docs/decisions.md § No similarity floor for rules_lookup`): the distributions overlap and interleave at 0.342–0.416, and the one threshold that looks free is fitted to a 35-point sample minimum. Three chunking rounds moved the distributions by 0.001 and were never going to move them — the lever that does is the mechanical-model primer, not the chunker
- [x] `rollType`/`gatedByRollId`/`actingEntityId` fields on `roll_dice`, plus Warden prompt instructions for populating them — the deferred structural-checker fields from `docs/decisions.md § rollType / gatedByRollId / actingEntityId on roll_dice stay deferred, but they are measurement infrastructure`. Schema and prompt land together: a field the prompt doesn't instruct Claude to populate would still read `not_applicable` at re-baseline, forcing a second one later — exactly the repeated cost the batching was meant to avoid. Must land before the re-baseline. **Landed**: no migration (`dice_roll` payloads are `jsonb`) and no `FIXTURE_SCHEMA_VERSION` bump (the fields appear in live turn output, which fixtures never capture). Both checkers read them, branching on field presence so `eval:rescore` still grades the frozen `88fa84bd8329` artifacts unchanged. `actingEntityId` removes the last prose dependency in the structural checks; `rollType` ships as a descriptive enum with no measurement role, because the record never gave it one — see `docs/decisions.md`
- [x] Re-baseline against the final index — full corpus, uniform N, compared against the re-scored `88fa84bd8329` runs. A populated index changes what the Warden sees (tool results, and plausibly its roll behaviour), so every rate measured against the empty index is provisional. **Done, but it took three runs and a prompt change rather than one run.** `0bdd1306` re-baselined on 2026-08-09 (`§ S31`) and surfaced a regression the milestone did not set out to cause: `SYSTEM-ROLLED-PLAYER-ACTION` 0.90 → 0.45, the Warden resolving the player's declared action itself. Fixed by a prompt ownership/voice change (`§ S32`) and re-measured at `c45a142a` on 2026-08-10 (`§ S33`): the tag reads **1.00 (20/20)**, above July's 0.90, with `UNSURFACED-CHECK` holding at 1.00. **Scope deviation, recorded rather than silent: 4.6 was not re-run.** It carried 10 tool-loop-cap errors on the M7.5 attempt and the upgrade decision was settled in July, so "both models" was retired as unjustifiable spend — see `docs/plans/014-turn19-roll-ownership.md`. `Current baseline N` in `docs/eval-methodology.md` was **updated 2026-08-10** and this bullet is now closed: the record points at `claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z`, notes 4.6's retirement, and flags that N=10 is carried forward rather than re-derived — it was calibrated under a different model, a different prompt, and an empty index, and nothing since has re-measured per-fixture variance
- [x] Close the `§ S30` identifier defect on the product path, then re-baseline. **Both fixes landed 2026-08-10**, written up as amendments in `docs/decisions.md`: synthesis now names the player's `entityId` in the prompt, and drops (write path) or rejects (play-time validator) pool keys that duplicate a player pool under an unresolvable prefix; `renderEntities` emits player ids as a *source* rather than a filter override, so the Warden is told the canonical id instead of inferring one from pool names. **The re-baseline is what remains** — the `<entities>` change alters the Warden prompt and invalidates `c45a142a`. Owed before M7.6 adds further snapshot changes, and measured on its own so any tag movement is attributable to this change rather than to four at once. Watch `SYSTEM-ROLLED-PLAYER-ACTION`, whose `§ S33` repair is one run old. **Done — `claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z` (`§ S34`), 10 reps, zero errors, decision rule met on every clause.** `actingEntityId` now reads `alvarez` (the seeded id) where the baseline read `lt_alvarez` (inferred from pool names), with zero unresolvable ids; all guards held. Baseline record updated. The run's real finding is a corpus hole, carried to M7.7 below rather than left here

#### M7.6 — Character Sheet Fidelity

*Groups the three open pieces of character-sheet work behind the dependency they share: the shape of the sheet itself. `<character_attributes>` has been blocked since M5 on a sheet that "does not cleanly separate armor from loadout or carry conditions" — the same defect the character-creation rework exists to correct — so the schema work that block has been waiting for is this milestone's first bullet rather than a later batch. Sequenced ahead of the playtest, though not for the reason first recorded here: no fixture carries character-sheet data, so a sheet-shape change alone strands nothing. The coupling is to `MothershipCampaignStateSchema`, and it bites because of where this milestone's fields land — under `docs/decisions.md § State placement is decided by the lifetime of the referent, not the lifetime of the value`, stats, saves and the mutable ceilings all move into campaign state, which every fixture does capture. The conclusion survives the correction; the mechanism is different and worth stating accurately, since the wrong version would have justified sequencing a sheet-only change ahead of a playtest that it could not have affected. Internally ordered rather than a bag of three — the creation rework settles the shape, and the two renders read it; built in the other order they get built twice. Unlike M8.1, this milestone owns schema changes, which is why the two render bullets moved here out of it.*

Two findings surfaced by this milestone's analysis are deliberately **not** in it. The state-placement rubric that resolves the `<character_attributes>` blocker is a `decisions.md` entry rather than a bullet (`§ State placement is decided by the lifetime of the referent, not the lifetime of the value`), and every field this milestone adds lands on its campaign-state side — Mothership has no factory reset, so nothing character-attached is adventure state. The single-adventure constraint that the same analysis produced sits in M9, because it is a backend guard that touches no sheet, no render, and no snapshot, and shares no dependency with the three bullets below. Recorded here so the placement reads as a choice rather than an omission.

- [x] Character creation rework to match actual Mothership rules — **done 2026-08-15.** The sheet holds immutable creation data only (identity, class, trinket, patch, trauma response, `creationRolls` as dice, `creationChoices`); Stats, Saves, Health, Stress, skills, equipment and armor all moved to campaign state. Class adjustments are applied by `deriveMothershipCharacterResourcePools`, and the creation form collects the rolls and the Android/Scientist Stat choice. `V19__character_sheet_m76_reset.sql` drops and recreates rather than transforming (`decisions.md § The M7.6 migration drops and recreates rather than transforming`). Original scoping note: — carried over from the kanban board; scope not yet established here, and sizing it is the first task rather than an afterthought, because the two bullets below depend on the shape it settles and the playtest milestone depends on all three. If it reaches `MothershipCharacterSheetSchema` it also reaches `deriveMothershipCharacterResourcePools`, `formatMothershipCharacterProse`, both frontend character pages, and a migration for existing `character_sheet` rows
- [x] Reconcile the pools with whatever the rework settles — **done 2026-08-15.** Pools nest by owner, eleven per character, with the stress correction in all three axes (seeds 2, floors at Minimum Stress by prompt instruction, no ceiling because the 20 cap converts overflow rather than rejecting it). Below-`min` deltas are rejected rather than clamped, and `hp` exercises that path now that it carries `min: 0`. No read-side validation of `character_sheet.data` was added. Original note: — `mergePlayerResourcePools` cannot overwrite, so a migration that changes ceilings on the sheet leaves `{entityId}_hp.max` and `{entityId}_stress` untouched (`docs/decisions.md § Player resource pools are derived at character creation, not at synthesis`, second addendum). Includes the stress pool's three-axis correction (seed 2 not 0, floor at Minimum Stress not 0, cap 20 not null) and an explicit reject-or-clamp decision per pool, since below-`min` deltas are rejected rather than clamped and HP has never exercised that path. **Do not add read-side validation of `character_sheet.data` without changing the harness seed in the same milestone** — `harness-runner.ts:326` writes 1 of 9 required fields deliberately, and it works only because no read path parses the sheet
- [x] Static character-sheet build data (stats, saves) into the snapshot — **done 2026-08-15, and the bullet's own title was wrong.** Stats and Saves are *not* static: Wounds reduce a Stat and a Save, Level 2 radiation reduces all seven per round, and Stress overflow reduces the most relevant one. They are pools, and they render live in `<resource_pools>` rather than as build data — a render on the static assumption would hand the Warden a stale target number after any wound, silently, because it would still look plausible. `SYSTEM-ROLLED-PLAYER-ACTION` still wants watching for the reason below. Original note: — Strength/Speed/Intellect/Combat and saves are already structured fields on `character_sheets.data`, populated at character creation; render them into context so Claude can adjudicate checks without asking the player to re-enter their own stats. No synthesis write path of its own, and no schema change beyond whatever the rework above lands. **Watch `SYSTEM-ROLLED-PLAYER-ACTION` specifically**: this hands the Warden the target number for the player's roll, at the exact pressure point `docs/rules-extraction-findings.md § S32` repaired, and that repair is measured on a single N=20 run
- [x] `<character_attributes>` snapshot block — **done 2026-08-15.** Armor mode, weapon loadout and active conditions with parameters, plus bleeding, a raised Minimum Stress and a pending Death Save when they are off their resting values. The schema addition, the write path and the render all landed together as the decision entry asked. Original note: — persistent qualitative character state (armor mode, weapon loadout, active conditions), specified in the design doc and the M5 spec and omitted since M5 for want of a data source (`docs/decisions.md § The <character_attributes> snapshot block is specified but deferred until a data source exists`). Reactivated here because that entry's own trigger — "the milestone that first needs the data ... M6 (condition toggles) or M7 (roll resolution that consults armor)" — **already fired and went unnoticed**, the same way the static-build-data slice did until its amendment caught it. Its stated blocker (`MothershipCampaignState` carries no `characterAttributes` field, synthesis writes none, and `equipment: string[]` / `saves.armor: number` neither separate armor from loadout nor carry conditions) is what the first bullet resolves. The schema addition, the write path, and the render therefore all land **here**, designed together against concrete usage exactly as the decision entry asks, rather than the render landing now and the schema riding a later batch
**Retrieval dependency, recorded because a Wounds bug and an M7.5 regression look identical from the scores.** M7.6 is the first milestone whose *mechanical correctness* depends on `rules_lookup` returning a specific table row rather than on the Warden reasoning from prose. The Wounds Table is TKG content and does not ship in this repo; the Warden retrieves it per-turn against the self-hoster's own ingested PDF, and the prompt directs the lookup by damage type. M7.2 and M7.5 being complete satisfies the dependency — but undocumented, a flamethrower Wound that comes back with a Gunshot result gets triaged as a Wounds bug when it is a retrieval regression. **The PSG is ingested in local dev and not on the enceladus host where the eval harness runs**, so ingesting it there is a prerequisite for any run that exercises Wounds; without it every Wounds fixture fails for infrastructure reasons that are indistinguishable from Warden failures in the scores.

- [ ] **Re-baseline — the one thing M7.6 still owes.** Everything else in this milestone is built and green as of 2026-08-15. Two prerequisites before the run: **ingest the PSG on enceladus** (D6 — it is in local dev and not there, and without it every Wounds fixture fails for infrastructure reasons indistinguishable from Warden failures), and note that `corpusVersion` is now `2cfaf351a760…`, an **input-affecting** bump under `eval-methodology.md:548-562`. Six Warden-visible changes ride this one run — the snapshot's `owner.pool` addressing, `<character_attributes>`, the pool-delta array with `reason`/`maxDelta`/`damageType`, `characterState`, the wounds chain, and the re-keyed corpus — so `eval:compare` across the boundary is meaningless and §6.3's predictions become sanity checks read off the new numbers. **Which makes those predictions the only route to attributing a fallen score to this milestone**, since no honest delta exists to appeal to — the trigger for whether a fall gets prompt work now or goes to M8.1's backlog is `docs/decisions.md § Prompt work during a re-baseline is triggered by attribution, not by a number falling`, recorded 2026-08-16 before any of this run's numbers were readable. **The report must state what the run does not measure:** `characterState`'s five families get no floor at all from this milestone, the absolute-vs-delta count excepted. No signal is easy to mistake for good signal. Original note: — in `docs/eval-methodology.md` as part of the same bullet. Deliberately a second run rather than a bundle with the `<entities>` re-baseline that precedes this milestone: four snapshot changes measured together would leave any tag movement unattributable, and with 4.6 retired each run is a single model. **Ride the Haiku 4.5 control arm alongside it** — low N, `--fixtures` scoped to the fixtures carrying `out-of-order-resolution` and `turn28-hidden-info-leak`, both pinned at 1.00 across every run since the swap. The arm exists to show those checks can fail at all; a weaker model passing them is the finding. Committed 2026-08-09 when 4.6 was retired as a decision input, never scheduled, and superseded for these two checks once M7.8 asserts the same thing directly and without a Warden run

**M7.8 candidate, flagged while the work is fresh (§6.4): the Wounds Table is a near-ideal known-answer fixture.** A deterministic table, an unambiguous correct row per damage type and `1d10` result, and both the damage type and the applied result live in event structure — so the check is structural rather than judge-graded. `CARRYOVER-ARITHMETIC` (M7.6) already does the adjacent half and demonstrates the shape; what it cannot do is verify the *row*, because the table is TKG content and does not ship. A known-answer fixture would need the expected row supplied by the fixture author rather than by the repo.

#### M7.7 — Playtest and Fixture Capture

*The dedicated playtest, promoted out of M7.5 into its own milestone: it is evidence-gathering with a corpus deliverable rather than a quality bar on retrieval, and what it produces closes an item in a different milestone (M7.4's fixture-count bar), which a bullet buried in M7.5 hid. Same shape as M8's caller/initiative playtest bullet. Runs after M7.6 so the capture carries the corrected sheet shape. The synthesis `entityId` fix it also depends on **landed 2026-08-10** (`docs/decisions.md § Player resource pools are derived at character creation, not at synthesis`, amendment), so a fresh capture will no longer mint duplicate resource-pool prefixes — capturing against known-defective state is precisely how the current corpus acquired the `alvarez_*` / `lt_alvarez_*` ambiguity it still carries.*

- [ ] **Playtest convention, not code: do not create a second adventure in a campaign during capture.** Fixtures freeze whatever `campaignState` exists at authoring time, and adventure-scoped state is not yet separated from campaign state — so a capture taken after a second adventure begins would bake cross-adventure pollution into the corpus permanently, the same way the current corpus acquired its `alvarez_*` / `lt_alvarez_*` ambiguity from capturing against known-defective state. The enforcing guard lands in M9; until then this is a convention, and it is cheaper than moving a milestone boundary to get the guard early
- [ ] Dedicated playtest against the final index — confirms the index actually helped, and is the source of the second confirmed instances `MISSING-CANON-CAPTURE`, `UNSURFACED-CHECK`, `OVER-RESOLUTION`, and `SCENE-JUMP` need to close M7.4's remaining item. Harness-only validation stays provisional without it
- [ ] Author fixtures for whatever the playtest surfaces, then close M7.4's remaining fixture-count bullet against them. That bullet is explicitly "blocked on playtest evidence, not on code", and this is the evidence
- [ ] Add a `system-rolled-player-action` check to the `turn24-*` fixtures. **Not blocked on the playtest, and worth doing before it.** `§ S34` found the Warden rolling the player's declared action six times across `turn24-scene-jump`, `turn24-over-resolution` and `turn24-hidden-info-leak` — fixtures that carry no such check — while the tag read 1.00 (20/20) off the only two fixtures that do. The baseline run carried ten occurrences under the same prompt. The fixtures already exist and already provoke the behaviour, so this is a corpus change gradeable against frozen artifacts via `eval:rescore`, with no Warden run to pay for. Doing it first also means the playtest capture is graded by a checker that can see the failure mode, rather than inheriting the blind spot
- [ ] Sanity-check the capture before authoring anything from it: one entity id per character, one resource-pool prefix per entity, and `gmContextBlob.playerEntityIds` populated from a real `character_sheet` row rather than backfilled by hand. Cheap to verify and expensive to discover later — the current corpus needed all 15 fixtures hand-patched after the fact

#### M7.8 — Harness Meta-Eval

*Known-answer fixtures that grade the harness rather than the Warden: tiny hand-authored artifacts engineered to pass or fail one specific check, with the assertion being that the harness says so. Its own milestone rather than an M7.7 bullet for the same reason the playtest was promoted out of M7.5 — the deliverable is a second corpus with a different subject, and buried under "fixture capture" it would be invisible from the milestone title. Not a re-run of M7.4's closed counterexample bullet: that one covers structural checkers in the fail direction only, asserted once at authoring time, and leaves the applicability gate and the aggregation stages untested — which is where the artifact-gated applicability defect and the fixture-seeded `target: null` defect both lived. Costs no Warden spend: the artifacts are authored, not captured, and grading runs through `eval:rescore`. Sequenced before M8 so the caller/initiative checkers M8 introduces are authored under this discipline rather than retrofitted into it.*

- [ ] Known-answer fixture pairs for each structural checker — one engineered to pass, one to fail, asserted against the checker's verdict. The pass direction is the new half; M7.4's closed bullet covers the fail direction
- [ ] Coverage of the applicability gate as its own axis: a fixture per `fixture` / `artifact` / `ungated` path, asserting `not_applicable` is returned where it should be and *not* returned where it shouldn't. The M7.4 artifact-gating defect and the `target: null` pinning defect are both applicability failures, not checker failures
- [ ] Regression case per known M7.4/M7.5 defect — the damage-only pattern matcher, the commitment-language false fails, the ambient-roll classifier blind spot, the spurious rubric-hash warning. Each was found by hand once; each becomes a standing assertion
- [ ] Record the reframe in `docs/decisions.md`: "pinned at 1.00 is a harness suspect" moves from primary trust mechanism to coverage-gap detector for failure modes no known-answer fixture was authored against. The Haiku control arm's justification narrows the same way
- [ ] Out of scope: the judge. Prose classification is probabilistic by construction and gets characterized statistically via `eval:judge-variance`, not asserted against known answers

#### M8 — Multiplayer Foundation

*Caller model and initiative mode.*

- [ ] **Prerequisite — turn-path lock audit.** `applyTurnAtomic` serializes concurrent turns incidentally rather than deliberately: `writeCampaignState` runs first and takes a row lock on `campaign_state` (keyed by *campaign*), before `writeTurnEvents` → `nextSequenceNumber` takes its `SELECT ... FOR UPDATE` on `adventure` (keyed by *adventure*). Two questions to settle before caller/initiative work makes concurrent turns routine:
  - Is `campaign_state.data` genuinely campaign-scoped? If yes the coarse lock is load-bearing — two adventures merging deltas into one JSONB blob would lose a merge — and write order must be pinned by convention, not left to chance. If no, it is over-serializing sibling adventures.
  - Confirm where the read → validate → write cycle is locked. `decisions.md` states the advisory lock must span the full cycle; the transaction in `applyTurnAtomic` opens at write time only. Either a `SessionService`-level lock covers the earlier phases or the guarantee is narrower than recorded — resolve and correct whichever is wrong.
  - Lock ordering is currently safe by accident (every path takes campaign_state → adventure; the `diceResult` transaction takes only the adventure lock). Record the ordering as a convention so a future writer touching `campaign_state` after sequence allocation doesn't introduce a deadlock.
- [ ] Caller role enforcement, voluntary transfer, request + auto-approve timeout, offline claim
- [ ] Narrative transfer via `caller_transfer` in `submit_gm_response`
- [ ] Initiative mode (adventure mode flip, order stored in record, `advance_initiative` handling in `GmService`)
- [ ] Frontend: caller indicator and transfer UI, initiative order display and active player highlighting
- [ ] Multi-PC / caller model dedicated playtest, then author fixtures for whatever caller and initiative failure modes it surfaces. The current corpus has no coverage for caller transfer or initiative sequencing at all — these are new failure modes, not new instances of existing tags, so this is corpus expansion rather than a re-run. Do not combine with mechanical coverage playtests (see Phase 2 requirements)

#### M8.1 — Warden Prompt Iteration

*Prompt-only changes to the Warden system prompt, sequenced after M8 rather than earlier so iteration runs against the complete Phase 1 fixture corpus — including whatever caller/initiative failure modes M8's own playtest surfaces, not just the pre-multiplayer corpus. Runs on M7.4's existing `eval:run`/`eval:compare`. A schema change that grows out of a validated experiment here does not land in this milestone — it goes wherever the next tool-schema batch is, per the `decisions.md` principle of paying the rebaseline cost once.*

- [ ] Pilot a hidden per-`dice_request` contingency field as a prompt-only instruction (no schema change) — Claude states "if this fails, X" without narrating it, to relieve the pressure behind OVER-RESOLUTION / OUT-OF-ORDER-RESOLUTION. Evaluated against existing fixtures for those tags plus `unauditable-mapping`. If it validates, formalizing it as an actual `dice_requests` field is a separate schema-change decision for the next tool-schema batch — not committed here
- [ ] `unauditable-mapping` prompt fix: any GM-side roll selecting among narrative outcomes must state the outcome mapping in `purpose` before the roll fires. Prose-in-`purpose`, not a schema field — the outcome table is free text that varies per roll. Track GM-side spontaneous-roll *frequency* (via the check's applicability rate) alongside pass rate — the failure mode is compliance-by-suppression, not just non-compliance
- [ ] `status`-field-overload prompt fix: `status` is strictly the `'alive'|'dead'|'unknown'` enum; tactical and narrative detail moves to `npcState`

#### M9 — Self-Hosted Deployment

*Shippable open-core product.*

- [ ] In-depth human review of game system implementation
- [ ] In-depth human review of oracle tables
- [ ] Docker Compose production configuration
- [ ] Environment variable documentation
- [ ] Signup mode implementation (`SIGNUP_MODE` / `INVITE_TOKEN` enforcement in `AuthService`)
- [ ] **Enforce the identifier format rule, which has never been enforced anywhere.** `docs/decisions.md § Entity and resource pool identifiers use underscores only` states the rule and no code applies it: grep finds only comments citing the entry (`apps/zoltar-be/src/session/session.service.ts:962`, `session.schema.ts:152-154`) — no regex, no Zod refinement, no check on any write path. Entity ids arrive from `submit_gm_context` (`synthesis.schema.ts:34`) and pool owner keys from `submit_gm_response`, both unconstrained. Surfaced by the M7.6 plan's D1-A.1, which needs a `_` prefix reserved for owner keys like `_scenario`; M7.6 ships only the narrow assertion (reject an unknown `_`-prefixed owner) and deliberately leaves the general case here, because enforcing format across entity creation, synthesis, and the tool boundary is its own change with its own failure modes. Worth noting the two known symptoms — `alvarez` / `lt_alvarez` and `android_memory_integrity` — are both what unenforced identifier discipline looks like, though neither is a *format* violation, so this would not have caught them
- [ ] Enforce one adventure per campaign — backend rejection on adventure creation when the campaign already has *any* adventure, including `completed` and `failed`, plus the corresponding UI gate. Placed here rather than in M7.6, where the analysis originated, because the constraint's entire value is a property of what `v0.1.0` ships: with exactly one adventure per campaign in every self-hosted database, provenance for the Phase 2 migration into an adventure-state row is unambiguous by construction rather than inferred. **The `completed`/`failed` case is the one that matters** — `docs/decisions.md § One active adventure per campaign` explicitly permits it today, which is what lets a campaign accumulate two adventures' worth of unscoped state, and the addendum withdrawing that permission is the reason this bullet exists. Throwaway code by design; it is removed in Phase 2 when the adventure-state row, `campaign_canon`, and a dedicated boundary playtest are all in place (`§ Adventure state gets its own row, not an adventure tag on campaign state`)
- [ ] Documentation reorganization ahead of the setup guide — **scope not yet established here, and sizing it is the first task rather than an afterthought**, because the guide's location and the audience split depend on what it settles. The driver is that `v0.1.0` splits a readership that has been one person and one CC session into three: self-hosters who need setup and operations, potential contributors who need architecture and conventions, and the existing internal working record. Nothing in `docs/` currently distinguishes them. Known candidates for the pass, not a scope commitment: deciding which docs are public artifacts and which are internal (`decisions.md` is arguably the most valuable thing to publish and `docs/plans/` the least); pruning or archiving accumulated `docs/specs/zoltar/` entries, which are ephemeral by policy (`§ Design documentation discipline`) but have never been swept; whether `decisions.md` at 1,300+ lines with per-entry addenda stays one file; and the two pending renames already carried — "The Three Phases of Campaign Creation" → "steps" in `docs/zoltar-design-doc.md § 122`, with the matching "synthesis phase" references in `docs/tools.md`
- [ ] Self-hosted setup guide + DigitalOcean Droplet walkthrough
- [ ] Verify rules text ingestion pipeline in target environment
- [ ] Signup mode documented in self-hosted setup guide
- [ ] Responsive polish pass (thumb reach, viewport refinement)
- [ ] Single Flyway migration consolidation pass — squash the accumulated Phase 1 migrations into a clean baseline, immediately before the tag and after the last schema change lands. Until `v0.1.0` the migration history has no external consumer and is disposable; after the tag every migration is permanent public surface that self-hosters upgrade through, so this is the last moment it can be done at zero cost. It also discards genuine dead ends rather than shipping them as history — `V18__rules_chunk_hnsw_index.sql` exists because an ivfflat index built against an empty table silently under-returned, and a fresh installation has no reason to replay that. **Preserve non-obvious design reasoning from deleted migrations in `docs/decisions.md` before discarding them**; reasoning that lives only in a migration comment disappears with the file. Sequencing: consolidate, verify a fresh install against the Docker Compose production config, then the eval run below. Phase 2's adventure-state migration then builds on the consolidated baseline rather than on Phase 1's history
- [ ] Full-corpus eval run before tagging, compared against the M7.5 re-baseline. This is release discipline rather than milestone scope — it belongs on the release checklist alongside the setup guide and env-var docs, and it recurs at every tagged release, not just this one. Listed here explicitly to establish the habit
- [ ] Comprehensive release checklist authored for future releases
- [ ] First tagged release (`v0.1.0`)

---

## Phase 2 — Expanded Systems, Campaign Modes, and Real-Time

Target: UVG and OSE support, remaining campaign creation modes, synchronous multiplayer, and the first wave of quality-of-life tooling.

### Requirements (to be broken into milestones when Phase 1 ships)

- UVG and OSE Zod schemas (campaign state and character sheet shapes) and rules-as-code backend validation
- UVG and OSE oracle tables
- Location and random table generation tool (UVG)
- Solo Authored campaign creation mode — freeform authoring dialogue with Claude, player-reviewed proposed canon
- Collaborative campaign creation mode — human author builds GM context via authoring dialogue, author reviews proposed canon
- Solo with Overseer campaign creation mode — Solo Blind generation, designated third-party canon reviewer
- Canon review UI — pending canon queue surfaced to the appropriate reviewer per campaign mode
- Faction/NPC agenda advancement tool
- Session summarization tool
- Structured override layer (rest rules, crit rules, death saves, spell systems)
- Initiative mode polish
- Ably real-time integration (`RealtimeService` implementation)
- Live typing preview for caller input (requires Ably)
- Presence indicators (requires Ably)
- Private action affordance
- Caller transfer UI polish
- Multi-PC / caller model dedicated playtest — do not combine with mechanical coverage playtests; schedule after backend implements caller transfer and initiative sequencing
- Campaign canon — second promotion step at adventure completion; `campaign_canon` table; synthesis reads campaign canon alongside oracle results for subsequent adventures
- Campaign canon review UI — surfaces `campaign_canon` entries with `pending` status to the appropriate reviewer at adventure completion

---

## Phase 3 — Rules Engine, VTT Layer, and SaaS

Target: D&D 5e and Infinity 2d20 support, the 2D renderer, and the first SaaS infrastructure.

### Requirements (to be broken into milestones when Phase 2 ships)

- Infinity 2d20 and D&D 5e system support
- Full constraint module system and rule evaluation engine
- Community rule module library
- Rules engine arithmetic layer for 5e (attack resolution, action economy, conditions)
- 2D VTT canvas renderer (Pixi.js or BabylonJS — decision deferred to this phase)
- Asset management (token images, map backgrounds)
- Sub-cell geometry layer (`map_geometry` table implementation)
- AI map generation pipeline (Claude describes, compiler generates grid data)
- SaaS infrastructure: Clerk, Stripe, S3, EntitlementsService, RLS policies
- Subscription billing — GM pays model; adventure creation as tier gate; per-token metering internal only
- Multi-tenant Postgres RLS migration
- DigitalOcean App Platform deployment

---

## Phase 4+ — Full VTT and Creator Economy

Target: 3D renderer, additional system support, and creator economy if demand justifies.

- 3D BabylonJS/STL renderer (separate private repository)
- Additional game system support based on user demand (Feng Shui 2 is the current candidate — cinematic action fit, slim resolution mechanic, shot clock initiative; NPC schtick tracking at scale is the main open question)
- Creator economy / Stripe Connect (if demand justifies)
- Campaign Manager evaluation (separate product or Unicorn module — decide when Phase 3 is complete)

---

## Deferred Indefinitely

Items that are explicitly out of scope until there is a specific reason to revisit:

- Image generation tool (Phase 3+ at earliest — pure polish)
- Cryptographic enforcement of GM information secrecy
- Undo mechanic (by design — corrections replace undo)
- Publishing `@uv` packages to npm
