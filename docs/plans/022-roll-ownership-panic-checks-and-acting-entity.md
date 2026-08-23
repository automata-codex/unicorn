# 022 — Whose panic check, and who `actingEntityId` names

**Status: open.** Drafted 2026-08-23, directly out of plan 021's second run
(`f0753f86__2026-08-23T14-39-39Z`). Two prompt-surface changes aimed at the
eight `SYSTEM-ROLLED-PLAYER-ACTION` failures that run left behind, which are
two unrelated bugs sharing a tag. Same shape as `014` and `021`: a plan, not a
spec, with predictions pre-registered before the edit.

## The two bugs

**1. The prompt never says whose panic check.** `WHEN TO CALL roll_dice` lists
*"Panic checks triggered by the fiction (stress accumulation, monstrous
reveal, witnessing a teammate die)"* without qualifying the actor, and that
line outranks any guard further down. Every instance is a `1d20` for
`dr_kennedy` with `diceRequests: []` — e.g. *"Panic Check for dr_kennedy — …
needs greater than 2 to succeed"*. Plan 021 recorded this as the case it
deliberately left alone, on the grounds that the fixture passed 10/10 before
021 so 021's own edit was the cause; the second run shows the line is load
bearing on its own once the Warden is thinking about thresholds.

**2. `actingEntityId` is overloaded with "entity acted upon."** The prompt
says *"For a roll the world makes with no actor, name the entity it acts
on"* — so a contractor's damage roll against the player is attributed to the
player. `rollActsFor` then classifies it `'player'` and the check fails it.
A prompt instruction and a checker contradict each other. **This predates 021**
(`turn24-over-resolution` 0.88 → 0.78, `turn24-hidden-info-leak` 0.80 → 0.89
across it — flat within noise), so it is an inherited bug being paid down, not
regression repair.

## Why both in one change, against the usual one-at-a-time rule

Because the two are **not independent in what they move**, and one alone
cannot be measured:

- **7 of the 8 failing reps carry a panic-check violation**; exactly one
  (`turn24-over-resolution`) is `actingEntityId`-only. A rep fails if *any*
  violating roll is present.
- So fixing `actingEntityId` alone takes 8 fails → 7, i.e. **0.89 → ~0.90** —
  landing precisely on the floor, indistinguishable from noise at this N, in
  exchange for a full re-baseline.
- Panic masks `actingEntityId` entirely until it is fixed.

**Attribution survives the batching because the artifacts separate what the
rollup cannot.** Each fix targets a structurally distinct violating roll, and
plan 021's second-run analysis classified all eight failures from the
artifacts. The predictions below are stated per violation *class*, checkable by
reading the violating rolls on any rep that still fails — not per rep number,
which a fresh stochastic run does not reproduce.

## The changes

Both prompt-only. `promptHash` moves; **`assemblyHash` must not** — no tool
schema is touched, and that is itself a check.

1. **`WHEN TO CALL roll_dice`** — the panic-check entry says whose. An NPC's
   panic check is `roll_dice`; the player character's is a `diceRequest`, like
   any other roll of theirs.
2. **`FIELDS EVERY roll_dice CALL MUST CARRY` → `actingEntityId`** — name the
   entity whose *action the roll resolves*; never the entity a roll merely
   happens to. For a consequence roll that is the **cause**, not the target:
   damage from Beta's hit is `veridian_contractor_beta`. The "name the entity
   it acts on" clause is deleted.

### The route not taken, and why

A reserved sentinel (`_scenario`, as spec 018 established for pools owned by
no entity) is the tempting home for a genuinely actorless roll. **It would make
the numbers worse, not better.** `rollActsFor` returns `'unknown'` for any id
that is neither the player nor a declared entity, and `'unknown'` routes to
`unbindableVerdict` — an *undecided* rep, not a pass. Those reps would leave
the denominator instead of joining the numerator, which is the
rate-bought-by-a-shrinking-denominator failure `docs/eval-methodology.md`
warns about. Naming the causing actor needs no checker change at all, because
NPCs are declared entities and resolve to `'other'`.

Deferred, not dismissed: if a roll genuinely has no actor, `_scenario` plus a
checker change teaching `rollActsFor` to treat it as `'other'` is the correct
end state. Nothing in the corpus currently needs it — every observed case has
a nameable cause.

## Predictions, pre-registered before the edit

- `SYSTEM-ROLLED-PLAYER-ACTION` **≥ 0.95**, up from 0.89, on an unmoved
  denominator. Seven of eight current failures should clear.
- **No remaining failure carries a panic-check or damage/wounds-table
  violating roll.** This is the real test and it is read from the artifacts,
  not the rate. A residual failure of either class means the corresponding
  edit did not land.
- **The built-in control: genuine violations must still fail.** One current
  failure carries a third roll neither fix addresses — *"Alvarez's Combat
  check for suppressive fire against the room … roll under Combat 30"*, the
  player's declared action resolved by the system. Turns of that kind must
  keep failing. **If `SYSTEM-ROLLED-PLAYER-ACTION` reaches 1.00, suspect
  over-correction** — the Warden deferring rolls it legitimately owns — and
  check applicability and `UNAUDITABLE-MAPPING` before believing it.
- **`assemblyHash` unchanged** at `ada7fb8a`. Both edits are prompt text.
- Hold: `UNAUDITABLE-MAPPING` ≥ 0.90 **with applicability still ~0.20
  (10/50)** — plan 021's gain must survive; `UNSURFACED-CHECK` ≥ 0.90;
  `NARRATING-PAST-A-BLOCK` ≥ 0.90; `HIDDEN-INFO-LEAK` ≥ 0.90.

## Deliberately not in this change

- **`SCENE-JUMP`'s rubric.** It reads 0.22 and 8 of its 9 rationales flag the
  boundary as borderline or ambiguous in both directions — the same defect
  class as `HIDDEN-INFO-LEAK`'s, on a tag that also rests on one fixture. It
  is scoring-side rather than Warden-visible, so batching it here would
  confound a rubric change with two prompt changes on one run. Its own change,
  after this.
- The `_scenario` sentinel and its checker change, above.
- Widening `UNAUDITABLE-MAPPING` past its single fixture — still blocked on
  the second playtest.
