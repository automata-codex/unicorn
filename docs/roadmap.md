# Roadmap

This document answers two questions and no others: **what is this product made of**, and **in what order does it get built**. It is scope-focused — no time estimates.

## What belongs here

- **Feature Requirements** — the inventory of *product* scope, by domain. What the application does.
- **Development Tooling Requirements** — the inventory of scope that exists to support building the product rather than to ship with it: playtest review, replay, the eval harnesses, rules ingestion.
- **Delivery Milestones** — the order the work is built in. Each milestone is independently testable and represents a meaningful step toward the phase target. Most include both frontend and backend work.

A milestone entry states what the milestone delivers. It does not narrate how the work went, and it carries no per-item status.

## What does not belong here

This document once grew into an exhaustive todo list with findings, diagnoses and decision records embedded in its bullets. It is deliberately none of those things.

| Kind of thing | Where it lives |
|---|---|
| A decision — its alternatives, its reasoning, what would reverse it | `docs/decisions/`, one file per ADR, indexed into `docs/decisions.md` by `task docs:decisions:build` |
| A measurement, diagnosis, or defect writeup | the relevant findings document: `docs/rules-extraction-findings.md`, `docs/eval-methodology.md`, `docs/hidden-information-findings.md` |
| How a feature is designed and built | `docs/specs/` and `docs/plans/`, written when the feature is about to be built |
| Outstanding work at task granularity | the working todo list, outside this repo |
| Per-item completion status | the working todo list. This document tracks status at **milestone** granularity only |
| A convention that constrains how future work is done | the ADR or findings document that established it |

Unplanned work that extends a shipped milestone is folded into that milestone's deliverables rather than given an entry of its own.

---

## Phase 1 — MVP (Open Core, Self-Hosted)

Target: a playable solo Mothership adventure on a personal Droplet.

---

### Feature Requirements

Product scope — what the application does. Organized by domain, not by delivery order.

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
- One adventure per campaign, enforced at the backend and gated in the UI
- Frontend: auth flow (login, adventure management), campaign list, adventure list shell

#### Oracle Tables & Character Creation

- Mothership oracle tables — survivors, threats, secrets, vessel type, tone (versioned JSON files)
- Oracle table filtering data model — active/inactive entries per category, range dials
- Character creation flow — Mothership mechanical character creation producing a character sheet that seeds oracle weighting
- Immutable creation data on the sheet; stats, saves, health, stress, skills, equipment and armor in campaign state
- Frontend: oracle filtering UI (activate/deactivate entries, range dials), character creation UI

#### Campaign Creation (Solo Blind)

The Solo Blind campaign creation pipeline: oracle table filtering, coherence check, and GM context synthesis. This is a significant Phase 1 feature — the adventure is only as good as the GM context that seeds it.

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
- State snapshot builder — visibility-filtered, GM context injected; includes `flagTriggers` adjacent to flag values and a `characterAttributes` block for persistent qualitative character state; omits entity position fields
- Claude API client with prompt caching for GM context blob
- Prompt structure: `[GM context blob] → [state snapshot] → [last N kb of messages]`
- Rolling N-kb message window — measured in kb, not message count

#### GmService & State Management

- `SessionService` orchestrating the full request/response cycle
- Backend state change validation (resource deductions, HP thresholds, flag changes)
- State change application to DB
- `proposed_canon` routing — write entries to pending canon queue; auto-promote in Solo Blind
- `game_events` write path (all state changes logged with sequence numbers)
- Correction mechanic (`superseded_by` write path)
- `adventure_telemetry` write path — per-turn record of player input, full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, prompt and completion token counts
- Entity write path — `visible` (line of sight), `revealed` (discovery), `npcState` (disposition)
- Frontend: play view (message log, input field, character status strip, threshold banner)

#### Tools

> **Adjudication scope note:** Phase 1 has no formal rule evaluator. Mechanical adjudication for Mothership is Claude's responsibility, informed by the rules lookup tool rather than confabulation. The backend enforces structural constraints only (resource availability, HP thresholds, death triggers). The full constraint module system and rule evaluation engine are Phase 3 work. This is an acceptable tradeoff for Mothership — it's a slim ruleset and the horror is in the fiction more than the mechanics.

- `roll_dice` tool — dice notation parser, server-side execution, audit log write; audit log records player-entered vs system-generated rolls
- Rules lookup tool — vector embedding pipeline for Mothership rules text; pgvector extension on Postgres; query endpoint
- Tool call routing in `SessionService`
- Frontend: dice entry UI — "roll for me" button and manual raw roll entry (with explicit modifier language: "enter the number showing on the die")

#### Multiplayer Foundation

- Caller role enforcement — only the caller can submit input
- Voluntary caller transfer
- Caller request with configurable auto-approve timeout
- Offline claim (caller disconnected)
- Narrative transfer via `caller_transfer` in `submit_gm_response`
- Initiative mode — adventure mode flip, initiative order stored in adventure record
- `advance_initiative` handling in `SessionService`
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

### Development Tooling Requirements

Scope that exists to support building the product rather than to ship with it. Inventoried here because it is most of what Phase 1 has actually built, and a roadmap that hid it was describing a smaller project than the one under way.

#### Playtest Review

- SQL views joining `game_events` and `adventure_telemetry` (per-turn, per-state-history, per-correction)
- CLI producing a turn-by-turn markdown report for a given adventure id
- Warden prompt version persisted per telemetry row and surfaced in review output
- GM context render recoverable per turn, stored on change

#### Rules Ingestion

- Python ingestion pipeline under `ingestion/` — extraction, column-aware block sort, footer-derived page and chapter attribution, block-based merge to a token target, Voyage document-mode embedding, SQL insert
- Per-system configuration (`system.json`) carrying page exclusions
- Fixup patch mechanism for chunk-level corrections, matched on block `id`
- `--markdown` curated-input path, bypassing extraction
- Hash-verification step detecting source-document drift between re-ingestions
- Query preprocessing for `rules_lookup`
- Ingestion smoke tests (chunk count, embedding dimensions, `system_id` tagging)

#### Replay & Capture

- Automatic turn-0 capture into `adventure_synthesis_snapshots`, written inside the synthesis-commit transaction
- `reconstructStateAsOfTurn` — folds turn-0 state forward through `game_events`, `pending_canon` and `messages` to reconstruct state entering any turn
- `capture-fixture` — turns a real playtest turn into a fixture, with fail-closed applicability stubs per check
- Single pure `applyValidatedTurn` covering both `campaign_state.data` and `gm_context.blob`

#### Retrieval Eval Harness

- Page-labeled fixtures scored deterministically for recall@3/@5 and MRR
- Unanswerable questions included so a similarity floor is derivable
- Fixture queries drawn from real Warden phrasing, not hand-authored tidy questions
- Voyage calls only, no judge — cheap enough to run on every chunking change
- Retrieval probe: replays recorded Warden queries through the real retrieval path

#### Warden Eval Harness

- `EvalFixture` format — source adventure and sequence number, seeded state, player input, structural and judge-graded assertions, failure-mode tag, applicability
- Structural assertion checkers — deterministic, no second LLM call
- Judge-graded assertions — one rubric per failure-mode tag
- Multi-run infrastructure — reps, machine-readable score rows, paired comparison, re-scoring of frozen artifacts
- Run identity: `promptHash`, `assemblyHash`, `corpusVersion`, `rubricHash`, `judgeContractHash`, `harnessVersion`
- Assembly goldens gating `eval:run` against a stale workspace build
- Markdown report — per-fixture rates, per-tag rollup, errors, exclusions, applicability findings
- `eval:judge-variance` for characterizing judge behavior statistically
- Failure-mode tag catalog generated from the check registry

#### Harness Meta-Eval

- Known-answer fixtures that grade the harness rather than the Warden
- Coverage of the applicability gate as its own axis
- A regression case per known harness defect

#### Documentation Tooling

- One file per ADR under `docs/decisions/`, built into `docs/decisions.md`
- Corpus validation — identifiers, front matter, index staleness, `§` reference resolution

---

### Delivery Milestones

Sequence, not inventory. Status is tracked here at milestone granularity only; task-level status lives in the working todo list.

#### Milestone 1.0 — Manual GM Context Prototyping

**Status:** Complete

Validate the campaign creation and play loop manually before building any pipeline. Produces no shippable code — it produces confidence that the GM context design is right and that oracle table entries are rich enough to sustain a session. Discoveries here are cheap to act on; discoveries after the pipeline is built are not.

- Rough synthesis prompt written by hand, oracle results selected manually
- One or two sessions run manually, state snapshot constructed by hand each turn
- Oracle table entries and synthesis prompt revised until output is consistently good
- The structured section's required contents documented from what the manual sessions revealed
- Gold-standard GM context quality bar documented as a written rubric

#### M1 — Dev Environment & Data Model

**Status:** Complete

Infrastructure only — no game logic, no UI. Everything else depends on this.

- Docker Compose local dev setup (Postgres + NestJS + Svelte + Flyway)
- NestJS module hierarchy, DB connection via Drizzle ORM + `node-postgres`
- Flyway migration setup; all Phase 1 migrations (core tables, grid tables, audit/telemetry tables, `map_geometry` stub)
- Environment config loading and validation
- Service interface stubs + noop implementations for all deferred services

Spec: [000](specs/zoltar/000-m1-local-dev-environment.md) · Plan: [000](plans/000-m1-local-dev-environment.md)

#### M2 — Auth, Campaign & Adventure CRUD

**Status:** Complete

First shippable frontend + backend slice.

- Magic-link auth (`AuthService` interface + backend-owned session management)
- Traefik added to the local dev stack
- Mothership Zod schemas (campaign state, character sheet)
- Basic CRUD endpoints for campaigns and adventures
- Frontend: auth flow, campaign list, adventure list shell

Spec: [001](specs/zoltar/001-m2-auth-and-campaign-crud.md) · Plan: [001](plans/001-m2-implementation-plan.md) · Decisions: ADR-0009

#### M2.5 — Design Sprint

**Status:** Complete

Establish visual foundation before any feature UI is built. Mobile-first throughout.

- Primitive token definitions (`themes/base.css`)
- Mothership theme — semantic token layer (`themes/mothership.css`)
- Base component set: button, input, panel, typography scale
- Mobile layout sketches for play view, oracle filtering, and character creation

Spec: [002](specs/zoltar/002-m2.5-design-sprint.md) · Plan: [002](plans/002-m2.5-design-sprint.md) · See also `docs/design-system.md`

#### M3 — Oracle Tables & Character Creation

**Status:** Complete

The raw material for GM context synthesis.

- Mothership oracle tables — versioned JSON files (survivors, threats, secrets, vessel type, tone)
- Oracle table filtering data model (active/inactive entries, range dials)
- Character creation flow seeding oracle weighting
- Frontend: oracle filtering UI, character creation UI

Spec: [003](specs/zoltar/003-m3-oracle-tables-et-al.md) · Plan: [003](plans/003-m3-oracle-tables-et-al.md)

#### M4 — Solo Blind Campaign Creation Pipeline

**Status:** Complete

End-to-end adventure creation: from oracle picks to GM context in DB.

- `submit_gm_context` tool definition + write path
- State snapshot fields rationalized; read/write contract with the tool schema finalized
- Coherence check (three-tier resolution)
- GM context synthesis
- Entity ID alignment
- Pending canon queue + auto-promote for Solo Blind
- Frontend: full Solo Blind adventure creation flow wired end-to-end

Spec: [004](specs/zoltar/004-m4-campaign-creation-pipeline.md) · Plan: [004](plans/004-m4-campaign-creation-pipeline.md)

#### M5 — Claude API Client & Prompt Assembly

**Status:** Complete

Get a coherent GM response back from Claude. No state changes applied yet.

- Client-side router migrated to `svelte-spa-router` v5
- `submit_gm_response` tool definition (including `proposed_canon`)
- State snapshot builder — visibility-filtered, GM context injected, `flagTriggers`, no entity positions
- Claude API client with prompt caching for the GM context blob
- Prompt structure: `[GM context blob] → [state snapshot] → [last N kb of messages]`
- Rolling N-kb message window

Spec: [005](specs/zoltar/005-m5-prompt-assembly.md) · Plan: [005](plans/005-m5-prompt-assembly.md) · Decisions: ADR-0049 (`<character_attributes>` deferred to M7.6)

#### M6 — GmService & State Management

**Status:** Complete

Apply GM responses to game state and close the play loop.

- `SessionService` orchestrating the request/response cycle — the `GmService` name is retired
- Backend state change validation + application to DB
- `proposed_canon` routing + auto-promote in Solo Blind
- `game_events` write path (all state changes, sequence numbers)
- Correction mechanic (`superseded_by` write path)
- `adventure_telemetry` write path
- Frontend: play view (message log, input field, character status strip, threshold banner)

Spec: [006](specs/zoltar/006-m6-state-management.md) · Plan: [006](plans/006-m6-state-management.md)

#### M7 — Tools

**Status:** Complete

Dice and rules lookup wired into the play loop. Ships runtime plumbing with an empty index, so playtest evidence can prioritize ingestion coverage.

- `roll_dice` tool (dice notation parser, server-side execution, audit log)
- Rules lookup tool (vector embedding pipeline, pgvector, query endpoint)
- Tool call routing in `SessionService`
- Frontend: dice entry UI — "roll for me" and manual raw roll entry

Spec: [007](specs/zoltar/007-m7-ai-tools.md) · Plan: [007](plans/007-m7-ai-tools.md)

#### M7.1 — Playtest Review Tooling

**Status:** Complete

Turn-by-turn readback of `game_events` and `adventure_telemetry` for playtest analysis. Scoped after M7 because M7 is the first milestone producing playtest-worthy adventures — review tooling earns its keep against runs with dice and rules lookups in place. No web UI; a CLI script is the deliverable.

- SQL views joining `game_events` and `adventure_telemetry`
- CLI producing a turn-by-turn markdown report for a given adventure id
- `adventure_telemetry` payload shape sanity-checked against a real Mothership run
- Warden prompt versioning persisted per telemetry row and surfaced in review output

Spec: [008](specs/zoltar/008-m7.1-playtest-review-tooling.md) · Plan: [008](plans/008-m7.1-playtest-review-tooling.md)

#### M7.2 — Rules Ingestion Pipeline

**Status:** Complete

Populate the `rules_chunk` index for Mothership. A separate milestone because the pipeline is Python, not TypeScript, and is independently testable.

- Python ingestion pipeline under `ingestion/` (`task ingest`)
- Column-aware block sort ahead of chunk merging
- Query preprocessing for `rules_lookup`
- Fixup patch scaffolding matched on block `id`
- Hash-verification step detecting source-document drift
- Ingestion smoke tests
- Retrieval eval harness (`task eval:retrieval`) with a labelled fixture set
- One-time local seed of Mothership rules chunks

Two gaps shipped knowingly rather than by oversight: the empty `Table` blocks on printed pp. 11–12, and fallback chapter attribution for the five footer-less pages.

Spec: [012](specs/zoltar/012-m7.2-rules-ingestion.md) · Plan: [012](plans/012-m7.2-rules-ingestion-implementation-plan.md) · Decisions: ADR-0012, ADR-0013, ADR-0014, ADR-0015, ADR-0017, ADR-0018, ADR-0019 · Findings: `rules-extraction-findings.md § S1–S15`

#### M7.3 — Turn-State Replay Infrastructure

**Status:** Complete

Prerequisite for M7.4: automatic, no-action-required capture of an adventure's true starting state, plus a way to fold that state forward through the existing event log to reconstruct any later turn. Replaces the M7.1 `save-synthesis` script, which only ever handled the zero-turn case.

- Automatic turn-0 capture into `adventure_synthesis_snapshots`
- `load-synthesis` sourced from that table by adventure id
- One-off import of pre-M7.3 playtest adventures' legacy output
- `applyValidatedTurn` — one pure function covering campaign state and GM context blob
- `sequence_number` on `pending_canon`
- `reconstructStateAsOfTurn(db, adventureId, targetSequenceNumber)`

Spec: [009](specs/zoltar/009-m7.3-turn-state-replay-spec.md) · Plan: [009](plans/009-m7.3-turn-state-replay-implementation-plan.md)

#### M7.4 — Warden Eval Harness

**Status:** In progress — fixture-count bar open, blocked on playtest evidence

Regression suite for Warden prompt candidates against known failure modes surfaced by real playtests. Drives the real turn pipeline in-process rather than reimplementing it; seeds each fixture's starting state via M7.3's `reconstructStateAsOfTurn`. Extended after shipping by multi-run infrastructure.

- `EvalFixture` format — source adventure and sequence number, seeded state, player input, assertions, failure-mode tag, applicability
- Structural assertion checkers — deterministic, no second LLM call
- Judge-graded assertions — one rubric per failure-mode tag
- `eval:run` (execution) + `eval:report` (rendering); `eval:compare` for paired diffs
- Markdown output report — per-fixture rates, per-tag rollup, errors, exclusions
- One deliberately-broken counterexample per structural checker
- Multi-run infrastructure — reps, machine-readable score rows, re-scoring of frozen artifacts
- Fixtures for each failure-mode tag, at least two confirmed instances per tag where the bar requires it

Spec: [010](specs/zoltar/010-m7.4-eval-harness-spec.md), [011](specs/zoltar/011-eval-harness-multi-run.md) · Plan: [010](plans/010-m7.4-eval-harness-implementation-plan.md), [011](plans/011-eval-harness-multi-run-implementation-plan.md) · Decisions: ADR-0069

#### M7.5 — Rules Retrieval Quality

**Status:** Complete

Takes the populated-but-unmeasured index from M7.2 and makes retrieval good enough to trust, then buys the Warden-level measurement once, against an index that is not about to change again. Separate from M7.2 because the completion criteria differ in kind: M7.2's are binary, M7.5's is a quality bar, and quality-bar milestones absorb whatever is adjacent to them.

- Retrieval quality bar set against M7.2's first measurement, with separate targets for authored and Warden-observed query styles
- Chunking iteration against `task eval:retrieval`, one change per round, losing rounds logged too
- Character-creation spread and character-profile sheet excluded from the rules index
- Reference-card duplicates evaluated for exclusion and kept
- `SectionHeader` blocks tested; shipped as an opt-in flag, off by default
- Vocabulary bridging for `rules_lookup` via prompt-side guidance
- Mechanical-model primer in the Warden system prompt
- Similarity floor derived from the answerable/unanswerable distributions
- `--markdown` curated-input path on `ingest.py`
- `rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice`, with the prompt instructions that populate them
- Identifier defect on the synthesis and render paths closed
- Re-baseline against the final index

Spec: [013](specs/zoltar/013-m7.5-rules-retrieval-quality.md) · Plan: [013](plans/013-m7.5-rules-retrieval-quality-implementation-plan.md), [014](plans/014-turn19-roll-ownership.md) · Decisions: ADR-0016, ADR-0019, ADR-0020, ADR-0045, ADR-0107 · Findings: `rules-extraction-findings.md § S15–S34`, `eval-methodology.md § The retrieval quality bar`

#### M7.6 — Character Sheet Fidelity

**Status:** Complete

Groups the three open pieces of character-sheet work behind the dependency they share: the shape of the sheet itself. `<character_attributes>` had been blocked since M5 on a sheet that does not cleanly separate armor from loadout or carry conditions — the same defect the character-creation rework exists to correct. Internally ordered rather than a bag of three: the creation rework settles the shape, and the two renders read it.

- Character creation rework to match actual Mothership rules — the sheet holds immutable creation data only
- Resource pools reconciled with the reworked sheet, eleven per character, nested by owner
- Stats and saves rendered live in `<resource_pools>` — they are pools, not static build data
- `<character_attributes>` snapshot block — schema addition, write path and render landing together
- Re-baseline, with a Haiku control arm

Spec: [016](specs/zoltar/016-m7.6-character-sheet-fidelity.md) · Plan: [016](plans/016-m7.6-character-sheet-fidelity-implementation-plan.md) · Decisions: ADR-0026, ADR-0036, ADR-0039, ADR-0049, ADR-0085 · Inventories: `milestones/m7.6-*.md`

#### M7.7 — Playtest and Fixture Capture

**Status:** In progress

The dedicated playtest, promoted out of M7.5 into its own milestone: evidence-gathering with a corpus deliverable rather than a quality bar on retrieval, and what it produces closes an item in a different milestone (M7.4's fixture-count bar). The milestone has absorbed the defects the playtests surfaced, which is what a capture milestone is for.

- `system-rolled-player-action` attached to the `turn24-*` fixtures as a tag-independent check
- Tool-syntax leak guard inside the turn loop, ahead of persistence, with schema descriptions as emission mitigation
- `assemblyHash` — identity for the Warden-visible surfaces built by code
- Assembly goldens gating `eval:run` against a stale workspace build
- Entity visibility split — `visible` is line of sight, `revealed` is discovery — and the entity write path built against it
- Judge contract identity, and the verdict/rationale field-order swap
- Goldens for the four synthesis surfaces
- GM context render stored on change in playtest telemetry
- Post-playtest character-creation and mechanics gaps (spec 018), including the wounds chain and the 0-indexed table convention
- Contractor NPCs get a rolled Instinct and a `crewRole`-mapped skill bonus
- `turn16-narrating-past-a-block` retired
- `roll_dice.purpose` required to state the outcome mapping before the roll fires
- Second playtest — steered rather than natural, captured across its whole length, run against the final index
- Fixtures authored from it, closing M7.4's fixture-count bar
- `SEEDED-CANON-CONTRADICTION` registered and captured
- `UNREVERSED-RETCON` registered and captured
- `worldFacts.ship_layout` restructured from prose into a deck-indexed list
- Synthesis provenance — its own spec, sequenced after the playtest

Spec: [018](specs/zoltar/018-post-playtest-character-creation-and-mechanics.md), [019](specs/zoltar/019-entity-visibility-and-entity-write-path.md), [020](specs/zoltar/020-judge-contract-identity-and-the-field-order-swap.md) · Plan: [019](plans/019-entity-visibility-and-entity-write-path-implementation-plan.md), [020](plans/020-judge-contract-identity-and-the-field-order-swap-implementation-plan.md), [021](plans/021-unauditable-mapping-roll-purpose.md), [022](plans/022-roll-ownership-panic-checks-and-acting-entity.md) · Decisions: ADR-0094, ADR-0096 through ADR-0105, ADR-0108, ADR-0109, ADR-0110 · Findings: `hidden-information-findings.md`, `eval-methodology.md`, `rules-extraction-findings.md § S35–S36` · Capture targets: `playtest-scenarios.md`

#### M7.8 — Harness Meta-Eval

**Status:** Not started

Known-answer fixtures that grade the harness rather than the Warden: tiny hand-authored artifacts engineered to pass or fail one specific check, with the assertion being that the harness says so.

**The judge is out of scope for known-answer testing.** Prose classification is probabilistic by construction and gets characterized statistically via `eval:judge-variance`, not asserted against known answers. That exclusion is narrower than it first appeared — rationale-versus-verdict disagreement is checkable without a known answer, by reading one artifact against itself, and belongs inside this milestone's remit. Re-examine the exclusion's stated reason before planning against it.

- Known-answer fixture pairs for each structural checker — one engineered to pass, one to fail
- Coverage of the applicability gate as its own axis, one fixture per `fixture` / `artifact` / `ungated` path
- Regression case per known M7.4/M7.5 harness defect
- Wounds Table known-answer fixture — deterministic table, unambiguous correct row, both inputs in event structure
- `judgeContext` renderer covered by a committed golden
- Judge field-order study widened to the remaining six judged checks
- The "pinned at 1.00 is a harness suspect" reframe recorded as a decision

Decisions: ADR-0074, ADR-0076, ADR-0080, ADR-0082, ADR-0105, ADR-0108 · Source material: `milestones/m7.7-turns-50-52-transcript.md`

#### M8 — Multiplayer Foundation

**Status:** Not started

Caller model and initiative mode.

- Turn-path lock audit — a prerequisite; `applyTurnAtomic` serializes concurrent turns incidentally rather than deliberately
- Caller role enforcement, voluntary transfer, request + auto-approve timeout, offline claim
- Narrative transfer via `caller_transfer` in `submit_gm_response`
- Initiative mode — adventure mode flip, order stored in the adventure record, `advance_initiative` handling
- Frontend: caller indicator and transfer UI, initiative order display, active player highlighting
- Multi-PC / caller model dedicated playtest, then fixtures for the caller and initiative failure modes it surfaces

Decisions: ADR-0053, ADR-0054

#### M8.1 — Warden Prompt Iteration

**Status:** Not started

Prompt-only changes to the Warden system prompt, sequenced after M8 so iteration runs against the complete Phase 1 fixture corpus — including whatever caller and initiative failure modes M8's own playtest surfaces. This milestone owns no schema changes; work needing one belongs to the milestone that owns the schema.

- Pilot a hidden per-`dice_request` contingency field as a prompt-only instruction — Claude states "if this fails, X" without narrating it, relieving the pressure behind `OVER-RESOLUTION` and `OUT-OF-ORDER-RESOLUTION`

#### M9 — Self-Hosted Deployment

**Status:** Not started

Shippable open-core product.

- In-depth human review of game system implementation
- In-depth human review of oracle tables
- Docker Compose production configuration
- Environment variable documentation
- Signup mode implementation (`SIGNUP_MODE` / `INVITE_TOKEN` enforcement in `AuthService`)
- Identifier format rule enforced — ADR-0032 states it and nothing applies it
- One adventure per campaign enforced at the backend, with the corresponding UI gate
- Documentation reorganization ahead of the setup guide — sizing it is the first task, since the guide's location and the audience split depend on what it settles
- Self-hosted setup guide + DigitalOcean Droplet walkthrough
- Rules text ingestion pipeline verified in the target environment
- Signup mode documented in the setup guide
- Responsive polish pass (thumb reach, viewport refinement)
- Single Flyway migration consolidation pass — squash Phase 1 migrations into a clean baseline, immediately before the tag and after the last schema change lands
- Full-corpus eval run before tagging, compared against the M7.5 re-baseline — release discipline rather than milestone scope; moves to the release checklist once that exists
- Comprehensive release checklist authored for future releases
- First tagged release (`v0.1.0`)

Decisions: ADR-0032, ADR-0053, ADR-0054

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
- Campaign canon — second promotion step at adventure completion; `campaign_canon` table; synthesis reads campaign canon alongside oracle results for subsequent adventures
- Campaign canon review UI — surfaces `campaign_canon` entries with `pending` status to the appropriate reviewer at adventure completion
- E2E tests or something for the frontend

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
