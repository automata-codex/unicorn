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

- [ ] Python ingestion pipeline under `ingestion/` (marker extraction, `chunks` output format → column-aware block sort → footer-derived page/chapter attribution → block-based merge toward a ~400-token target → Voyage document-mode embedding → SQL insert). Supersedes the original `###`-heading-boundary design, a confirmed dead end at 10 headings against a 100–400 chunk target (`docs/rules-extraction-findings.md § S1.5`)
- [ ] One-time local seed of Mothership rules chunks from the PDF
- [ ] Column-aware block sort ahead of chunk merging — marker's emitted block order is not reading order on multi-column pages, scrambled (including full reversals) on roughly half the measurable pages (`docs/rules-extraction-findings.md § S6.2`); a geometric sort on each block's bbox recovers 15 of 16 measurable pages (`§ S7`). Blocking: the chunker's "merge in order" step is wrong without it
- [ ] Query preprocessing for `rules_lookup` — document-frequency-based term-dropping before matching, per `docs/decisions.md § Query preprocessing for rules_lookup promoted from optional to critical path`. Mechanical, no LLM call, proven on both FTS and dense retrieval (`docs/rules-extraction-findings.md § S4`, `§ S5.3`) — the largest retrieval-quality effect measured in the whole M7.2 investigation
- [ ] Fixup patch scaffolding for chunk-level corrections, matched on block `id` (e.g. `/page/11/Table/5`), not `{section, contains}` — `contains` has no text to match on empty `Table` blocks, and `section` derives from `section_hierarchy`, a confirmed dead end (`docs/rules-extraction-findings.md § S6.5`)
- [ ] Resolve the 14/32 empty `Table` blocks (physical pp. 11–12, FIREARMS and INDUSTRIAL EQUIPMENT, lost entirely) — fixup-file entry vs. a second extraction pass on table regions; not yet scoped (`docs/rules-extraction-findings.md § S3.2`)
- [ ] Fallback chapter attribution for the 5 footer-less pages (physical 0, 1, 2, 10, 43) — page 10 (equipment continuation) is reachable body content and most needs an answer before ingestion can attribute it correctly (`docs/rules-extraction-findings.md § Open questions`)
- [ ] Hash-verification step to detect source-document drift between re-ingestions
- [ ] Ingestion smoke tests (chunk count, embedding dimensions, system_id tagging)
- [ ] Retrieval eval harness — page-labeled fixtures scored deterministically for recall@3/@5 and MRR, with unanswerable questions included so a similarity floor is derivable. Voyage calls only, no judge, so it is cheap enough to run on every chunking change. This is the ruler M7.5 iterates against; without it, "did that chunking change help?" is unanswerable. **Fixture queries must reflect real Warden phrasing (verbose, sometimes off-vocabulary), not hand-authored tidy questions — a harness built on idealized queries cannot detect the failure mode `docs/rules-extraction-findings.md § S4`–`S5` found, and would report a quality bar the Warden's actual queries never clear.** 596 real `rules_lookup` queries are already recorded in `unicorn-artifacts` (`§ S8`) and are the intended source — they need page labels added, and the eval-run sample skews toward combat (fixture design, not play), so draw across fixture tags rather than by raw frequency

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

- [ ] Retrieval quality bar set against M7.2's first measurement rather than guessed in advance, with separate targets for authored and Warden-observed query styles, recorded in `docs/eval-methodology.md`
- [ ] Chunking iteration against `task eval:retrieval` — one change per round, each logged in `docs/rules-extraction-findings.md`, including the rounds that made things worse. Closes on the bar or on the stopping rule, whichever comes first
- [ ] Exclude the character-creation spread (physical pp. 4, 41–42) from the rules index — confirmed unreachable by the Warden: `rules_lookup` is wired only into the play-loop tool array, and character creation makes no Anthropic calls at all. Removes the worst-provenanced pages in the corpus (page 4's footer doesn't resolve; 41–42 are byte-identical duplicates of it) without needing the fallback-chapter question answered for them. (`docs/rules-extraction-findings.md § S2`)
- [ ] Check whether physical page 3 (character profile sheet) belongs in the same exclusion as pp. 4/41–42 — not yet confirmed unreachable like those were, but a likely false-positive magnet if left in: it ranked top-3 for two of three queries in `§ S3.7` on pure stat-name density alone (`§ S2`, `§ Open questions`)
- [ ] Vocabulary bridging for `rules_lookup` — test whether prompt-side guidance (steering the Warden's query phrasing toward book vocabulary) closes enough of the gap `docs/rules-extraction-findings.md § S5.3` measured, before committing to a per-system synonym/thesaurus table. Per `docs/decisions.md § Query preprocessing for rules_lookup...`, the prompt-side option is free; the synonym table is real ongoing per-system authoring cost. Not yet decided which is needed
- [ ] Mechanical-model primer for the Warden's system prompt — teach Mothership's actual resolution model (roll-under-stat, no DC/target number, no opposed rolls, no flanking) so the Warden stops generating concept-absent `rules_lookup` queries in the first place, rather than merely rephrasing them toward book vocabulary. Distinct from the vocabulary-bridging item above: that targets the wrong-word bucket (S5.3); this targets the concept-absent bucket, which S9 measured at 130 of 344 out-of-corpus queries (37.8%) and found no vocabulary mapping can retrieve (`docs/rules-extraction-findings.md § S8.3`, `§ S9.4`). Evaluate via concept-absent query rate (applicability-style measurement), same pattern already used for `unauditable-mapping` tracking in M8.1
- [ ] Test whether including `SectionHeader` blocks in the corpus changes retrieval ranking — currently excluded (169 blocks, 2,632 chars of topic labels), and an untested confound in every `S3`–`S5` measurement so far (`docs/rules-extraction-findings.md § S9.1`). Cheap: rerun `S5`'s ranking method with headers included
- [ ] Decide whether to dedupe the page 1/43 reference-card duplicates against the body pages they restate, to avoid near-duplicate chunks competing in cosine ranking — still open, lower priority (`docs/rules-extraction-findings.md § Open questions`)
- [ ] `--markdown` curated-input path on `ingest.py`, bypassing extraction. The capability ships; a curated Mothership Markdown cannot, per `docs/rules-ingestion.md § Licensing Posture`
- [ ] Similarity floor for `rules_lookup` derived from the answerable/unanswerable distributions — or a recorded finding that they do not separate and no honest floor exists yet. Must land before the re-baseline, since it changes what reaches the Warden
- [ ] `rollType`/`gatedByRollId`/`actingEntityId` fields on `roll_dice`, plus Warden prompt instructions for populating them — the deferred structural-checker fields from `docs/decisions.md § rollType / gatedByRollId / actingEntityId on roll_dice stay deferred, but they are measurement infrastructure`. Schema and prompt land together: a field the prompt doesn't instruct Claude to populate would still read `not_applicable` at re-baseline, forcing a second one later — exactly the repeated cost the batching was meant to avoid. Must land before the re-baseline
- [ ] Re-baseline both models against the final index — full corpus, uniform N, compared against the re-scored `88fa84bd8329` runs. A populated index changes what the Warden sees (tool results, and plausibly its roll behaviour), so every rate measured against the empty index is provisional. Update `Current baseline N` in `docs/eval-methodology.md` if applicability or variance shifted
- [ ] Dedicated playtest against the final index — confirms the index actually helped, and is the source of the second confirmed instances `MISSING-CANON-CAPTURE`, `UNSURFACED-CHECK`, `OVER-RESOLUTION`, and `SCENE-JUMP` need to close M7.4's remaining item. Harness-only validation stays provisional without it

#### M8 — Multiplayer Foundation

*Caller model and initiative mode.*

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
- [ ] Static character-sheet build data (stats, saves) into the snapshot — Strength/Speed/Intellect/Combat and saves are already structured fields on `character_sheets.data`, populated at character creation; render them into context so Claude can adjudicate checks without asking the player to re-enter their own stats. No schema change, no synthesis write path — narrower than the deferred `<character_attributes>` block (armor mode/loadout/conditions), which stays deferred per `docs/decisions.md` pending the schema work it actually needs

#### M9 — Self-Hosted Deployment

*Shippable open-core product.*

- [ ] In-depth human review of game system implementation
- [ ] In-depth human review of oracle tables
- [ ] Docker Compose production configuration
- [ ] Environment variable documentation
- [ ] Signup mode implementation (`SIGNUP_MODE` / `INVITE_TOKEN` enforcement in `AuthService`)
- [ ] Self-hosted setup guide + DigitalOcean Droplet walkthrough
- [ ] Verify rules text ingestion pipeline in target environment
- [ ] Signup mode documented in self-hosted setup guide
- [ ] Responsive polish pass (thumb reach, viewport refinement)
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
