---
id: ADR-0113
title: 'The duplicate turn19/turn21 fixtures are kept as tripwires at `repOverride: 1`, not retired'
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  Two fixture pairs replay one turn each from identical seeded state, a leftover from
  before `ADR-0096` let one fixture carry two checks. Neither retiring them nor keeping
  them at full N is right: the behaviour they catch has been absent for seven runs but
  recurred once within a single day. `repOverride: 1` keeps the tripwire and its
  comparison history at a tenth of the cost.
---

## Context

`turn19-out-of-order-resolution` and `turn19-system-rolled-player-action` are the same
turn — sequence 82 of adventure `18be155e`, identical `playerInput`, and `seededState`
differing only in `capturedAt`, which is provenance and never read at eval time. The
turn21 pair is the same at sequence 95.

**They exist because selection used to be 1:1 with `tag`.** Covering two failure modes on
one turn required two files. `ADR-0096` removed that constraint, and the widening recorded
in `docs/eval-findings.md § S37` acted on it: both `-out-of-order-resolution` fixtures now
carry a `system-rolled-player-action` check. That makes each sibling's check set a **strict
subset** of its partner's — `{system-rolled-player-action, tool-syntax-leak}` against
`{out-of-order-resolution, system-rolled-player-action, tool-syntax-leak}` — on the same
turn, from the same seeded state.

**The duplication is real spend, not a filing quirk.** `eval-run.core.ts:350-391` seeds a
fresh scratch campaign per fixture per rep and calls `sessionService.sendMessage` for each,
with no memoisation on seeded state. Two fixtures with identical input are two independent
draws costing two Warden turns. At N=10 the two siblings cost 20 turns per full-corpus run.

## The evidence, and why it points both ways

Across all seventeen archived runs the two siblings have produced **28
`SYSTEM-ROLLED-PLAYER-ACTION` failures** — 19 on turn19, 9 on turn21. The behaviour is
real and both scenarios provoke it.

It has also been absent for a long time:

| Period | Failures |
|---|---|
| 2026-07-29 (Sonnet 4.6) | 14 / 17 |
| 2026-08-09 | 11 / 20 |
| 2026-08-10 → 08-16 | 3 across four runs |
| **2026-08-18 → 08-24, seven runs** | **0 / 134** |

**The recurrence pattern is what decides this.** On 2026-08-09 the fixtures were clean at
`14-37-36Z` and produced eleven failures at `21-23-39Z` — the same day. A behaviour that
can return within one day after a clean run is not settled by seven clean runs; it is
dormant. `§ A model swap audits the harness as much as the model` records the same shape
one level up: the 4.6 → Sonnet 5 swap surfaced defects no number of 4.6 runs could show.

## Decision

**`repOverride: 1` on `turn19-system-rolled-player-action` and
`turn21-system-rolled-player-action`.** They stay in the corpus, keep their ids, and run
once per full-corpus pass instead of ten times.

`repOverride` is consumed at `eval-run.core.ts:284` as
`Math.min(args.reps, fixture.repOverride)`, resolved into a map *before* the rep loop
begins, which is what makes "no adaptive mode" a structural property rather than a
promise. The mechanism already existed and was tested; nothing is built here.

**What this buys.** Cost falls from 20 Warden turns per run to 2. The fixture ids stay in
the corpus, so `eval:compare` keeps pairing them on `(fixtureId, checkId)` against every
archived run. And a regression that returns at anything like the historical rate meets a
live fixture rather than a deleted one.

**What it costs, stated plainly.** At N=1 a fixture's own rate is uninterpretable — one
rep is a tripwire, not a measurement, and anyone reading `SYSTEM-ROLLED-PLAYER-ACTION`'s
per-fixture breakdown must read these two rows as present-or-absent rather than as a rate.
The thin denominator is at least visible, because `ADR-0083` puts applicability beside
every rate.

## Alternatives considered

- **Keep both at full N.** 20 turns per run for a second draw on a behaviour with no live
  signal in 134 consecutive reps. The insurance is worth something; it is not worth ten
  times the cheapest version of itself.
- **Retire the two siblings.** The first instinct, and it discards two things that cost
  nothing to keep: the `(fixtureId, checkId)` pairing that lets `eval:compare` reach every
  archived run, and the tripwire. Retirement is right when a fixture is *measuring the
  harness* — `turn16-narrating-past-a-block`, `turn02-missing-canon-capture` — and these
  are not; they measure the Warden and have caught it 28 times.
- **Consolidate onto one fixture per turn.** Identical in effect to retiring, since the
  survivor would have to be the `-out-of-order-resolution` file — `out-of-order-resolution`
  is not tag-independent and can only reach a fixture carrying its tag — so the sibling's
  id is what disappears either way.
- **Retire them and rely on the `turn24-*` trio for this tag.** Rejected on the same
  evidence that motivated `ADR-0096`: a tag measured on a narrow set of scenarios is a
  claim about those scenarios. Nineteen of the 28 failures are on turn19, a scenario the
  `turn24-*` fixtures do not reproduce.

## Consequences

**This is a fourth kind of corpus bump, and `§ Two kinds of corpus bump` names three.**
Editing `repOverride` changes the fixture file, so `corpusVersion` moves — but no input
reaching the Warden changed, no grading of existing output changed, and no fixture was
added or removed. What changes is the **sample size going forward**. Frozen artifacts stay
exactly as valid as they were and `eval:rescore` is unaffected; future denominators shrink,
so a rate compared across this change needs the same like-for-like-on-shared-fixtures
treatment a set-membership bump needs. Worth adding to that section as a named kind rather
than left to be re-derived.

**The tripwire has to be read to work.** A fixture at N=1 contributes one row, and one row
among hundreds is easy to skim past. This is only insurance if someone looks at the
per-fixture breakdown after a run — which `ADR-0082`'s "a rate that never moves is a
harness suspect" already asks for, and which this decision now depends on.

**What would reverse it.** A single failure on either sibling means the behaviour is back
and the fixtures should return to full N to measure it. So would a model swap or a prompt
change touching roll ownership: this decision is calibrated on seven clean runs under one
model and one prompt family, and neither is a permanent condition.
