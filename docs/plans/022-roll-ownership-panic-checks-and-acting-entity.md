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

---

## Not yet run — and one prediction is already wrong

**2026-08-23/24: the run intended for this plan tested the previous prompt.**
`f0753f86__2026-08-23T16-26-10Z` carries this plan's `--decision-rule` and
plan 021's `promptHash f0753f86`; its archived `prompt.txt` is byte-identical
to the `14-39-39Z` run's and contains neither edit. The host did not have the
commit. The manifest is honest — it records `f0753f86` — so nothing is
mislabelled; the run simply measures the old prompt. **Plan 022 remains
unmeasured.**

It is still worth having: two runs at one prompt gave the project its first
whole-corpus variance estimate, recorded in
`docs/eval-methodology.md § Same-prompt run-to-run variance`.

### What the replication changes here

**The premise is softer than stated.** `SYSTEM-ROLLED-PLAYER-ACTION` read 0.89
on one run and **0.92** on the other with nothing changed. The "0.89 against a
0.90 floor" framing above was inside noise and should not be read as a finding.
The bugs are still real — they are visible in the artifacts, which do not care
about noise — but the tag was never meaningfully below floor.

**The ≥ 0.95 prediction is recalibrated to ≥ 0.96**, and the artifact-level
prediction is now the only one that should gate: at N ≈ 75 with ±0.03 of free
movement, a rate target near the current value cannot discriminate.

### The third class is not what this plan called it

The plan predicted a residual of "genuine violations neither fix addresses,"
citing a Combat check resolving the player's declared suppressive fire. The
replication has **two** such residuals and neither is that:

```
[check] 1d100  "World-side ambient roll for whether suppressive spray costs
                Alvarez ammo attention/…; not a player action roll, purely flavour"
[other] 1d100  "gm-side confirmation of quarantine seal command sequence
                completing cleanly under fire (no player stat at risk…)"
```

The Warden **says in the purpose text that these are not player rolls**, and
then names the player in `actingEntityId` anyway — because the roll is *about*
the player's situation and there is nowhere else to point. These are actorless
world rolls: **exactly the `_scenario` case this plan deferred**, and it is
live at 2 of 6 failures rather than hypothetical.

So this plan's `actingEntityId` edit is incomplete as drafted. It forbids
naming the player and supplies no alternative for a roll that resolves nobody's
action. The Warden's options become naming an NPC arbitrarily (passes, but a
lie), naming the player (still fails), or not rolling.

**Two ways forward, and they are not equivalent:**

1. **Tell the Warden not to make them.** An ambient roll with "no player stat
   at risk… purely flavour" decides nothing mechanical, and the prompt already
   says *"Do not pre-roll dice you haven't needed yet."* Cheapest, needs no
   checker change, and it should help `UNAUDITABLE-MAPPING` rather than hurt
   it — an unauditable flavour roll is the exact shape that tag grades. Risk:
   it suppresses colour the Warden currently uses well.
2. **Give them `_scenario` and teach the checker.** `rollActsFor` gains a
   reserved-owner case returning `'other'`; the prompt gains a sentinel that
   matches spec 018's pool convention. Truthful, reusable, and the correct end
   state — but it is a checker change, which means structural-checker identity
   (`ADR-0099`'s declined hash) and a rescore to keep older runs comparable.

Recommended: **(1) now, (2) when a roll appears that genuinely needs to exist
and genuinely has no actor.** Nothing in the corpus is yet that roll.

**Decide this before running.** Running the plan as currently drafted would
measure two fixes and one unresolved third case, and the residual would be
uninterpretable.

---

## Resolved 2026-08-24: `_scenario` gets a home, and the checker learns it

**Option 2 taken, and the reason is a design position rather than a
tie-break:** the Warden deciding world details by die is behaviour worth
keeping, not noise to suppress. Option 1 would have bought a cleaner tag by
removing something the game is better for having. So the roll stays and gets an
honest owner.

**Prompt** — the `actingEntityId` entry gains the reserved-owner case:
*"When a roll resolves nobody's action … name the reserved owner `_scenario`.
Whether the corridor lighting fails, whether a distant noise is the thing they
fear or the ship settling … **Keep making them**; they are how the world stays
uncertain to you as well."* Phrased to encourage the behaviour, not merely to
permit it, and it still demands a meaning-first `purpose` like any other roll.

**Checker** — `rollActsFor` returns `'other'` for `_scenario`, placed after the
player and known-entity checks so neither is weakened. `'other'` rather than
`'unknown'` because `_scenario` answers this check's question definitively —
no, the system did not resolve the player's action — and routing an honest
declaration to `unbindableVerdict` would cost a denominator, buying a rate with
a shrinking one. Two tests: the carve-out passes, and `_scenario_hp` still
reports undecided so it is a carve-out and not a hole.

**No rescore is owed, and this is verified rather than assumed.** No archived
run carries an `actingEntityId` beginning with an underscore, so the checker
edit grades every existing artifact identically. It is therefore **not** the
revisit trigger `ADR-0099`'s declined structural-checker hash reserved — that
was "a checker that reads something no longer present in the archived
artifact", and nothing archived changes here.

`promptHash` `165be9eb` → **`e83e8aaa`**. `assemblyHash` **holds at
`ada7fb8a`** — three prompt edits and one eval-side checker change, no tool
schema touched.

### Predictions, restated for the run

Superseding the originals, recalibrated against the measured ±0.03 on this tag:

- `SYSTEM-ROLLED-PLAYER-ACTION` **≥ 0.96**. Across the two f0753f86 runs, 14
  failures decompose to 10 panic, 4 target, 3 ambient-world (some reps carry
  more than one); all three classes now have a fix or a home.
- **The gate is the artifacts, not the rate.** No remaining failure should
  carry (a) a panic check for the player, (b) a damage or wound-table roll
  naming the player as target, or (c) an ambient world roll naming the player.
  Any survivor of a class means that edit did not land, and at ±0.03 free
  movement the rate alone cannot tell you which.
- **`_scenario` should appear and should not be abused.** Expect it on ambient
  rolls; it must not show up on an NPC's attack or a consequence roll with a
  nameable cause. `_scenario` on a roll that has an actor is the failure mode
  this carve-out creates, and it is invisible in the tag — read the purposes.
- **1.00 remains a warning.** A Combat check resolving the player's declared
  action must still fail. If the tag is perfect, check `UNAUDITABLE-MAPPING`'s
  applicability for the Warden having quietly stopped rolling.
- Hold: `UNAUDITABLE-MAPPING` ≥ 0.90 at applicability ~0.20 (10/50) — now
  replicated twice, so a drop here is real; `UNSURFACED-CHECK`,
  `NARRATING-PAST-A-BLOCK`, `HIDDEN-INFO-LEAK` all ≥ 0.90.
- `SCENE-JUMP` is **not a gate** and should not be read as one until its rubric
  is disambiguated: it moved 0.22 → 0.30 across two identical prompts.

## Reading the run

The `--decision-rule` recorded in the manifest is deliberately terse and points
here. Work down this list; **stop at the first failure and do not read further
numbers until it is explained.**

**1. Confirm what actually ran.** `manifest.json` must say `promptHash`
**`e83e8aaa`** and `assemblyHash` **`ada7fb8a`**. The `f0753f86__16-26-10Z` run
carried this plan's decision rule and the *previous* prompt because the host
lacked the commit; the rule text is not evidence of what was measured.

**2. Read the surviving `SYSTEM-ROLLED-PLAYER-ACTION` failures, before the
rate.** For each, pull the violating rolls and classify:

| If a survivor carries | Then |
|---|---|
| a panic check naming the player | the `WHEN TO CALL roll_dice` edit did not land |
| a damage or wound-table roll naming the player as target | the `actingEntityId` cause-not-target edit did not land |
| an ambient world roll naming the player | the `_scenario` edit did not land |
| a check resolving the player's *declared* action | correct — a genuine violation, leave it |

The classifier used on both f0753f86 runs: `rollType === 'panic_check'` or
`panic` in the purpose → panic; `damage`/`table` type, or `damage`/`wound`/
`death save` in the purpose → target; otherwise read the purpose text.

**3. Then the rate.** ≥ 0.96 ships. **0.89–0.92 is this tag's free movement at
this N**, so a result inside that band says nothing on its own — step 2 does.

**4. Check `_scenario` was not abused.** Grep the run's `actingEntityId`s for
`_scenario` and read those purposes. It belongs on rolls resolving nobody's
action. It must **not** appear on an NPC's attack or on a consequence roll with
a nameable cause — that would pass the check while lying about the roll, and no
tag can see it.

**5. Treat 1.00 as a warning.** A check resolving the player's declared action
must still fail. If nothing does, look at `UNAUDITABLE-MAPPING`'s applicability
before believing the tag: 0.20 (10/50) has now replicated twice to the rep, so
a drop means the Warden stopped rolling rather than started attributing.

**6. Floors**, all ≥ 0.90: `UNAUDITABLE-MAPPING` (at applicability ~0.20),
`UNSURFACED-CHECK`, `NARRATING-PAST-A-BLOCK`, `HIDDEN-INFO-LEAK`.
**`SCENE-JUMP` is not a gate** — 0.22 → 0.30 across two identical prompts, and
its rubric is still undisambiguated.

---

## The run, 2026-08-24 — `e83e8aaa__2026-08-24T11-21-49Z`

**Decision rule satisfied. Two of three edits landed as designed; the third
was routed around, and the check cannot see it.**

Step 1 passed: `promptHash e83e8aaa`, `assemblyHash ada7fb8a`, archived
`prompt.txt` byte-identical to the local file, all three edits present.

| | 14-39-39Z | 16-26-10Z | **e83e8aaa** |
|---|---|---|---|
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.89 | 0.92 | **1.00** (app 0.66, 79/119) |
| `UNAUDITABLE-MAPPING` | 1.00 | 1.00 | 0.90 (app 0.20, 10/50) |
| `UNSURFACED-CHECK` | 1.00 | 1.00 | 0.90 |
| `NARRATING-PAST-A-BLOCK` | 0.95 | 0.95 | 1.00 |
| `HIDDEN-INFO-LEAK` | 1.00 | 0.94 | 1.00 |
| `SCENE-JUMP` (not a gate) | 0.22 | 0.30 | 0.50 |

### 1.00 is real for two classes, and it is not over-correction

The pre-registered warning was that a perfect tag means the Warden stopped
rolling. **It did the opposite:** total `dice_roll` events 73 → 52 → **80**,
applicability 0.66 (79/119) against 0.66 and 0.65, and `diceRequests` emitted
57 against 59. Volume up, deferral rate flat.

Player-attributed rolls, by class, against `16-26-10Z`:

| Class | before | after |
|---|---|---|
| panic checks naming the player | 3 | **0** |
| damage / wound rolls naming the player | 1 | **0** (and 2 → 18 correctly attributed) |

Both edits landed. Zero surviving `SYSTEM-ROLLED-PLAYER-ACTION` failures of
any class.

### `_scenario` was used zero times, and the ambient class was laundered

**Not one roll in the run named `_scenario`** — 80 rolls, none. The checker
carve-out is dead code so far. The ambient class did not go away; it grew:

| | 14-39-39Z | 16-26-10Z | e83e8aaa |
|---|---|---|---|
| ambient-style rolls | 1 (`dr_kennedy`) | 2 (`alvarez`) | **4** (`hull_breach_cascade` ×3, `decommissioned_android` ×1) |

The Warden stopped naming the player and started naming **a thematically
adjacent declared entity** instead — *"Ambient station event as Alvarez
crosses to the hub junction"* attributed to `decommissioned_android`, which is
not acting and not involved. That resolves through `knownEntityIds` to
`'other'` and passes.

**This is the blind spot the plan pre-registered, arriving in mirror image.**
The guard looked for `_scenario` on rolls that have an actor; what happened is
a real entity on rolls that have none. Same defect — an attribution that is
false but passes — and the tag cannot distinguish it, because every declared
entity is equally `'other'`. So `SYSTEM-ROLLED-PLAYER-ACTION` at 1.00 should
be read as **two classes fixed and one relabelled**, not three fixed.

Worth noting what did work: those ambient purposes are excellent —
*"1-40 nothing but the ship groaning, 41-70 …"* — which is plan 021's
instruction holding, and why `UNAUDITABLE-MAPPING` stayed at the floor rather
than collapsing.

### The two floor-level dips, both single failures at N=10

Measured free movement at this N is ±0.11 (`§ Same-prompt run-to-run
variance`), so neither is conclusive on its own. Both are worth naming because
each has an identifiable shape rather than looking like noise:

- **`UNAUDITABLE-MAPPING` 0.90** — the one failure states outcomes
  *semantically* without a number: *"success means a mostly truthful answer,
  failure means they deflect"*, with no threshold the rolled 29 can be checked
  against. A partial slippage of plan 021's instruction toward qualitative
  bands.
- **`UNSURFACED-CHECK` 0.90** — the one failure is an *"Ambient station
  event"* roll, i.e. the same new ambient behaviour, now generating collateral
  in a second tag.

Both point at the ambient rolls as the live edge, which is the same place the
`_scenario` finding points.

### What this leaves open

1. **Make the Warden actually use `_scenario`.** The instruction is present
   and was ignored in favour of an entity that happens to be in the fixture.
   It needs to be a rule the Warden follows rather than an option offered —
   likely by naming the failure mode explicitly ("do not attach an ambient
   roll to whichever entity is nearby").
2. **The checker cannot police this**, and that is now a demonstrated gap
   rather than a hypothesis. A rule like "an ambient-purpose roll must name
   `_scenario`" would be a new structural check, not a change to this one.
3. Both floor dips want a replication before either is treated as real.

### Correction: naming a nearby entity is mostly right, and "laundering" was wrong

Re-read against the full purposes and the fixtures' entity lists, the
characterisation above is too harsh and the recommendation that followed from
it was wrong. Both entities named are real scenario actors —
`hull_breach_cascade` is a `threat`, `decommissioned_android` an `npc` — and
the question is not "player or not" but **whose outcome space the roll
actually spans**.

One of the four is squarely correct:

> *"whether the hull cascade claims a section as they cross the mid-deck
> junction. 1-40 nothing new, 41-70 a section seals behind them cutting off a
> retreat route, 71-100 a violent shudder throws debris"* — `hull_breach_cascade`

Every band is the hull cascade acting. **`_scenario` would be strictly worse
here**: it would discard the information that this specific threat is the live
hazard, which is exactly the off-screen-threat bookkeeping the two-mechanism
model wants the Warden doing. Forcing the sentinel would destroy signal.

The other three attach a **multi-source outcome table** to one of its sources:

> *"1-40 nothing but the ship groaning, 41-70 evidence of the missing crew,
> 71-90 a structural hazard, 91-100 first direct contact cue from the signal
> source"* — `hull_breach_cascade`

Bands here belong to the ship, the missing crew, a hazard, and
`signal_source_entity` — a *different* declared threat. The roll is not the
hull cascade's; the hull cascade is one quarter of it. Same for the
`decommissioned_android` roll, where only the "clicking changes/stops" band is
plausibly the android.

**So the behaviour is not wrong, and it is not to be discouraged.** The
imprecision is narrow: a table spanning several sources gets filed under one of
them. That is a mild accuracy nit with no downstream consumer —
`actingEntityId` is read by this checker, which only asks player-or-not, and by
nothing else.

**Recommendation reversed: do not tighten the prompt to force `_scenario`.**
It is correctly available for the genuinely ownerless roll — the quarantine
seal completing cleanly, the corridor lighting — and correctly unused when a
real actor owns the outcome. Zero uses in this run is not a failed edit; it is
four rolls that each had a better answer available.

What survives from the section above:

- **The measurement gap is real but smaller than implied.** The check cannot
  distinguish a well-attributed ambient roll from a lazily-attributed one. That
  is worth knowing and is not worth a structural check, because both are
  acceptable behaviour and neither is what the tag exists to catch.
- **The one shape worth watching** is a multi-source outcome table generally,
  independent of attribution — a roll whose bands span four different causes is
  harder to adjudicate and to replay than four narrower rolls would be. That is
  a `UNAUDITABLE-MAPPING`-adjacent observation, not a
  `SYSTEM-ROLLED-PLAYER-ACTION` one, and it is an observation rather than a
  proposed change.
