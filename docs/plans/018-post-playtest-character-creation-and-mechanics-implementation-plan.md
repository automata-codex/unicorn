# 018 — Post-playtest character creation and mechanics: Implementation Plan

Multipart implementation plan for
`../specs/zoltar/018-post-playtest-character-creation-and-mechanics.md`. Each
part is sized for a manual code review and a single commit. **Pause after each
part for review before starting the next.**

**Grounding.** Written 2026-08-20 against `milestone-m77-playtest-and-fixtures`
at `5cbf9a7`. Every `path:line` below was read in the working tree, not
inherited from the spec.

**Invariant for every part: the repo is green at each commit.** `npm run build`,
`npm test`, `npm run lint`. This is load-bearing rather than ceremonial —
`MothershipCreationRollsSchema`, `MothershipCharacterStateSchema` and the pool
derivation all live in `@uv/game-systems`, and every consumer is in a different
workspace package. A schema change and its consumers therefore land in the same
commit, and that constraint — not the spec's section boundaries — is what fixes
the part sizes below.

---

## Ordering

The spec has six Parts. This plan splits them into twelve commits and reorders
two things.

| Spec | Plan | Why moved |
|---|---|---|
| Part 2 (skills + loadout) | Parts 3, 4, 5, 6 | Four independent changes with four different blast radii: a `@uv/game-systems` schema addition, a new snapshot section, and two unrelated creation forms. Folding them into one commit makes an unreviewable diff spanning the schema, the renderer, the goldens and two forms |
| Part 6 (Instinct + `crewRole`) | Parts 9, 10 | The field and the derivation have different risk. Part 9 adds storage that changes nothing behavioural; Part 10 turns on a derivation that must not ship before its `assemblyHash` guard |

**The spec's suggested order is superseded by one discovery.** It put Part 6
before Part 2 so the skill accessor would exist before the creation form
consumed it. Correct instinct, wrong unit: what Part 2 actually needs is the
**accessor and its render**, not the NPC derivation. Extracting that into its
own commit (Part 4) lets the creation forms land early and leaves Part 10 free
to add the Contractor branch behind an interface that already exists.

### The parts

| # | Title | Warden-visible | Package boundary crossed |
|---|---|---|---|
| 1 | Creation shows its arithmetic | no | — |
| 2 | The oracle filter reaches the backend | no | — |
| 3 | The `loadout` roll and the 0-index convention | no | `@uv/game-systems` + FE |
| 4 | The skill accessor and its render | **yes** | `@uv/game-systems` + BE |
| 5 | Skill selection at creation | no | FE + BE |
| 6 | Loadout and gear at creation | no | FE + BE |
| 7 | `wounds` is writable in the Warden's view | **yes** | BE |
| 8 | A durable roll modifier | **yes** | `@uv/game-systems` + BE |
| 9 | Instinct and `crewRole` on the entity record | **yes** | `@uv/game-systems` + BE |
| 10 | `CREW_ROLE_SKILLS`, the derivation, and its guard | **yes** | `@uv/game-systems` + BE |
| 11 | The two stub checkers | no | eval |
| 12 | Predictions, then the re-baseline | — | — |

Parts 1 and 2 are independent of everything else and of each other. If you want
working code before more plan, start there.

---

## Part 1 — Creation shows its arithmetic

*Spec Part 1. Frontend only.*

`CharacterCreate.svelte:337-344` renders `preview[key].current` as a bare
integer. The `+25`/`+10` base and the class adjustment are invisible, which is
why a correct Scientist Sanity of `2d10+10+30` was reported as a bug.

**Work.**

1. Export a per-pool breakdown from `@uv/game-systems` alongside the totals —
   dice sum, flat base, class adjustment, chosen-Stat adjustment. **Derive it in
   the same function that computes the pools**, not in a parallel one: a second
   function that re-adds the same numbers is exactly the duplication
   `deriveMothershipCharacterResourcePools` was centralised to prevent
   (`character-pools.ts:43-46`).
2. Render the terms in the creation preview.
3. Same treatment on `CharacterView.svelte:65-88`, which has the same opacity.

**Watch for.** `wounds` displays `max`, not `current` (`CharacterCreate.svelte:340`),
and `stress`/`credits` have `max: null`. Three pools already deviate from the
common render path; a breakdown that assumes uniformity will be wrong on all three.

**Done when.** For each of the eleven pools, a reader who does not know the class
table can verify the total from what is on screen.

---

## Part 2 — The oracle filter reaches the backend

*Spec Part 3. Backend and frontend, no schema package.*

`OracleFilter.svelte:62-72` draws from the filtered pool and sends only the drawn
entry; `synthesis.controller.ts:102-106` rebuilds `activePools` from
`getMothershipOraclePool(cat)` — the full static pool — and
`synthesis.service.ts:305-314` substitutes from that. The filter has never
crossed the wire.

**Work.**

1. Extend `SynthesizeRequestSchema` (`dto/synthesize.dto.ts`) with the active
   entry ids per category.
2. Controller builds `activePools` from those ids, resolved against the static
   pool, instead of from the static pool wholesale.
3. **Reject a request whose active pool for a category does not contain that
   category's selection** — 422. The two halves disagreeing means one is wrong
   and nothing here can tell which.
4. `OracleFilter.svelte` sends `filterState.active`.

**The degenerate case is now reachable and was not before.** A category filtered
to one entry has no legal substitute. `pickRerollReplacement` already returns
`null` there (`synthesis.service.ts:309-311`) and the caller escalates to
`CoherenceConflictError`, so the path exists — but it has never been exercised,
because the static pool always had alternatives. Add a test for it.

**Back-compat.** Decide explicitly whether the new field is required. Optional
means an old client silently gets today's broken behaviour; required means a
version skew is a 422. Given this is a self-hosted SPA served from the same
deploy, **required** is the honest choice — but make it a decision, not a default.

**Done when.** A category filtered to a known set cannot produce a synthesis
carrying a selection outside it, by reroll or otherwise.

---

## Part 3 — The `loadout` roll and the 0-index convention

*Spec Part 2, first slice. `@uv/game-systems` + frontend, one commit.*

PSG Step 8 rolls Loadout, Trinket and Patch. The schema has the latter two
(`character-sheet.schema.ts:69-71`) and not the first.

**Work.**

1. Add `loadout` to `MothershipCreationRollsSchema`, `1d10`.
2. Add a `tableIndexForRoll(die: number): number` helper — returns `die - 1` —
   with the convention documented once: **tables are indexed from `00`, dice are
   1-based (`dice.ts:57-64`), the record stores the die as it fell, and the
   offset is applied at lookup.**
3. `ROLL_SPECS` in `CharacterCreate.svelte:44-62` gains the entry.

**Make `loadout` optional, and say why in the schema.** A sheet created before
this commit cannot retroactively acquire a roll nobody made. Marking it required
forces either a migration that invents dice or a `V20` drop-and-recreate, and
inventing a creation roll is precisely what `creationRolls`' own doc comment
forbids (`character-sheet.schema.ts:38-49`). Optional-with-a-reason is the same
shape `creationChoices` already uses.

**Do not apply the offset at roll time**, and do not "fix" `trinket`/`patch` to
be 0-based. Both are narrative-only (`character-sheet.schema.ts:132-135`) and the
player resolves those tables from their own book, so nothing has ever applied an
offset to them. This commit establishes a convention; it does not repair a live
miscalculation.

**Done when.** `loadout` round-trips through creation, and one documented helper
owns the 0-index offset.

---

## Part 4 — The skill accessor and its render

*Spec Parts 2 and 6, shared machinery. `@uv/game-systems` + backend.*
**Warden-visible — moves `assemblyHash`.**

`session.snapshot.ts` contains no occurrence of "skill". Nothing renders a
skill for anyone, so Part 5 would populate a list the Warden never sees.

**Work.**

1. `resolveSkills(entityId, campaignState, entity): MothershipSkillEntry[]` in
   `@uv/game-systems`. **Player branch only in this commit** — reads
   `characterState[entityId].skills`. The Contractor branch is Part 10 and goes
   behind this same signature.
2. Fold `suppressedSkills` (`character-state.schema.ts:196-215`) into the
   accessor's output so a `loss_of_confidence` skill renders as suppressed rather
   than as a live bonus. This is the first point at which that function has ever
   had a non-empty list to operate on.
3. Render skills and tiers into the snapshot. Extend `<character_attributes>`
   rather than adding a section — it is already the per-entity block
   (`renderCharacterAttributes`, `session.snapshot.ts:140`), and a new top-level section costs a
   `buildStateSnapshot` composition change for data that is per-character.
4. **`ASSEMBLY_PROBE` gains skills on `probe_player`**, including one suppressed
   by a `loss_of_confidence` condition. Update `assembly-golden/state-snapshot.txt`.

**The probe update is not optional and not cosmetic.** `ASSEMBLY_PROBE`'s own
rule is that "a section this probe never populates is a section whose shape the
hash cannot see" (`session.assembly.ts:48-50`). The probe already carries a
`frightened` condition (`assembly-golden/state-snapshot.txt:12`), so the
`loss_of_confidence` case is a small addition to an existing branch.

**Done when.** A player character's skills reach the Warden, suppression
included, and `assemblyHash` moves.

---

## Part 5 — Skill selection at creation

*Spec Part 2. Frontend + backend write path. Not Warden-visible: Part 4 already
shipped the render, so this commit changes no rendering code.*

**Work.**

1. Skill selection in the creation form, honouring the PSG prerequisite chain
   (Trained → Expert → Master) and each class's starting allowance.
2. Write through the existing seed path — `CharacterService.create` already calls
   `seedCharacterState` (`character.service.ts:48-52`); the skills go into the
   state it seeds instead of `emptyMothershipCharacterState()`'s `[]`.
3. Validate the prerequisite chain **server-side as well**. A skill entry is a
   free string by deliberate design (`character-state.schema.ts:62-73`), so the
   schema cannot enforce the graph and a form-only check is not a check.

**The update path is a trap.** `CharacterService.update` re-derives pools into
`mergePlayerResourcePools`, which is preserve-on-conflict and therefore a no-op
for any pool that already exists (`character.service.ts:58-60`). Check whether
`seedCharacterState` has the same semantics before assuming a sheet edit can
change a skill list; if it does, either this commit or an explicit note has to
say so, because "edited the character and nothing happened" is the exact failure
that shape produces.

**Done when.** A character is created with skills, they render to the Warden, and
`loss_of_confidence` can suppress one that exists.

---

## Part 6 — Loadout and gear at creation

*Spec Part 2. Frontend + backend write path. Not Warden-visible —
`<character_attributes>` already renders armor and weapon loadout (M7.6), so this
populates an existing render rather than adding one.*

**Work.**

1. Loadout entry at creation, keyed off the Part 3 `loadout` roll, writing
   `characterState.equipment` and `characterState.wornArmor`.
2. Gear purchase against the `credits` pool.
3. `forgoLoadout` suppresses the loadout half and keeps the ×100 credits — the
   arithmetic already landed at `5cbf9a7`; this is the branch on the other side
   of the checkbox that was never built.

**Structured entry, not the book's tables.** PSG loadout content does not ship —
`ingestion/*/templates/*` is gitignored (`.gitignore:125`) — and `rules_lookup`
runs in the turn path, so a creation form has no way to read the corpus even
where it is ingested. The player transcribes from their own copy.

**Verify before building the spend path.** Confirm whether anything else writes
`credits` at creation, and whether spending below zero should reject or clamp.
Pool deltas reject rather than clamp below `min` (M7.6), and `credits` carries
`FLOOR_AT_ZERO` (`pool-definitions.ts:98`) — so rejecting is consistent, but this
is the first *creation-time* spend and the precedent is a play-time one.

**Done when.** A character is created carrying gear and worn armor, and the
existing `<character_attributes>` render shows them.

---

## Part 7 — `wounds` is writable in the Warden's view

*Spec Part 4. Backend only.* **Warden-visible — moves `assemblyHash`.**

The `pool` field is `z.string().min(1)` described as
`'The bare pool name: "hp", "stress", "combat". Never a prefix.'`
(`session.schema.ts:42-45`). `wounds` is absent, and the only appearance of
Wounds anywhere in the tool schema is under `maxDelta` — the field that moves a
*ceiling* (`session.schema.ts:48-58`).

**Work.**

1. Enumerate the character pool names in the `pool` description, **built from
   `MOTHERSHIP_CHARACTER_POOL_NAMES`** rather than restated, so the list cannot
   drift from the derivation.
2. Disambiguate `delta` from `maxDelta` on `wounds` specifically: taking a Wound
   is `delta: +1`; `maxDelta` is Panic 19 removing a Wound *slot*.
3. Keep the field an open string. Pools outside the character set are legal by
   design — NPC timers, `_scenario` subsystems, anything synthesis mints
   (`pool-definitions.ts:78-82`) — so an enum would reject valid writes.

**This is a description change and it is the whole fix.** Both halves the roadmap
bullet offered are already present: the prompt documents the chain including the
wounds delta (`mothership-m7.txt:311`), and the schema accepts any pool name.
Resist widening scope into either.

**Done when.** The tool schema names `wounds` as writable, and `missing-delta`
(Part 11) has something to measure.

---

## Part 8 — A durable roll modifier

*Spec Part 5. `@uv/game-systems` + backend, one commit.*
**Warden-visible — moves `assemblyHash`.**

The Fatal Injury row's `[-]` on all rolls matches none of the eight Conditions,
and `characterState` has no shape for a durable roll modifier.

**Work.**

1. A modifier shape on `MothershipCharacterStateSchema`, carrying source, scope
   (all rolls vs. narrower), and lifetime.
2. A `stateChanges.characterState` op to write it — the discriminated union at
   `session.schema.ts:79-160`, alongside `bleeding_set` and `death_save_pending`,
   which exist for exactly this reason: Wounds Table outputs that are not
   Conditions.
3. Fold it in `session.validator.ts:364-400`, where character-state changes are
   applied on a working copy.
4. Render into `<character_attributes>`. A modifier the Warden cannot read next
   turn is the same silent loss in a different place.
5. Prompt instruction in the wounds chain (`mothership-m7.txt:283-315`), which
   already says "Apply the result" at step 4 without saying where it goes.
6. `ASSEMBLY_PROBE` gains one, plus golden.

**Do not extend `MothershipConditionEnum`.** Adding `skull_fracture` puts a
Wounds Table result into an enum documented as the Panic table's
(`character-state.schema.ts:3-8`), and the next Fatal Injury row wants another.

**Decide the lifetime explicitly.** Unlike `bleeding`, nothing suggests these
expire. If they are permanent the schema should say so rather than leaving a
Warden to re-judge it every turn.

---

## Part 9 — Instinct and `crewRole` on the entity record

*Spec Part 6, first slice. `ADR-0100`. `@uv/game-systems` + backend.*
**Warden-visible — moves `assemblyHash`.**

**Work.**

1. `instinctRoll` and `crewRole` on the entity record — `entitySchema`
   (`synthesis.schema.ts:3-15`) and campaign state's `EntitySchema`. `crewRole`
   is a Zod enum of the 20 roles.
2. **The backend rolls Instinct** at synthesis-write time via `executeDiceRoll`
   (`dice.service.ts:43`), for every `type: 'npc'` entity. Not `threat`, not
   `feature`.
3. Seed `characterState` for NPCs. Synthesis writes none today — only
   `CharacterService.create` does (`campaign.repository.ts:165`).
4. Derive and render the Instinct total: `2d10 + 25 + role adjustment`
   (+15 senior / +10 skilled / +5 unskilled / +0 no role).
5. Synthesis prompt: give `crewRole` to any NPC who is crew, **never invent an
   NPC to fill an unused role**, never supply `instinctRoll`.

**Claude must not be able to supply the roll.** `SYNTHESIS_TOOLS` is
`[SUBMIT_GM_CONTEXT_TOOL]` (`synthesis.tools.ts:23`) — no `roll_dice` — so a
model-supplied number is a fabrication. A prompt instruction is not sufficient
protection: **strip or reject `instinctRoll` on ingest** rather than trusting the
instruction, the same posture `ADR-0097` took after a prompt-only mitigation
failed.

**Watch the silent-skip path.** `synthesis.write.ts:43` documents that non-pool
entries in `initialState` are silently dropped. These fields go on the entity
record specifically to avoid that (`ADR-0100 § Amendment 2026-08-20`) — verify
`buildEntityMap` (`synthesis.write.ts:157`) actually carries them through
rather than rebuilding entities from a fixed field list.

**No skill effect yet.** This commit stores and renders a number. The derivation
is Part 10.

---

## Part 10 — `CREW_ROLE_SKILLS`, the derivation, and its guard

*Spec Part 6, second slice. `@uv/game-systems` + backend.*
**Warden-visible — moves `assemblyHash`.**

**Work.**

1. `CREW_ROLE_SKILLS` — the 20-row role → chain table, in code, never persisted.
2. Extend Part 4's `resolveSkills` with the Contractor branch. One accessor, two
   sources; `MOTHERSHIP_SKILL_BONUS`, the render and `loss_of_confidence` each
   keep one implementation.
3. **`ASSEMBLY_PROBE` gains a Contractor with a `crewRole`.**
4. **A golden rendering all 20 role → chain mappings**, folded into
   `assemblyHash`.
5. Play prompt: resolve a Contractor's check as Instinct + tier bonus when it
   falls in a mapped skill's domain, Instinct alone otherwise.

**Items 3 and 4 are the reason this is its own commit, and they ship with the
derivation or the derivation does not ship.** Deriving at read time means editing
`CREW_ROLE_SKILLS` changes what the Warden sees for frozen fixtures whose files
did not change — `corpusVersion` hashes fixture *files* and will not move. Only
`assemblyHash` can catch it. A probe Contractor alone gives partial coverage: with
a `pilot` in the probe, editing `xenobiologist` still moves nothing. The 20-row
golden is what makes coverage total, and it doubles as a readable diff of a table
edit in review.

---

## Part 11 — The two stub checkers

*Prerequisite for Part 12. Eval only, no product code.*

`missing-delta` and `roll-result-inversion` are stubs
(`eval/checks/registry.ts:332-335`), and `assertNoStubCheckers` refuses a run
before any spend when a selected fixture carries one. Seven of the 22 fixtures do.

**Work.** Implement both; empty `STUB_CHECK_IDS`.

**`missing-delta` is Part 7's own checker.** It is the failure mode the playtest
produced — a mechanic narrated with no corresponding pool delta — so Part 7's fix
is unmeasurable until this exists. Write it against the frozen artifacts before
the re-baseline, not after.

**Revisit `applicabilitySource` while here.** Both are declared `'fixture'`
with a comment saying the declaration is accurate *for a stub* and that a real
checker reading turn output is likely `'artifact'`
(`eval/checks/registry.ts:260-271`). That comment is an instruction to this part.

---

## Part 12 — Predictions, then the re-baseline

**Write the predictions before the run.** Five Warden-visible changes ride one
run — Parts 4, 7, 8, 9, 10 — so `eval:compare` across this boundary is
meaningless and no honest per-tag delta exists. Predictions written in advance
are the only route to attributing a fallen score to this work (`ADR-0085`), the
same position M7.6 was left in by six changes on one run.

**Before spending anything, confirm:** `STUB_CHECK_IDS` is empty; `assemblyHash`
has moved and the goldens in review show the diff you expect; `corpusVersion` is
unchanged unless a fixture file was edited, and if one was, the bump is labelled
**input-affecting** or **scoring-only** in the note next to the hash
(`eval-methodology.md:619-624`).

**The report must state what the run does not measure.** `CARRYOVER-ARITHMETIC`
and `UNEXPLAINED-DELTA` still carry no denominator; whether Part 7 moved
`missing-delta` is measurable only if a captured fixture exercises the wounds
chain.

---

## Acceptance criteria → parts

| Spec "Done when" | Part |
|---|---|
| Derived values show their terms on both character screens | 1 |
| Skills and loadout write to `characterState`; skills render; `loss_of_confidence` suppresses a real skill | 4, 5, 6 |
| A filtered category cannot produce an out-of-set selection | 2 |
| Tool schema enumerates pool names; `delta` vs `maxDelta` unambiguous | 7 |
| Durable roll modifier representable, writable, rendered | 8 |
| Instinct rolled by the backend, dice stored, arithmetic derived | 9 |
| `crewRole` stored, chain derived, one accessor shared with Part 2 | 4, 10 |
| `ASSEMBLY_PROBE` carries a `crewRole` Contractor; 20-row golden | 10 |
| `STUB_CHECK_IDS` empty | 11 |
| Predictions first, then one full-corpus re-baseline | 12 |

## Out of scope, restated

- A play-view resource display (`Play.svelte:35` types `resourcePools` and
  renders nothing).
- `mergePlayerResourcePools` preserve-on-conflict as a general problem — Part 5
  checks whether `seedCharacterState` shares it, but repairing the pool case is
  migration-shaped work.
- Repairing the `TRINKETS`/`PATCHES` extraction damage. Decided 2026-08-20: the
  player resolves those tables from their own book and nothing queries them.
- Rebalancing. The one deliberate deviation is `ADR-0100`, labelled a house rule
  there and here.
