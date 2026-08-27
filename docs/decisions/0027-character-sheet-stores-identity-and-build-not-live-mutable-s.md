---
id: ADR-0027
title: Character sheet stores identity and build, not live mutable state
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The sheet/pool split: identity, build and ceilings on the character sheet, anything
  that mutates in play in `resourcePools`. Read the addenda before relying on the body
  — they generalize the rule and find the entry wrong against the rules in several
  places, including the stress seed, floor and cap. Addendum 3 rejects
  end-of-adventure write-back.
---

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
