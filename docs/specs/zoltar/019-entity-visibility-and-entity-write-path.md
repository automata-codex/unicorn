# 019 — Entity visibility, and the entity write path that never got built

**Status:** **Parts 1–9 built 2026-08-21; the re-baseline is not run.** Decision recorded as `ADR-0101`. Plan at `../../plans/019-entity-visibility-and-entity-write-path-implementation-plan.md`. Origin: `docs/hidden-information-findings.md`. `promptHash` `fa4e6e2f` → `6717347d`, `assemblyHash` `3d8df5f3` → `6dc28608`
**Target path:** `docs/plans/019-entity-visibility-and-entity-write-path-implementation-plan.md`
**Type:** ephemeral implementation spec (archive after execution; the living record is `docs/decisions/` and the roadmap)

---

## Context

`docs/hidden-information-findings.md` recorded that `renderResourcePools` emits a hidden entity's HP into the prompt while `<entities>` withholds the entity, and left the question of whether that is a defect open. `ADR-0101` answers it: **it is not a leak, because `visible` never meant secrecy.** It means line of sight — transient, bidirectional, the goblin ducking behind a column — and the playtest used it as a monotonic discovery gate because nothing anywhere told it otherwise.

**The field is described nowhere.** Bare `z.boolean()` in `synthesis.schema.ts:25`, bare `z.boolean().optional()` in `session.schema.ts:275`, no `.describe()` on either, no mention in `mothership-m7.txt` or any synthesis prompt. Every model reading or writing it is inferring from the word.

**The synthesis model reconstructed the missing concept in the flags namespace** — the playtest carries `secret_signal_origin_revealed` and `secret_cut_corners_revealed` next to `signal_source_entity.visible: false`. It modelled both perception and discovery; the schema had room for one.

Once that separation is made, the spec's real subject shows up, and it is bigger than the visibility question: **the entity write path is half-built, in four independent places.** They are one spec rather than four tickets for the reason spec 018 named — *the mechanism exists and the path into it does not.*

- `visible` is writable and, for hidden entities, unreadable — the Warden cannot see the value it is being asked to flip.
- `revealed` does not exist, and the concept is live in production data.
- `npcState` is defined (`shared.ts:15`), carries an instructional comment, is preserved on merge (`session.validator.ts:641-642`) — and **has no writer and no reader**. Nothing sets it; nothing renders it. `gmUpdates.npcStates` does *not* write it, despite the name: it merges into `gmContextBlob.narrative.npcAgendas` (`session.applier.ts:57`).
- `status` accepts a free string at the tool boundary (`session.schema.ts:275`) and a three-value enum at the applier (`shared.ts:10`), and the mismatch silently discards the rest of the entity change.

The last two interlock, which is why the M8.1 prompt bullet cannot ship alone: it says tactical and narrative detail "moves to `npcState`", and `npcState` is not writable.

---

## Goals

1. `visible` and `revealed` are distinct, documented, and both readable by the Warden on every turn.
2. Every field on the entity payload states its meaning in the schema the model actually sees.
3. `status` is the enum it has always been at the applier, enforced at the boundary, with a real place for the detail it currently absorbs.
4. No valid field in an entity change is discarded because a different field on the same entity was invalid.
5. The design doc's two-mechanism claim matches the code, with structural secrecy narrowed to position rather than abandoned.

## Non-goals

- **A line-of-sight computation.** Nothing computes LOS and nothing will here. `visible` stays Warden-authored narration state until the 2D renderer gives it a spatial source of truth. This spec makes the field mean something; it does not make anything derive it.
- **Any spatial block in the snapshot.** `ADR-0047` stands — Phase 1 spatial consistency is prose-based.
- **Reconciling `entities[id].visible` with `grid_entity.visible`.** Both are written at synthesis and neither derives from the other. Real, and a renderer-era problem; see `§ Open`.
- **Reopening `ADR-0038 § D4`'s turn-level atomicity.** Part 5 fixes rejection *reporting*, not partial application; see its corrected premise.
- **Fixture re-capture.** `ADR-0101` resolves finding (5) to *no*: the four fixtures freezing a hidden entity's pools freeze correct behaviour. No `corpusVersion` bump, no re-scoring.
- **General identifier validation.** Out of scope in M7.6 and M9; unchanged here.
- **The `HIDDEN-INFO-LEAK` checker's verdicts.** The findings doc established these fixtures are unaffected. If `<entities>` changing shape moves the tag, that is a prediction to write (`§ Ordering`), not a checker change.

---

## Part 1 — `visible` becomes line of sight, and the snapshot stops filtering

Remove the visibility filter at `session.snapshot.ts:309`. Every entity renders every turn, carrying its own current `visible` value.

**This discloses much less than it appears to.** `formatGmContextBlob` (`session.prompt.ts:52`) already emits every entity in the GM context blob — hidden ones tagged `starts hidden` — into the first cached system block, ahead of the snapshot, together with a `hidden_truth` line carrying the mystery in prose. Existence, id, type and tags are already in the prompt on every turn. The new information is the **current value of the flag**, which is exactly what an adjudicator of line of sight cannot work without: to decide whether the goblin steps out of the shadow, the Warden has to know it is in one.

**The two-state render already exists and is only used for player entities.** `playerLines` computes `entity.visible ? 'visible' : 'hidden'` (`session.snapshot.ts:293`); `otherLines` hardcodes the literal `visible` (`session.snapshot.ts:312`) because the filter guaranteed it. NPCs adopt the same computed form, plus `revealed` from Part 2.

**Hidden entities now render Instinct and `crewRole` skills too**, since those live inside the same map (`session.snapshot.ts:314-322`). That is correct and load-bearing: the Warden needs a hidden NPC's target numbers to run off-screen combat, which is the pressure `ADR-0023` documents, and the findings doc's open question (2) worried a filter would starve it. No filter, no starvation.

**Acceptance:** an entity with `visible: false` appears in `<entities>` with its flag state legible, and the block's line count equals the entity count plus player ids on every fixture.

## Part 2 — `revealed`, the discovery gate

Add `revealed: boolean` to `EntitySchema` (`packages/game-systems/src/shared.ts:12`), to the synthesis entity schema (`synthesis.schema.ts:25`), and to the `entities` payload on `submit_gm_response` (`session.schema.ts:272-278`).

**It is monotonic.** `false` → `true`, never back. Enforced in `applyEntity`, not by convention: a Warden that can un-reveal a mystery makes the field useless as a gate, and the enforcement is three lines. A proposed `revealed: false` against an entity already `true` is a rejection with a reason, not a silent no-op.

**Scope of the concept.** Entity-scoped secrets live here. Narrative secrets with no entity stay flags — `secret_cut_corners_revealed` is about a denied parts requisition, not a thing aboard the ship, and has no entity to hang on. The two are complementary; this is not a migration of flags into entities.

**Back-fill rule: `revealed := visible`.** Existing rows have exactly one signal about discovery, and it is the overloaded field — an entity currently visible is one the players know about, and a hidden one is the case that needs `revealed: false`.

**Mechanism, decided 2026-08-21: a real migration now, `V20`, written to be discarded.** Not a Zod `.default()` and not a read-time derivation — both leave the ambiguity in the read path indefinitely, and the whole point of the field is that a reader can trust it. `V20` back-fills every `campaign_state.data.entities.*` with `revealed` set from its current `visible`, after which the field is required rather than defaulted.

It follows `V19`'s precedent and says so in its header comment: **disposable by design**, to be dropped by M9's pre-`v0.1.0` Flyway consolidation pass rather than carried into the baseline self-hosters upgrade through. Until the tag the migration history has no external consumer; after it, every migration is permanent public surface. `roadmap.md § M9` carries the matching note so the drop is not left to memory.

**Acceptance:** synthesis can declare a secret entity `visible: false, revealed: false`; the Warden can flip `visible` both directions across turns and `revealed` once; a second `revealed: false` is rejected with a reason naming the monotonicity rule.

## Part 3 — Every entity field says what it means

Add `.describe()` to `visible`, `revealed`, `status` and `npcState` on **both** schemas — `submit_gm_response` and the synthesis tool — since both are read by a model and neither documents anything today.

The descriptions must distinguish the two axes explicitly rather than describing each field in isolation; the failure this spec exists to fix is that a reader given only the word `visible` picked the wrong one of two defensible meanings. Wording is the implementer's call, the requirement is that a model reading only the generated `input_schema` can tell which field a given situation calls for — the standard `ADR-0097` addendum 2 set when it found five top-level properties carrying no description at all.

**Also state it in `mothership-m7.txt`**, which mentions visibility nowhere. Schema descriptions travel with the tool; the prompt is where the Warden is told that keeping line of sight current is part of the job at all. This makes the prompt a Warden-visible change on top of the schema one — both hashes move regardless (`§ Ordering`).

**Acceptance:** `visible`, `revealed`, `status` and `npcState` each carry a description on both schemas; a dump of the generated `input_schema` shows no undescribed property on the entity payload.

## Part 4 — `status` sheds its overload, and `npcState` gets a write path

**Folds in `roadmap.md § M8.1`'s bullet** — *"`status`-field-overload prompt fix: `status` is strictly the `'alive'|'dead'|'unknown'` enum; tactical and narrative detail moves to `npcState`"* — which is removed from M8.1 when this lands. It belongs here for two reasons: M8.1 is prompt-only by its own preamble and this is a schema change, and the bullet's remedy names a field that cannot be written.

- **Tighten the boundary to the enum it already is at the applier.** `status: z.string().optional()` becomes the `EntityStatusSchema` enum, so the constraint appears in the `input_schema` the model reads rather than only in a rejection it sees after the fact.
- **Build the `npcState` write path.** Add it to the `entities` payload so a per-entity disposition string has somewhere to go.
- **Give `npcState` a read path.** A field nothing renders teaches the Warden to stop writing it. It renders in `<entities>` or `<character_attributes>`; which is the implementer's call.
- **Stop `gmUpdates.npcStates` writing into `narrative.npcAgendas`.** See `§ Part 4a` — this is the reason the entity field is load-bearing rather than tidy.

### Part 4a — `npcStates` destroys the agenda it merges into

**Investigated 2026-08-21, answering this spec's original open question (4). They are not the same concept, and the current merge is destructive.**

`narrative.npcAgendas` holds durable authored motivation. `gmUpdates.npcStates` holds volatile per-turn disposition. `session.applier.ts:57` spreads the second over the first — `{...priorAgendas, ...npcStates}` — keyed by entity id, with no rejection, no event and no log line.

In the 2026-08-16 playtest the cartographer's synthesized agenda was:

> Wants to seal the forward sections and abandon the aft, because they recognize the signal pattern from old survey data they never reported. They are withholding what they know out of guilt and fear of being blamed — they will only reveal it if pushed hard or if the situation becomes lethal enough that silence is worse than confession.

By the end of the adventure that key held:

> Panic check passed (rolled 15 vs stress ~4) after hearing the entity mimic Kennedy's greeting - shaken, voice thin, but still functional and accompanying Kennedy.

**The conditions governing the NPC's central secret were replaced by a mood note**, and from that turn on `formatGmContextBlob` rendered the mood note under an `npc_agendas:` heading (`session.prompt.ts:34-36`). Nine of 58 turns wrote `npcStates`. `cartographer_confesses` is `true`, so the confession happened — whether it honoured conditions the Warden could no longer read is unknowable. The original survives only in `adventure_synthesis_snapshots.gm_context_blob`.

**A second symptom in the same data:** the map also carries `deep_space_cartographer_reyes_note`, a key that is not an entity id, invented to park a cross-cutting observation. The namespace is being used as a scratchpad because nothing else is offered.

**Requirements.**

- Disposition goes to `entities[id].npcState`. `npcAgendas` becomes what synthesis wrote and stays it.
- **Agendas may change during an adventure — decided 2026-08-21 — so agenda amendment gets its own explicit path.** An NPC's motivation moving in response to play is legitimate and the schema should support it. What is not legitimate is a *disposition* write landing on an *agenda* field because that is the only slot offered. The requirement is that the two paths are separately named and neither can reach the other's field: disposition to `entities[id].npcState`, agenda amendment to a field that says so. An explicit agenda write may replace the prior value outright — that is the author's intent, stated — and `gmUpdates.npcStates` is removed rather than retained as a third spelling.
- **The original agenda stays recoverable.** `adventure_synthesis_snapshots` holds the synthesis blob, and an explicit replace is still a replace. Worth naming as the safety net that exists rather than building a second one: nothing in this spec preserves a prior agenda in `gm_context` itself.
- A key that is not a known entity id is rejected rather than created, per `§ Part 5`'s explicit-create rule.
- **The 2026-08-16 campaign is not repaired — decided 2026-08-21.** Recovery is possible (`adventure_synthesis_snapshots` holds the original blob) and deliberately not done. That adventure is finished evidence rather than live play, no fixture depends on it — the corpus reads `campaign_state`, not `gm_context` — and leaving the damage in place keeps the record of what the defect did. Anyone reading that campaign's `npcAgendas` later should read `§ Part 4a` first.

**Acceptance:** a turn writing disposition for an NPC leaves that NPC's `npcAgendas` entry byte-identical; a golden pins the cartographer's agenda against `adventure_synthesis_snapshots`.

**The playtest's rejected values are the test cases**: `"manifested, stationary, vocalizing"` and `"deceased"`. Both are legitimate things to want to say, both belong in `npcState`, and neither may be silently dropped.

**Acceptance:** a status outside the enum is rejected at the boundary with a reason naming `npcState`; a written `npcState` survives a turn and renders in the snapshot.

## Part 5 — `applyEntity` reports every bad field, and creation is explicit

**Corrected 2026-08-21: this is not silent data loss, and all-or-nothing stays.** An earlier draft of this spec and of `ADR-0101` said a bad `status` silently discards `change.visible`. It does not. `applyEntity` pushes a rejection (`session.validator.ts:613-621`), and `ADR-0038 § D4`'s validate-all-then-apply guarantee means a non-empty `rejections` array discards the entire `applied` set — `SessionService` runs a correction round and, if that also fails, throws `SessionCorrectionError` (`session.service.ts:377-406`). Verified directly: the rejection fires with `applied.entities` empty. **Apply-the-valid inside `applyEntity` would therefore be unreachable code** unless D4's turn-level guarantee is reopened, which this spec does not propose — the guarantee is what makes a turn atomic, and the correction round is what makes a rejection recoverable rather than lossy.

**What is actually wrong is narrower: only the first bad field on an entity is ever reported, against a single correction shot.** `applyEntity` returns at the failed `status` without examining anything else. A Warden told about `status`, fixing it, and failing on an unreported sibling gets no second correction — the turn is thrown. With one other rejectable field today this is theoretical; Part 2 adds `revealed` and Part 4 adds `npcState`, which is what makes it likely.

- **Accumulate every field-level rejection for an entity before returning.** One rejection per bad field, all reported in the same round.
- **Rejection reasons name the remedy.** `"status must be 'alive', 'dead', or 'unknown'"` should point narrative detail at `npcState`; a rejected reverse `revealed` should name the monotonicity rule. The correction round's whole value is that the Warden can act on what it is told.
- **Record it as an addendum to `ADR-0038`**, which settles granularity *across* `stateChanges` members and leaves granularity *within* an entry unstated. The addendum states that within-entry rejection is all-or-nothing **by inheritance from D4**, and that completeness of reporting — not partial application — is the property being fixed.

**Explicit create, per the decision of 2026-08-21.** `applyEntity` has no existence check: an id absent from `currentData.entities` is created rather than rejected (`session.validator.ts:626-633`), so a hallucinated id and a genuine mid-adventure NPC are indistinguishable. An unknown id in an `entities` change is now a rejection; introducing an entity during play requires an explicit create carrying the fields a new entity needs. Note `validateStateChanges` already receives `knownEntityIds` (`session.service.ts:365`) and `applyEntity` ignores it — the identifier set is plumbed and unused, so this is a use of existing wiring rather than new wiring. The create op's shape and whether it also seeds `grid_entity` are implementer questions; the rule is that creation is stated, never inferred.

**Acceptance:** an entity change with two bad fields produces two rejections in one round; an unknown id is rejected with a reason naming the create op; a create op introduces an entity that renders in the next snapshot.

## Part 6 — The design doc says what the code does

`docs/zoltar-design-doc.md:263` claims *"The goblin isn't in the prompt."* Amend to the narrower claim that survives contact with the code, per `ADR-0101`: an entity's existence, identity and state are GM context and withheld **behaviourally**; an entity's **position** is withheld **structurally**.

**Narrow it, do not delete it.** The structural half is vacuous today — no renderer emits position, and the M7 snapshot has no spatial block — and stops being vacuous when the 2D renderer ships, where `grid_entity.visible` (`synthesis.write.ts:300`) and position filtering are the mechanism. Text that reads "entity data is always visible" without this scoping forecloses it.

`CLAUDE.md:51` summarizes the same model and moves with it.

**Acceptance:** no sentence in the design doc or `CLAUDE.md` claims a hidden entity is absent from the prompt.

---

## Ordering, and the run this owes

**Parts 1, 2, 3 and 4 are all Warden-visible.** `<entities>` changes shape, the entity payload gains fields and constraints, and `mothership-m7.txt` gains text — so both `assemblyHash` and `promptHash` move (`ADR-0099`). Part 5 is not Warden-visible; Part 6 is documentation.

**One re-baseline, and it does not buy its own.** Batch onto a scheduled run per `ADR-0094`, exactly as spec 018 did with six changes. **Write predictions before the run** (`ADR-0085`) — with no honest delta across the boundary, they are the only route to attributing a moved score to this work. `eval:compare` across this boundary is meaningless and the warning is not to be suppressed.

**Scheduled into M7.7**, against the open bullet the finding already had there — not M8.1, which is prompt-only by its own preamble and defers schema work to a "next tool-schema batch" that has never been allocated. Batch onto M7.7's next scheduled re-baseline rather than buying one; if M8.1's `dice_requests` contingency pilot validates first, it should ride the same run.

**Part 4a removes `gmUpdates.npcStates`, so it is Warden-visible too** — the schema loses a property. Part 5 is the only part with no Warden-visible surface.

Suggested commit order: Part 5 first — no Warden-visible surface, independent of everything else, and Parts 2 and 4 both add fields that make its reporting gap likelier. Then 4a (it is a live defect and the reason Part 4's field is load-bearing), 4, 2, 1 (schema before render, since the render reads the new field), then 3, then 6, then predictions and the run.

**Invariant, per M7.6:** the repo is green at every commit — `npm run build`, `npm test`, `npm run lint`. Parts 2 and 4 change `@uv/game-systems` schemas whose consumers live in other workspace packages, so a schema change and its consumers land in the same commit.

---

## Predictions, pre-registered 2026-08-21 before any run

Written before the re-baseline, per `ADR-0085`, because `eval:compare` across
this boundary is meaningless and predictions are the only route to attributing
a moved score to this work.

**Run identity.** Baseline is `claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z`
(prompt `fa4e6e2f`, assembly `3d8df5f3`, corpus `abbce198026c`, 22 fixtures ×
10 reps). The re-run moves both surfaces — prompt **`6717347d`**, assembly
**`6dc28608`** — and **`corpusVersion` stays `abbce198026c`**: no fixture file
is edited, which is the whole point of doing the `revealed` fill in
`seedScratchAdventure` rather than in the files.

**The tag most likely to move is `HIDDEN-INFO-LEAK`,** at 1.00 (20/20) on the
baseline. `<entities>` now carries a line per hidden entity where it carried
none, so the Warden sees ids it previously saw only in `<gm_context>`. **Floor:
0.90.** Below that, the prompt work in Part 9 — specifically "seeing them is
not permission to mention them" — has failed to hold and the finding is that
the block needs to say less, not that the split was wrong. This is the
prediction most worth being wrong about.

**Guardrails, none of which this work should touch.**
`SYSTEM-ROLLED-PLAYER-ACTION` 0.98 (47/48) — floor 0.90, the same clause 018
used. `UNSURFACED-CHECK` 1.00 — floor 0.90. No tag down more than 0.15.

**`UNAUDITABLE-MAPPING` stays at 0.00.** Nothing here addresses it; if it
moves, the movement is unattributed and belongs to whatever else rode the run.

**Tool-syntax emission is the one number that could move for a bad reason.**
1.36% (3/220) across two runs. `mothership-m7.txt` grows by ~30 lines here,
and `ADR-0097` established the defect tracks the model rather than the prompt —
so the prediction is **no material change**, and a jump would be evidence
against that conclusion rather than against this spec.

**Five tags reading exactly 1.00 are suspects, not passes** (`ADR-0082`).

### What the run does not measure

- **The synthesis-side schema changes.** `revealed` on the synthesis entity
  schema, its `visible → revealed` invariant, and both new descriptions. The
  corpus replays turns, not synthesis, and `assemblyHash`'s goldens are
  session-side — so nothing in a run exercises `submit_gm_context` at all.
- **Agenda amendment.** No fixture writes `gmUpdates.npcAgendas`, so Part 4a is
  covered by unit tests and the applier regression only.
- **`newEntities`.** No fixture introduces an entity mid-adventure. Whether the
  create op is ergonomic enough for the Warden to reach for instead of naming
  an unknown id is unmeasured, and the telemetry could not size it either — the
  2026-08-16 playtest applied entity changes on zero of 58 turns.
- **The `V20` back-fill against real data.** Verified on a scratch database
  across four row shapes and for idempotency; it has not run against the dev
  volume or any deployed database.

## Done when

- [x] `renderEntities` emits every entity with its own `visible` value; no caller filters on visibility (Part 1)
- [x] Hidden NPCs render Instinct and `crewRole` skills like any other (Part 1)
- [x] `revealed` exists on all three schemas, is monotonic, and a reverse flip is rejected with a reason (Part 2)
- [x] `V20` back-fills `revealed := visible` on every entity, header-commented as disposable, with the matching note on M9's consolidation bullet (Part 2)
- [x] `visible`, `revealed`, `status`, `npcState` each carry a `.describe()` on both tool schemas, distinguishing the two axes (Part 3)
- [x] `mothership-m7.txt` states that line of sight is Warden-maintained (Part 3)
- [x] `status` is the enum at the tool boundary; both playtest rejects have a legal home (Part 4)
- [x] `npcState` is writable and rendered (Part 4)
- [x] Agenda amendment has its own explicit path; `gmUpdates.npcStates` is removed; no disposition write can reach `npcAgendas` (Part 4a)
- [x] A turn writing NPC disposition leaves that NPC's `npcAgendas` entry byte-identical; a golden pins it against `adventure_synthesis_snapshots` (Part 4a)
- [x] An entity change with two bad fields produces two rejections in one round; reasons name the remedy (Part 5)
- [x] An unknown entity id is rejected; an explicit create op introduces one (Part 5)
- [x] `ADR-0038` carries an addendum stating within-entry rejection is all-or-nothing by inheritance from D4 (Part 5)
- [x] Design doc and `CLAUDE.md` claim only what the code does (Part 6)
- [x] `docs/hidden-information-findings.md` closed against `ADR-0101`
- [x] Predictions written **before** the run (`§ Predictions`)
- [ ] One full-corpus re-baseline, with the report stating what it does not measure

---

## Resolved before drafting

- **`visible` is line of sight, `revealed` is discovery** — `ADR-0101`. The findings doc's open question (1) resolved to neither of the two answers it anticipated.
- **No fixture re-capture.** Finding (5) resolves to *no*; the four affected fixtures freeze correct behaviour.
- **Findings (2) and (4) are moot**, not deferred — there is no pool filter to place, and the other unfiltered renderers were never wrong.
- **Structural secrecy is narrowed to position, not abandoned**, so the renderer era still has a mechanism to build on.
- **The M8.1 `status` bullet moves here**, because its remedy names a field with no write path.
- **Milestone: M7.7**, decided 2026-08-21.
- **`npcStates` and `npcState` are different concepts and the current merge is destructive** — investigated 2026-08-21, `§ Part 4a`. This is what makes Part 4's entity field load-bearing.
- **Within-entry rejection stays all-or-nothing.** Apply-the-valid was the preferred answer until `ADR-0038 § D4` was re-read: a non-empty `rejections` array discards the whole `applied` set, so partial application inside `applyEntity` is unreachable without reopening the turn-level atomicity guarantee. The fixable property is completeness of *reporting*, not partiality of *application* (`§ Part 5`).
- **Unknown entity ids are rejected; creation requires an explicit op** (`§ Part 5`).
- **Agendas may change during an adventure**, via an explicit path of their own; the defect was the silent conflation, not the mutability (`§ Part 4a`).
- **The 2026-08-16 campaign is not repaired.** Finished evidence, no fixture depends on it, and the damage is part of the record.
- **`revealed` back-fills via `V20`**, written to be discarded at M9's consolidation pass rather than defaulted in the read path.
- **Field names stay `visible` / `revealed`** rather than `inLineOfSight` / `discovered`. Part 3's descriptions carry the distinction; if a run shows the model conflating them, renaming is a later change with its own re-baseline — deciding on speculation costs the same and knows less.

## Open

*Nothing. All open questions were closed between 2026-08-21 and 2026-08-21; see `§ Resolved before drafting`.*

*The three closed last: whether agendas may be amended during play (yes, explicitly), whether to repair the 2026-08-16 campaign (no), and the `revealed` back-fill mechanism (`V20`, disposable).*
