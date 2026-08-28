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

**This is the summary log.** 81 of 116 entries have a summary; the rest fall back to their full text. For the reasoning behind any entry, follow its link or see [`decisions.md`](decisions.md).

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

The `voyage-3-lite` default never matched the `vector(1024)` column, and an empty index meant pgvector never evaluated a comparison to say so. Settles on `voyage-4-lite`, and names the two constraints nothing in the type system enforces: ingestion and runtime must be the same model, not merely two of the same width, and a swap is checked against the column before ingesting.

### [ADR-0110](decisions/0110-dice-are-stored-as-rolled-and-offset-at-lookup.md) — Dice are stored as they fell; the 0-indexed table offset is applied at lookup

Dice are stored as they fell and the 0-indexed table offset is applied at lookup, in one place, so a recorded roll still means what the player saw on the table. `trinket` and `patch` have carried the same 1-based roll since M7.6: a convention to establish going forward rather than a bug to repair, since nothing reads those tables.

---

## Rules Ingestion

### [ADR-0012](decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md) — Rules ingestion pipeline and retrieval quality are separate milestones

Why the re-baseline and playtest left M7.2 for M7.5: buying a baseline against an index about to be re-chunked buys it twice. The load-bearing half is what makes that safe rather than procrastination — the retrieval harness reads index quality for a few Voyage calls — plus the completion-criteria argument for two milestones instead of one with a later Part 6.

### [ADR-0013](decisions/0013-rules-ingestion-is-cli-only-in-phase-1.md) — Rules ingestion is CLI-only in Phase 1

No web upload surface for rules ingestion. It follows from the licensing posture rather than from effort — an uploader puts the operator in the position of receiving other people's rulebook PDFs — and from the shape of the job. Recorded because the absence of a UI is the single thing a future reader is most likely to assume was an oversight.

### [ADR-0014](decisions/0014-chunk-extraction-is-block-based-with-footer-derived-provenan.md) — Chunk extraction is block-based with footer-derived provenance, not markdown headings

Why ingestion chunks marker's typed blocks rather than Markdown headings — the PSG's heading histogram kills that premise on arithmetic alone — and where provenance actually comes from, since `blocks[].page` is an internal id that looks like a page number and is not. Verified against the PSG 1e only; a second book needs its own check.

### [ADR-0015](decisions/0015-reading-order-requires-an-explicit-column-aware-sort-an-llm.md) — Reading order requires an explicit column-aware sort; an LLM may validate it, never perform it

Marker's emitted block order is not reading order on multi-column pages — roughly half the body pages would concatenate backwards. Settles on a deterministic column-aware sort in `ingest.py`, with the boundary that an LLM may validate the result and never perform the reordering. The coverage caveat stands: the test validating the sort sees 16 of 44 pages.

### [ADR-0016](decisions/0016-character-creation-content-is-excluded-from-the-rules-index.md) — Character-creation content is excluded from the rules index — structurally unreachable by the Warden

Why the character-creation pages leave the rules index, and why page 3 leaves it for an entirely different reason — structural unreachability, read off the tool array, versus measured harm to answerable queries. That distinction is the entry's real content. Carries a method note on a pre-registered criterion that turned out to point at the wrong fixtures.

### [ADR-0017](decisions/0017-fixup-match-schema-keyed-on-block-id-not-section-contains.md) — Fixup match schema keyed on block `id`, not `{section, contains}`

Why fixup entries match on block `id` rather than the `{section, contains}` pair the ingestion doc specifies — neither key can express the confirmed defect, which is tables extracting empty with no text to match on. This fixes the schema those fixups will use, not the defects; `fixups.json` is still empty.

### [ADR-0109](decisions/0109-trinket-and-patch-tables-are-not-repaired.md) — The garbled trinket and patch tables are not repaired — nothing queries them

The trinket and patch tables extract garbled — reassembly damage rather than loss, with all 100 indices present in each — and are deliberately not repaired, because nothing in the app resolves a d100 against them. Corrects `§ S11.2`'s 'intact' claim, which holds at the token level and not at the row level.

### [ADR-0111](decisions/0111-footer-less-pages-inherit-the-preceding-chapter.md) — Footer-less pages inherit the preceding chapter; reference cards carry none by design

How the eight footer-less PSG pages resolve — two dropped, two reference cards recorded as `chapterless_pages`, one inheriting the preceding chapter — plus the re-measurement showing it cost no retrieval accuracy. Includes a same-day correction: a chapterless page skips the carry rather than stopping it.

---

## Rules Retrieval

### [ADR-0018](decisions/0018-rules-retrieval-mechanism-dense-embeddings-over-fts-or-llm-a.md) — Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex

The three spikes that settled dense embeddings over Postgres FTS and LLM-authored regex, including the latency budget that rules out any second model call at query time and the one query that discriminated between the mechanisms. It does not settle vocabulary sensitivity, which is `ADR-0019`'s subject.

### [ADR-0019](decisions/0019-query-preprocessing-for-rules-lookup-promoted-from-optional.md) — Query preprocessing for `rules_lookup` promoted from optional to critical path

Query preprocessing as critical path — and the half of it measurement overturned: the document-frequency ceiling has no useful setting on this corpus, because what `§ S4` proved was hand-authored trimming by someone who knew the target page. The vocabulary half stays open, and the amendment splits it into wrong-word and concept-absent, which is what makes a similarity floor load-bearing rather than a refinement.

### [ADR-0020](decisions/0020-no-similarity-floor-for-rules-lookup-the-distributions-overl.md) — No similarity floor for `rules_lookup` — the distributions overlap, and the free-looking threshold is fitted to noise

No similarity floor for `rules_lookup`: the answerable and unanswerable distributions interleave rather than abut. The part worth reading is why the free-looking 0.34 threshold is rejected — its zero measured cost is an artifact of being fitted to a sample minimum — and what would actually make a floor derivable, which sits upstream of retrieval.

### [ADR-0021](decisions/0021-the-d-d-5e-bias-hypothesis-has-a-confirmed-instance-in-the-s.md) — The D&D-5e-bias hypothesis has a confirmed instance, in the schema rather than in retrieval

Two 5e mechanics found in the Mothership sheet and pool definitions: a `level` field, and 0 HP sending a character to death saves where the rules give a Wound. Recorded for the pattern rather than the defects — the bias hypothesis was about retrieval and got confirmed in a hand-authored schema instead. It does not validate the retrieval-side claim, and names the cheap test still unrun.

### [ADR-0022](decisions/0022-the-retrieval-stopping-rule-is-measured-on-the-metrics-with.md) — The retrieval stopping rule is measured on the metrics with headroom, not on the saturated one

Why M7.5's stopping rule moved off `authored` recall@3: already at 100%, it cannot improve, so the no-progress test would have fired after three rounds unconditionally — a round counter dressed as a quality test. `authored` becomes a regression floor instead. Corrected before round 1 ran, which is the point, and the general lesson outlives this rule.

### [ADR-0107](decisions/0107-reference-cards-stay-in-the-rules-index.md) — The reference-card duplicates stay in the rules index — a close call settled on a pre-fixed criterion

The reference cards stay in the index. Dropping the back-cover cheat sheet worked exactly as designed — its share of top-3 slots went 14 → 0, every aggregate identical — and one fixture regressed deterministically, so the criterion fixed before the run reverted it. Also records why this fixture set can no longer discriminate at this level.

---

## Claude Integration — Tool Schemas & State

### [ADR-0023](decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md) — Warden model upgraded to `claude-sonnet-5`

The 4.6 → Sonnet 5 upgrade and the baseline tables behind it. Several figures here have since been retired — the `SYSTEM-ROLLED-PLAYER-ACTION` ceiling, everything graded before `actingEntityId` — and the judged rows are self-graded. Addenda cover the Haiku control arm's narrowing job, the Sonnet 5 markup-leak defect, and what the arm returned — valid for prose-graded checks, unable to probe a check whose fail direction needs a field the generator populates.

### [ADR-0024](decisions/0024-tool-use-over-prompt-instructions-for-structured-output.md) — Tool use over prompt instructions for structured output

Structured output goes through forced tool calls rather than prompt-instructed JSON. The addendum narrows the guarantee substantially: tool use enforces the schema, not that the model put its content in the right field, and the category of malformed response this entry claims to eliminate relocated inside a valid parameter. Schema validity is a floor, not a proof.

### [ADR-0025](decisions/0025-hp-and-all-numeric-resources-in-resourcepools-not-a-separate.md) — HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field

An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

### [ADR-0026](decisions/0026-state-placement-is-decided-by-the-lifetime-of-the-referent-n.md) — State placement is decided by the lifetime of the referent, not the lifetime of the value

The placement rule across the three state destinations: does the value change in play, and if it does, how long does the thing it describes last. The part worth reading is 'reset is a rule, not a lifecycle' — the intuition that spell slots are adventure-scoped is exactly what the rule exists to correct. Scopes finer than an adventure have no home yet.

### [ADR-0027](decisions/0027-character-sheet-stores-identity-and-build-not-live-mutable-s.md) — Character sheet stores identity and build, not live mutable state

The sheet/pool split: identity, build and ceilings on the character sheet, anything that mutates in play in `resourcePools`. Read the addenda before relying on the body — they generalize the rule and find the entry wrong against the rules in several places, including the stress seed, floor and cap. Addendum 3 rejects end-of-adventure write-back.

### [ADR-0028](decisions/0028-pool-validator-applies-full-delta-before-threshold-detection.md) — Pool validator applies full delta before threshold detection

When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.

### [ADR-0029](decisions/0029-pool-behavior-defined-in-system-zod-schema-not-hardcoded-in.md) — Pool behavior defined in system Zod schema, not hardcoded in validator

Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.

### [ADR-0030](decisions/0030-typed-system-specific-fields-on-tool-schemas-are-acceptable.md) — Typed system-specific fields on tool schemas are acceptable while one system is supported

Why `damageType` may name five Mothership Wounds Table columns on a shared tool schema, and what a generic `properties` container would cost while only one system exists. Names the trigger to generalize — a second system needing a *different* field, not this one needing a second field — and the re-baseline asymmetry that argues for watching the pool-delta object closely.

### [ADR-0031](decisions/0031-entity-death-does-not-auto-zero-prefixed-pools.md) — Entity death does not auto-zero prefixed pools

When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.

### [ADR-0032](decisions/0032-entity-and-resource-pool-identifiers-use-underscores-only.md) — Entity and resource pool identifiers use underscores only

Identifiers carry underscores only, and why dots and hyphens were rejected. The addendum retires the `{entity_id}_{pool_name}` composite key in favour of owner-nested pools without disturbing the rule itself, and records the cost that is easy to miss: merges must become deep, where two existing merge points are shallow.

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

Player pools are written when the character sheet is created, not by synthesis. Three later notes qualify it: the 'two writers never race' claim was false and produced duplicate pool prefixes for one character, the derivation is one-way so sheet edits never reach live pools, and read-side validation of `character_sheet.data` cannot be added without changing the harness seed in the same change.

### [ADR-0037](decisions/0037-synthesis-prompts-are-system-specific-no-driver-registry-yet.md) — Synthesis prompts are system-specific; no driver registry yet

Each system owns its synthesis prompt module, with system-prefixed exports so no name falsely suggests cross-system generality; only the tool definitions and shared schemas are universal. The `synthesisDrivers[systemId]` registry is deferred on the standing ground that an interface defined against one implementation is a guess shaped entirely by Mothership.

### [ADR-0038](decisions/0038-m7-6-pool-and-character-state-contract-resolved-decisions.md) — M7.6 pool and character-state contract — resolved decisions

What M7.6's D1–D4 actually built: owner-keyed `resourcePools`, the reserved `_scenario` owner, `creationChoices.adjustedStat`, `characterState`'s six operations, and all-or-nothing rejection per turn. Also records what was identified and deliberately left out, with the trigger that would reverse it. The addendum settles within-entry granularity, which the body left looking open.

### [ADR-0039](decisions/0039-the-m7-6-migration-drops-and-recreates-rather-than-transform.md) — The M7.6 migration drops and recreates rather than transforming

Why the M7.6 migration deletes every `character_sheet` and `campaign_state` row rather than transforming them, and the three facts that made that safe. Recorded because the migration file is disposable — the pre-`v0.1.0` Flyway consolidation discards it — and this reasoning is not. A defensive transform could not have worked anyway: the old sheet stored sums, never the rolls.

### [ADR-0040](decisions/0040-armor-points-are-a-threshold-not-a-pool-the-m7-6-spec-was-wr.md) — Armor Points are a threshold, not a pool — the M7.6 spec was wrong about this

Armor Points are a threshold, not a pool: a hit below AP is not a state change at all, and a single hit at or above it destroys the armor. Recorded because the M7.6 spec and implementation plan both say the opposite, and because 'subtract armor from each hit' is the error a Warden defaults to. Damage Reduction is a separate field for the same reason.

### [ADR-0100](decisions/0100-npc-crew-role-skills.md) — Contractor NPCs get a rolled Instinct and a `crewRole`-mapped skill bonus — a Zoltar house rule, not RAW

Introduces Instinct for `npc` entities and a `crewRole` → skill-chain layer over it: the roll, where it is stored, and the `assemblyHash` precondition a role-table edit would otherwise slip past. Everything mechanical in it is invented — a Zoltar house rule, not RAW.

### [ADR-0103](decisions/0103-entity-merge-preserves-schema-fields.md) — Entity merge preserves all schema fields rather than a hand-enumerated set

The hand-enumerated entity merge that silently destroyed authored fields — `crewRole`, `instinctRoll` — the playtest evidence for it, and the parse-through-`EntitySchema` fix, which has not yet landed. Carries five open items, two of them since resolved: the 2c0ba938 captures are confirmed fix-invariant below seq 99, and there is still no way to remove a field from an entity record.

---

## Claude Integration — Turn Loop & Correction

### [ADR-0041](decisions/0041-correction-loop-bounded-at-one-re-prompt.md) — Correction loop bounded at one re-prompt

The correction loop is capped at one re-prompt — a hard cap, not a budget — after which the turn 502s and the transaction rolls back. A larger retry budget masks the real problem, which is a validator rule or a prompt that needs work. Names what evidence would justify loosening it.

### [ADR-0042](decisions/0042-the-correction-loop-does-not-re-enter-the-inner-tool-loop.md) — The correction loop does not re-enter the inner tool loop

The correction pass narrows `tool_choice` to `submit_gm_response`, so it cannot re-invoke `roll_dice` or `rules_lookup`. The rationale is practical — those tools already did their work against the live fiction, and an invalid delta is a narrative fix — and principled: re-entering the loop would make reroll-until-validation-passes possible by construction.

### [ADR-0043](decisions/0043-rules-lookup-calls-are-captured-in-adventure-telemetry-paylo.md) — `rules_lookup` calls are captured in `adventure_telemetry.payload.rulesLookups`, not in `game_events`

Why `rules_lookup` calls land in `adventure_telemetry.payload` rather than `game_events`: they are metadata about how the Warden reached a ruling, not state changes, and the event log is player-visible and bound to a sequence-number contract. Records what the telemetry record keeps and why full chunk text is deliberately omitted.

### [ADR-0044](decisions/0044-agentic-graph-decomposition-stays-deferred-dice-arbitration.md) — Agentic graph decomposition stays deferred; dice-arbitration evidence weakens the case without closing it

Why a LangGraph-style decomposition of the turn loop stays deferred, and how the dice-arbitration evidence for it has moved. The criterion is on its third iteration — the 0.90 the deferral rested on halved once the index was populated, the structural `roll_dice` fields did not fix it, and the current test is prompt placement, measured against `UNSURFACED-CHECK` as a pair.

### [ADR-0045](decisions/0045-rolltype-gatedbyrollid-actingentityid-on-roll-dice-stay-defe.md) — `rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice` stay deferred, but they are measurement infrastructure

Closed — the three `roll_dice` fields landed in M7.5 on the schedule this entry set; the title is the original question, not the outcome. Records what `gatedByRollId` and `actingEntityId` bought the checks waiting on them, that `rollType` never had a measurement role, and a provenance note on a reversal that was itself reversed.

### [ADR-0046](decisions/0046-actingentityid-must-resolve-against-a-declared-identifier-se.md) — `actingEntityId` must resolve against a declared identifier set, and an unresolvable id is undecided

The `actingEntityId` namespace mismatch that inverted `system-rolled-player-action` and graded ten violations clean, plus the three rules drawn from it: name both namespaces in an identifier comparison, treat a resolution failure as a third state, and enforce one canonical id at runtime while the checker tolerates aliases. The amendment closes the product path and corrects two claims about the cause.

### [ADR-0097](decisions/0097-a-schema-valid-submit-gm-response-is-not-necessarily-well-fo.md) — A schema-valid `submit_gm_response` is not necessarily well-formed

The tool-syntax leak — schema-valid responses whose payload was serialized into `playerText` — its measurement, and the deterministic guard that catches it. Read the addenda before citing the body: they supersede the retry reasoning (the budget is 1, not the loop cap) and replace the prompt-block mitigation with tool-schema descriptions.

---

## Claude Integration — Continuity & Spatial

### [ADR-0047](decisions/0047-phase-1-spatial-consistency-is-prose-based-not-structured.md) — Phase 1 spatial consistency is prose-based, not structured

Phase 1 spatial consistency runs on Claude-authored `worldFacts` rather than the migrated-but-unused grid tables. An explicit deferral under uncertainty, naming the failure modes a playtest should watch for — several of which `ADR-0101`'s 2026-08-25 addendum then measured.

### [ADR-0048](decisions/0048-phase-1-continuity-is-carried-by-cached-gm-context-and-worki.md) — Phase 1 continuity is carried by cached GM context and working-memory fields, not a rolling summary

Why the rolling summary stays unbuilt and `adventure.rolling_summary` stays null through Phase 1 — cached GM context plus the working-memory fields already cover most of what it was specified to capture. An explicit deferral under uncertainty, naming the playtest failures that would validate or reverse it.

### [ADR-0049](decisions/0049-the-character-attributes-snapshot-block-is-specified-but-def.md) — The `<character_attributes>` snapshot block is specified but deferred until a data source exists

The `<character_attributes>` block was specified with nothing to populate it. Two amendments have overtaken the body: the static stats/saves slice was never actually blocked, and the qualitative half's own reactivation trigger had already fired with nothing watching. Both landed in M7.6, not the M8.1 this entry last scheduled.

### [ADR-0050](decisions/0050-message-ordering-relies-on-createdat-only-no-shared-sequence.md) — Message ordering relies on `createdAt` only; no shared sequence key with `game_events`

Why `messages` carries no sequence key and ordering rests on `createdAt` alone, plus the two conditions that would change it: multi-instance deployment with application-side timestamps, and synchronous multiplayer. Records that a player message and the GM's response are deliberately not written in one transaction.

### [ADR-0101](decisions/0101-visible-is-line-of-sight-not-discovery-only-position-is-stru.md) — `visible` is line of sight, not discovery — only position is structurally withheld

Splits the overloaded `visible` into line of sight plus a monotonic `revealed`, removes `renderEntities`' filter, and narrows the design doc's structural-secrecy claim to position alone. Two addenda carry weight: `npcState` on the entity, and the correction that 'structurally vacuous' held only for the grid — Phase 1's vertical ship topology was already producing position errors.

---

## API & Data Model

### [ADR-0051](decisions/0051-narrative-and-dice-result-submissions-are-separate-endpoints.md) — Narrative and dice-result submissions are separate endpoints, not a discriminated union under `POST /actions`

Why narrative and dice submissions ship as `/messages` and `/dice-results` rather than a discriminated union under `/actions`: the two diverge on Claude invocation, response shape, failure modes and resource semantics, so a union reconciles the request bodies and nothing else. Names the endpoint count that would justify revisiting.

### [ADR-0052](decisions/0052-campaign-canon-is-separate-from-adventure-canon.md) — Campaign canon is separate from adventure canon

Why campaign-level facts get their own `campaign_canon` home rather than being fed into synthesis as prior-adventure blobs, and why promotion into it is a second deliberate editorial step at adventure completion rather than something automatic.

### [ADR-0053](decisions/0053-one-active-adventure-per-campaign.md) — One active adventure per campaign

One active adventure per campaign — and the addendum withdraws even the completed-adventure allowance for `v0.1.0`, because nothing behind that door works: no campaign canon, no rolling summary, no adventure-scoped state. The constraint is a data guarantee that keeps the Phase 2 migration mechanical, and carries an explicit reversal condition.

### [ADR-0054](decisions/0054-adventure-state-gets-its-own-row-not-an-adventure-tag-on-cam.md) — Adventure state gets its own row, not an adventure tag on campaign state

Adventure-scoped state gets its own row rather than an adventure tag on campaign state, with the two-schemas-two-write-paths cost stated. Not implemented in Phase 1. The addendum is the load-bearing part: ownership and scope are orthogonal, so the Phase 2 move spans all of `scenarioState` and part of `resourcePools`, by owner key.

### [ADR-0055](decisions/0055-adventure-telemetry-vs-session-export-are-distinct-artifacts.md) — `adventure_telemetry` vs session export are distinct artifacts

Two artifacts that were originally both called `adventure_log`, kept apart deliberately: `adventure_telemetry` is per-turn diagnostic infrastructure and not player-facing, while the session export is the on-demand portable file supporting restore and post-session analysis.

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

Why the artifact is the whole serialized `TurnExecutionResult` and not the `submit_gm_response` payload the spec describes: `eval:judge-variance` re-runs checks against a frozen artifact with no database at all, so anything narrower would force re-seeding a scratch campaign per re-evaluation or keeping every one alive.

### [ADR-0066](decisions/0066-harnessversion-is-the-git-short-sha-not-a-hand-maintained-co.md) — `harnessVersion` is the git short SHA, not a hand-maintained constant

Recorded per rep and per row as `git rev-parse --short HEAD`, with a `-dirty` suffix when `apps/zoltar-be` has uncommitted changes, and `unknown` outside a git checkout. Same argument as `corpusVersion` being a content hash rather than a hand-bumped string: a manually maintained version fails silently when someone forgets to bump it, and the failure mode — two reps labeled identically under different checker semantics — poisons exactly the weeks-apart append the field exists to disambiguate.

### [ADR-0067](decisions/0067-error-is-a-fourth-verdict-not-folded-into-fail.md) — `error` is a fourth verdict, not folded into `fail`

Why a turn that never completed is its own verdict rather than a `fail`: conflating a transient failure with a real regression corrupts `pass / (pass + fail)`, the one number the harness exists to produce. Errors leave the denominator, stay counted, and surface in their own report section.

### [ADR-0068](decisions/0068-eval-judge-variance-writes-beside-the-run-not-into-reps.md) — `eval:judge-variance` writes beside the run, not into `reps/`

`reps/*/scores.jsonl` rows mean "one observation of generator and grader together" — every pass-rate denominator in `eval:report`/`eval:compare` assumes that. A grader-only re-run against frozen input is a different measurement and would corrupt those denominators if appended there. Its output lives in `<run-dir>/judge-variance/<timestamp>.jsonl` instead — an extension beyond the spec, which doesn't say where this command's output goes.

### [ADR-0069](decisions/0069-eval-harness-retired-not-kept-alongside-eval-run.md) — `eval:harness` retired, not kept alongside `eval:run`

The multi-run harness's whole premise is separating execution from rendering — `eval:run` writes score rows, `eval:report` reads them, and nothing downstream parses markdown. Leaving `eval:harness` in place would have kept a second write path producing no score rows, which is the thing this milestone existed to eliminate. `eval:replay` survives — repointed at the unified check registry — and gained an artifact-based mode (`--run-dir --rep`, no database), covering the quick single-fixture-iteration use `eval:harness` was also serving.

### [ADR-0070](decisions/0070-judge-verdicts-stay-binary-no-confidence-scoring.md) — Judge verdicts stay binary — no confidence scoring

Judge verdicts stay `{passed, rationale}`. Records a decision that predates the multi-run harness and had lived only in the shape of a schema, because a permanently-empty optional confidence column reads as an invitation to fill it rather than as a decision. Adding one later is non-breaking.

### [ADR-0071](decisions/0071-eval-compare-s-mixed-rubric-warning-groups-by-checkid-and-fi.md) — `eval:compare`'s mixed-rubric warning groups by `checkId`, and `--filter-rubric` is scoped to one check

The mixed-rubric warning fired on every multi-check run by construction, and following its printed remedy silently dropped every judged check but one. Groups rubric hashes per `checkId` instead and scopes `--filter-rubric` to `CHECK=HASH`. Records why `checkId` rather than `tag` is the grouping key.

### [ADR-0072](decisions/0072-a-warning-s-suggested-remedy-must-produce-a-correct-comparis.md) — A warning's suggested remedy must produce a correct comparison, not merely a homogeneous one

The class behind three separate warnings that each detected a real inconsistency and then suggested a remedy that deleted it rather than resolving it. The rule: a warning may only suggest a remedy that leaves the comparison valid, and where none exists it says what the reader must do by hand. Homogeneity is a property of the row set; correctness is a property of what the rows mean.

### [ADR-0073](decisions/0073-applicability-is-fixture-authored-keyed-by-checkid-never-inf.md) — Applicability is fixture-authored, keyed by `checkId`, never inferred from the turn's own output

Applicability moves out of 'did this turn produce a `dice_roll`?' — selection on the outcome variable, which had shrunk two checks to 2 decided reps out of 40 — and into a fixture-authored `applicability` map keyed by `checkId`. Records why it is keyed rather than nested under `assertion`, and why `capture-fixture` stubs it fail-closed.

### [ADR-0074](decisions/0074-a-structural-check-may-read-event-and-state-structure-it-may.md) — A structural check may read event and state structure; it may not classify prose

The dividing line for structural checkers — they may read event and state structure, never classify prose — and the three-case taxonomy built on it. The third case closed in M7.5, though one residual false FAIL survives in `out-of-order-resolution`'s deferred-gate branch. The addendum records why the harness deliberately writes a `character_sheet` row the schema would reject.

### [ADR-0075](decisions/0075-eval-rescore-re-grades-frozen-artifacts-re-score-rows-are-a.md) — `eval:rescore` re-grades frozen artifacts; re-score rows are a distinct row kind

What `eval:rescore` is — re-grading frozen artifacts with no Warden calls and no database — and why it landed alone, before any checker changed, so its output could be validated against independently derived numbers. Records why re-score rows extend the run row schema rather than forking it, and why un-regradable rows are carried forward rather than dropped.

### [ADR-0076](decisions/0076-applicabilitysource-is-declared-per-check-and-the-third-valu.md) — `applicabilitySource` is declared per check, and the third value is `'ungated'`

The three values of `applicabilitySource` — where a check's `not_applicable` verdicts come from — required rather than optional so adding a check forces the question, and carried on the row so it keeps describing the rules it was scored under. Records why `'judged-check'` and `'none'` were both rejected for the third value.

### [ADR-0077](decisions/0077-a-judged-check-may-carry-a-structural-pre-filter-judgegate-a.md) — A judged check may carry a structural pre-filter (`judgeGate`), and gated reps are excluded from judge-variance

`judgeGate` — the structural pre-filter that lets one check span both modes without adding a third `mode` value. The non-obvious half is what it does to `eval:judge-variance`: gated inputs are deterministic, so leaving them in the flip-rate denominator would pull the one number that command exists to produce toward zero.

### [ADR-0078](decisions/0078-structural-checks-report-undecided-rather-than-guessing-when.md) — Structural checks report undecided rather than guessing when a prose dependency fails

The rule that a structural check reports undecided when its prose binding fails, rather than collapsing into its PASS condition — with the denominator cost measured across both frozen runs. The same audit found a second error: binding a `dice_request` by prose was wrong outright, since a pending request is a deferred player roll whatever its purpose text says.

### [ADR-0079](decisions/0079-out-of-order-resolution-reads-the-deferred-gate-and-declines.md) — `out-of-order-resolution` reads the deferred gate, and declines the in-turn case

Why `out-of-order-resolution` reads a pending `dice_request` as a structural gate, and the three sub-cases the checker keeps distinct so none collapses into a false pass. The in-turn half closed when `gatedByRollId` landed; the deferred-gate branch's known false FAIL is pinned by a test rather than patched, and the two-turn fixture idea is withdrawn.

### [ADR-0080](decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md) — OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be

OPEN. The undecided discipline governs structural checks and was never extended to judged ones; `turn24-over-resolution` is the case that shows it should be — a judged check that cannot find its subject collapses into FAIL, the mirror of `ADR-0046`. Three questions are listed and none is settled, so read `OVER-RESOLUTION` at 0.90 accordingly.

### [ADR-0081](decisions/0081-missing-canon-capture-stays-structural-because-a-judge-canno.md) — `missing-canon-capture` stays structural, because a judge cannot say "nothing to grade"

The one check reviewed for its prose dependency where the conclusion ran the other way. A judge asked about a detail the narration never introduces answers 'it didn't' and, the verdict being binary, returns a pass — turning an honest zero denominator into a spurious 1.00. The real defect is in the fixture, tracked separately.

### [ADR-0082](decisions/0082-a-rate-that-never-moves-is-a-harness-suspect-not-a-finding.md) — A rate that never moves is a harness suspect, not a finding

The heuristic that a rate pinned at 0.0 or 1.0 is a harness suspect rather than a finding, with the ceiling half the one nobody investigates. Four addenda extend it: the instance list decays and should be computed, `turn16` turned out to be a rules error in the fixture rather than an immovable checker, it has since been retired, and the Haiku control arm dispositioned `turn28-hidden-info-leak` as real while proving it cannot reach `out-of-order-resolution` at all.

### [ADR-0083](decisions/0083-applicability-is-reported-alongside-every-rate-and-errors-ar.md) — Applicability is reported alongside every rate, and errors are not in its denominator

Applicability is reported beside every rate, and errors are excluded from its denominator — an errored rep never reached the question. The same number reads differently by `applicabilitySource`, which is why reports render it alongside: a partial value means a harness defect for a fixture-gated check and a real behavioural measure for an artifact-gated one.

### [ADR-0084](decisions/0084-eval-report-and-eval-compare-name-which-grading-they-rendere.md) — `eval:report` and `eval:compare` name which grading they rendered, and share one default

Once `eval:rescore` exists, 'the report for this run' stops being a well-defined request. `--scoring` selects, defaulting to the most recent re-score and naming the resolved grading in the title, a header bullet and stderr. It lives on both `eval:report` and `eval:compare` through one resolver, because a default that moved only one would manufacture the cross-grader comparison the flag exists to prevent.

### [ADR-0085](decisions/0085-prompt-work-during-a-re-baseline-is-triggered-by-attribution.md) — Prompt work during a re-baseline is triggered by attribution, not by a number falling

The four-way classification for whether a number that moved during a re-baseline is this milestone's work or M8.1's backlog — written before M7.6's numbers were readable, which is the point. Category 2 is the hard one: with six Warden-visible changes on one run there is no honest delta, so a regression has to be argued from a violated prediction.

### [ADR-0094](decisions/0094-don-t-pay-for-the-same-re-baseline-twice.md) — Don't pay for the same re-baseline twice

The rule that a change forcing a re-baseline waits for one already being bought rather than triggering its own. Records a rule that had been operating in three other entries before it had a home, and bounds it: this is not a reason to defer a fix worth measuring on its own.

### [ADR-0096](decisions/0096-a-check-may-be-attached-to-a-fixture-whose-tag-it-is-not-via.md) — A check may be attached to a fixture whose `tag` it is not, via fixture-authored `applicability`

Selection by `tag` alone meant a check was measured only on fixtures named after it — which let `SYSTEM-ROLLED-PLAYER-ACTION` read 1.00 while six violations sat on `turn24-*` fixtures. Adds tag-independent attachment through fixture-authored `applicability`, and explains why `tagIndependent` is hand-declared rather than derived from `applicabilitySource`.

### [ADR-0098](decisions/0098-a-check-may-run-on-every-fixture-with-no-applicability-entry.md) — A check may run on every fixture, with no applicability entry to author

Universal checks — no `applicability` entry to author, run on every fixture — added for `tool-syntax-leak`, with the three ways routing it through `applicability` fails. The accepted trade is that a universal check cannot be scoped to part of the corpus; a check that needs scoping is conditional, and belongs in the tag-independent list instead.

### [ADR-0099](decisions/0099-the-code-built-prompt-surfaces-get-their-own-identity-separa.md) — The code-built prompt surfaces get their own identity, separate from `promptHash`

Adds `assemblyHash` over the three code-built Warden surfaces — tool definitions, GM context blob, state snapshot — via a frozen probe and committed goldens. Two addenda matter: the hash tracks the *build* rather than the commit, so a stale workspace `dist` mislabels a run, and the playtest-telemetry shape proposed here was replaced by store-on-change.

### [ADR-0102](decisions/0102-the-judge-contract-gets-its-own-identity-and-the-verdict-fol.md) — The judge contract gets its own identity, and the verdict follows the reasoning

Gives the judge contract — verdict tool, system prompt, closing instruction, model — the identity `rubricHash` never covered, and gates every judge-spending entry point on its golden. Also swaps `rationale` ahead of `passed`, shipped on variance measurement rather than on the argument. Judged checks only; the structural half is `ADR-0108`.

### [ADR-0104](decisions/0104-spatial-errors-two-failure-modes.md) — Spatial narration errors are two failure modes, not one

Splits the 2026-08-24 playtest's spatial narration errors into a gradeable seeded-canon tag and an ungradeable relative-position one, with the rubric and `judgeContext` injection the first needs. The addendum reverses the second half: its category-three classification does not hold and registration is deferred.

### [ADR-0105](decisions/0105-judgecontext-golden-not-hash.md) — `judgeContext` output is covered by a golden, not a hash

`judgeContext` output is the one judge-visible surface no identity covers, which lets `eval:compare` issue a false like-for-like license in silence. Covered by a committed golden rather than a hash, with the argument for why hashing the output is the wrong instrument and a corollary on renderers selecting from the fixture rather than authoring content.

### [ADR-0108](decisions/0108-no-identity-for-the-structural-checkers.md) — Structural checkers get no identity hash — the repair hatch is what makes them different

Why the structural checkers get no identity hash while the judged half does. The gap is real; the reason is repair cost — `eval:rescore` regrades deterministic checkers for free, so a run mislabelled by a checker edit is repairable after the fact at zero spend, where the judged half has no such hatch. Names the case that would reverse it.

### [ADR-0112](decisions/0112-unreversed-retcon-is-judged-and-the-reversed-turn-s-committe.md) — `UNREVERSED-RETCON` is judged, and the reversed turn's committed deltas are captured

The turn 20/21 retcon pair, registered as a tag on one instance. Judged rather than structural, because detecting a reversal means reading prose; graded against a new captured field (`seededState.precedingCommittedTurn`, fixture schema v3) rather than hand-authored facts, because the fold destroys the delta the check needs. Carries the rejected structural design and the `ADR-0105` golden that ships with the renderer.

### [ADR-0113](decisions/0113-the-duplicate-turn19-turn21-fixtures-are-kept-as-tripwires-a.md) — The duplicate turn19/turn21 fixtures are kept as tripwires at `repOverride: 1`, not retired

Two fixture pairs replay one turn each from identical seeded state, a leftover from before `ADR-0096` let one fixture carry two checks. Neither retiring them nor keeping them at full N is right: the behaviour they catch has been absent for seven runs but recurred once within a single day. `repOverride: 1` keeps the tripwire and its comparison history at a tenth of the cost.

### [ADR-0114](decisions/0114-out-of-order-resolution-is-tag-independent-and-attached-to-s.md) — `out-of-order-resolution` is tag-independent, and attached to six more fixtures

`ADR-0096` settled that the check *could* travel and deferred whether it *should*, pending a count. The count found 29 violations across five fixtures it was not pointed at, all of one shape. Records the count, the attachment, and why one fixture with zero observed failures is attached anyway.

### [ADR-0115](decisions/0115-turn02-missing-canon-capture-is-retired-not-re-authored.md) — `turn02-missing-canon-capture` is retired, not re-authored

The fixture reported `not_applicable` on 157 reps across 16 runs. The marker phrase looked like the defect and was a symptom: the detail it asks the Warden to capture is already seeded in `worldFacts`, so re-authoring the marker would have failed the turn for not re-writing a durable fact. Retired rather than repaired, and replaced by two fixtures graded in opposite directions.

### [ADR-0116](decisions/0116-warden-eval-findings-get-their-own-log-and-the-s-numbering-s.md) — Warden eval findings get their own log, and the `S` numbering spans both files

`rules-extraction-findings.md § S30`–`§ S36` are Warden eval findings in a file about chunking PDFs. `docs/eval-findings.md` takes the subject from `§ S37` on, continuing the same numbering — the break is forward-only because frozen plans cite the older sections by file and number.

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

Records that `docs/plans/` and `docs/specs/zoltar/` are tracked and stay tracked — already true in practice, after an earlier keep-them-out policy reversed without either decision being written down. Written because a citation to that vanished policy nearly justified pruning the specs. Whether they are *public* is a separate question and stays open.

### [ADR-0106](decisions/0106-handoff-format.md) — Cross-Context Handoff Format

The `handoff` block format for moving work between Claude Code and Claude Web: header fields, the closed `ask` set, and the body shapes for `review-decision` and `verify-claims`. Provisional — the open questions at the end are the experiment's own success criteria.

---

## Licensing & Business Strategy

### [ADR-0090](decisions/0090-license-elastic-license-2-0.md) — License: Elastic License 2.0

Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

### [ADR-0091](decisions/0091-open-source-release-proceeds-as-designed-no-closed-source-ca.md) — Open-source release proceeds as designed; no closed-source carve-out for prompts or graph orchestration

Rejects closing the Warden prompts or any future orchestration logic as a moat, on threat-model grounds rather than technical ones — the time-to-market estimate shows a prompt-only closure would not buy the gap it is meant to. Names where protection actually sits, and closes the open-source release question.

### [ADR-0092](decisions/0092-saas-service-implementations-stay-closed-source-enforcement.md) — SaaS service implementations stay closed source — enforcement rationale, not competitive secrecy

Why the SaaS service implementations stay closed while the prompts and orchestration stay open. Not secrecy — the RLS, tenancy and billing layer is the literal mechanism that makes the ELv2 single-tenant restriction real, and the open core is single-tenant by omission rather than enforcement. Costs nothing to maintain, since the interface split already separates them.

---

## Security

### [ADR-0093](decisions/0093-prompt-injection-risk-acknowledged-not-addressed-at-mvp.md) — Prompt injection risk acknowledged, not addressed at MVP

Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.
