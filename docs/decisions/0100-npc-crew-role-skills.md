---
id: ADR-0100
title: Contractor NPCs get a rolled Instinct and a `crewRole`-mapped skill bonus — a Zoltar house rule, not RAW
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  Introduces Instinct for `npc` entities and a `crewRole` → skill-chain layer over it:
  the roll, where it is stored, and the `assemblyHash` precondition a role-table edit
  would otherwise slip past. Everything mechanical in it is invented — a Zoltar house
  rule, not RAW.
---

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
