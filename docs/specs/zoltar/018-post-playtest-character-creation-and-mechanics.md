# 018 — Post-playtest: character creation gaps and three mechanical dead ends

**Status:** ready for implementation. Plan at `../../plans/018-post-playtest-character-creation-and-mechanics-implementation-plan.md`
**Target path:** `docs/plans/018-post-playtest-character-creation-and-mechanics-implementation-plan.md`
**Type:** ephemeral implementation spec (archive after execution; the living record is `docs/decisions/` and the roadmap)

---

## Context

The 2026-08-16 playtest (adventure `5c34991b`, 58 turns) produced two kinds of finding. The harness-shaped ones — the tool-syntax leak, `assemblyHash`, the stub checkers — are closed or tracked in M7.7 and are **not** in this spec. What is left is six defects in the product itself, five of them in or adjacent to character creation.

Their common shape is worth naming, because it is what makes them one spec rather than six tickets: **in every case the mechanism exists and the path into it does not.** `characterState.skills` exists and nothing writes it. `characterState.equipment` exists and nothing writes it. The `wounds` pool is derived, defined, and rendered, and the Warden could not find a way to increment it. The Conditions enum is closed and correct, and the one thing the Wounds Table's Fatal Injury row produces is not in it. None of these are arithmetic bugs; they are gaps between a schema and its writers.

Two of the six were already open bullets under M7.7 (`roadmap.md:326-327`) and are folded in here per the scoping decision of 2026-08-19, on the grounds that both are `characterState` shape questions and splitting them across two documents means two schema passes over the same file.

**Already fixed, out of scope, listed so the spec's own history reads correctly.** The `forgoLoadout` preview/backend divergence found during triage landed standalone at `5cbf9a7`.

---

## Goals

1. Character creation collects everything Mothership creation produces — skills and loadout included — and **shows its arithmetic** rather than asserting totals.
2. The player's oracle filter is honoured by the coherence reroll, which today can substitute an option the player explicitly deselected.
3. Every mechanic the Warden is instructed to run has a documented, schema-visible place to write its result. Today the wounds chain and the Fatal Injury row do not.
4. Contractor NPCs gain an Instinct score and the `crewRole` skill layer from `ADR-0100`, using the per-entity structure that already exists rather than a new one.

## Non-goals

- **Rebalancing anything.** The class adjustments, the Wounds Table, and the skill tiers are the book's. The one deliberate deviation is `ADR-0100`, which is labelled a house rule there and stays labelled one here.
- **A play-view resource display.** `Play.svelte:35` types `resourcePools` and renders nothing, so a player cannot see their own Health during play. Real, out of scope, belongs on the roadmap.
- **The `mergePlayerResourcePools` preserve-on-conflict limitation** (`character.service.ts:58-60`). It means no sheet edit can repair an existing pool, which is a migration-shaped problem, not a creation-shaped one.
- **General identifier validation**, already recorded as out of scope in M7.6.

---

## Part 1 — Creation shows its arithmetic

**The bug is not the number.** The playtest character was a Scientist, and a Scientist's Sanity Save is `2d10 + 10 + 30` (`character-pools.ts:70,134`) — PSG "Step 3". `2d10+40` is correct. Every read path was checked for a double-applied `SAVE_BASE`; there is none.

What is wrong is that a correct value is indistinguishable from a broken one. `CharacterCreate.svelte:337-344` renders a bare integer under a label, beside a roll field labelled `2d10`. The `+10` and the `+30` are invisible, so the only way to audit the number is to know the class table by heart. That this produced a bug report from the person who *wrote* the class table is the evidence.

This matters more here than it would in most forms. M7.6's entire `creationRolls` design rests on the property that rolls plus class arithmetic reconcile to each starting ceiling — that is the stated justification for storing dice rather than sums (`character-sheet.schema.ts:45-49`). The one screen where a human could perform that reconciliation does not display its terms.

**Scope.** Frontend only. No schema change, no backend change, no Warden-visible surface.

- Each derived value in the creation preview shows its terms: dice sum, the flat base, the class adjustment, and the chosen-Stat adjustment where it applies.
- The same treatment on `CharacterView.svelte:65-88`, which renders starting values from the same pure function and has the same opacity.
- Presentation is the implementer's call within the design system; the requirement is that every term is visible, not that a particular layout is used.

**Acceptance:** for each of the eleven pools, a reader with no knowledge of the class table can verify the displayed total from what is on screen.

---

## Part 2 — Skills and loadout are collected at creation

`characterState` already carries `skills`, `equipment` and `wornArmor` (`character-state.schema.ts:142-144`), seeded empty by `emptyMothershipCharacterState()` and written to campaign state by `CharacterService.create` (`character.service.ts:46-52`). The shapes are built. Nothing populates them, and creation offers no UI for either.

Two consequences follow that are worse than the missing forms:

- **`MOTHERSHIP_SKILL_BONUS` is dead code in practice.** No skill is ever held, so no bonus is ever applied.
- **`loss_of_confidence` is inert by construction.** It stores which skill loses its bonus as a link into the skills list (`character-state.schema.ts:26-31`) — a list guaranteed to be empty. The Condition can be granted and can never do anything.

**And a write path alone will not finish this.** `session.snapshot.ts` contains no occurrence of "skill" — the snapshot renders skills for nobody, player included. Populating `characterState.skills` without a render leaves the Warden adjudicating checks against a skill list it was never sent, which is the failure mode the Wounds Table instructions exist to prevent ("YOU DO NOT KNOW THE WOUNDS TABLE FROM MEMORY", `mothership-m7.txt:304`). The render is part of this part, and it is the half that makes Part 2 Warden-visible.

**Scope.**

- Skill selection at creation, respecting the PSG prerequisite chain (Trained → Expert → Master) and each class's starting skill allowance.
- Loadout selection at creation, and gear purchase against the credits pool. `forgoLoadout` already suppresses the loadout half correctly since `5cbf9a7`; this is the branch that was never built on the other side of that checkbox.
- Both write through the existing `characterState` seed path. `skills`, `equipment` and `wornArmor` need no schema change — they exist and are unwritten.
- A render of held skills and their tiers into the state snapshot, through the accessor Part 6 specifies so player and Contractor skills render identically.
- **A `loadout` entry on `MothershipCreationRollsSchema`** — see below.

### The missing creation roll

PSG "Step 8" is *Roll Loadout, Trinket, and Patch*. `MothershipCreationRollsSchema` records `trinket` and `patch` as d100 rolls (`character-sheet.schema.ts:69-71`) and has **no `loadout` field at all**; `ROLL_SPECS` in the creation form has the same hole (`CharacterCreate.svelte:44-62`). Two thirds of one creation step is stored and the third is missing, so a character's loadout is not reconstructable from their sheet even in principle.

This is a schema addition, which makes Part 2 larger than a form and a write path. The roll is **`1d10`**, and each class has its own ten-row table indexed `00`–`09` — confirmed against the corpus, whose header row reads `D10 | LOADOUT`.

### Loadout content: not shipped, and the mechanism already exists

**Resolved — the open question from the first draft is answered by `.gitignore:125`.** `ingestion/*/templates/*` is gitignored with only a `.gitkeep` committed, while `ingestion/mothership/fixups.json` **is** tracked and carries `{description, match.block_id, replace_with_template}`. So the repo ships the knowledge of an extraction defect and the self-hoster supplies the replacement text from their own PDF. Loadout content is PSG text and does not ship, consistent with the Wounds Table precedent (spec 016 §3.2).

**Audited 2026-08-20 against the local corpus: printed p.7 is clean, and needs no fixup.** Four chunks under `LOADOUTS`, checked for the `§ S27.4` wide-table signature — truncation at a consistent visual width with the remainder dropped or orphaned onto a leading-`|` row:

- **40 of 40 rows present** — four class tables (Marine, Teamster, Scientist, Android) × `00`–`09`, no gaps.
- **Zero rows ending in a comma**, and zero orphan continuation rows.
- **No width clustering.** Row lengths run 52–117 characters in a smooth distribution with no pile-up at a ceiling, and the longest row terminates on a complete item name (`… Personal Locator, Subsurface Scanner`). Truncation at a fixed width would show several rows stopping at the same length.
- Cross-checks against `§ S27.4`'s independent readings pass: `SCIENTIST 05` carries both the scanner and the terminal, `TEAMSTER 04` the explosives.

**The same audit found the defect one page over, on two tables that are already live.** `TRINKETS` (p.8) and `PATCHES` (p.9) both carry the signature — 4 and 6 orphan continuation rows respectively, plus two comma-terminated rows in `TRINKETS` (`| | (Spent Shotgun Shells) | 69 | Miniature Chess Set,`). All 100 indices survive in each, so this is **reassembly damage rather than data loss**: they are three-column tables and the extraction interleaves the columns across lines, so a row and its continuation are adjacent but not associated. `§ S11.2` lists the d100 trinket and patch tables as "intact", which is true at the token level and wrong at the row level.

**Not fixed, by decision 2026-08-20, and out of scope for 018.** Creation rolls the number and the player enters the result from their own copy of the book; nothing in the app resolves a d100 against these tables, and the sheet records both as "narrative, never mechanical" (`character-sheet.schema.ts:132-135`). A garbled table nobody queries costs nothing. The finding is recorded on the roadmap because `§ S11.2`'s "intact" claim should be corrected where it stands, not because a repair follows.

### The tables are 0-indexed and the dice roller is not

`executeDiceRoll` returns `randomInt(sides) + 1` (`dice.ts:57-64`), so `1d10` yields **1–10** and `1d100` yields **1–100**. Every one of these tables is indexed from **00**: loadouts `00`–`09`, trinkets and patches `00`–`99`.

So a raw roll cannot index the table it was rolled for, and the top result has no row at all.

**Decided 2026-08-20: store the dice as they fell and apply the `-1` at lookup.** That preserves the property `creationRolls` is built on — the record is what the dice showed, not a value already transformed for one consumer — and it keeps the offset in a single place instead of at every roll site. `trinket` and `patch` have carried the same 1-based roll since M7.6, but since the player resolves those tables themselves nothing has ever applied an offset to them, so this establishes a convention rather than repairing a live miscalculation.

**The creation form cannot read the corpus, and that is the constraint that decides the UI.** `rules_lookup` runs in the turn path; a creation form has no Warden in it. So the form takes structured entry rather than presenting the book's tables, regardless of how clean the corpus turns out to be. The audit matters for *play* — a Warden adjudicating what a character is carrying — not for creation.

---

## Part 3 — The oracle filter reaches the backend

Confirmed end to end, and it is not an edge case — it is the only behaviour the code can produce.

1. `OracleFilter.svelte:62-72` draws a selection from the player's *filtered* pool, then sends only the drawn entry.
2. `SynthesizeRequestSchema` (`dto/synthesize.dto.ts`) carries `oracleSelections` and `addendum`. The filter state never crosses the wire.
3. `synthesis.controller.ts:102-106` reconstructs `activePools` from `getMothershipOraclePool(cat)` — the **full static pool**, as though nothing had been deselected.
4. `synthesis.service.ts:305-314` picks uniformly from that, excluding only the current id.

So a coherence reroll draws from a pool the player has already rejected. The playtest's `Coherence reroll: tone body_horror -> corporate_nihilism` is the expected output.

The backend is not ignoring the filter. It has never been told the filter exists.

**Scope.**

- Extend the synthesize request to carry the active pool per category — the ids the player left enabled, not the drawn selection.
- `checkCoherence` picks substitutes from that, never from the static pool.
- Reject a request whose active pool for a category does not contain that category's selection; a selection outside its own pool means the two halves disagree and guessing which is right is worse than a 422.
- Handle the degenerate case explicitly: a category filtered to one entry has no legal substitute, so a reroll there must escalate to `surface` rather than silently reusing the current selection. `pickRerollReplacement` already returns `null` for this; the path is reachable now in a way it was not before.

**Acceptance:** a category filtered down to a known set can never produce a synthesis carrying a selection outside it, by reroll or otherwise.

---

## Part 4 — `wounds` is writable in the Warden's view

**The state was never missing.** The fixtures captured from this playtest carry all eleven pools for `dr_kennedy`, `wounds: {current: 0, max: 2}` among them. Derivation (`character-pools.ts:120-121`), definitions (`pool-definitions.ts:89`) and the snapshot render (`session.snapshot.ts:98-115`, which filters nothing) are all correct. The roadmap bullet's framing — "only `hp`/`stress` appeared in the snapshot's pool list" — describes what the Warden believed, not what it was sent.

The `pool` field of a resource-pool change is `z.string().min(1)` and its entire description is:

> `'The bare pool name: "hp", "stress", "combat". Never a prefix.'` — `session.schema.ts:42-45`

Three examples, and `wounds` is not among them. The **only** appearance of Wounds anywhere in the tool schema is in `maxDelta`'s description — "Maximum Wounds lost to Panic 19" (`session.schema.ts:48-58`) — which describes moving the *ceiling*. So a model reading the schema for how to take a Wound finds the word attached to precisely the field it must not use, and an example list that reads as a domain.

This is the same defect class as `ADR-0097` addendum 2, where dumping the generated `input_schema` found five top-level properties carrying no description at all and the prompt was the wrong lever. The prompt is not the wrong lever *here* — `mothership-m7.txt:283-315` documents the chain correctly, including "the wounds delta" at :311. Both halves the roadmap bullet asks us to choose between are present. The gap is a third thing: an open string whose examples were read as an enumeration.

**Scope.**

- Enumerate the character pool names in the `pool` field description, sourced from `MOTHERSHIP_CHARACTER_POOL_NAMES` rather than restated, so the list cannot drift from the derivation.
- Keep the field an open string. Pools outside the character set are legal by design — NPC timers, `_scenario` subsystems, anything synthesis mints (`pool-definitions.ts:78-82`) — and an enum would reject them.
- Disambiguate `delta` from `maxDelta` on the wounds pool specifically: taking a Wound is `delta: +1`, and `maxDelta` is for Panic 19 removing a Wound *slot*.

**Warden-visible.** Moves `assemblyHash`; see § Ordering.

**Acceptance:** `missing-delta` is the checker this failure produced, and it is currently a stub (`registry.ts:332-335`). Implementing it is a prerequisite for measuring this fix — see § Ordering.

---

## Part 5 — A durable roll modifier for the Fatal Injury row

On the same turn as Part 4's finding, the Warden read `Skull fracture. [-] on all rolls.` off the Wounds Table, found no match among the eight Conditions (`character-state.schema.ts:9-18`), correctly declined to invent one, and recorded the penalty in `gmUpdates.notes` — where nothing downstream can apply it.

The enum is right to be closed. Its justification stands: the Panic table's Conditions are fixed by the rules and an open string is a fabrication surface. The problem is that the Wounds Table produces an effect that is **not a Panic Condition at all** — a durable, mechanical modifier on future rolls — and `characterState` has no shape for one. `bleeding` and `pendingDeathSave` exist as dedicated fields for exactly this reason: they are Wounds Table outputs that are not Conditions. This is a third one that was missed.

**Scope.** A representation for a durable roll modifier in `characterState`, with:

- Its source recorded, so a Fatal Injury penalty is distinguishable from any later source of the same shape.
- Its scope recorded — `[-]` on *all* rolls is the Fatal Injury case, but the table's other rows produce narrower penalties.
- A defined lifetime. Unlike `bleeding`, nothing suggests these expire on their own; if they are permanent, the schema should say so rather than leaving it to a Warden's judgement per turn.
- A `stateChanges.characterState` op to write it, and a render into `<character_attributes>` so the Warden sees it on subsequent turns. A modifier the Warden cannot read next turn is the same silent loss in a different place.

**Explicitly not** an extension of `MothershipConditionEnum`. Adding `skull_fracture` would put a Wounds Table result into an enum documented as the Panic table's, and the next Fatal Injury row would want another.

**Warden-visible.** Moves `assemblyHash`.

---

## Part 6 — Contractor Instinct and `crewRole` skills (`ADR-0100`)

The house rule is decided in `ADR-0100` and is not re-litigated here. Its schema section was **amended 2026-08-20** against the three findings below, which were found while drafting this spec; the amendment is the version this part implements.

**This part introduces Instinct, it does not extend it.** NPCs carry no mechanical stats today, so the skill layer has nothing to add a bonus to. Per the amended ADR: every `npc`-type entity gets `2d10 + 25 + role adjustment` (+15 senior / +10 skilled / +5 unskilled / +0 no role), **rolled by the backend** at synthesis-write time via `executeDiceRoll` (`dice.service.ts:43`) — never supplied by Claude, which has no `roll_dice` in `SYNTHESIS_TOOLS` (`synthesis.tools.ts:23`) and would therefore be fabricating the number. The dice are stored as they fell, exactly as `creationRolls` does for a player; the `+25` and the adjustment are derived.

`threat` entities get no Instinct and `feature` entities are not actors, so `type: 'npc'` is the whole of the carrier — no new type enum value.

**Every number here is invented**, extrapolated from the Contractors rules rather than read out of them (`ADR-0100 § Deviation from RAW`). That matters for this part specifically because the values are about to be rendered into a Warden-visible surface, and a sourced-looking number in a prompt is how an invention becomes indistinguishable from a rule.

The three findings that forced the amendment, in increasing order of severity:

1. **There is no `entities[].initial_state`.** `initialState` is a sibling of `entities` under `structured` (`synthesis.schema.ts:36`), and it is a flat map keyed by the two-part pool address `{owner}.{poolName}` whose values are `{current, max}` pools (`synthesis.prompts.ts:125`). It is not a per-entity object and has never held per-entity attributes.

2. **There is no `instinct` field to be a sibling of.** The only occurrences in the tree are a test fixture (`session.service.spec-int.ts:174`) and a comment recording that `INST` must never be rendered for player characters (`synthesis.prompts.ts:55`). `entitySchema` is `id`, `type`, `startingPosition`, `visible`, `tags` — NPCs carry no mechanical stats at all. Instinct is not a thing `crewRole` extends; this work has to introduce it.

3. **The chosen location has the exact failure mode the ADR rejects the free-text tag for.** `synthesis.write.ts:43` records that non-pool entries in `initialState` are silently skipped at merge time. A `crew_role` string there would pass Zod (`z.unknown()`), pass `validateSubmitGmContextForWrite`, and then be **dropped with no error** — the NPC reverting to Instinct-only with nothing surfaced. That is the ADR's stated argument against the tag, arriving through a different door.

**The correction, now carried in the ADR.** `instinct` and `crewRole` go on the per-entity structure that already exists and is already persisted per entity. **Store the role and the Instinct dice; never store the chain the role implies.**

That is the `creationRolls` → pools shape, and the counter-example is in this repo with its own postmortem: `maxHp` was a stored duplicate of a derived ceiling — "one fact in two places, free to diverge, and it did" (`character-sheet.schema.ts:38-43`). A materialised skill chain is the same object, recomputable from one enum value and free to disagree with the table the moment the table changes.

**The unification with Part 2 belongs at the read boundary, not the storage boundary.** A PC's skills are stored because a player *chose* them and nothing can recompute a choice; a Contractor's are arithmetic over `crewRole`. Those are different facts and should not share a storage location. They should share a *reader*: one accessor returning `MothershipSkillEntry[]` for any entity — `characterState.skills` for a PC, derived for a Contractor — so `MOTHERSHIP_SKILL_BONUS`, the render, and `loss_of_confidence` each have one implementation.

### The eval consequence of deriving, and the two things that contain it

Deriving at render time means an edit to `CREW_ROLE_SKILLS` changes what the Warden sees **for frozen fixtures whose files did not change**. `corpusVersion` is a content hash over fixture files, so it does not move: the corpus looks identical and is not. That is precisely the gap `assemblyHash` exists to close (`ADR-0099`), and `ASSEMBLY_PROBE` already states the governing rule — "Every branch of both formatters should be exercised here — a section this probe never populates is a section whose shape the hash cannot see" (`session.assembly.ts:48-50`).

Today `probe_npc_one` is `{ id, type: 'npc', visible: true, tags: ['crew'] }` (`session.assembly.ts:74`) — no role, no skills. So as things stand a table edit would move nothing and `eval:compare` would report a match across an input-affecting boundary. Both of these are required, not optional:

1. **`ASSEMBLY_PROBE` carries a Contractor with a `crewRole`**, so the derivation appears in the golden at all.
2. **The whole table folds into the hash** — a fourth golden rendering all 20 role → chain mappings. One probe NPC gives partial coverage only: with a `pilot` in the probe, editing `xenobiologist` still moves nothing. The table is Warden-visible data built by code, which is `assemblyHash`'s stated remit, and a golden makes the edit readable in review as a diff of what the Warden receives.

This is the trade against storing the chain, stated plainly: storing it means re-keying every Contractor-carrying fixture on a table edit (M7.6's D5 again); deriving it means a table edit is invisible unless the two guards above are in place. Deriving is right, and it is right *conditionally*.

**Two gaps this part opens.** `characterState` is seeded only by `CharacterService.create`, for the player — synthesis writes none (`campaign.repository.ts:165`), so NPC seeding is new work here, and rolling Instinct makes it required rather than optional. And the snapshot renders no skills at all (§ Part 2), so the render is new work too.

**Warden-visible.** Moves `assemblyHash`. The milestone-placement question at the bottom of the ADR is still open, and § Ordering below is the input to it.

**Nothing in this part is blocked.** The ADR's remaining open question is milestone placement, which § Ordering answers if 018 lands as a unit.

---

## Ordering, and the one run this all has to pay for

Parts 1 and 3 touch no Warden-visible surface. **Parts 2, 4, 5 and 6 all do** — Part 2 because its skill render is a new snapshot section, which was not obvious when this spec was first drafted and is the reason Part 2 cannot be treated as frontend work. Each moves `assemblyHash` (`ADR-0099`).

**One re-baseline, not four.** A run per change is the only way to attribute a tag movement to a specific change, and it is not worth it here: M7.6 rode six Warden-visible changes on one run, and the resulting inability to compare was survivable because §6.3-style predictions were written in advance. Do the same — write the predictions **before** the run, per `ADR-0085`, since with no honest delta available they are the only route to attributing a fallen score to this work. Batching onto a scheduled re-baseline rather than buying one is what `ADR-0094` prescribes.

**Three prerequisites, all hard.**

- **`missing-delta` and `roll-result-inversion` are stub checkers** (`registry.ts:332-335`), and `assertNoStubCheckers` refuses a run before any spend if a selected fixture carries one. Seven of the 22 fixtures come from this playtest and carry them. `missing-delta` is the checker for Part 4's exact failure — that fix is unmeasurable until the checker is real.
- **`ASSEMBLY_PROBE` must exercise `crewRole`, and the role table must fold into the hash** (§ Part 6). Without both, a `CREW_ROLE_SKILLS` edit is an input-affecting change that moves no run identity at all — the failure `ADR-0099` was written to prevent.
- **`eval:compare` across this boundary is meaningless** and that is not a warning to suppress. Same reasoning as `eval-methodology.md:137-142`.

Suggested commit order: 1, 3, then the stub checkers, then 6, 2, 4, 5, then the run. Parts 1 and 3 are independent and reviewable immediately. **Part 6 now precedes Part 2**, reversing the earlier suggestion: Part 6 defines the skill accessor and the render that Part 2 consumes, so building Part 2 first means building a render twice. That ordering makes `ADR-0100`'s amendment the critical path for everything except Parts 1 and 3.

**Invariant, per M7.6:** the repo is green at every commit — `npm run build`, `npm test`, `npm run lint`. Parts 5 and 6 change `@uv/game-systems` schemas whose consumers live in other workspace packages, so a schema change and its consumers land in the same commit.

---

## Predictions, pre-registered before the re-baseline

Written 2026-08-20, **before any Warden call**, because five Warden-visible
changes ride one run and no honest per-tag delta will exist (`ADR-0085`). The
`--decision-rule` string points here; this is the reasoning it compresses.

Identities: `promptHash` `ccac7d1c` → `fa4e6e2f`, `assemblyHash` `0bb41002` →
`3d8df5f3`, `corpusVersion` `1c2a418cf68c` → `cbc840d21158` (scoring-only).
Baseline for every number below is
`claude-sonnet-5__ccac7d1c__2026-08-18T11-48-47Z`, 10 reps.

### What this corpus actually sees

Checked against the 22 fixtures rather than assumed, and it is narrower than
"five changes":

- **15 of 22 fixtures carry `characterState.skills`** — `Military Training`
  trained, `Firearms` expert — captured at M7.6 and never rendered until Part 4.
  Those fixtures now hand the Warden **+10 and +15 it has never seen**.
- **The tool schema changed**: `pool` enumerates the eleven character pool
  names, `delta`/`maxDelta` disambiguate taking a Wound, and two
  `roll_modifier` ops are new.
- **The prompt changed**: a wounds-chain line routing a lasting `[-]` to
  `roll_modifier_add`, and a conditional NPC-Instinct line.
- **Inert on this corpus**: no fixture carries `crewRole`, `instinctRoll` or
  `rollModifiers`, so the `<entities>` and roll-modifier renders emit nothing
  and cannot explain any movement. No fixture carries `loss_of_confidence`, so
  skill suppression never fires either.

### Primary — and it is a new measurement, not a delta

`MISSING-DELTA` and `ROLL-RESULT-INVERSION` get a denominator for the first
time, across three fixtures **captured precisely because the Warden failed
them**. A low rate is the expected and correct result.

**Read ≥0.90 on either tag as a rubric that cannot see its failure mode, not as
a clean Warden** — investigate the judge transcript before recording it
(`ADR-0082`). `ROLL-RESULT-INVERSION` is artifact-gated: applicability 0 means
it measured nothing and says nothing.

### The tag most exposed, and why

`SYSTEM-ROLLED-PLAYER-ACTION`, baseline **0.92 (45/49)**. Handing the Warden two
skill bonuses invites it to resolve the player's own check rather than defer it
— the exact pressure point `§ S32` repaired. **Predict ≥0.85.** A fall past that
is attributable to the skills render rather than to noise, and the fix is a
prompt line stating that a skill bonus does not license rolling for the player.

### Guardrails

- `TOOL-SYNTAX-LEAK` ≥ 0.99 (baseline 149/149 graded, 1 error)
- `UNSURFACED-CHECK` ≥ 0.95 (baseline 1.00)
- `HIDDEN-INFO-LEAK` holds 1.00 — the NPC render sits inside the visible-only
  branch and must not widen the leak in `hidden-information-findings.md`
- No other tag drops > 0.15 at unchanged applicability
- Zero errors before any number is read (`ADR-0085` category 4)

### Recorded, gated on nothing

- `NARRATING-PAST-A-BLOCK` 0.55 is `turn16` at ~0.10, a known-defective fixture
  (`ADR-0082` addendum). Not evidence about the Warden; re-authoring is not in
  this run.
- `UNAUDITABLE-MAPPING` 0/30 and `MISSING-CANON-CAPTURE` 0/10 applicability.
- `UNEXPLAINED-DELTA` and `CARRYOVER-ARITHMETIC` remain registered with no
  fixture carrying either, so this run measures neither — again.
- Any tag reading exactly 1.00 is a suspect to investigate, not a pass.

---

## Done when

- [ ] Every derived value on both character screens shows its terms (Part 1)
- [ ] Skill selection and loadout/gear entry write to `characterState` at creation; held skills and tiers render into the snapshot; `loss_of_confidence` can suppress a skill that exists (Part 2)
- [ ] A category filtered to a known set cannot produce a synthesis carrying a selection outside it (Part 3)
- [ ] The tool schema enumerates the character pool names from `MOTHERSHIP_CHARACTER_POOL_NAMES`, and `delta` vs `maxDelta` on `wounds` is unambiguous (Part 4)
- [ ] A durable roll modifier is representable, writable via `stateChanges.characterState`, and rendered into `<character_attributes>` (Part 5)
- [ ] Contractor Instinct is rolled **by the backend** at synthesis-write time, dice stored as they fell, the `+25` and role adjustment derived (Part 6)
- [ ] `crewRole` stored on the entity, the skill chain derived and never stored, both read through one accessor shared with Part 2 (Part 6)
- [ ] `ASSEMBLY_PROBE` carries a `crewRole` Contractor, and a golden covers all 20 role → chain mappings, so a table edit moves `assemblyHash` (Part 6)
- [ ] `missing-delta` and `roll-result-inversion` are implemented; `STUB_CHECK_IDS` is empty
- [ ] Predictions written **before** the run, then one full-corpus re-baseline, with the report stating what it does not measure

---

## Resolved before drafting

- **Playtest character's class: Scientist.** Confirmed against the captured fixture — Sanity 52 = `2d10(12) + 10 + 30`. Part 1 is a display fix, not an arithmetic one.
- **Items 5 and 6 fold in from M7.7** rather than staying there — both are `characterState` shape questions and would otherwise mean two schema passes.
- **NPC mechanics are in scope**, via `ADR-0100`'s house rule rather than any of the four options offered at triage.
- **The `crewRole` chain is derived, not stored.** `crewRole` is the input and the chain is arithmetic over it, so storing the chain would repeat the `maxHp` duplication M7.6 removed. Accepted with its condition: the derivation is only safe once `assemblyHash` can see a table edit (§ Part 6).
- **Contractor Instinct is rolled, not assigned from `crewRole`** — the role→Instinct mapping is not total over `npc` entities, and assignment would give every pilot on a ship the same number. `2d10 + 25 + role adjustment`, rolled by the backend. `ADR-0100` amended accordingly on 2026-08-20.
- **`forgoLoadout` fixed standalone** at `5cbf9a7`, ahead of this spec.

## Open

*Nothing. All open questions were closed between 2026-08-19 and 2026-08-20; see `§ Resolved before drafting` and the closure note below.*

*Closed 2026-08-20 (second round): the `loadout` roll is `1d10` against per-class `00`–`09` tables. Printed p.7 audited clean, no fixup. `TRINKETS`/`PATCHES` extraction damage recorded and deliberately not repaired — the player resolves those tables. 0-index convention: store the dice as they fell, offset at lookup.*

*Closed 2026-08-20: `ADR-0100` accepted for **M7.7**, both halves together, riding 018's re-baseline. Its schema section amended against the three findings in Part 6. Instinct's base (`2d10 + 25`) and tier adjustments (+15 / +10 / +5 / +0), all invented rather than sourced; `npc` is the only entity type that rolls Instinct. PSG loadout content does not ship — `ingestion/*/templates/*` is gitignored while `fixups.json` is tracked, so the repo carries the defect knowledge and the self-hoster supplies the text.*
