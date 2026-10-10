# Warden Eval — Findings Log

A running record of what the Warden eval harness has actually measured: run
diagnoses, tag coverage, checker defects, and the corpus decisions that follow
from them. Each entry says what was run, what came back, and what was concluded,
so the next reading starts from the last one's evidence.

**Relationship to the other documents.** `docs/eval-methodology.md` is *how to
run the harness* — rep allocation, corpus bumps, what a re-score is valid after.
This file is *what running it found*. The line between them is the one that
file's own header draws: methodology "as distinct from what it measures." A rule
you would apply to the next run belongs there; a number you got from the last one
belongs here. `docs/rules-extraction-findings.md` is the same kind of record for
the rules corpus — chunking, extraction, retrieval.

**Why the numbering starts at S37.** This file continues a section series that
began in `docs/rules-extraction-findings.md`, whose `§ S30`–`§ S36` are Warden
eval findings sitting in a file whose own header describes it as the empirical
record of "what has actually been tried against real rulebook PDFs." That drift
started 2026-08-09 with `§ S30` and was complete by `§ S34`: each entry followed
its predecessor into the wrong file because splitting a thread reads worse than
continuing one.

**Those sections stay where they are.** `docs/plans/014-turn19-roll-ownership.md`
cites `rules-extraction-findings.md § S30`, `§ S31` and `§ S32`;
`docs/plans/021-unauditable-mapping-roll-purpose.md` cites `§ S36`. Plans are
frozen — dated accounts of what was true when written — so rewriting those
citations is not available, and moving the sections would strand them. The break
is therefore forward-only: `§ S36` and earlier are found in the rules file,
`§ S37` and later here.

**The numbering is one namespace across two files**, deliberately. Restarting at
`S1` here would make `§ S12` ambiguous in every future citation, and the sections
are cited by number far more often than by title.

**How to add to this file.** Append a new dated section. Do not silently edit an
earlier one's numbers — supersede them with a new entry, so a wrong earlier
reading stays visible as something that was once believed. A section may be
amended in place to record that its own open item was later closed, which is what
`§ S37`'s "Fixed 2026-08-28" note is.

---

### S37 — 2026-08-27 · `SYSTEM-ROLLED-PLAYER-ACTION` attached to the two `-out-of-order-resolution` fixtures

`§ S35`'s "Still open" item, closed on the same evidence and by the same
mechanism. `turn19-out-of-order-resolution` and `turn21-out-of-order-resolution`
now carry a `system-rolled-player-action` `applicability` block, taking the check
from 8 fixtures to 10.

A **scoring-only** bump under `§ Two kinds of corpus bump`: two `applicability`
blocks, no `seededState`, `playerInput` or `assertion` touched, no
`fixtureSchemaVersion` moved (both fixtures were already v2, which is what
`requiresFixtureSchema` asks for). Every `warden-output.json` on disk remains
exactly as valid as it was.

#### One correction to `§ S34`'s citation

The ten occurrences are in the run `§ S34` compares **against**
(`claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z`, `§ S33`), not in the run it
reports. The reported run had six, all on `turn24-*`, which is exactly what
`§ S34` says — but "the baseline carries ten of them, including four on
`turn19-out-of-order-resolution`" has been read since as though both counts
belong to the same run. They do not, and the distinction matters here: the
fixture this entry attaches the check to shows nothing at all on the run
`§ S34` accepted.

#### Re-scored, after being predicted first

The two runs carrying failures were re-scored under the widened corpus
(`corpusVersion` `8ac47a8296f8`, `harnessVersion` `81575df`); rows are in each
run's `rescore/2026-08-27T18-0[67]-*.jsonl`. Both fixtures select only
structural checks, so the pass made **no Anthropic calls**.

| Run | As scored | Widened | New failures |
|---|---|---|---|
| `c45a142a` 12-18-32Z (`§ S33`) | 1.00 (20/20) | **0.93 (37/40)** | 3 reps, all `turn19` |
| `c45a142a` 19-45-15Z (`§ S34`) | 1.00 (20/20) | 1.00 (40/40) | none |
| `ccac7d1c` 12-38-30Z (M7.6) | 0.94 (47/50, re-scored) | **0.93 (65/70)** | 2 reps, all `turn19` |
| `e83e8aaa` 2026-08-24 (current) | 1.00 (79/79) | 1.00 (99/99) | none |

The middle two rows are recorded measurements; the first and last remain
predictions, computed by running the checker against the frozen artifacts
without writing rows, because both are all-passes and re-scoring them would pad
a denominator without answering anything.

**The prediction and the re-score agree exactly** — 7/3 on `turn19` and 10/0 on
`turn21` for `12-18-32Z`, 8/2 and 10/0 for `ccac7d1c`. That is worth one line
rather than none: the local prediction and the harness are the same checker over
the same files, so agreement proves nothing about the *rate*, but it does
establish that a scoped `--fixtures` re-score selects the checks the corpus edit
intended and no others.

A widened rate must not be read against a narrow-corpus one. `§ S35`'s treatment
applies: restrict per-tag movement to fixtures present on both sides before
reading it.

#### `§ S34`'s hand count reconciles, once the unit is watched

`§ S34` counted **four occurrences** on `turn19-out-of-order-resolution`; the
checker reports **three failing reps**. Both are right. Rep 004 of the
`12-18-32Z` run contains two system-generated rolls resolving Alvarez's declared
attack — the Combat to-hit at sequence 2 and the damage roll at sequence 3 —
and a structural checker returns one verdict per rep. Four rolls, three reps.

That agreement is the only evidence available that the attachment grades the
thing it was attached for, which is the test `§ S35` applied to the `turn24-*`
attachment and passed by a different route (there, six occurrences fell in six
distinct reps and the two numbers matched outright).

#### What it buys, stated honestly

**Denominator, not a rate.** The behaviour does not occur on the current
baseline: the widening adds 20 rows to `e83e8aaa` and all 20 pass. `turn21`
contributes no failures in any archived run and is denominator only.

That is the same shape `§ S35` recorded and worth restating rather than
re-deriving: widening a check's corpus is not a way to make a rate fall, it is a
way to make the rate mean the corpus. What changes is that `§ S34`'s four
hand-counted occurrences are now rows a future regression would surface without
anyone reading artifacts by hand.

#### A harness defect the re-score exposed: `sourceVerdict` on a check with no source row

Every row in both re-score files reports `sourceVerdict` equal to its own
`verdict` — including the `system-rolled-player-action` and `tool-syntax-leak`
rows, which the same pass warned had **no row in the source run**. The two
statements contradict each other, and the file is the one that survives.

The cause is at `scripts/eval-rescore.core.ts:417`:
`sourceVerdict: sourceRow?.verdict ?? observation.verdict`. The persisted schema
types the field `verdictSchema`, which is not nullable, so a check that was never
scored before is written as though it had been scored identically.

**The in-flight accounting is honest and only the record is not.** The progress
event at line 341 uses `sourceVerdict: sourceRow?.verdict ?? null` and sets
`changed: false` explicitly when there is no source row, so the CLI never prints
a false transition and the stderr warning names each affected row. Impact today
is bounded — nothing reads `sourceVerdict` back except that live line — but the
field's own doc comment states its purpose as "kept so a diff never needs both
files open", which is exactly the use it quietly breaks: a reader diffing the
file six months from now sees `pass → pass` for a check that had no prior
measurement at all.

This is the shape `ADR-0067` and `ADR-0078` both legislate against in other
places — an absent answer given a confident value rather than its own one.

**Fixed 2026-08-28.** `sourceVerdict` is nullable, `null` means there was no
source row, and the reasoning lives on `rescoreRowSchema.sourceVerdict` where
the next person to widen a check will read it. Two tests: the schema accepts
`null` and still parses the old shape, and a re-score whose universal check has
no source row records `null` rather than its own verdict — the second verified
by mutation, since it passes vacuously against a correct implementation and only
the old fallback distinguishes it.

**The two files this entry cites predate the fix** and carry the copied verdict.
Their verdicts are the measurement and are correct; only the source-side
bookkeeping is wrong, and it is wrong in the direction of claiming a prior
measurement that never happened. They were left as written rather than
re-generated: a second pair of files recording the same measurement would make
the archive harder to read than one documented quirk does.

#### Still open

`turn19-out-of-order-resolution` and `turn19-system-rolled-player-action` are the
same turn — identical `playerInput`, and `seededState` differing only in
`capturedAt`, which is provenance and never read at eval time. The turn21 pair is
the same at seq 95. Both pairs predate `ADR-0096`, when duplication was the only
way to cover two tags on one turn.

The obvious reading is waste — two Warden turns per rep for one scenario. The
opposite reading has better support: each fixture seeds its own scratch
adventure, so the pair is two independent draws, N=20 rather than N=10 for that
scenario, and `turn19` is the only scenario in the corpus that has ever produced
a `SYSTEM-ROLLED-PLAYER-ACTION` failure. Consolidating would halve the sample
exactly where the signal is. Recorded as a decision to make rather than work to
schedule.

---

### S38 — 2026-08-28 · Pre-registration: the corpus re-baseline, at an unchanged prompt

Written before the run, per `ADR-0085` and the convention `§ Bump note — 2026-08-23`
established. Recorded here rather than in `eval-methodology.md` because a
pre-registration becomes a record the moment the run lands — see `ADR-0116`.

#### The prompt half of this re-baseline is already bought

The task that prompted this entry describes a re-baseline for plan 021's
`roll_dice.purpose` change, "promptHash 6717347d to 995083c8, assemblyHash 6dc28608
to dc5fa663". Every one of those identities is behind the tree:

| | Task says | Actually |
|---|---|---|
| promptHash | → `995083c8` | **`e83e8aaa`** |
| assemblyHash | → `dc5fa663` | **`ada7fb8a`** |
| corpusVersion | `ead033182d6a` | **`c077bc456af7`** |

Plan 021's change has had **two** runs. `995083c8` (2026-08-23) stopped at 7 of 10
reps and read `UNAUDITABLE-MAPPING` 8/8 at applicability 8/36. `e83e8aaa`
(2026-08-24) ran all ten and read **9/10 at applicability 10/50** — the target off
0.00 with applicability unmoved at 0.20, so the pre-registered over-correction
falsifier did not fire. Commit `c3de56a` records the disposition: *"target held, and
the residual splits into two unrelated bugs."*

**So the run below is not plan 021's.** It is owed for the corpus, which has moved
several bumps since `e83e8aaa` and now contains fixtures no run has ever executed.

#### What this run is actually for

**Seven of 27 fixtures have never been run** — every `2c0ba938` capture, four
predating this batch and three from it. Three registered tags have therefore never
produced a single score row: `SEEDED-CANON-CONTRADICTION`,
`UNGROUNDED-CONTRACTOR-TARGET` and `UNREVERSED-RETCON`. `MISSING-CANON-CAPTURE`'s
two replacements are also unrun, and its previous fixture is retired (`ADR-0115`),
so that tag has no live measurement either.

Alongside them, four fixture-check pairs were widened onto existing artifacts
(`§ S37`, `ADR-0114`) and two fixtures were dialled to `repOverride: 1`
(`ADR-0113`).

#### The decision rule, in full

**No pre-existing fixture's input changed**, so this run's primary claim is a
negative one, and it is the falsifier:

> Every fixture that ran under `e83e8aaa` must reproduce its rate within one rep.
> A pre-existing fixture that moves is a **harness suspect first** — fixture schema
> v3, the widened check selection, or the sampling change — and Warden behaviour
> only after that is excluded. A corpus change audits the harness as much as it
> measures the Warden, which is `§ A model swap audits the harness as much as the
> model` one level down.

**Ship the new fixtures as measured if**, and only if:

- Each of the four first-time tags returns a **non-zero denominator**. A tag whose
  fixtures all report `not_applicable` has measured nothing, which is the
  `turn02` failure (`ADR-0115`) arriving in a new place, and it is a corpus defect
  rather than a result.
- **Applicability is read before every rate, and reported beside it.** A first-time
  tag reading 1.00 on applicability 0.10 has measured one turn, not a tag. This is
  the ticket's own falsifier generalised: a rate that looks good because the
  denominator collapsed is not a pass.
- `UNAUDITABLE-MAPPING` holds near **0.20 applicability**. It is the one tag with a
  pre-registered applicability expectation, and a collapse there means the Warden
  stopped making spontaneous rolls rather than started explaining them.

**Floors on the established tags**, unchanged from `6717347d`'s rule and expected to
hold trivially since nothing Warden-visible moved: `SYSTEM-ROLLED-PLAYER-ACTION`,
`UNSURFACED-CHECK`, `NARRATING-PAST-A-BLOCK` and `HIDDEN-INFO-LEAK` at ≥ 0.90. A
breach is evidence about the harness, not the prompt.

**Not gates**, and stated so they are not read as ones:

- `turn19-system-rolled-player-action` and `turn21-system-rolled-player-action` run
  at `repOverride: 1`. Their rows are tripwires — present or absent — and a single
  failure means the behaviour returned and they go back to full N (`ADR-0113`). A
  rate cannot be computed from one rep and must not be quoted as one.
- Tool-syntax emission, counted as abandoned turns ÷ (fixtures × reps) rather than
  off the `TOOL-SYNTAX-LEAK` check rate, which reads 1.00 whenever a leak abandons
  the turn (`ADR-0097` addendum 3).

#### Predictions, pre-registered

- Every pre-existing fixture reproduces `e83e8aaa` within one rep. **This is the
  one I most expect to be wrong**, and the reason to write it down.
- `UNREVERSED-RETCON` reaches a verdict on most reps: its gate excludes only a turn
  that produced no `gm_response`, and its fixture's player message forces the
  reveal.
- `SEEDED-CANON-CONTRADICTION` reads high with a full denominator. Its gate reports
  `not_applicable` only when the fixture seeds no `worldFacts`, and all three
  fixtures seed plenty — so a low applicability there would mean the gate is wrong.
- `MISSING-CANON-CAPTURE` reaches a verdict on both new fixtures, and `turn23`
  passes via the `worldFacts` diff — the branch that has never executed against
  real output in 157 reps. If it does not, the replacement failed the same way
  `turn02` did.
- `UNGROUNDED-CONTRACTOR-TARGET` has the weakest expectation: one fixture, and its
  gate needs a Contractor to roll. A zero denominator here is the least surprising
  and still needs saying so.

---

### S39 — 2026-08-28 · The corpus re-baseline: four tags measured for the first time, and one fails 8/8

`claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`. Full corpus, 10 reps, prompt
`e83e8aaa` and assembly `ada7fb8a` unmoved, corpus `f6186723bc49` →
`c077bc456af7`, harness `7482a78`. Scored against the rule pre-registered in
`§ S38`.

#### First numbers for the four tags that had never produced a row

| Tag | Rate | Applicability |
|---|---|---|
| `SEEDED-CANON-CONTRADICTION` | 0.87 (26/30) | 30/30 |
| `UNGROUNDED-CONTRACTOR-TARGET` | 1.00 (10/10) | 10/10 |
| `MISSING-CANON-CAPTURE` | 0.20 (3/15) | 15/17 |
| `UNREVERSED-RETCON` | **0.00 (0/8)** | 8/8 |

**Every one returned a non-zero denominator**, which was the rule's condition for
treating them as measured rather than as a corpus defect. Applicability is full or
near-full on all four — no rate here is bought by a collapsed denominator, which
was the ticket's original falsifier generalised.

#### `UNREVERSED-RETCON` fails every rep it reaches

Eight of eight, with two reps lost to errors. A 0.00 is a harness suspect under
`ADR-0082` before it is a finding, so the rationales were read rather than
assumed. They are grading the intended thing:

> The preceding turn narrated a failed Computers check … and committed two pieces
> of state because of that failure: (1) a +1 stress delta to Danny's stress pool
> for "failed Intellect+Computers check," bringing stress to 3 … This turn
> legitimately re-adjudicates the roll (48 vs 50 is indeed a success) … The
> question is whether the state committed *because of the failure outcome* was
> reversed or offset.

That is `ADR-0112`'s question asked correctly, and the Warden loses it every time.
The failure mode is **systematic, not occasional** — the strongest single result in
this run, and a stronger claim than the single playtest instance the tag was
registered on.

`MISSING-CANON-CAPTURE`'s fail-side fixture behaves the same way: `turn21` reads
0/5. Its pass-side sibling `turn23` reads 3/10, which is the better outcome — it
discriminates rather than sitting at the ceiling a pass-side fixture risks.

#### The falsifier fired, and only once in a way that matters

The rule said every pre-existing fixture must reproduce `e83e8aaa` within one rep,
and that a mover is a harness suspect before it is the Warden. Three shared pairs
moved, compared **like-for-like against the 08-24 re-score** rather than its
original rows:

| Pair | 08-24 | 08-28 | Mode |
|---|---|---|---|
| `5c34991b-turn07-missing-delta` | 7/10 | 5/10 | judged |
| `turn24-hidden-info-leak / hidden-info-leak` | 9/9 | 8/9 | judged |
| `turn24-hidden-info-leak / system-rolled-player-action` | 9/9 | **7/9** | **structural** |

**The like-for-like qualifier is load-bearing and nearly went wrong here.**
`SCENE-JUMP` on the 08-24 run reads 5/10 in `reps/` and **10/10 in `rescore/`**
under the disambiguated rubric `01a4288c` (`§ Bump note — 2026-08-24`). Compared
naively it shows 0.50 → 1.00, a spurious half-point gain; compared correctly it is
1.00 → 1.00, unchanged. The first pass of this analysis made that error and caught
it only by checking whether a re-score existed.

#### The one structural mover is the panic-check residual, not a new regression

Both failures are the Warden resolving the player's own Panic Check system-side —
rep 004 *"Alvarez Panic Check triggered by taking a serious wound mid-firefight"*,
rep 007 *"Panic Check triggered by taking a Lethal Injury wound"*.

This is the case `c3de56a` isolated in plan 021's second run, and **plan 022's
prompt fix for it shipped on 2026-08-23** — before both runs. The prompt now says
it outright: *"The player character's own Panic Check is theirs to roll and goes in
diceRequests … the trigger being something the world did to them does not make the
roll yours."*

So the fix is real and incomplete. `SYSTEM-ROLLED-PLAYER-ACTION` reads 0.97 (76/78)
here against 1.00 (79/79) on 08-24, under a byte-identical prompt — **08-24's clean
sweep was the optimistic tail**, the same shape `§ Tool-syntax emission: the
2026-08-18 figure was the optimistic tail` records for a different mitigation. Two
occurrences in ten reps is the honest current rate, not zero.

**The `repOverride: 1` tripwires did not fire**: `turn19-` and
`turn21-system-rolled-player-action` both pass their single rep. `ADR-0113`'s
reversal condition is therefore not met — and it is worth noting that the corpus
widening caught this where the tripwires could not, since the failures are on
`turn24-hidden-info-leak`, a fixture that carries the check only because `ADR-0096`
attached it there.

#### Predictions, scored

- **"Every pre-existing fixture reproduces within one rep" — wrong**, on three
  pairs. `§ S38` called this the prediction most likely to fail, which is the only
  reason it is legible as a result rather than a surprise.
- `UNREVERSED-RETCON` reaches a verdict on most reps — **confirmed**, 8/8.
- `SEEDED-CANON-CONTRADICTION` high with a full denominator — **confirmed**, 0.87
  on 30/30.
- `MISSING-CANON-CAPTURE` reaches a verdict on both new fixtures — **confirmed**;
  the sub-prediction that `turn23` would pass via the `worldFacts` diff was too
  strong at 3/10, and the weaker result is the better fixture.
- `UNGROUNDED-CONTRACTOR-TARGET` most likely to return a zero denominator —
  **wrong**, and comfortably: 10/10 at full applicability.

#### Also worth carrying forward

- **`OUT-OF-ORDER-RESOLUTION` now has a real denominator** — 33 rows across eight
  fixtures against two before (`ADR-0114`), reading 1.00 (33/33) at applicability
  33/58. The widening found nothing this run, which is not evidence against it: the
  29 historical violations it was attached on are in frozen artifacts, and a check
  that catches nothing on the run after it is attached is the ordinary case.
- **The two `2c0ba938-turn21-*` fixtures error at 2 and 3 of 10.** Every other new
  fixture errors zero times. Both replay sequence 64, so the shared cause is the
  turn rather than either tag, and it is unexplained.

---

### S40 — 2026-08-28 · The Haiku 4.5 control arm, dispositioned twelve days late: it settled one of its two checks and cannot settle the other

`claude-haiku-4-5-20251001__ccac7d1c__2026-08-16T13-24-26Z`. 3 reps, `--fixtures`
scoped to `turn19-out-of-order-resolution`, `turn21-out-of-order-resolution` and
`turn28-hidden-info-leak`, corpus `2cfaf351a760`, harness `9e5b9b5`, rubric
`4cf7fda1`. The rider `ADR-0023`'s first addendum scheduled onto M7.6's
re-baseline, run the same day as `claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z`.

**It has sat in `unicorn-artifacts` undispositioned since.** No findings doc named
it, and `task docs:baseline-check` could not catch that — the arm is not a baseline
candidate and the standing point has moved twice since. Recorded now because
`ADR-0082` and `ADR-0023` both still describe the arm in the future tense while its
result was on disk, and because the result is not the clean retirement either entry
anticipated.

**Read in one direction only**, per `ADR-0023`: a weak model *passing* a pinned
check is the finding. Haiku's rates are not a model comparison and are not reported
beside Sonnet 5's as though they were. The Sonnet 5 column below is the pinned rate
under test, not an opposing arm.

| Fixture / check | Sonnet 5, same day | Haiku 4.5 | What the arm established |
|---|---|---|---|
| `turn28-hidden-info-leak` | 1.00 (10/10) | **0.00 (0/3)**, App 1.00 | check discriminates — suspicion retired |
| `turn19-out-of-order-resolution` | 1.00 (9/9) | 1.00 (3/3), App 1.00 | **nothing** — passed on absence |
| `turn21-out-of-order-resolution` | 1.00 (10/10) | n/a, 3 `not_applicable` | **nothing** — never reached a verdict |

#### `turn28-hidden-info-leak` is a real finding, and the pinned 1.00 can be believed

Three fails from three reps, at full applicability, on a check that had read 1.00
across every Sonnet 5 run since the model swap. That is what the arm was built to
produce. Combined with the same fixture reading 0.67 (6/9) under 4.6 at prompt
`97feadbd`, the ceiling is behaviour rather than a blind checker.

**The fails are for the right reason, with one qualification.** `ADR-0023` warns
that a Haiku failure proves a check *can* move without proving it moved correctly.
The rationales grade the tag's actual question — exact roll totals, HP values and
stat thresholds narrated past the perception boundary:

> the Warden fully executed the charge as if committed, revealing exact roll totals
> (89, 64, 51, 79, 8, 88), specific damage numbers (3, 4, 3 damage), and precise HP
> values … the narration didn't just hint at danger, it narrated a full resolved
> combat sequence with concrete mechanical facts the character could not know from a
> pre-commitment hypothetical question.

The qualification is that **all three rationales share one root cause** — Haiku
treated *"How exposed would I be if I charged Gamma…"* as a committed action and
resolved it. So this is three reps of one failure mode, not three independent
observations, and the leak is downstream of an over-resolution failure that the
`--fixtures` scoping meant no `over-resolution` check saw. Sufficient for the
discrimination question, which asks only whether a `fail` is reachable; not a
characterisation of the check's fail surface.

**Graded under rubric `4cf7fda1`, superseded by `13305f34` on 2026-08-23**
(`§ Bump note`, the `HIDDEN-INFO-LEAK` scoping disambiguation). Judge-variance put
`turn28`'s Sonnet 5 output at 30/30 under both rubrics, so the pass side is
rubric-stable; the arm's fail side has never been re-scored under the current
rubric. Three judge calls would settle it and it is the only open item here.

#### `out-of-order-resolution` cannot be probed by a control arm at all

This is the half that matters, and it is a stronger claim than "N=3 was too thin."

**`turn19` passed 3/3 by rolling nothing.** All three reps issued one
`dice_request` for the player's Combat Check and stopped — `diceRolls: []`, zero
`dice_roll` events, one pending request at end of turn. The deferred-gate branch
asks whether any roll resolved ahead of the pending gate; with no rolls, the
answer is trivially no. The check's own doc comment anticipates the shape —
*"'No consequence rolled ahead of its gate' is satisfied by absence, so a turn
that rolls nothing satisfies it trivially"* — and the guard it describes requires
*a pending gating request*, which Haiku produced. The hole is one step narrower
than the guard: **request present, rolls absent, automatic pass, applicability
1.00**. The healthiest-looking row in the report is the one that measured nothing.

**`turn21` never reached a verdict.** All three reps rolled — 5, 6 and 6 rolls —
left no request pending, and **named no `gatedByRollId` on any of them**, so the
in-turn branch returned `not_applicable` on all three: *"no dice_request is pending
at the end of this turn, and none of the 5 roll(s) resolved in-turn names a
gatedByRollId."*

Put together: the in-turn fail direction is reachable **only when the model under
test populates `gatedByRollId`**, and a weaker model is precisely the one that
won't. The instrument and its target are anti-correlated. A control arm can widen
the applicability gap it was meant to close, and no increase in N fixes it — a
model that never fills the field never produces a gradeable turn.

So `turn19` and `turn21-out-of-order-resolution` **remain harness suspects under
`ADR-0082`**, and the arm is retired as an instrument for them rather than
returning an inconclusive result to be re-run. `§ S39` widened the check to 33 rows
across eight fixtures and it still reads 1.00 (33/33) — a bigger denominator on the
same unexercised fail direction. Only M7.8's known-answer pairs, which supply
`gatedByRollId` by hand instead of hoping a generator emits it, can close this.

#### What this changes about the arm

`ADR-0023` scheduled the arm against "the fixtures carrying those two checks" as
though the two were equivalent targets. They are not, and the distinguishing
property is stateable in advance: **an arm can probe a check whose fail direction
depends only on what the model narrates; it cannot probe one whose fail direction
depends on the model populating a structural field the check reads.** The rule is
recorded in `docs/eval-methodology.md § A model swap audits the harness as much as
the model`; the dispositions are recorded in `ADR-0023` and `ADR-0082`.

---

### S41 — 2026-08-29 · Pre-registration: `UNAUDITABLE-MAPPING` widened from one fixture to four

Written before the run, per `ADR-0085` and `ADR-0116`. Plan:
`docs/plans/023-widen-unauditable-mapping-coverage.md`. Corpus `c077bc456af7`
→ `6bc7eee3970f`, a set-membership bump whose note is in
`docs/eval-methodology.md § Bump note — 2026-08-29`.

#### What was actually carrying the tag

On the standing point `claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`, the
tag reads **1.00 (10/10) at applicability 10/50**, and the per-fixture
breakdown says why that number is worth less than it looks:

| Fixture | Verdicts | `dice_roll` events per rep |
|---|---|---|
| `5c34991b-turn01-unauditable-mapping` | pass 10/10 | 1 |
| `5c34991b-turn09-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn01-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn03-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn14-unauditable-mapping` | `not_applicable` 9, error 1 | 0 |

Every exclusion is the honest `no dice_roll events this turn` branch, not the
classifier blind spot. Four of five fixtures produce **zero** rolls on every
rep, which the checker's own comment predicted: the no-rolls branch fires
"11 times, all under Sonnet 5, which rolls far less than 4.6 on these
fixtures."

That is the fact this widening has to survive. **Applicability is a property of
the re-run turn, not of the fixture** — the gate reads the Warden's fresh
output, so a captured turn only invites a spontaneous roll and cannot guarantee
one.

#### The four additions

Three pass-direction turns from the 2026-08-24 playtest, annotated
`FIXTURE-CANDIDATE-PASS` in its report, plus one tripwire from 2026-08-16. All
four candidate rolls were checked against `isSpontaneousGmRoll` on the live
rows before capture — every one is `system_generated`, single die,
`modifier: 0`, no `requestId`, so the gate passes them to the judge.

**The 2026-08-24 playtest ran under prompt `e83e8aaa`** — the current one. The
three pass candidates are therefore the shipped 021 instruction working on
turns no fixture covered, not an older Warden's luck, and they will re-run
under the prompt that produced them.

#### The decision rule

**The falsifier: a new fixture that returns `not_applicable` on most reps has
bought paper denominator.** That is `turn02` (`ADR-0115`) arriving in a new
place — a corpus defect, not a result — and the fixture should be re-authored
against a turn that forces the roll rather than left to pad an exclusions
table.

**A rate is not readable here without its applicability beside it**, and the
rollup is not readable at all as a movement: three of the four additions are
pass-direction and the fourth is a fixed defect, so both numbers move for
reasons unrelated to Warden behaviour. Like-for-like is `5c34991b-turn01`
alone.

**Floors, unchanged and expected to hold trivially** since nothing
Warden-visible moved: `SYSTEM-ROLLED-PLAYER-ACTION`, `UNSURFACED-CHECK`,
`NARRATING-PAST-A-BLOCK` and `HIDDEN-INFO-LEAK` at ≥ 0.90. A breach is evidence
about the harness, not the prompt.

#### Predictions, pre-registered

- **Turn 25 is the likeliest of the three to return `not_applicable`.** Its
  roll is the Warden's own initiative on a casual conversational beat — Danny
  feeling Teo out in the mess hall — and it is the easiest of the four to skip
  entirely. **This is the one I most expect to be wrong about**, in the sense
  that I expect it to be the one that fails to apply.
- **Turn 51 is the likeliest to apply**, and to contribute two graded rolls
  rather than one. The player declares nothing (*"I wait for word from Reyes
  and Petrov"*), so the whole turn is off-screen NPC work the Warden must
  resolve by die or hand-wave. Its second roll is contingent on the first
  failing, so a rep where the repair succeeds grades one roll, and the graded
  set varies between reps by design.
- **The three pass candidates pass where they apply.** They were produced under
  this exact prompt, so a fail is a rubric or renderer problem before it is a
  Warden one.
- **Turn 44 passes.** It failed under `ccac7d1c`; a fail now means 021's fix
  does not hold on an assessment-shaped roll, where the Warden is asked for an
  NPC's judgement rather than a reaction. That would be a finding, and the
  reason this fixture is worth its rep budget.
- **Applicability rises materially above 0.20 without the rate falling below
  0.90.** The null result is the opposite pairing: a rate still reading 1.00
  because the new fixtures all sat at `not_applicable` and `5c34991b-turn01`
  went on carrying the tag alone.

#### Not gates, stated so they are not read as ones

- **The `judgeContext` golden.** `unauditableMappingJudgeContext` now has a
  committed golden, closing the `ADR-0105` gap `ungrounded-contractor-target`'s
  spec named when it opened the pattern. It guards what the judge reads against
  silent edits; it is test-side, moves no hash, and predicts nothing about this
  run.
- **The tag has no live fail direction after this bump**, and no capture can
  give it one — see the bump note for the demonstration. `5c34991b-turn44` is a
  tripwire, not a fail-side fixture, and its passing is the expected outcome
  rather than a missing signal. The fail side is frozen on disk and belongs to
  M7.8.
- **Both tag-independent checks gain four rows per rep**, because
  `selectChecksForFixture` selects on a block being present rather than on
  `applies` being true. Seven of the eight new blocks are `applies: false` and
  are exclusion rows by construction, kept so they surface in the report's
  `fixture-gated-never-applies` finding. Neither rate moves; both
  applicabilities do, so the ≥ 0.90 floor on `SYSTEM-ROLLED-PLAYER-ACTION`
  should be read against its rate and not against a shifted denominator.
- **The one gradeable addition is `OUT-OF-ORDER-RESOLUTION` on
  `2c0ba938-turn51`**, taking it from eight fixtures to nine that can reach a
  verdict. It carries `applies: true` on the argument
  that it is the corpus's only genuine two-stage chain and that check's in-turn
  branch has never had material — 1.00 (33/33) in `§ S39`, and `§ S40` showed
  its fail direction needs the model to populate `gatedByRollId`. **The
  prediction is a pass**, because the source turn ordered the two rolls
  correctly; a fail would mean the Warden reversed a chain it previously got
  right, which is a finding rather than a widening artefact. **The row worth
  reading is neither the rate nor the verdict but the exclusion reason**: if it
  comes back `no pending dice_request and no in-turn roll declares a gate`, the
  Warden did not emit `gatedByRollId` on a turn practically built to invite it,
  and the check's fail direction stays unexercised on the corpus's best
  candidate for it. That would be the strongest evidence yet for `§ S40`'s
  conclusion that only M7.8's known-answer pairs can close it.

#### Addendum, 2026-08-31 — this pre-registration will be scored against a corpus whose `ship_layout` has been restructured, and it is held valid across that

All four fixtures this entry adds — `2c0ba938-turn25/45/51-unauditable-mapping`
and `5c34991b-turn44-unauditable-mapping` — carry `worldFacts.ship_layout`, and
`§ S42` restructures it from prose into a deck-indexed list on all 18 fixtures
that hold it. That is an **input-affecting** bump. None of the four has executed
yet, and `§ S42`'s two runs are scoped away from them, so the run that finally
scores this entry will be the post-playtest full re-baseline — which lands
**after** the restructure. Strictly, these fixtures will not be the fixtures the
predictions above were written against.

**Held valid, on a stated argument rather than by omission.** Every prediction
here turns on whether the Warden takes a spontaneous roll and whether its
`purpose` states the outcome mapping before the die fires. Neither is a question
about the layout fact: `isSpontaneousGmRoll` reads `system_generated`, die count,
`modifier` and `requestId`, and the rubric grades the roll's own stated mapping.
The form of a `worldFacts` entry the roll does not consult is not plausibly
load-bearing on either.

**What the scorer owes anyway.** Say in the write-up that the seeded
`ship_layout` differs in form from what this entry was written against, and treat
an **applicability** surprise — a fixture returning `not_applicable` where it was
predicted to apply, or the reverse — as possibly restructure-induced before
concluding anything about Warden initiative. Applicability is the axis a longer,
more legible prompt block could move without touching roll discipline at all, and
it is the axis every prediction above is read through.

**The cheaper alternative was declined, and why.** Scoring `§ S41` first would
mean buying a full-corpus run before the restructure, which is the spend `§ S42`
exists to avoid. Recorded here so the choice is visible as a choice.

#### Second addendum, 2026-08-31 — a second Warden-visible change now lands before this is scored, and the run that scores it is named

The addendum above held this pre-registration valid across one change to its
fixtures' seeded state. **Two more are now scheduled ahead of the run**, both in
M7.7 before the next playtest, and the held-valid argument does not extend to
both on the same terms.

- **Synthesis schema field descriptions, and `narrative.location` renamed.**
  Invisible to this entry either way: no eval command exercises synthesis, and if
  the rename is taken as a full field rename it moves `gmContextBlob.narrative`
  on every fixture without touching a roll, a `purpose` string, or anything
  `isSpontaneousGmRoll` reads. **Held valid**, on the same reasoning as the
  restructure.
- **`current_location` written by the Warden through `stateChanges`.** **Not held
  valid on the same terms, and this is the one to watch.** It is a tool-schema
  change, so it moves `promptHash`/`assemblyHash`, and unlike a layout label it
  adds a field the Warden writes *during the turn*. Every prediction here is
  about whether the Warden takes a spontaneous roll and whether its `purpose`
  states the mapping before the die fires — both properties of what the Warden
  does mid-turn, which is exactly the surface a new `stateChanges` field touches.
  A plausible mechanism exists in both directions: another required write could
  crowd out roll narration, or the extra structure could sharpen it.

**The run that scores this entry is therefore named in advance**: the
**re-baseline that `current_location` owes before the playtest capture**, which
M7.7's own sequencing rule requires — a Warden-visible change ahead of a capture
gets a re-baseline first, settled 2026-08-23 for plan 021 and the same shape
here. Folding the two saves a run, exactly as `§ S38`'s re-baseline covered plan
021 and the 2026-08-23 bump together.

**What that costs this entry, stated rather than discovered.** Its four fixtures
will run for the first time under a prompt and tool schema that have both moved
since the prediction was written, so **a miss is not attributable to the Warden
behaviour the prediction is about**. The falsifier survives — a fixture returning
`not_applicable` on most reps is still a corpus defect rather than a result,
because applicability gates on whether a roll happened at all — but the
*direction* predictions (turn 25 likeliest to be excluded, turn 51 likeliest to
grade two rolls) become weak claims about a Warden that has changed underneath
them.

**Two ways out, and the choice is open.** Score this entry on a run taken
*before* `current_location` lands — an extra full-corpus pass, which is the spend
the first addendum declined — or accept the confound and say so in the write-up.
**Recommended: accept it**, on the grounds that these predictions were always
about applicability rather than rate, applicability is the axis least likely to
move for a schema addition, and `§ S44` has just demonstrated what buying an
underpowered run to attribute a modest change actually returns.

**What is not open** is discovering this while scoring. `§ S44` records a
pre-registration that named a direction and no test and could not return an
answer; this is the same failure one stage earlier — a prediction whose subject
moved between writing and scoring, unnoted. It is noted.

#### Third addendum, 2026-10-04 — closed unscored: the run that would have scored this is no longer planned

**None of the five predictions was tested.** The four added fixtures —
`2c0ba938-turn25/45/51-unauditable-mapping` and
`5c34991b-turn44-unauditable-mapping` — appear in no run under
`$ZOLTAR_EVAL_ROOT/eval-runs`, checked 2026-10-04 by searching every run's score
rows and directory names. Both later runs were scoped to other fixtures (`§ S43`,
`§ S44`).

**Why no run will score it.** Scoring needs a full-corpus `eval:run`, and the
M7.7 triage of 2026-10-04 dropped it: M7.4 is closed and the eval work moved to
the rebuilt harness (`docs/roadmap.md` M7.9). The second addendum's open choice
is moot for the same reason — `current_location` is no longer scheduled on this
harness.

**What this leaves standing.** The fixtures stay in the corpus, never executed.
`UNAUDITABLE-MAPPING`'s last measured figure is still the one this entry opened
with, 1.00 (10/10) at applicability 10/50 from a single fixture, and the reason
this entry gave for distrusting that number has not been answered. This is a
pre-registration with no result, not one that was confirmed or falsified.

---

### S42 — 2026-08-31 · Pre-registration: `worldFacts.ship_layout` restructured from prose into a deck-indexed list

Written before either run, per `ADR-0085`, `ADR-0116`, and `ADR-0104`'s standing
requirement that this particular prediction be written first — *"a prediction too
loose to be violated makes category-2 attribution unreachable by construction."*
Reasoning for the intervention is in the `ADR-0101` addendum, 2026-08-25.

#### The intervention

`ship_layout` is a single ~700-character prose run carrying roughly fifteen
spatial facts with no deck list and no adjacency, and it renders verbatim in
every snapshot of both playtest adventures. The restructure makes it a
deck-indexed list, decks numbered from the top down, with the vertical connector
stated separately. **Form only** — no schema change, no migration, no write path,
and no spatial fact added or removed. The synthesis prompt's worked example moves
with it, so the next adventure generates the new shape rather than regenerating
the old one.

It touches **18 of 31 fixtures** across both adventures: the `2c0ba938`
*Halbrecht* and the `5c34991b` *Halberd's Grief*, which carry different ships in
the identical prose form. That makes it an **input-affecting** corpus bump for
all 18 — every frozen `warden-output.json` for them stops being evidence.

#### What is actually carrying the tag

`SEEDED-CANON-CONTRADICTION` reads 0.87 (26/30) at applicability 30/30 on the
standing point `claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`. The per-fixture
breakdown is the reason this pre-registration is written per-fixture and not
against the rollup:

| Fixture | Direction | Verdicts | Referent |
|---|---|---|---|
| `2c0ba938-turn08-seeded-canon-contradiction` | fail | pass 9, fail 1 | `ship_layout` |
| `2c0ba938-turn14-seeded-canon-contradiction` | fail | pass 7, fail 3 | `ship_layout` |
| `2c0ba938-turn29-seeded-canon-contradiction` | pass | pass 10, fail 0 | `ship_layout` |

**Four failures, three of them on one fixture.** `turn29` is pinned at 1.00,
which is the `ADR-0082` shape and expected of a pass-direction fixture.
`turn08` was captured as fail-direction and now passes 9/10 — the same
self-healing `§ S41` records for `5c34991b-turn01`, which went fail 10/10 →
pass 10/10 from byte-identical seeded state across a prompt change.

A perfect intervention therefore moves the rollup 0.87 → 1.00 by removing four
failures, against judged run-to-run variance `§ S39` measured at 2/10 on a
byte-identical prompt. **The existing corpus cannot detect this intervention**,
which is why two fixtures are captured first.

#### Two captures, checked against the database before capture

Both are turns `ADR-0104` named as further fail-direction instances and neither
was ever captured — the 2026-08-28 run carried turns 08, 14, 15, 21 ×2, 23 and
29 from this adventure and nothing else.

| Turn | `sourceSequenceNumber` | `gm_response` | Contradicts |
|---|---|---|---|
| 18 | 53 | 55 | `ship_layout` — *"You head back down to the lower deck … and rap a knuckle against Mara's hatch"*; berths are mid |
| 24 | 73 | 74 | `crew_roster` — *"he's two decks from the engine room"*; the roster puts Petrov in it |

**Turn 24 is gradeable, and that was not safe to assume.** `crew_roster` is
written at **seq 72, during turn 23**, so it is resident in turn 24's seed at seq
73. Had it been written by turn 24 itself there would have been nothing to
contradict and every rep would have returned `not_applicable` — `turn02`
(`ADR-0115`) arriving in a new place. Verified against `game_event` rather than
inferred.

**Turn 19 carries no deck claim**, confirming `ADR-0104`'s addendum correction
against the database rather than against the report that first got it wrong.

#### Why two scoped runs rather than two full ones

**Half the "before" already exists.** Turns 08, 14 and 29 have valid
pre-restructure artifacts at `promptHash e83e8aaa` / `assemblyHash ada7fb8a`,
both unmoved since, and the only corpus movement since was set-membership, which
leaves survivors' artifacts intact. So run A needs to cover only the two new
fixtures.

- **Run A** — scoped to `turn18` and `turn24`. Establishes their pre-restructure
  rates. Baseline only, no comparison.
- **Run B** — scoped to turns 08, 14, 18, 24 and 29, plus two or three
  `ship_layout`-carrying fixtures with other tags as a side-effect tripwire.

`§ S41` declined a scoped run on the grounds that its result would not be
decision-bearing on its own; that reasoning is specific to pass-direction
fixtures and does not carry here, where the run is a deliberate before/after on
fail-direction ones. **Spend the saving on reps rather than fixtures:** the
constraint is four failures, not thirty fixtures, and 20–30 reps on five fixtures
costs a fraction of one full-corpus pass.

**What the scoping gives up, stated so it is not discovered later.** The
restructure changes seeded state that *every* check on those 18 fixtures reads.
A scoped run says nothing about whether it moved `UNAUDITABLE-MAPPING`,
`SYSTEM-ROLLED-PLAYER-ACTION`, `MISSING-DELTA` or anything else on the thirteen
fixtures it does not run. That question is answered at the post-playtest full
re-baseline, **confounded** with whatever else rides that run — the `ccac7d1c`
shape, accepted deliberately here rather than by omission.

**Neither run is a baseline candidate, and `baseline-check` will ask for both
anyway.** ~~Both runs are invisible to `baseline-check`.~~ **Corrected
2026-08-31**, before either was read: the check enumerates every directory under
`eval-runs` carrying a `manifest.json`, which a `--fixtures`-scoped run writes
like any other, so it does see them. What it cannot do is tell a rider run from a
baseline candidate, or tell a real disposition from a bare mention of the run id.
Each therefore needs a genuine disposition in `docs/eval-methodology.md § Current
baseline N` — naming it alone will satisfy the tool and record nothing. See that
file's correction under **What `baseline-check` does not check**, which is where
this error originated.

#### The decision rule

**Read per-fixture. The rollup is not readable at all** — the denominator moves
between run A and run B by construction, and a set-membership bump plus an
input-affecting bump ride the same comparison.

- **Treatment** — referent is `ship_layout`: `turn14`, `turn18`, `turn08`.
- **Control** — referent is `crew_roster`: `turn24`.
- **Ceiling** — pass-direction, pinned: `turn29`.

**The falsifier: `turn14` does not improve, or `turn24` improves as much as the
treatment fixtures.** The second is the one that matters. A uniform lift across
treatment and control is not a deck-lookup fix; it is a general legibility effect
or noise, and reporting it as the former would be the category-2 error
`ADR-0104` wrote this pre-registration to prevent.

#### Predictions, pre-registered

- **`turn14` improves by at least 2 reps, normalised to N.** It carries three of
  the four known failures and is the clearest treatment case. **This is the one I
  expect to carry the result**, and if it does not move, the intervention has
  failed on its best available evidence.
- **`turn18` improves against its run A baseline.** With the caveat that voids
  it: **if run A shows `turn18` already passing ≥ 90%, the prediction is void and
  the fixture is a tripwire rather than evidence.** It was captured from a
  pre-fix playtest and may have self-healed the way `5c34991b-turn01` did — which
  is a finding about prompt drift, not about this restructure.
- **`turn24` does not improve by more than one rep.** Stated as *not materially*
  rather than *not at all*, because the claim is a distance claim whose endpoints
  are located by two different facts — `crew_roster` puts Petrov in the engine
  room, `ship_layout` puts the engine room on the lower deck — so the restructure
  can touch it at the margin. The contradiction being graded is that Petrov is in
  the room he is said to be two decks from, which is `crew_roster` alone.
- **`turn29` stays at or near 1.00.** A drop is a harness suspect before it is a
  regression (`ADR-0082`), and a pass-direction fixture at the ceiling predicts
  nothing either way.
- **Applicability stays at 1.00 across all five.** The gate returns
  `not_applicable` only when a fixture seeds no `worldFacts`; all five seed
  plenty, so any exclusion here is a gate defect rather than a result.

#### Not gates, stated so they are not read as ones

- **The deck numbering runs top-down** (`DECK 1` upper, `DECK 3` lower), which
  **inverts the `5c34991b` station convention** already in the corpus, where
  `station_spatial_layout` numbers `DECK 0` lower and `DECK 1` upper. Those
  fixtures are out of scope and keep their convention, so the corpus will carry
  both. Each fact states its own convention, so this is survivable — but the
  synthesis prompt now states the top-down rule explicitly, because otherwise
  generation coin-flips it per adventure.
- **`station_spatial_layout` is the model, not an invention.** It is
  synthesis-generated, already deck-indexed with adjacency chains and an explicit
  distance fact, and produced by the same prompt that produced the Halbrecht
  paragraph. The variance is in generation, not in the instruction's ceiling —
  which is why the prompt's worked example is being tightened rather than its
  instruction rewritten.
- **No within-deck adjacency is added.** The station fact chains rooms with `→`
  because its source prose establishes a corridor order; nothing in the Halbrecht
  prose does, so arrows here would invent canon the fixture never had. That would
  be a change to the seeded facts, not to their form, and the whole claim of this
  intervention is that it is form-only.
- **No Warden prompt clause rides along.** The Warden prompt contains no
  occurrence of `worldFacts`, `layout`, `spatial` or `deck`, so the restructure
  improves the form of data the Warden is never instructed to consult. Adding
  that instruction would move `promptHash` and make run B attribute two changes
  at once. If the restructure underperforms, the clause is the obvious second
  arm.
- **`gm_context.narrative.location` is not renamed here.** `ADR-0101`'s addendum
  calls the rename "secondary and unblocked", but there is an
  `assembly-golden/gm-context.txt`, so it moves `assemblyHash` and is a second
  Warden-visible change. Worth doing, not on this run.

---

### S43 — 2026-08-31 · Run A: `turn18` fails 13 of 20, and the corpus can now measure the restructure

`claude-sonnet-5__e83e8aaa__2026-08-31T13-18-04Z`. Scoped rider run, 20 reps,
both fixtures on every rep. `promptHash e83e8aaa`, `assemblyHash ada7fb8a`,
corpus `301302000143`, harness `6dffa38`, `rubricHash b089ac3d`,
`judgeContractHash 01620ef7`, temperature 1. Scored against `§ S42`.

#### Results

| Fixture | Rate | Applicability | Notes |
|---|---|---|---|
| `2c0ba938-turn18-seeded-canon-contradiction` | **0.35 (7/20)** | 20/20 | fail-direction, `ship_layout` |
| `2c0ba938-turn24-seeded-canon-contradiction` | **0.89 (16/18)** | 18/18 | control, `crew_roster`; 2 reps lost to a tool-syntax leak |

**The capture did what it was for.** `turn18` alone contributes **13 failures at
N=20**, against **four** across the whole of the pre-existing three-fixture set.
The measurement that `§ S42` called close to unfalsifiable now has headroom.

#### Predictions, scored

- **`turn18`'s void condition did not fire.** `§ S42` said that if `turn18`
  passed ≥ 90% it was a tripwire rather than evidence — the `5c34991b-turn01`
  self-healing pattern. It reads 0.35. It has not self-healed, and it is the
  strongest fail-direction fixture this tag has ever had.
- **Applicability is full on both** — 20/20 and 18/18. The falsifier ("a fixture
  returning `not_applicable` on most reps is a corpus defect, not a result") did
  not fire, so both captures are measuring rather than padding an exclusions
  table. The `turn02` risk on `turn24` is now settled by observation as well as
  by the seeded-state check that preceded the capture.
- **The two `applies: false` blocks behaved as authored.** `out-of-order-resolution`
  and `system-rolled-player-action` return `not_applicable` on every rep of both
  fixtures — exclusion rows by construction, surfacing in
  `fixture-gated-never-applies` rather than moving any rate.

#### `turn24` is a weaker control than the pre-registration assumed, and this is the finding that changes run B

`§ S42` set `turn24` up as a negative control: its referent is `crew_roster`,
which the restructure does not touch, so a lift there as large as the treatment
fixtures' would mean the effect is not deck-lookup-specific.

**At 0.89 it has two failures of headroom.** It can move at most 2 reps in the
predicted-null direction, so it cannot distinguish "no effect" from "small
effect", and it detects only a *large* uniform lift. That is still the failure
mode worth guarding against, so the control is not worthless — but it is
low-resolution, and quoting it as a clean null would overstate it.

This is `turn08` again. Both were captured as fail-direction instances from the
2026-08-24 playtest and both now mostly pass under `e83e8aaa` — the pattern
`§ S41` recorded for `5c34991b-turn01`, arriving twice more. **A turn captured
from a pre-fix playtest is a pass-direction fixture in waiting**, and `turn18`
is notable for being the exception rather than for being typical.

Revised reading for run B, per-fixture as `§ S42` requires:

| Role | Fixture | Pre-restructure | Headroom |
|---|---|---|---|
| Treatment | `turn18` | 7/20 | 13 |
| Treatment | `turn14` | 7/10 | 3 |
| Control | `turn24` | 16/18 | 2 |
| Ceiling | `turn08` | 9/10 | 1 |
| Ceiling | `turn29` | 10/10 | 0 |

**`turn18` now carries the experiment.** If the restructure works, it shows
there or nowhere.

#### The failures are the right failures, and there are two distinct kinds

A 0.35 is low enough to read the rationales rather than assume them (`ADR-0082`).
They grade the intended thing, and they split:

> The narration states Danny "head[s] back down to the lower deck" to knock on
> Mara's hatch. According to the seeded `ship_layout`, crew berths … are located
> on the MID deck, not the lower deck.

That is the captured instance. But rep 020 **clears** the berth claim and fails
on a different one — the Warden places the cryo bay bulkhead *"a few decks up"*
from mid-deck berths, when `ship_layout` puts the cryo bay on the mid deck too.
The rationale explicitly tests the rubric's both-endpoints-seeded requirement
before grading it, and passes that test correctly.

So the fixture catches `ship_layout` deck contradictions **generally**, not only
the one it was captured for. Both kinds are the class the restructure targets,
which is the right outcome — but it means a post-restructure improvement cannot
be attributed to fixing the captured instance specifically without reading the
rationales again on run B.

#### Tool-syntax emission is elevated on a small sample, and both leaks are on one fixture

Counted per `§ S38`'s convention — abandoned turns ÷ (fixtures × reps) — this run
reads **2/40 = 5.0%** against the standing ~1.36% per turn. **Corrected in `§ S45`: that comparison is all-errors against a leak-only comparator. Leak-only this run is also 2/40 = 5.00%, and the elevation is a corpus-composition artefact rather than a rate change.** Both abandoned turns
are `turn24` reps (012 and 014), none on `turn18`.

**These are not the unexplained turn-level errors `§ S39` recorded** on the two
`2c0ba938-turn21-*` fixtures, which shared a replayed sequence and no diagnosed
cause. These carry a diagnosis in the error message: `submit_gm_response` leaked
tool-call syntax twice in a row and the guard abandoned the turn — working as
designed, ahead of persistence. Every check on those two reps errors together,
which is the turn dying rather than four independent failures.

At n=40 this does not establish a regression; 2 events cannot separate an
elevated rate from ordinary variance around 1.36%. Recorded so the next run has
a prior, and because a concentration on one fixture is the shape worth watching.

#### Disposition

Not a baseline candidate. Dispositioned by hand in
`docs/eval-methodology.md § Current baseline N`. The standing point remains
`claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`.

**And it corrected a claim this experiment had been repeating.** `§ S42` said a
`--fixtures`-scoped run is invisible to `baseline-check`. It is not: the check
enumerates every run directory carrying a `manifest.json`, and this run
demonstrated it — the tool went from "0 newer run(s)" to "1 newer run(s), all
accounted for" once the run landed and was named. The real gap is that naming a
run id in a list satisfies the check whether or not anything was read, and that a
rider run is indistinguishable from a baseline candidate to it. Both the
methodology bullet this was taken from and `§ S42` are corrected in place; the
M7.8 item stands on the narrower statement.

---

### S44 — 2026-08-31 · Run B: the restructure is unmeasured, and the only significant number in either run is an error rate that predates it

`claude-sonnet-5__e83e8aaa__2026-08-31T15-19-08Z`. Scoped rider run, 8 fixtures,
20 reps, 20/20 completed. `promptHash e83e8aaa` and `assemblyHash ada7fb8a`
unmoved, corpus `d651cec51ad7` (post-restructure). Scored against `§ S42`,
against run A (`§ S43`) for the two new fixtures and the 2026-08-28 standing
point for the rest.

#### Results, and the test `§ S42` should have specified

| Fixture | Role | Before | After | Fisher *p* |
|---|---|---|---|---|
| `turn18` | treatment | 7/20 | 10/20 | 0.52 |
| `turn14` | treatment | 7/10 | 17/19 | 0.31 |
| `turn08` | treatment | 9/10 | 13/18 | 0.38 |
| `turn24` | **control** | 16/18 | 15/18 | 1.00 |
| `turn29` | ceiling | 10/10 | 14/16 | 0.51 |
| `5c34991b-turn01` | tripwire | 10/10 | 18/20 | 0.54 |
| `2c0ba938-turn15` | tripwire | 10/10 | 19/20 | — |
| `5c34991b-turn10` | tripwire | 10/10 | 19/19 | — |

**Not one per-fixture movement is distinguishable from sampling noise.** Every
comparison the pre-registration named returns *p* ≥ 0.31. **The intervention is
unmeasured — not confirmed, not refuted**, and no category call is available
from this run.

**`§ S42` pre-registered a direction and a magnitude but no test**, which is the
defect this entry exists to record. "Improves by at least 2 reps" is satisfiable
by noise at these denominators, and the decision rule said to read per-fixture —
which is correct for avoiding a denominator artefact and is exactly what strips
the power. Both halves were reasonable and together they produced a rule that
could not return an answer. **A pre-registration that names a comparison should
name the test and the N that makes it decidable**, or say plainly that the run
is descriptive.

**Pooling the two treatment fixtures with headroom** — `turn18` and `turn14`,
14/30 → 27/39 — gives *p* = 0.084. **Not pre-registered, and not a result.**
Recorded because it is the only reading under which this run points anywhere,
and because inventing the pooling *after* seeing the numbers is precisely the
move `§ S42` existed to prevent. It is a reason to run more reps, not a finding.

**What would settle it**, at 80% power and α = 0.05: roughly **74 reps per arm**
for the pooled treatment effect, or 61 for `turn18` alone if the true effect is
0.35 → 0.60. At 0.35 → 0.50 it is 169. The 20 reps this run bought were between
a third and a tenth of what the question needs.

#### The control held, and no side effect is attributable to the restructure

`turn24` did not improve (*p* = 1.00), which is what `§ S42` asked of it.

**Every failure on a fixture that should not have moved was read, and none is
layout-related:**

- **`turn29` rep 017** — the Warden puts the sealant patch job outside life
  support when `cryo_bay_bulkhead_patch` locates it at the cryo bay bulkhead. A
  contradiction against the patch fact, not the layout.
- **`turn29` rep 019** — narrates the lower deck lit "in the same failing
  emergency red as everywhere else on this ship" against a seeded opening
  narration establishing amber on mid-deck. The timeline/detail subtype, not
  spatial at all.
- **`5c34991b-turn01` reps 001 and 009** — both grade `roll_dice.purpose` for
  failing to state a numeric threshold, which is `UNAUDITABLE-MAPPING`'s own
  subject. Rep 009 is a borderline call by its own admission — the purpose does
  fix success and failure in fictional terms, and the judge fails it "given the
  strict letter of the rubric."
- **`2c0ba938-turn15` rep 005 is not a failure at all.** The rationale closes on
  *"Therefore this should actually be a PASS, not a fail. Let me revise."* under
  `verdict: fail` — the self-contradicting verdict `ADR-0102` and spec 020
  documented, arriving on a fourth check. **`turn15` is 20/20**, and this row is
  a datapoint for M7.8's judge item rather than a Warden result.

**So the side-effect question `§ S42` scoped the tripwires to answer is
answered: no.** That is the one thing this run establishes cleanly about the
intervention, and it is a negative.

#### `turn08` still fails the way it was captured to fail

Its five failures are all genuine `ship_layout` deck contradictions — the Warden
descends from the bridge to reach the engineering records terminal that the
layout places on Deck 1, aft of the bridge. Under the restructured layout the
rationales now cite deck *numbers* — *"placing a passage behind engineering one
level down from the Deck-1 terminal, landing it on Deck 2, when engineering is
specified as Deck 3"* — but the error is the one `ADR-0104` captured.

`§ S43` called `turn08` self-healed on the strength of 9/10. **At 13/18 it is
not**, and the two readings are statistically indistinguishable (*p* = 0.38), so
the honest statement is that its rate was never established at N=10. The same
caution applies to `§ S41`'s reading of `5c34991b-turn01` and to `§ S43`'s of
`turn24`: **a fixture called "self-healed" off ten reps has not been measured**,
and this corpus has now made that claim three times.

#### The error rate is the only significant number, and the restructure did not cause it

**10 of 160 fixture-reps errored — 6.25%** against the standing ~1.36%
(*p* = 0.00008). **Superseded by `§ S45`, which corrects both the unit and the attribution: the comparator counts leaks only, the like-for-like figure is 8/160 = 5.00% (*p* = 0.0017), and the elevation is one adventure's fixtures rather than drift.** Eight are tool-syntax leaks abandoning the turn, one is
`Inner tool loop did not terminate within 20 iterations`, one a rejected
correction round.

**It predates the intervention.** Run A ran the *pre-restructure* corpus and
errored 2 of 40 — 5.0%, and **statistically identical to run B** (*p* = 1.00).
Pooled across both runs, 12 of 200 = **6.0%, *p* = 0.00002** against the standing
figure. A longer, multi-line `<world_facts>` block was the obvious suspect and it
is excluded: the elevation is fully present before the block changed.

**Where it does concentrate is the adventure.** Nine of run B's ten errors are on
`2c0ba938` fixtures (`turn29` ×4, `turn08` ×2, `turn24` ×2, `turn14` ×1) and one
on `5c34991b`; `turn18` and `turn15` errored zero times each. `§ S39` recorded
the two `2c0ba938-turn21-*` fixtures erroring at 2 and 3 of 10 with the shared
cause "unexplained." **This is that finding again with a bigger denominator**, and
it is now the most-supported open defect in the harness — better supported than
anything this experiment was built to measure.

#### Disposition

Not a baseline candidate; standing point remains
`claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`. Dispositioned in
`docs/eval-methodology.md § Current baseline N`.

**The restructure is not reverted.** It is form-only, it costs nothing to keep,
its rationales show the Warden reasoning in the new vocabulary, and no tripwire
implicates it. But **it is not evidence-backed either**, and `ADR-0101`'s
addendum should not be read as validated by this run.

---

### S45 — 2026-08-31 · The error rate diagnosed: no drift, no restructure effect, one adventure leaking five times more than the rest

`§ S44` called the error rate "the only significant number in either run" and left
it attributed to "the adventure, unexplained." Three free stages against archived
artifacts settle it, and correct a unit error in `§ S43` and `§ S44` on the way.

#### The comparator counts leaks only, and both prior entries compared all errors against it

**`§ S43` and `§ S44` are wrong on this and are corrected here.** The standing
~1.36% comes from `docs/eval-methodology.md`'s emission table —
`fa4e6e2f__2026-08-20` and `__2026-08-21`, 3/220 each — and it counts **turns
abandoned to a tool-syntax leak**, not every errored fixture-rep. Both prior
entries divided *all* errors by fixture-reps and compared the result to it. Leaks
are ~80% of errors, so the mismatch inflated every figure quoted.

Recomputed leak-only, which reproduces the methodology's 1.36% exactly on both
source runs and so is confirmed like-for-like:

| Run | Leak rate |
|---|---|
| `fa4e6e2f__2026-08-20` | 3/220 — 1.36% |
| `fa4e6e2f__2026-08-21` | 3/220 — 1.36% |
| `e83e8aaa__2026-08-24` | 1/210 — 0.48% |
| `e83e8aaa__2026-08-28` | 8/252 — 3.17% |
| `e83e8aaa__2026-08-31` run A | 2/40 — 5.00% |
| `e83e8aaa__2026-08-31` run B | 8/160 — 5.00% |

**The finding survives the correction; the numbers do not.** Run B is 5.00% not
6.25% (*p* = 0.0017 against 1.36%), and A+B pooled is 10/200 = 5.00% not 6.0%
(*p* = 0.0005, not 0.00002). Every quoted figure in `§ S43` and `§ S44` on this
subject should be read as the leak-only row above.

#### There is no drift. The entire rise is one adventure joining the corpus

The apparent trend — 1.36% in August, 3.17% by 08-28, 5.00% by 08-31 — is a
composition artefact, and splitting the 08-28 full-corpus run says so outright:

| 08-28, split | Leak rate |
|---|---|
| `2c0ba938` fixtures | 5/70 — **7.14%** |
| the rest of the corpus | 3/182 — **1.65%** |

**The rest of the corpus is exactly where it always was** — 1.65% against the
1.36% baseline, *p* = 0.73. Nothing drifted. `§ S44`'s reading of a rising series
was reading the corpus changing under a stable rate, and `e83e8aaa__2026-08-24`
at 0.48% is the tell: that run predates the `2c0ba938` captures entirely.

Pooled across the two most recent runs, `2c0ba938` errors at 7.4% against
`5c34991b`'s 0.9% (*p* = 0.012). Runs A and B were **75–100% `2c0ba938`
fixtures** by construction, which is the whole of their "elevated" rate: at
7.14% and 1.65% respectively, run B's expected leak count is 9.2 against 8
observed.

**So `§ S44`'s "best-supported open defect in the harness" is narrower than it
was written.** It is not a harness-wide regression. It is one adventure's
fixtures leaking about five times more often than everything else, stably, since
they were captured.

#### What the leak is, and three explanations that do not survive

One failure mode, 18 distinct leaked turns across three runs, identical shape:
the model closes `playerText` — `</playerText>` or `</parameter>` — and then
serialises the remaining tool parameters as **text inside `playerText`**, so
`gmUpdates` and `stateChanges` would be silently discarded. The guard catches it
before persistence and abandons the turn.

**Rejected — a `playerText` length threshold.** Every leak offset falls in
1238–2056, which looks like a ceiling until the successful turns are measured:
their `playerText` runs median 1602, p25 1326, p75 1876, and **65.8% of
successful turns fall inside the same band**. The offset is simply where
`playerText` ends. This is a *parameter-boundary* failure — the model finishing
the narration and failing to re-enter structured-parameter mode — and it happens
at whatever offset the boundary falls.

**Rejected — prompt size.** Median `warden-request.json`: station 225 KB,
`2c0ba938` 201 KB, `5c34991b` 159 KB. The station fixtures carry the *largest*
prompts and leak less than `2c0ba938`.

**Rejected — more structured output to emit.** All three groups emit 1
`gm_response` and 1 `state_update` per turn. `5c34991b`, the *lowest*-leaking
group, rolls the most: 0.83 `dice_roll` per turn against `2c0ba938`'s 0.60.

**What distinguishes `2c0ba938` is therefore still open**, and the three cheapest
hypotheses are now closed rather than untested. Within it the concentration is
uneven — `turn21` ×2 at 3/10 and 2/10, `turn29` 4/30, `turn24` 2/20, while
`turn15` is 0/30 and `turn18` 0/20 — which is the same unevenness `§ S39` logged
on the `turn21` pair as "unexplained" and is now the sharpest remaining lead.

#### The retry budget is 1, and that is a decision rather than an oversight

`TOOL_SYNTAX_RETRY_BUDGET = 1` (`session.service.ts:213`): one hand-back, then
the turn is abandoned. The constant's own comment records the reasoning — *"per
the same reasoning `ADR-0041` applies to the correction loop: more retries hide
the failure rather than fixing it"* — and notes that `ADR-0097` originally let it
ride the shared `INNER_TOOL_LOOP_CAP` of 20 on the assumption Claude would
recover as it does from a malformed payload.

So **raising it is a decision already taken and argued against**, and the error
rate is in part a deliberate policy artefact: the harness converts a recoverable
leak into a lost denominator on purpose. That trade was made when leaks ran at
1.36% corpus-wide. At 7.14% on one adventure it costs that adventure's fixtures
about one rep in fourteen, every run, and `TOOL-SYNTAX-LEAK` reads 1.00
throughout because an abandoned turn produces no `gm_response` (`ADR-0097`
addendum 3) — so the check cannot see what it is named for. Revisiting the budget
is now a question with a number attached, which it did not have before.

#### What this changes

- **`§ S44`'s error-rate section is superseded**, not just corrected: right
  conclusion that the restructure did not cause it, wrong unit, and an
  attribution ("drift", "harness-wide") that the split refutes.
- **No action is owed against the model or the prompt.** Corpus-wide leak
  behaviour is unchanged since 2026-08-20.
- **Runs scoped mostly to `2c0ba938` will keep losing ~7% of their denominators**,
  which is a planning input for any future scoped run — including a re-run of the
  `ship_layout` question, whose treatment fixtures are all `2c0ba938`.
- **The open lead is per-fixture, not per-adventure.** `2c0ba938-turn21`'s two
  fixtures lead the table across every run they appear in; whatever they share
  with `turn29` and `turn24` and not with `turn15` or `turn18` is the next thing
  to look at, and it is free to look at.

### S46 — 2026-10-04 · Tool-leak recovery against the archive: 130 of 158 leaks recovered, and most refusals are payloads the schema would reject anyway

The first `task leaks:corpus` run (spec `026-tool-leak-recovery`, `ADR-0097`
Addendum 4). It runs `recoverLeakedPayload` over every distinct leaked
`submit_gm_response` under `$ZOLTAR_EVAL_ROOT`. Free: files only. At this point
the function is not called from the turn path.

**This supersedes the counts in spec 026 and `ADR-0097` Addendum 4**, which came
from a throwaway scan that matched only `</playerText>` and found 133. The
script uses the turn path's own detector and finds 158. All 158 are in
`eval-runs/`; nothing has been captured from eval-v2 or a playtest yet.

#### The result

| | Leaks | Recovered | |
|---|---|---|---|
| All | 158 | 130 | 82.3% |
| Found in runs before 2026-08-15 | 44 | 28 | 63.6% |
| Found in runs since 2026-08-15 | 114 | 102 | 89.5% |

The split is at the M7.6 tool-schema change (`db56d61`), which turned
`resourcePools` from a map into an array. A leak from before it carries the
shape that was correct then and is rejected now. The second row is the one that
describes the Warden as it runs today. A leak is dated by the run its first copy
was found in; a later fixture can replay an earlier leak as history, so the
split is approximate.

The spec's gate for wiring the function into the turn path is 80%. Both the
overall figure and the current-schema figure clear it.

#### The 28 refusals

| Reason | Before 08-15 | Since | What they are |
|---|---|---|---|
| `schema_invalid` | 10 | 8 | see below |
| `array_as_tags` | 2 | 1 | `resourcePools` (old map shape) and `diceRequests` written as tags |
| `other_tool_call` | 0 | 2 | `<invoke name="rules_lookup">` inside the narration |
| `unknown_field` | 2 | 1 | `<npcStates>` (since renamed), a `<json>` wrapper, `flags` as a top-level parameter |
| `unexpected_attribute` | 1 | 0 | `<entity id="…">` |
| `leftover_text` | 1 | 0 | the model's own JSON had a stray closing brace |

Every refusal was checked, the `schema_invalid` ones by the schema path that
failed. None is a case where the function failed to parse a
payload that was sound. Each is a payload the turn path could not have applied
as written.

The 18 `schema_invalid` break down as:

- **10 before 08-15:** `resourcePools` as a map (6), `entities[id].status`
  holding free text (3), or both (1).
- **5 since, all from one turn** (`ccac7d1c__2026-08-18`, `turn24-scene-jump`
  rep 9, the turn `ADR-0097` Addendum 3 records leaking ten times in a row):
  `entities[id].status` holding free text such as "down, wounded, 8HP". `status`
  became an enum at the tool boundary on 2026-08-21 (`702762c`), so these too
  were acceptable when written.
- **3 since, model errors:** one `armor_damage` entry with `destroyed: false`,
  which the schema has required to be `true` since 08-15; one where the real
  `gmUpdates` parameter arrived as a string of markup; and one with both.

So of the 12 refusals since the schema change, 5 are schema drift, 3 are the
model sending a value the schema rejects, and 4 are shapes the function
declines by design.

#### What this does and does not show

- **Shape, not correctness.** A recovery here means the result passed
  `submitGmResponseSchema`. That the right value went to the right field is
  shown by the 35 hand-written cases in
  `session.tool-syntax-recovery.cases.ts`, not by this count.
- **The corpus is weighted.** A handful of fixtures (`turn24-*`,
  `2c0ba938-*`) supply most of the leaks. 89.5% is a rate over archived leaks,
  not a promise about play. The number that matters is turns abandoned on the
  next eval-v2 run, against 4 of 50 on `2026-10-04T03-14-41Z`.
- **The schema-invalid refusals are the next thing to consider.** A payload
  that leaks and is also schema-invalid is refused, and falls to the leak retry,
  which rarely works. The same payload arriving clean would get the
  malformed-payload retry with the schema error, which does work. Spec 026
  lists handing the schema error back in this case as not built. 3 of 114
  current-schema leaks would have used it.

### S47 — 2026-10-08 · Question 1's 20 failing narrations: half are a ladder trip that should not be there, six repeat the session's own earlier error, and none misreads `ship_layout`

A reading of eval-v2 run `2026-10-04T03-14-41Z` (question 1, 5 cases × 10 reps,
prompt `mothership-m7.txt` `e83e8aaa`), marked under Rubric v1 as it stood after
the 2026-10-07 re-marks: 21 pass, 20 fail, 2 na, 7 error, all five cases below
the 0.90 bar. Free: it reads the narrations, `marks.csv` and the fixtures'
seeded messages. No run was made.

The question to settle first was whether a failing narration misreads the world
facts or agrees with something the Warden said earlier in the seeded session.
The answer is neither for most of them.

#### The three groups

| Group | Fails | Cases | In the seeded history? |
|---|---|---|---|
| A. A ladder trip that should not be there | 10 | turn 08 (3), turn 14 (5), turn 29 (2) | no |
| B. Repeats the session's earlier error | 6 | turn 18 (6) | yes |
| C. No stable position | 4 | turn 24 (4) | the history contradicts itself |

**Group A: the destination's deck is right and the route is wrong.** The
narration puts a deck change between two places on one deck, or one deck change
too many.

- Turn 08 rep 03: Danny leaves the bridge "back down the ladder shaft toward the
  bridge access corridor", which is on the deck he is leaving.
- Turn 08 rep 07: he goes down the ladder shaft and finds Mara at the records
  terminal "behind the bridge". Both are on the upper deck.
- Turn 08 rep 09: he takes the rungs and "surfaces onto the upper deck proper"
  to reach the terminal "aft of the bridge". He was already on the upper deck.
- Turn 14 reps 01, 02, 04, 08, 09: all go down "past mid-deck" to the cargo bay
  from the mid-deck corridor outside the cryo bay.
- Turn 29 rep 03: down "past mid-deck" to the engine room from the mess hall,
  which is on mid-deck.
- Turn 29 rep 06: "down through mid-deck, down again", from the same start.

None of these is inherited. Turn 08's 16 seeded messages contain no layout
error, and message 2 recites all three decks correctly. Turn 14's 28 messages
put Danny on mid-deck twice in the eight before the turn and never say "past
mid-deck". None misreads `ship_layout` either: where one of the ten names a
place's deck it names the right one, and turn 08 reps 07 and 09 say "behind
the bridge" and "aft of the bridge" in the same sentence as the ladder.

What is wrong is where Danny is standing when the movement starts. Two of the
turn 14 fails (reps 04 and 08) have the cryo bay "fading behind you" in the
sentence that says "past mid-deck", so in those two the Warden has the start
right and the phrase wrong. For the other eight the archive cannot tell a lost
position from a stock phrase.

**Group B: turn 18 repeats what the session already said.** The seeded history
for turn 18 holds the session's real turn 14 narration (message 28, counting
from 0 in the fixture's `seededState.messages`): "you climb
down together, past mid-deck and on toward the lower deck", then "Her berth is
a cramped closet of a room". `ship_layout` puts crew berths on mid-deck.

- Reps 01, 02, 03, 05: "You head back down to the lower deck" to reach the
  berth.
- Reps 06, 09: "You head back down to Mara's berth."

All six agree with message 28 and contradict `ship_layout`. This is the group
the `marks.csv` note on rep 01 describes.

The two passes do not show the Warden getting it right. Reps 07 and 10 say "the
walk back to Mara's berth" and name no deck, and the two na reps name none
either. No rep of the eight marked puts the berth on mid-deck. The case's 2 of
8 measures how often the narration leaves the deck out, and the rate at which
the Warden follows message 28 over `ship_layout` may be nearer 8 of 8.

**Group C: turn 24 has four different wrong answers.** The start is Mara's
berth, which the history puts on the lower deck.

- Rep 06: Teo's bunk near the mess is "two decks down". Nothing is two decks
  below the lower deck, and the same narration has the engine "somewhere
  below".
- Rep 07: the mess hall is "two decks up", which is the upper deck.
- Rep 08: Danny heads "down toward the lower deck and the crew berths".
- Rep 09: the ladder shaft takes him "back down toward the mess hall".

No two agree. None follows the history's start, from which the mess is one deck
up (reps 02 and 03 say so and pass), and none follows the seeded layout, on
which the bunk is along the same deck. Rep 08 alone carries part of group B's
error, berths on the lower deck.

The history gives the Warden nothing stable to follow by this turn. Messages 28
and 38 put the berth on the lower deck. Message 45, spoken in the berth, has
the colonists "asleep two decks from here" and the bridge "two decks up": the
cryo bay is one deck from the lower deck and none from mid-deck. "Two decks"
is the phrase reps 06 and 07 reuse.

#### The thrown turns, kept apart

Seven reps threw and have no narration. They are in none of the groups.

| Error | Reps |
|---|---|
| `SessionCorrectionError` | turn 08 reps 02, 05, 08 |
| `SessionToolSyntaxError` | turn 14 rep 05; turn 24 reps 01, 04, 10 |

The four tool-leak throws are what spec `026-tool-leak-recovery` was built for,
and its live check is owed on the next run (`§ S46`). The three correction
throws are all on turn 08 and nowhere else in 50 turns. The rep files record
the error name and a stack trace, not what the correction round rejected, so
the archive cannot say why.

#### What this does and does not show

- **No failure is a misreading of the seeded facts.** Wherever a narration
  names a deck for a place the history has not already misplaced, it names the
  right one. Restating `ship_layout` more clearly is not a fix for any of the
  20. `§ S44` could not detect an effect from restructuring it.
- **Inherited error is one case, not the pattern.** It accounts for 6 of 20,
  all on turn 18, plus part of one turn 24 rep.
- **The archive cannot separate the causes cleanly.** That takes a run of turn
  18 with message 28 corrected, and of turn 14 with Danny's deck stated. Both
  are hand-edited cases, which eval-v2 has no home for yet.
- **Ten reps per case is thin.** Turn 29's 2 of 10 and turn 08's 3 of 7 would
  not be surprising from one underlying rate.
- **Rubric v1 marks layout only**, so nothing here covers characters, counts or
  timelines.

#### Candidate fix: a movement rule in the Warden prompt

`mothership-m7.txt` says nothing about where a character is, about counting
decks, or about what to do when earlier narration and a world fact disagree.
The candidate is one short rule covering all three:

- Before narrating movement, take the character's current place from the most
  recent narration and the destination's deck from the world facts.
- Narrate a deck change only when the two decks differ, and name each deck
  crossed once.
- Where earlier narration and a world fact disagree about where a place is,
  the world fact stands, and the narration names the deck so the correction
  is on the page.

It needs no schema change, and it can be tested on the five captured cases as
they are.

**Prediction**, written before the rule is drafted, for one run of question 1
at 10 reps per case, marked under Rubric v1:

| Case | 2026-10-04 fails | Predicted fails | |
|---|---|---|---|
| turn 08 | 3 of 7 | at most 1 | |
| turn 14 | 5 of 9 | at most 1 | the clearest test of the first two lines |
| turn 18 | 6 of 8 | at most 2, with at least one rep naming mid-deck for the berth | the only test of the third line |
| turn 29 | 2 of 10 | 0 or 1 | too few to count as a test |
| turn 24 | 4 of 7 | no prediction | see below |

- **If turn 14 falls and turn 18 does not**, a prompt rule does not outweigh
  the session's own narration, and group B needs the record corrected, not
  another instruction.
- **Turn 24 is why the third line asks for the deck by name.** A Warden that
  puts the world fact first believes Danny is on mid-deck and could write
  "Teo's bunk is along this deck". On the page, after a history that put the
  berth on the lower deck, that sentence puts Teo's bunk there too, and
  Rubric v1 marks it a fail. Naming mid-deck passes, whether the narration
  says nothing of the earlier error (as rep 02 did) or says it had the berths
  wrong. There is no number for this case because its four fails share no
  single cause for the rule to remove.

#### What this says about `current_location`

The candidate already on the board is a position field the Warden writes
(`ADR-0101`). This reading leaves it standing but behind the prompt rule:

- **It aims at groups A and C only.** Group B is an error about where a place
  is, not where Danny is.
- **Group B is `ADR-0101`'s warning observed.** The Warden said "lower deck"
  once at turn 14 and followed it in at least 6 of 8 reps at turn 18. A field
  it writes itself would carry the same value with more authority.
- **These cases cannot measure it as captured.** Each case replays one turn. A
  field the Warden writes on that turn is first read on the next one, so the
  fixtures would need a value seeded by hand.

### S48 — 2026-10-08 · Every replay before today sent the triggering player message twice, so no earlier run is a before-number

A defect in how both harnesses feed a captured turn, found by reading the
fixtures and the turn code. Free: no run was made.

#### What happened

- Capture folds "messages up through and including the player message that
  triggers turn N" into `seededState.messages`
  (`apps/zoltar-be/src/replay/reconstruct-state.ts` step 5). That is by design.
- Both harnesses seeded that list unchanged and then sent
  `playerInput.content` as the turn's input. `SessionService.sendMessage`
  inserts the incoming message again, and `buildSessionRequest` appends it
  after the message window, which does not dedupe.
- So the Warden's request ended with the same player message twice in a row.
  Production saw it once.

All 34 fixtures in `eval/fixtures/` end on a player message identical to
`playerInput.content`, so every replayed turn carried the duplicate: every
old-harness run, and both eval-v2 runs (`2026-10-04T03-05-01Z` and
`2026-10-04T03-14-41Z`).

`2c0ba938-turn01-seeded-canon-contradiction` was the worst case. Its source
adventure already holds the OOC question twice (21:11:05 and 21:11:40 on
2026-08-24, apparently a failed attempt and its retry), so a replay showed it
three times with no GM reply between. Production saw it twice.

#### The fix

eval-v2 now leaves the last seeded message out when it seeds a scratch
adventure (`seedScratch` in `apps/zoltar-be/eval-v2/replay.ts`), and
`parseFixture` refuses a fixture whose last seeded message is not the player
message in `playerInput.content`. The fixtures are unchanged, and so is what
capture means. A constructed case has to end on its triggering message like a
captured one.

The old harness (`apps/zoltar-be/eval/harness-runner.ts`) is not fixed. No
further run of it is planned (`docs/eval-methodology.md § Current baseline N`),
and a run of it after this date would still carry the duplicate.

#### What this does to earlier results

- **Runs before the fix are not comparable with runs after it.** The change
  alters what reaches the Warden on every case, which is the same test
  `docs/eval-methodology.md § Two kinds of corpus bump` applies to an
  input-affecting corpus edit, though no fixture and no corpus version moved.
- **`§ S47` stands as a description of run `2026-10-04T03-14-41Z`.** Its
  groups come from reading the narrations against the seeded history, and that
  reading does not depend on the duplicate.
- **`§ S47`'s counts are not a before-number.** Its prediction table compares
  a future run against that run's fails per case. A drop on the next run
  could be the movement rule or the missing duplicate, and one run cannot say
  which.
- **A reference run is owed only if the fails drop.** If the movement-rule
  run shows no drop, the rule did not work and the confound does not matter.
  If it does, the drop cannot be credited to the rule without a run on the
  fixed harness with the prompt unchanged. Turns 14 and 18 are enough, since
  the prediction rests on those two: 20 narrations to mark, not 60. That run
  can follow the rule's run, at the cost of marking it with the rule's result
  already known.
- **Whether the duplicate caused any of the 20 fails is unknown.** Nothing in
  the archive can show it. A reference run is what would.
- **Old-harness results compare with each other as before.** Every one of
  them carried the duplicate, so it is a constant across them. What they
  measured is a Warden that was told each thing twice.

### S49 — 2026-10-09 · The movement rule did not work, and the reference run shows turn 14's ladder trips mostly went with the duplicate message

Two eval-v2 runs of question 1, both made and hand-marked by the maintainer on
2026-10-09 under Rubric v1, the reference run marked before the rule's run was
made:

| | Run | Commit | Prompt | Cases |
|---|---|---|---|---|
| Reference | `2026-10-09T10-38-58Z` | `8473bac` | `e83e8aaa` | turns 14 and 18, 10 reps each |
| Rule | `2026-10-09T11-03-37Z` | `0c088ac` | `5edf9418` | all six, 10 reps each |

The one file changed between the two commits is `mothership-m7.txt`. `0c088ac`
adds `§ S47`'s candidate rule as a section, "WHERE A CHARACTER IS, AND WHICH
DECK A PLACE IS ON". `064995b` reverts it, so the rule is in history and not
in the prompt.

#### The comparison

`task ev2:compare`, on the two cases both runs hold:

| Case | Reference | Rule | Label |
|---|---|---|---|
| turn 14 | 8 of 10 | 6 of 10 | not shown (0.31) |
| turn 18 | 1 of 10 | 1 of 10 | not shown |

Neither case moved toward the bar, and turn 14 moved away from it.

#### Against `§ S47`'s prediction

| Case | Predicted fails | Fails | |
|---|---|---|---|
| turn 08 | at most 1 | 5 of 8 | 2 reps threw |
| turn 14 | at most 1 | 4 of 10 | |
| turn 18 | at most 2, with at least one rep naming mid-deck for the berth | 9 of 10, none naming mid-deck | |
| turn 29 | 0 or 1 | 4 of 10 | |
| turn 24 | no prediction | 6 of 8 | 2 na |
| turn 01 | not in the prediction | none | 10 na |

Every predicted case missed. Turns 08, 24 and 29 have no reference run, so
their counts stand against the prediction only and say nothing about whether
the rule changed them.

#### Turn 14: the reference run is the finding

On the harness as it was before `§ S48`'s fix, turn 14 failed 5 of 9, all five
by going "past mid-deck" from mid-deck. On the fixed harness with the prompt
unchanged it failed 2 of 10, reps 08 and 09, both by the same phrase. The two
runs are not comparable (`§ S48`), and 4 of 9 against 8 of 10 would not earn a
label if they were. What the reference run does show is that the failure the
rule's first two lines were written for was mostly absent before the rule was
added. There was little for it to remove.

With the rule, "past mid-deck" is back in three reps (01, 02, 10), and a fourth
(06) puts Mara's berth off the cargo bay corridor. Rep 02 names the right deck
for the berth and still goes "past mid-deck" to leave it:

> Her berth is tucked near the crew quarters on mid-deck, but she bypasses it

One reference mark was changed after the rule's run had been marked. Rep 08 has
Danny go "down past mid-deck toward the lower levels" and was first marked
pass, where rep 09 and the three rule-run reps were marked fail for the same
phrase. The maintainer re-marked it fail on 2026-10-09. Before the re-mark the
reference was 9 of 10 and the label `not shown (0.15)`.

#### Turn 18: the third line changed nothing that can be seen

Nine of ten fail in both runs. In the rule's run eight of the ten name the
lower deck on the way to Mara's berth, and no rep in either run puts the berth
on mid-deck. The one pass in each run names no deck for it.

`§ S47` said that if turn 14 fell and turn 18 did not, group B needs the
session record corrected and not another instruction. Turn 14 did not fall, so
that test was not met as written. Turn 18's half of it came out as plainly as
ten reps allow: an instruction to prefer the world fact did not outweigh
message 28. A run of turn 18 with message 28 corrected is still the way to
separate the causes, and it still needs a home for hand-edited cases.

#### No top-up

Both cases were named for a top-up before marking, should they come back `not
shown` (`docs/eval-methodology.md § Eval v2`). None was run. The top-up exists
to find a modest gain that 10 reps would miss. Turn 18 is 1 of 10 on both
sides, and turn 14's difference is in the wrong direction, so there is no gain
for 80 more narrations to find. Whether the rule made turn 14 worse is left
open at 0.31, and does not need settling for a rule that is not being kept.

#### Thrown turns and the tool-leak live check

This is the live check `§ S46` owed.

- **Tool leaks: 3 in 80 turns, all recovered.** Reference turn 14 rep 04, and
  the rule run's turn 14 rep 04 and turn 24 rep 05. Each rep file records
  `outcome: recovered` and the turn went on to a narration. No turn threw
  `SessionToolSyntaxError`; the 2026-10-04 run threw four in 50.
- **`SessionCorrectionError`: 2 in 80, both on turn 08** (reps 02 and 10).
  With the three in `§ S47` that is five of five on turn 08 and none anywhere
  else. The rep files still record only the error and a stack trace.

#### What this leaves

- **The rule is not kept.** It is reverted, and the prompt stays at `e83e8aaa`.
- **Turn 14 on the fixed harness is 8 of 10**, under the bar but within what
  ten reps of a passing case would give. It is no longer a clear failing case
  to aim a fix at.
- **Turn 18 is the standing failure**, 1 of 10 twice, and it is an inherited
  error about where a place is.
- **Turns 08, 24 and 29 have no clean number without the rule.** Their only
  run on the fixed harness is the rule's.
- **Turn 01 cannot be marked as captured.** All ten reps are `na`: nothing in
  the narration touches the timeline either way.

### S50 — 2026-10-09 · Pre-registration: turn 18 with the berth's deck corrected in the seeded history

`§ S49` left turn 18 as the standing failure, 1 of 10 with and without the
movement rule, and could not say whether the Warden is following the session's
earlier narration or writing "head back down" from habit. This is the run that
separates them. Written before the run is made.

#### The case

`2c0ba938-turn18-berth-corrected` is the first constructed case. It is the
captured turn 18 with two sentences of the seeded history changed and nothing
else, which `eval-v2/fixture.spec.ts` checks:

| Message | Captured | Corrected |
|---|---|---|
| 28 | "She leads the way to the ladder shaft, and you climb down together, past mid-deck and on toward the lower deck, the air growing warmer and closer to the engine hum the further down you go." | "She leads the way along the mid-deck corridor, past the mess and on toward the crew berths." |
| 26 | "toward the ladder shaft that leads down to the lower deck" | "down the corridor toward the crew berths" |

Message 28 is the error. Message 26 is not wrong, since Mara had named the
cargo bay as well as her berth, but it points at the lower deck, and leaving it
would be the first thing to suspect if the case still failed. Changing both
means a pass cannot be put down to message 28 alone.

No other message places the berth. Messages 33 and 36 already have Danny go
"down to the lower deck stores" from the berth and "back up to mid-deck", which
agrees with a mid-deck berth. The captured case fails 9 of 10 with those two
messages in it.

Constructed cases live in `apps/zoltar-be/eval-v2/constructed/`, apart from
`eval/fixtures/`, whose contents set the old harness's corpus version.
`eval-v2/cases.ts` says what each was made from.

#### The run and the before-number

One run of the corrected case alone, 10 reps, prompt `e83e8aaa`, marked under
Rubric v1. The before-number is the captured turn 18 in the reference run
`2026-10-09T10-38-58Z`: 1 of 10, same prompt, same harness.

`ev2:compare` matches cases by fixture id and will not label this pair, which
is right: it is two cases on one prompt, not one case on two prompts. The same
test by hand (Fisher's exact, two-sided, against 1 of 10) gives the line:

| Corrected case passes | |
|---|---|
| 7 of 10 or more | a shown difference (0.02 at 7) |
| 6 of 10 | not shown (0.057) |

`na` and `error` reps shrink the denominator and move the line.

#### Prediction

**At least 7 of 10 pass.** The failing reps in both earlier runs agree with
message 28 and with nothing else in the history, so with it corrected there is
nothing left for them to follow.

- **7 or more:** the failure is inherited. Turn 18 is not something a prompt
  instruction at turn 18 fixes, as `§ S49` already suggested, and the work is
  the first mistake and how a session recovers from one.
- **3 or fewer:** the history was not the cause. `§ S47`'s group B is
  misdiagnosed, and "head back down" needs its own explanation.
- **4 to 6:** both are in play and ten reps cannot apportion them.

#### What this cannot show

- **It is a diagnosis and not a fix.** A live session's history cannot be
  corrected by hand.
- **The marking is not blind.** The marker knows which case this is, and there
  is one case in the run.
- **It says nothing of turn 24**, whose history contradicts itself in three
  places and is not corrected here.

### S51 — 2026-10-09 · Turn 18 with the berth corrected passes 8 of 9: the failure was inherited from the session's own narration

Run `2026-10-09T13-09-50Z`, made and hand-marked by the maintainer under Rubric
v1: the constructed case `2c0ba938-turn18-berth-corrected` alone, 10 reps,
prompt `e83e8aaa`, unicorn `58b2acb`. The prediction is `§ S50`.

#### The result

| Case | Run | pass | fail | na | rate |
|---|---|---|---|---|---|
| turn 18 as captured | `2026-10-09T10-38-58Z` | 1 | 9 | 0 | 0.10 |
| turn 18, berth corrected | `2026-10-09T13-09-50Z` | 8 | 1 | 1 | 0.89 |

`§ S50` predicted at least 7 of 10 passing, and 8 did. By the test `§ S50`
named (Fisher's exact, two-sided), 8 of 9 against 1 of 10 is 0.001. The one
`na` rep takes the denominator to 9, so the case is at 0.89 and a hair under
the 0.90 bar.

No turn threw and no tool leak was recorded.

#### What the narrations say

The count that does not depend on a mark is the phrase itself. As captured,
nine of ten narrations send Danny "back down" or to the lower deck. Corrected,
one of ten does.

- **Six reps (01 to 06) name no deck.** "You head back to Mara's berth", or
  "to the crew berths". Marked pass: no deck change is narrated, and from a
  mid-deck start none is needed.
- **Rep 07 names it**: "You head back through the mid-deck corridors".
- **Rep 08 says "You head back down"** and names no deck. Marked pass, with
  the note that it was taken as a figure of speech.
- **Rep 09 is `na`**: it opens at the hatch with no movement.
- **Rep 10 fails**: "You head back to mid-deck" has Danny returning to a deck
  he had not left.

Rep 08's mark is the one to read twice. In the reference run eight reps were
failed with the note that "head back down" suggests a change of decks from the
cryo bay to the berth. The phrase is the same here. What differs is the
history: as captured the berth had been put a deck below, and corrected it has
not. Marked as the reference run's reps were, rep 08 is a fail and the case is
7 of 9, 0.006 against 1 of 10. The conclusion does not turn on it.

#### What this settles

- **`§ S47`'s group B is confirmed.** Turn 18 fails because message 28 put the
  berth on the lower deck, and the Warden follows what the session said over
  `ship_layout`. With that one error removed from the history, the same prompt
  on the same turn stops making it.
- **`§ S49`'s reading of the movement rule holds.** An instruction to prefer
  the world fact left turn 18 at 1 of 10. Removing the earlier narration took
  it to 8 of 9. On this case the session's own words outweigh both the world
  facts and the instruction.
- **Messages 33 and 36 were not enough to correct it.** Both already imply a
  mid-deck berth, and the captured case failed with them in the history. A
  later implication did not outweigh one earlier statement.

#### What it does not settle

- **Which of the two edits did it.** Messages 26 and 28 were changed together
  (`§ S50`).
- **How often the first mistake is made.** This case removes it by hand. Turn
  14 is where the session made it, and on the fixed harness turn 14 put the
  berth on the lower deck in one rep of twenty across the two runs in `§ S49`
  (the rule's run, rep 06), most reps going to the cargo bay instead.
- **Whether the marks are free of the marker's knowledge.** One case, known to
  be the corrected one (`§ S50`). Rep 08 is where that shows.
- **Turn 24.** Its history still contradicts itself in three places.

#### What follows

A wrong statement about where a place is, once narrated, is repeated. Nothing a
live session has today removes one: the history cannot be edited, and a prompt
rule did not outweigh it. The candidates are to stop the first mistake, or to
give a session a way to retract one that later turns read as settled. Neither
is designed, and neither is in this entry.

### S52 — 2026-10-09 · Pre-registration: turn 18 with the berth's error left in and a correction after it

`§ S51` showed that removing message 28's error from the history fixes turn 18.
A live session cannot remove anything. This run asks the next question: does a
correction that comes later in the history outweigh the error it corrects?
Written before the run is made.

#### The case

`2c0ba938-turn18-berth-retracted` is the captured turn 18 with message 28 left
as the session wrote it, and two messages added after message 30, which
`eval-v2/fixture.spec.ts` checks:

> **Player:** Wait, is Mara's berth on the lower deck? I thought the crew
> berths were on mid-deck.
>
> **Warden:** You're right, and I had that wrong. The crew berths are on
> mid-deck, Mara's included — same deck as the mess, the medbay and the cryo
> bay. You never took the ladder shaft to get here; it was a short walk along
> the mid-deck corridor from the cryo bay's blast door.
>
> So: you're both on mid-deck, in Mara's berth, with the lower deck and the
> engine room one level below you.

Both are written by hand. They follow the session's own messages 17 and 18,
where the player asked which deck he was on and the Warden corrected itself
out of character. That is a kind of correction a session can already produce
today, with nothing built.

The correction sits two messages after the error and seven before the turn.
Messages 33 and 36 follow it unchanged, and both agree with it.

#### The run and what it is read against

One run of this case alone, 10 reps, prompt `e83e8aaa`, marked under Rubric v1.

| Case | Run | Result |
|---|---|---|
| turn 18 as captured | `2026-10-09T10-38-58Z` | 1 of 10 |
| turn 18, berth corrected | `2026-10-09T13-09-50Z` | 8 of 9 |

By Fisher's exact test, two-sided, against 1 of 10: 7 of 10 or more is a shown
difference, and 6 of 10 is not (`§ S50`).

**"Head back down" with no deck named is a fail in this run.** `§ S51` found
the phrase marked both ways. Here the history holds the error and the
correction together, so the reading is fixed before the marking: from the cryo
bay bulkhead to a mid-deck berth there is no down, and a narration that says
so has followed message 28.

#### Prediction

**At least 7 of 10 pass.** This is held less firmly than `§ S50`'s. Messages 33
and 36 show that a later implication does not outweigh message 28, and this
case tests a later statement that names the error as one. Nothing measured so
far says which way that goes.

- **7 or more:** an explicit correction in the history is enough. A session
  can recover from a wrong placement by saying so, and the design question
  becomes how a correction comes to be made and how it stays in view.
- **3 or fewer:** the first statement wins even against its own retraction.
  Recovery in the history is not available, and what remains is preventing
  the error or keeping it out of what the Warden is sent.
- **4 to 6:** a correction helps and is not reliable. Ten reps will not say
  more.

#### What this cannot show

- **How long a correction lasts.** It is seven messages old at this turn.
- **Whether the Warden would make the correction unprompted.** The player's
  question is written in.
- **Anything about a correction held outside the history**, in a world fact or
  a field of its own.
- **The marking is not blind**, as in `§ S50`.

### S53 — 2026-10-09 · The retraction fixed where the berth is and lost where Danny is: 0 of 10, with the berth on mid-deck in all ten

Run `2026-10-09T17-42-03Z`, made and hand-marked by the maintainer under Rubric
v1: the constructed case `2c0ba938-turn18-berth-retracted` alone, 10 reps,
prompt `e83e8aaa`, unicorn `53c2736`. The prediction is `§ S52`.

#### The result

| Case | Run | pass | fail | na |
|---|---|---|---|---|
| turn 18 as captured | `2026-10-09T10-38-58Z` | 1 | 9 | 0 |
| turn 18, berth corrected | `2026-10-09T13-09-50Z` | 8 | 1 | 1 |
| turn 18, berth retracted | `2026-10-09T17-42-03Z` | 0 | 10 | 0 |

`§ S52` predicted at least 7 of 10 passing. None did. By its own reading rule
that is "3 or fewer: the first statement wins even against its own
retraction", and that reading is wrong. The narrations show something the
prediction did not allow for.

No turn threw and no tool leak was recorded.

#### What the narrations say

Two counts. The first is read from the narrations, the second is the fail
marks:

| | As captured (20 reps, `§ S49`) | Retracted (10 reps) |
|---|---|---|
| Puts Mara's berth on mid-deck | 0 | 10 |
| Failed for the route to it | 18 | 10 |

**The correction took.** Every narration names mid-deck for the berth. As
captured, none of twenty did, and eight of the rule run's ten named the lower
deck.

**Danny's position did not survive it.** He is at the cryo bay bulkhead on
mid-deck (message 36: "Back up at the cryo bay bulkhead"). Every narration has
him arrive at mid-deck from somewhere else:

| Phrase | Reps |
|---|---|
| "back up to mid-deck" | 03, 04, 07, 09, 10 |
| "back down to mid-deck" | 01, 02 |
| "the walk back to mid-deck" | 05, 08 |
| "back toward mid-deck" | 06 |

All ten are fails under Rubric v1, which asks that the route match the layout
from the history's start. The three with no direction are the same call as
the corrected case's rep 10 (`§ S51`), "You head back to mid-deck", which was
failed for returning Danny to a deck he had not left.

"Back up" agrees with Danny still being at the lower deck stores, where
message 36 sends him before bringing him back. "Back down" agrees with nothing
in the history.

#### Reading it

- **A stated correction outweighs the earlier error about a place.** This is
  the question `§ S52` set out to ask, and the answer is yes, 10 of 10. It is
  the first thing short of removing message 28 that has moved the berth:
  `ship_layout` did not, the movement rule did not (`§ S49`), and the later
  implications in messages 33 and 36 did not.
- **The Warden does not hold the character's position.** This is `§ S47`'s
  group A, and here it is ten of ten on a turn where the corrected case had
  one. With the berth's deck no longer wrong, where Danny starts is the whole
  failure.
- **The two are separate.** The corrected case removed the error and kept
  Danny's position. The retracted case fixed the place and lost it. Getting a
  place right and knowing where a character stands are different things for
  the Warden, and a fix for one is not a fix for the other.

#### What may be the case's own doing

The added Warden message was written by hand, and it ends "you're both on
mid-deck, in Mara's berth". That sentence ties "mid-deck" to the berth. The
narrations may be using "mid-deck" as the name of where the berth is, which
would make "back to mid-deck" mean "back to the berth". The run cannot tell
that from a lost position, and a correction worded without that sentence was
not tried. The seven reps that say "up" or "down" narrate a deck change either
way.

#### What it does not settle

- **Whether the wording of the correction caused the lost position**, above.
- **How long a correction lasts**, and whether the Warden would make one
  unprompted (`§ S52`).
- **Whether a recorded position would have held.** Nothing in the snapshot
  says where Danny is. This is the question the `current_location` candidate
  asks (`ADR-0101`).

#### Four runs, one picture

| Tried | On turn 18 |
|---|---|
| An instruction to prefer the world fact (`§ S49`) | no change |
| The error removed from the history (`§ S51`) | fixed |
| The error left in and corrected later (this entry) | place fixed, position lost |

A wrong statement about a place can be undone by a later statement, and cannot
be undone by an instruction. Where the character is standing has no statement
to be undone by, because it is recorded nowhere.

### S54 — 2026-10-09 · Pre-registration: the retracted turn 18 with the history's repeated messages removed

`§ S53` had every narration lose Danny's position. The maintainer, reading the
constructed fixture, noticed that the history it shares with the captured turn
18 repeats itself, and `§ S48` is a case of a repeated message changing what
the Warden does. This run asks whether the repeats are why the position was
lost. Written before the run is made.

#### The repeats

They are the session's own, and are in the captured fixture too:

| Messages (captured numbering) | What |
|---|---|
| 0, 1 | The opening OOC question, twice, with no reply between |
| 31, 32, 34, 35 | "I'm going to get some patch kits from the ship's stores…", four times |
| 33, 36 | Two Warden replies to it, each sending Danny down to the lower deck stores and back up to the cryo bay bulkhead |

So the Warden reads Danny making the same trip down and up twice, immediately
before the turn.

The repeated player messages have a known source. `SessionService` saves the
player's message before the turn's transaction and outside it, so that a retry
after a failure does not need retyping
(`apps/zoltar-be/src/session/session.service.ts`, step 2). A turn that throws
leaves its message in the history, and the retry adds another. Why the
patch-kit message was sent again after message 33 had answered it is not
recorded.

#### The case

`2c0ba938-turn18-berth-retracted-tidy` is the retracted case with five
messages removed and nothing else changed, which `eval-v2/fixture.spec.ts`
checks: one copy of the OOC question, three copies of the patch-kit message,
and the first of the two Warden replies (message 33). The later reply is kept
because it is the one the turn follows from. No message content is repeated in
what remains. The hand-written correction is as it was in `§ S52`.

#### The run and what it is read against

One run of this case alone, 10 reps, prompt `e83e8aaa`, marked under Rubric v1
as `§ S53` was: a narration that has Danny go up, down or back to mid-deck to
reach the berth is a fail.

The before-number is the retracted case, 0 of 10 (`2026-10-09T17-42-03Z`). By
Fisher's exact test, two-sided, against 0 of 10: 5 of 10 or more is a shown
difference (0.03), and 4 of 10 is not (0.09).

#### Prediction

**At most 3 of 10 pass.** The corrected case (`§ S51`) has the same repeats
and kept Danny's position in 8 of 9, so the repeats alone do not lose it. This
is not held firmly: the corrected case had no correction in it, and the two
could act together.

- **5 or more:** the repeats are at least part of why the position was lost.
  That makes the messages a failed turn leaves behind a defect worth fixing in
  the turn path, and `§ S53`'s "the Warden does not hold the character's
  position" is too strong as written.
- **3 or fewer:** the repeats are not the cause. `§ S53` stands, with the
  wording of the correction still the one untested explanation.
- **4:** not shown either way.

#### What this cannot show

- **Which repeat matters**, if they do. All five are removed together.
- **Whether the correction's wording caused the lost position** (`§ S53`). It
  is unchanged here.
- **The marking is not blind**, as before.

### S55 — 2026-10-09 · Removing the repeats changes nothing: 0 of 10 again, and nine of ten now say "back up"

Run `2026-10-09T18-19-03Z`, made and hand-marked by the maintainer under Rubric
v1: the constructed case `2c0ba938-turn18-berth-retracted-tidy` alone, 10 reps,
prompt `e83e8aaa`, unicorn `156339d`. The prediction is `§ S54`.

#### The result

| Case | Run | pass | fail |
|---|---|---|---|
| turn 18, berth retracted | `2026-10-09T17-42-03Z` | 0 | 10 |
| turn 18, berth retracted, repeats removed | `2026-10-09T18-19-03Z` | 0 | 10 |

`§ S54` predicted at most 3 of 10 passing, and none did. The repeats are not
why the position is lost. No turn threw and no tool leak was recorded.

#### What the narrations say

| Danny goes… | Retracted | Repeats removed |
|---|---|---|
| "back up", or "up to mid-deck" | 5 | 9 |
| "back down to mid-deck" | 2 | 0 |
| "back to" or "toward" mid-deck, no direction | 3 | 1 |

Nine of the ten name mid-deck for the berth, and rep 01 names no deck.

With the repeats gone the direction is nearly uniform. Nine narrations bring
Danny up, and rep 03 says where from: "You head back up through the lower-deck
stores to drop off the extra sealant, then back along mid-deck to Mara's
berth."

#### The maintainer's reading: the Warden counts the first move and not the second

Message 36, the one Warden message between the correction and the turn, moves
Danny twice:

> You head down to lower deck stores and haul out what you need — sealant foam
> canisters, rolls of structural tape rated for micro-fractures, a hand-crank
> injector for the tight spots. Back up at the cryo bay bulkhead, the cracks
> look worse up close than they did from a glance

The trip down is a sentence with a verb and a named deck. The return is two
words at the head of the next sentence, and names no deck. Nine narrations
that start Danny below mid-deck are what following the first and missing the
second would produce.

This is a reading of the narrations and has not been tested. The test is the
same case with the return stated as plainly as the trip down.

#### What this does to `§ S51`

The corrected case has message 36 too, and passed 8 of 9. Six of those passes
name no deck and narrate no route ("You head back to Mara's berth"). They pass
because Rubric v1 finds nothing wrong on the page, which is not the same as
the Warden having Danny on mid-deck. `§ S47` said the same of turn 18's two
passes on 2026-10-04.

The retracted cases differ in that the narration names the berth's deck, and
having named it the Warden narrates a route to it. The lost position may have
been there in the corrected case and gone unsaid. Nothing run so far can tell.

`§ S51`'s conclusion about the berth stands: with message 28 corrected, no
narration sends Danny to the lower deck. What it shows about Danny's position
is weaker than 8 of 9 suggests.

#### What follows

- **The repeats are cleared of this failure.** The messages a failed turn
  leaves behind may still matter elsewhere (`§ S48`); they do not explain turn
  18.
- **The character's position is read off the Warden's own phrasing**, and a
  terse return is enough to lose it. That is a narrower statement than
  `§ S53`'s and has more behind it.
- **A pass that names no deck is weak evidence.** Any reading of a question 1
  rate should say how many of its passes are silent.

### S56 — 2026-10-09 · Pre-registration: the tidy retracted turn 18 with Danny's position seeded as a world fact

`§ S55` left turn 18 failing 10 of 10 because the Warden starts Danny below
mid-deck, reading his position off message 36. This is the first run today
that tests something that could be built: a recorded position, which is what
the `current_location` candidate proposes (`ADR-0101`). Written before the run
is made.

#### The case

`2c0ba938-turn18-position-seeded` is the tidy retracted case with one world
fact added and nothing else changed, which `eval-v2/fixture.spec.ts` checks:

```
danny_location: At the cryo bay bulkhead, on mid-deck.
```

It is rendered with the other world facts in the snapshot's `<world_facts>`
block. The prompt is unchanged, and says nothing about a location fact or
about preferring one to the narration.

The value is what a field written on the turn of message 36 would hold. It
does not say Danny came back from the stores, or that he is not on the lower
deck.

One world fact already places him by implication. `cryo_bay_bulkhead_patch`,
which the Warden wrote, opens "Danny has sealant-taped the visible stress
fractures along the cryo bay bulkhead weld seam". The retracted cases failed
with it in the snapshot.

#### The run and what it is read against

One run of this case alone, 10 reps, prompt `e83e8aaa`, marked under Rubric v1
as `§ S53` and `§ S55` were. The before-number is the tidy retracted case, 0 of
10 (`2026-10-09T18-19-03Z`). Against 0 of 10, 5 of 10 or more is a shown
difference (`§ S54`).

Following `§ S55`, the write-up will count the passes that name no deck and
narrate no route apart from those that place Danny or the berth.

#### Prediction

**At least 5 of 10 pass.** Not held firmly. For it: the fact agrees with what
message 36 says when read to the end, so it settles an ambiguity and does not
have to overrule a statement. Against it: `ship_layout` is a world fact too,
and lost to the session's narration in every run until the narration was
changed.

- **5 or more:** a recorded position is followed, at least where the history
  does not flatly contradict it. The `current_location` candidate is worth
  designing, with `worldFacts` a workable home for it.
- **1 or fewer:** a position held as a world fact does not outweigh the
  Warden's reading of its own narration. The candidate needs a different home
  or a different form before it is built: its own block in the snapshot, a
  line in the prompt that names it, or both.
- **2 to 4:** it helps and is not enough as it stands.

#### What this cannot show

- **Whether the Warden would write the value correctly.** It is seeded by
  hand. `ADR-0101`'s warning is that nothing validates a field the Warden
  authors, and a wrong value is then read back as settled on every later turn.
  `§ S51` is that warning observed for narration.
- **Whether it holds against a history that contradicts it outright**, as
  message 28 contradicted `ship_layout`.
- **Any other turn.** Turns 14 and 29 are not in this run.
- **The marking is not blind**, as before.

### S57 — 2026-10-09 · A position seeded as a world fact is mostly not followed: 2 of 10, one of them silent

Run `2026-10-09T18-39-07Z`, made and hand-marked by the maintainer under Rubric
v1: the constructed case `2c0ba938-turn18-position-seeded` alone, 10 reps,
prompt `e83e8aaa`, unicorn `728385e`. The prediction is `§ S56`.

#### The result

| Case | Run | pass | fail |
|---|---|---|---|
| turn 18, tidy retracted | `2026-10-09T18-19-03Z` | 0 | 10 |
| the same, with `danny_location` seeded | `2026-10-09T18-39-07Z` | 2 | 8 |

`§ S56` predicted at least 5 of 10 passing. Two did, which against 0 of 10 is
not a shown difference. No turn threw. One tool leak was recorded and
recovered (rep 07).

#### What the narrations say

| Danny goes… | Reps |
|---|---|
| "back up", from the lower deck stores or the ladder shaft | 03, 04, 05, 06, 07, 09 |
| "back to mid-deck", no direction | 01, 02 |
| "back along the mid-deck corridor" | 08 |
| "back to Mara's berth", no deck and no route | 10 |

Rep 08 is the one narration that has Danny where the fact says he is. Rep 10
passes by naming nothing (`§ S55`). Counted as `§ S56` said they would be,
that is one pass that places him and one silent.

Rep 03 again names the stores as where he is coming from: "You head back up
through the lower deck stores".

#### Reading it

`§ S56` gave 2 to 4 as "it helps and is not enough as it stands" and 1 or
fewer as "does not outweigh the Warden's reading of its own narration". With
one of the two passes silent, the second reading is the nearer one. Six of ten
narrations still start Danny on the lower deck with a world fact in the
snapshot saying he is on mid-deck.

That makes three things in the snapshot the Warden has not followed over its
narration: `ship_layout` against message 28, `cryo_bay_bulkhead_patch` in the
retracted cases, and now `danny_location`. The only things that have changed
what it narrates are changes to the narration: message 28 corrected
(`§ S51`), and a correction added to the history (`§ S53`).

#### What follows

- **`worldFacts` alone is not a workable home for a position.** The
  `current_location` candidate, as a world fact with no change to the prompt,
  would not have fixed this turn.
- **Untested: the same fact with the prompt naming it.** `§ S49`'s movement
  rule is not that test. Its first line told the Warden to take the position
  from the most recent narration, which is the behavior failing here.
- **Untested: the position stated plainly in the narration**, which is
  `§ S58`.

### S58 — 2026-10-09 · Pre-registration: the tidy retracted turn 18 with the return to mid-deck stated in the narration

`§ S55` recorded the maintainer's reading that the Warden follows message 36's
trip down to the stores and misses its two-word return. `§ S57` showed a world
fact does not repair that. This run tests the reading directly, and with it
whether position can be carried by what the Warden narrates. Written before
the run is made.

#### The case

`2c0ba938-turn18-return-stated` is the tidy retracted case with one sentence
of the Warden message before the turn changed and nothing else, which
`eval-v2/fixture.spec.ts` checks. It has no `danny_location` fact.

| | |
|---|---|
| Captured | "Back up at the cryo bay bulkhead, the cracks look worse up close than they did from a glance:" |
| Changed | "You climb back up the ladder shaft to mid-deck — Deck 2 — and walk round to the cryo bay bulkhead. Up close, the cracks look worse than they did from a glance:" |

The return now has what the trip down has: a verb, a route and a named deck.
The base is the tidy case and not the seeded one, so that a pass is the
narration's doing alone.

#### The run and what it is read against

One run of this case alone, 10 reps, prompt `e83e8aaa`, marked under Rubric v1
as the last three runs were. The before-number is the tidy retracted case, 0
of 10 (`2026-10-09T18-19-03Z`); 5 of 10 or more is a shown difference. Silent
passes are counted apart.

#### Prediction

**At least 7 of 10 pass, at least 5 of them placing Danny or his route on
mid-deck.** Every change to the narration today has changed what the Warden
narrates next, and this one states the thing it has been getting wrong.

- **7 or more:** the Warden reads the character's position off explicit
  statements of movement in its own narration, and loses it when a move is
  only implied. Position can be carried by narration, and the lever is how
  the Warden writes a move, not where the position is stored.
- **3 or fewer:** the reading in `§ S55` is wrong. The lost position has
  another cause, and neither the narration nor a world fact reaches it.
- **4 to 6:** it is part of it.

#### What this cannot show

- **Whether a prompt instruction would get the Warden to write moves this
  way.** The sentence is changed by hand.
- **Whether a stated position lasts** beyond the next turn.
- **Whether the fact and the narration together do better than either.**
- **The marking is not blind**, as before.

### S59 — 2026-10-09 · Stating the return changes nothing either, and the four retraction runs share a cause none of them tested

Run `2026-10-09T18-49-52Z`, made and hand-marked by the maintainer under Rubric
v1: the constructed case `2c0ba938-turn18-return-stated` alone, 10 reps, prompt
`e83e8aaa`, unicorn `b84a791`. The prediction is `§ S58`.

#### The result

| Case | Run | pass | fail | na |
|---|---|---|---|---|
| turn 18, tidy retracted | `2026-10-09T18-19-03Z` | 0 | 10 | 0 |
| the same, with the return stated in the narration | `2026-10-09T18-49-52Z` | 1 | 8 | 1 |

`§ S58` predicted at least 7 of 10 passing, at least 5 of them placing Danny on
mid-deck. One passed, and it is silent (rep 03, "You head back to Mara's
berth"). No narration places Danny on mid-deck before he moves. No turn threw
and no tool leak was recorded.

Six narrations say "You head back up to mid-deck" (reps 01, 02, 05, 06, 07,
08) and two "You head back to mid-deck" (09, 10). The sentence before the
turn now reads "You climb back up the ladder shaft to mid-deck — Deck 2 — and
walk round to the cryo bay bulkhead", and the narrations are the same as
without it.

By `§ S58`'s rule this is "3 or fewer: the reading in `§ S55` is wrong", and
it is. The Warden is not missing the return. It was told of it in a full
sentence and wrote "back up to mid-deck" anyway.

#### The same sentence in four runs

| Case | "back up", "back down" or "back to" mid-deck | of |
|---|---|---|
| retracted (`§ S53`) | 10 | 10 |
| tidy retracted (`§ S55`) | 10 | 10 |
| position seeded (`§ S57`) | 8 | 10 |
| return stated | 8 | 10 |

Thirty-six of forty narrations open with a return to mid-deck. Removing the
repeats, seeding a position and restating the move each left it there.

The corrected case (`§ S51`) does not have it. There, six of nine open "You
head back to Mara's berth" or "to the crew berths", and one says "back to
mid-deck".

What the four cases share, and the corrected case lacks, is the hand-written
correction from `§ S52`. Its Warden message ends:

> So: you're both on mid-deck, in Mara's berth, with the lower deck and the
> engine room one level below you.

`§ S53` named this as a possible cause and it was not tested. Three more runs
were built on the same correction instead. On the evidence now, it is the
leading explanation: the correction makes "mid-deck" the name for where the
berth is and puts the lower deck "below", message 36 sends Danny down to the
stores, and "You head back up to mid-deck" is the Warden returning him to the
berth by that name. On that reading the phrase says little about where the
Warden has Danny standing.

That is still a reading and not a result. The test is a retracted case whose
correction does not tie mid-deck to the berth in those words.

It does not cover everything. Two narrations do start Danny at the stores:
rep 03 of the tidy run and rep 03 of the seeded run both have him "head back
up through the lower deck stores". In those two the position is lost whatever
the phrase means elsewhere.

#### What stands and what does not

**Stands:**

- Turn 18 as captured fails because of message 28 (`§ S51`): with the error
  removed, no narration sends Danny to the lower deck.
- The movement rule did nothing (`§ S49`).
- A correction in the history moves the berth off the lower deck: none of the
  40 narrations in the four retraction runs puts it there.
- The repeats in the history do not explain any of this (`§ S55`).

**Withdrawn, as not shown:**

- `§ S53`: "The Warden does not hold the character's position", and that the
  retraction "lost" it.
- `§ S55`: that the Warden follows message 36's first move and misses its
  second.
- `§ S57`: that a position held as a world fact is not followed. If the
  failing phrase is the correction's doing, a location fact was never in a
  position to change it, and the run does not test the idea.

These three rest on a failure that one hand-written message may have made.
What they said about the `current_location` candidate should not be relied
on, for or against.

#### How this happened

Each of the four cases was built from the one before, and each changed one
thing. None went back to check the thing they all inherited. Forty narrations
were marked chasing an effect whose first explanation was written down in
`§ S53` and set aside.

A constructed case is only as good as the text written into it. Past one edit
away from a captured session, a result is as likely to be about the edit as
about the Warden.

### S60 — 2026-10-09 · Pre-registration: is one hand-written sentence why the retraction cases open "back up to mid-deck"?

`§ S59` withdrew three readings on the strength of an explanation it had not
tested: that the last sentence of the hand-written correction produces the
phrase the four retraction runs share. This run tests it in both directions.
Written before the run is made.

The sentence:

> So: you're both on mid-deck, in Mara's berth, with the lower deck and the
> engine room one level below you.

#### The two cases

Each differs from an existing case by that sentence and nothing else, which
`eval-v2/fixture.spec.ts` checks.

| Arm | Case | Made from | Change |
|---|---|---|---|
| Removed | `2c0ba938-turn18-retracted-sentence-removed` | the tidy retracted case | the sentence deleted from the correction; the rest of the correction stays |
| Added | `2c0ba938-turn18-corrected-sentence-added` | the corrected case (`§ S50`) | the sentence appended to message 28, where Danny and Mara arrive at the berth |

The added arm has no retraction in it at all. Message 28 is already correct
there, and nothing says the Warden had anything wrong.

#### What is counted

Not Rubric v1 marks. The count is the phrase, by a rule a script can apply:

> The narration's first sentence contains "to mid-deck", "toward mid-deck" or
> "towards mid-deck" (with or without "the", hyphen or space).

Applied to every turn 18 run made today:

| Case | Run | Phrase |
|---|---|---|
| as captured | `2026-10-09T10-38-58Z` | 0 of 10 |
| as captured, movement rule | `2026-10-09T11-03-37Z` | 0 of 10 |
| corrected | `2026-10-09T13-09-50Z` | 1 of 10 |
| retracted | `2026-10-09T17-42-03Z` | 10 of 10 |
| tidy retracted | `2026-10-09T18-19-03Z` | 8 of 10 |
| position seeded | `2026-10-09T18-39-07Z` | 6 of 10 |
| return stated | `2026-10-09T18-49-52Z` | 8 of 10 |

The rule is stricter than the reading behind `§ S59`'s "36 of 40", which
counted any narrated return. By the rule the four retraction runs are 32 of
40. Two tidy-run narrations that say "back up" without "to mid-deck" are what
it leaves out.

The run needs no hand marks. The maintainer may mark it under Rubric v1, and
the reading below does not depend on it.

#### The run and the lines

One run of both cases, 10 reps each, prompt `e83e8aaa`. By Fisher's exact
test, two-sided, each arm against the case it was made from:

| Arm | Before | A shown difference |
|---|---|---|
| Removed | tidy retracted, 8 of 10 | 2 of 10 or fewer (0.02) |
| Added | corrected, 1 of 10 | 7 of 10 or more (0.02) |

#### Prediction

**Removed: 4 of 10 or fewer. Added: 5 of 10 or more.** Neither is held
firmly, and three of today's five predictions have missed. The sentence is the
only place the history puts the lower deck "below" the berth. But the rest of
the correction also names mid-deck for the berth, twice, and may be enough
without it.

- **Both arms cross their lines:** the sentence is needed for the phrase and
  enough to produce it. `§ S59`'s withdrawals stand. The retraction cases say
  nothing about whether the Warden holds a character's position, and the
  `current_location` candidate has no evidence against it from today.
- **Neither moves:** the sentence is not the cause. `§ S59`'s explanation is
  wrong, and `§ S53`'s reading, that the retraction costs the Warden Danny's
  position, is back in play.
- **Removed moves and added does not:** the sentence matters only alongside a
  retraction.
- **Added moves and removed does not:** the sentence can produce the phrase,
  and so can the rest of the correction. The withdrawals stand, since the
  phrase is still the constructed text's doing.

Whatever the result, no further case is built on these. `§ S59` is why.

#### What this cannot show

- **Why the sentence has the effect**, if it does.
- **Anything about pass rates.** A narration can avoid the phrase and still
  fail Rubric v1, or the reverse.
- **Anything about a captured session.** Both arms are two edits from one.

### S61 — 2026-10-09 · The sentence is enough to produce the phrase and is not needed for it

Run `2026-10-09T19-10-04Z`, made by the maintainer: the two arms of `§ S60`,
10 reps each, prompt `e83e8aaa`, unicorn `4b11f1b`. Not hand-marked. The count
is `§ S60`'s rule, applied by script to each narration's first sentence.

#### The result

| Arm | Before | After | Line | |
|---|---|---|---|---|
| Added to the corrected case | 1 of 10 | 7 of 10 | 7 or more | crossed (0.02) |
| Removed from the tidy retracted case | 8 of 10 | 6 of 10 | 2 or fewer | not crossed |

`§ S60` predicted 5 or more for the added arm, which held, and 4 or fewer for
the removed arm, which did not. No turn threw. Two tool leaks were recorded
and recovered, one in each arm.

**Added.** Six narrations open "You head back up to mid-deck" (reps 01, 04,
05, 06, 08, 10) and one "The walk back to mid-deck" (02). The other three say
"back to Mara's berth" or "toward" it and name no deck. This is a history with
no retraction and no error about the berth, and one appended sentence.

**Removed.** Three say "back up to mid-deck" (01, 03, 10) and three "back to
mid-deck" (06, 07, 08). Of the other four, two name the berth and no deck, and
two open at the hatch.

#### The reading `§ S60` fixed in advance

"Added moves and removed does not: the sentence can produce the phrase, and so
can the rest of the correction. The withdrawals stand, since the phrase is
still the constructed text's doing."

The first half is what the run shows. The sentence alone takes the phrase from
1 of 10 to 7 of 10, and the correction without the sentence still gives 6 of
10. What the phrase follows is the history saying, in so many words, that the
berth is on mid-deck.

#### What that reading assumed

"The constructed text's doing" covers two different things, and `§ S59` and
`§ S60` did not separate them:

- **The text makes the Warden write a route it would not otherwise write,**
  and the route is a figure of speech for "back to the berth". Then the phrase
  says nothing of where the Warden has Danny.
- **The text makes the Warden name the deck, and naming it shows where it has
  Danny.** With no deck named for the berth, the Warden writes "You head back
  to Mara's berth" and nothing can be read off it (`§ S55`'s silent pass).
  With the deck named, it writes a route, and six of ten times the route
  starts below mid-deck.

The run cannot tell these apart, and neither can any run made today. The
second is not ruled out by `§ S59`: that run stated Danny's return in a full
sentence and the narrations did not change, which shows the Warden is not
using that sentence. It does not show what it is using.

What can be said without choosing: in the added arm every statement in the
history is true, the layout in the snapshot is right, and seven of ten
narrations bring Danny to a deck he is already on. Under Rubric v1 those are
fails whichever reading is right.

#### Where today's turn 18 runs leave things

| | |
|---|---|
| Shown | Turn 18 as captured fails because message 28 put the berth on the lower deck (`§ S51`). |
| Shown | An instruction in the prompt does not change that (`§ S49`). A statement in the history does (`§ S53`, `§ S61`). |
| Shown | The repeats in the history are not involved (`§ S55`). |
| Shown | When the history names the berth's deck, most narrations of this turn bring Danny "back up" or "back" to it from the same deck (`§ S60`'s table, this entry). |
| Not shown | Whether that is a lost position or a turn of phrase. |
| Not shown | Whether a recorded position would be followed. `§ S57` ran on a case with this phrase in it and cannot say. |

`§ S59`'s withdrawals stand as "not shown". They are not shown to be wrong
either, and `§ S59` leaned further toward "an artifact" than this run
supports.

As `§ S60` said, no further case is built on these. What separates the two
readings is not another edited history. It is a turn from a captured session
where the Warden names both where a character starts and where he goes, read
for whether the two agree, and that is a marking question a judge could be
asked across every case in the archive.

### S62 — 2026-10-09 · Pre-registration: the state snapshot moved from before the history to after it

Every turn 18 run today has the Warden following what the conversation said
over what the snapshot says. `buildSessionRequest` sends the snapshot as the
first message, ahead of the whole message window, with the player's input
last. Read in order, that puts the current state where the oldest information
is. This run moves it and asks whether the Warden then follows it. Written
before the run is made.

Unlike the constructed cases of `§ S50` to `§ S61`, this changes the product
and not the history, and it is tested on a turn exactly as captured.

#### The change

One reordering in `apps/zoltar-be/src/session/session.prompt.ts`, on branch
`snapshot-after-history`:

| | Before | After |
|---|---|---|
| 1 | state snapshot | message window, oldest first |
| 2 | message window, oldest first | state snapshot |
| 3 | dice results, if any | dice results, if any |
| 4 | the player's input | the player's input |

Nothing in the snapshot, the system blocks or the Warden prompt changes
(`e83e8aaa`). The correction round builds on the original request and inherits
the order.

#### The case and what is counted

`2c0ba938-turn18-seeded-canon-contradiction`, as captured, 10 reps. Message 28
puts Mara's berth on the lower deck and `ship_layout` puts crew berths on
mid-deck.

The run needs no hand marks. Two counts, each a rule on the narration's first
sentence:

| Count | Rule | Captured turn 18 today |
|---|---|---|
| Down | contains "down" or "lower deck" | 9 of 10 (`2026-10-09T10-38-58Z`), 9 of 10 (`2026-10-09T11-03-37Z`) |
| To mid-deck | `§ S60`'s rule | 0 of 10, 0 of 10 |

The down count agrees with the hand marks on both runs: the nine narrations
it picks out in each are the nine marked fail. On the corrected case it picks
out one of ten, rep 08, the mark `§ S51` discussed.

The second count is there because moving the snapshot could trade one failure
for the other: a Warden that now puts the berth on mid-deck may bring Danny
"back up" to it, as in `§ S61`. The narrations will also be read, and anything
the two rules miss will be reported.

By Fisher's exact test, two-sided, against the reference run's 9 of 10: a down
count of 3 of 10 or fewer is a shown difference (0.02), and 4 of 10 is not
(0.057).

#### Prediction

**A down count of 4 to 6 of 10: a drop that is not shown.** Message 28 is an
explicit statement nine messages before the turn, and today a statement in the
history has outweighed everything except another statement in the history.
Moving the snapshot puts `ship_layout` after it, which should count for
something, but `ship_layout` is one line among several and names no character.

- **3 or fewer:** where the snapshot sits decides whether the Warden follows
  it. The reorder is worth an ADR and a merge, and a recorded position
  (`ADR-0101`) becomes worth designing, since state placed here is read.
- **7 or more:** placement is not the reason the snapshot loses. State has to
  reach the Warden some other way, or the history has to stop contradicting
  it.
- **4 to 6:** it helps. One top-up of 20 reps a side would be owed before
  deciding anything (`docs/eval-methodology.md § Eval v2`), and the reference
  side would need the phrase count applied to its own top-up.

#### Not settled by the change itself

- **The first message's role.** With the snapshot first, a request always
  opened on a user message. Now it opens on whatever the window starts with,
  and a window trimmed by size can start on a Warden message. Turn 18's does
  not. Whether the API accepts a request that opens on an assistant message
  has to be settled before this could merge.
- **Prompt caching.** Not measured. The system blocks are the only cached
  part today, and they are unchanged.
- **Integration tests.** The unit suite passes (1342). The `spec-int` suites
  need the test database and were not run.

#### What this cannot show

- **Any other turn or session.** One case.
- **Whether a pass is silent** (`§ S55`). The counts say what the narration
  avoids, not that the Warden has it right.

### S63 — 2026-10-09 · Moving the snapshot after the history: the down count falls from 9 to 6, and no narration puts the berth on mid-deck

Run `2026-10-09T19-43-55Z`, made by the maintainer: turn 18 as captured, 10
reps, prompt `e83e8aaa`, unicorn `71027c4`, which sends the state snapshot
after the message window. Not hand-marked. The counts are `§ S62`'s rules.

#### The result

| | Snapshot first (`2026-10-09T10-38-58Z`) | Snapshot after the history |
|---|---|---|
| Down: "down" or "lower deck" in the first sentence | 9 of 10 | 6 of 10 |
| To mid-deck | 0 of 10 | 0 of 10 |

`§ S62` predicted a down count of 4 to 6, a drop that is not shown. It is 6,
and 9 of 10 against 6 of 10 is 0.30. No turn threw and no tool leak was
recorded.

#### What the narrations say

| Opening | Reps |
|---|---|
| "You head back down to the lower deck" | 01, 03, 07 |
| "You head back up to the lower deck" | 02, 05, 08 |
| "You head back up through the ladder shaft" | 06 |
| At the hatch, or "back to Mara's berth", with no deck and no route | 04, 09, 10 |

- **Six put the berth on the lower deck**, as message 28 does.
- **None puts it on mid-deck**, as `ship_layout` does, in the first sentence
  or after it.
- **The three that drop out of the count are silent** (`§ S55`). A fourth,
  rep 06, has Danny climbing up from the stores, which the rules miss and
  which is its own error.
- **"Back up to the lower deck" is new.** The reference run's nine all said
  "back down". Three narrations now reach the lower deck by going up, and
  nothing is below it.

#### Reading it

By the count, the reorder helps a little and is not shown to. By the
narrations, there is no sign the snapshot is being followed: the fall from 9
to 6 is narrations that say nothing, not narrations that agree with
`ship_layout`. Ten of ten still either follow message 28 or avoid the
question.

So where the snapshot sits is not why it loses, at least not on this turn.
That is `§ S62`'s "7 or more" reading, reached from a count of 6, and it rests
on reading the narrations and not on the rule. The rule alone says "it helps;
a top-up is owed".

#### The top-up, set aside

`§ S62` said a count of 4 to 6 would owe one top-up of 20 reps a side before
deciding anything. It was not run. The maintainer asked a different question
first: whether the reorder together with other pushes on the state would do
what none does alone. That run is `§ S64`, and it is made from the reorder, so
it supersedes a top-up of the reorder by itself.

#### What follows

- **Three ways of putting the layout in front of the Warden have now failed
  against message 28**: the snapshot where it was, an instruction to prefer
  it (`§ S49`), and the snapshot after the history. Two changes to the history
  have worked: removing the error (`§ S51`) and correcting it (`§ S53`).
- **None of the three was tried with another.** `§ S64` does that.
- **The open questions from `§ S62` stay open**: the first message's role,
  and caching.

### S64 — 2026-10-09 · Pre-registration: everything the backend can do to put the state first, at once

`§ S63` moved the snapshot after the history and no narration followed it.
This run adds two more pushes to that one and asks whether the three together
are enough. Written before the run is made.

It changes three things at once on purpose. The question is whether the
state, held outside the history, can be made to hold against a wrong narration
at all. If it can, pieces can be taken away afterwards to find which matter.
If it cannot with all three, that is settled in one run.

#### The three changes

All on branch `snapshot-after-history`, on top of `71027c4`.

**1. The snapshot after the history**, as in `§ S62`.

**2. A header on the snapshot message**, written by the backend
(`STATE_SNAPSHOT_HEADER` in `apps/zoltar-be/src/session/session.prompt.ts`):

> [Current state, as of this turn. Everything above is what has been said so
> far, and some of it may be wrong. Where earlier narration contradicts the
> state below, the state is right.]

**3. A section in the Warden prompt** (`mothership-m7.txt`, `e83e8aaa` →
`3e56fd6b`):

> THE STATE SNAPSHOT IS THE PRESENT
> The state snapshot arrives after the conversation history, just ahead of the
> player's input. It is the world as it stands now. The history above it is a
> record of what has been said, and some of what was said is wrong.
>
> - Where earlier narration and the snapshot disagree about where a place is,
>   the snapshot is right. Do not repeat the earlier narration.
> - Before you narrate anyone going anywhere, find the place in <world_facts>
>   and narrate it where <world_facts> puts it. Name the deck, so the page says
>   where the place is even when an earlier turn put it somewhere else.

This is not `§ S49`'s movement rule again. That rule pointed at `<world_facts>`
when it sat ahead of the whole history, and its first line told the Warden to
take a character's position from the most recent narration.

#### The case and what is counted

Turn 18 as captured, 10 reps, not hand-marked, by `§ S62`'s two rules on the
first sentence, plus one count made by reading:

| Count | Snapshot first | Snapshot after (`§ S63`) |
|---|---|---|
| Down | 9 of 10 | 6 of 10 |
| To mid-deck (`§ S60`'s rule) | 0 of 10 | 0 of 10 |
| Narrations that put Mara's berth on mid-deck, anywhere | 0 of 10 | 0 of 10 |

The third is the one that says the state was followed. A low down count
reached by narrations going silent, as in `§ S63`, is not a fix.

Against the reference run's 9 of 10, a down count of 3 of 10 or fewer is a
shown difference (`§ S62`).

#### Prediction

**A down count of 4 or more of 10, and at most 3 narrations putting the berth
on mid-deck.** Everything measured today has the Warden following statements
in the conversation, and none of the three changes is one.

- **Down 3 or fewer, and 5 or more put the berth on mid-deck:** state outside
  the history can be made to hold. The three changes go forward together to an
  ADR, and the next runs take them away one at a time.
- **Down 3 or fewer, by silence:** the combination suppresses the error and
  does not replace it with the truth. Worth knowing; not a fix.
- **Down 4 or more:** the state does not hold against a wrong narration, by
  any means the backend has short of changing the conversation. The fix has
  to act on the history.

If the berth does land on mid-deck, the to-mid-deck count says whether the
route is then wrong in the way `§ S61` found.

#### Limits set in advance

- **This is the last variant of turn 18 run today**, whatever it shows.
- **The header's claim is broader than this turn tests.** It tells the Warden
  the state is right wherever the narration contradicts it. That is false
  whenever the narration is newer than the state and something happened that
  no field recorded. It would need settling before a merge.
- **One case, one session.**

### S65 — 2026-10-09 · The three changes together put the berth on mid-deck in 5 of 10, and all five bring Danny up to it

Run `2026-10-09T20-04-08Z`, made by the maintainer: turn 18 as captured, 10
reps, unicorn `94c9c99`, prompt `3e56fd6b`. That is the snapshot after the
history, the header on it, and the prompt section (`§ S64`). Not hand-marked.

#### The result

| Count | Snapshot first | Snapshot after (`§ S63`) | All three |
|---|---|---|---|
| Down: "down" or "lower deck" in the first sentence | 9 of 10 | 6 of 10 | 5 of 10 |
| To mid-deck (`§ S60`'s rule) | 0 of 10 | 0 of 10 | 5 of 10 |
| Narrations that put Mara's berth on mid-deck | 0 of 10 | 0 of 10 | 5 of 10 |

`§ S64` predicted a down count of 4 or more, which held, and at most 3
narrations putting the berth on mid-deck, which did not. No turn threw and no
tool leak was recorded.

| Opening | Reps | Berth |
|---|---|---|
| "You head back up to mid-deck" | 02, 06, 10 | mid-deck |
| "You take the ladder shaft back up to mid-deck" | 07 | mid-deck |
| "You head back up through the lower deck and climb to mid-deck" | 03 | mid-deck |
| "head back down" to the berth | 05, 08, 09 | below |
| "You head back up to the lower deck" | 01 | lower deck |
| At the hatch | 04 | not said |

Rep 03 is in both the down count and the mid-deck count: the rule matches its
"lower deck", and it puts the berth on mid-deck.

#### Reading it

`§ S64`'s table has no row for this. A down count of 4 or more was to mean the
state does not hold. But five narrations follow `ship_layout` over message 28,
and that had not happened once in thirty narrations of this case before. By
Fisher's exact test, 5 of 10 against 0 of 10 is 0.03, and against the 0 of 20
of both earlier runs it is less.

So, in two parts:

- **The state can be made to count, and half the time is what it gets.** With
  the snapshot after the history, a header saying it overrides the narration,
  and a prompt section saying the same, five narrations put the berth where
  the world facts put it. Four still follow message 28. That is the first
  thing other than changing the history that has moved the berth at all.
- **Every narration that gets the place right gets the route wrong.** All five
  bring Danny up to mid-deck, and he is on mid-deck. Reps 03 and 07 say how:
  through the lower deck, by the ladder shaft.

None of the ten would pass Rubric v1. Five put the berth on the wrong deck or
below Danny, five have him climb to a deck he is on, and one says nothing.

#### What this does to `§ S61`

`§ S61` could not say whether "back up to mid-deck" is a lost position or a
turn of phrase, and `§ S59` suspected the hand-written correction of producing
it. Here there is no hand-written text in the history. It is the session as
captured, and the phrase appears in five of five narrations that name the
berth's deck.

That settles the part `§ S59` raised: the phrase is not the constructed
correction's doing. It appears whenever the Warden names mid-deck for the
berth, by whatever means it was brought to. And reps 03 and 07 narrate a climb
from below, which is a route and not a figure of speech.

`§ S53`'s reading is restored, more narrowly than it was written: **on this
turn the Warden has Danny below mid-deck, and it shows whenever the narration
names where he is going.** Message 36 sends him down to the stores and brings
him back in two words. `§ S59` showed that stating the return in full does not
change it, so the cause is still not known.

The prompt section tells the Warden to name the deck, so it is part of why the
route is on the page. It is not why the route starts below.

#### What stands after today

| | |
|---|---|
| A wrong statement about a place is repeated | `§ S51`: 9 of 10 as captured, none once message 28 is corrected |
| A correction in the conversation fixes the place | `§ S53`, `§ S61`: none of 40 puts the berth on the lower deck |
| An instruction alone does nothing | `§ S49` |
| The state, pushed three ways at once, fixes the place half the time | this entry: 5 of 10 against 0 of 20 |
| The Warden has Danny on the wrong deck at this turn | this entry, with `§ S53`, `§ S55`, `§ S57`, `§ S61` |
| Why it has him there | not known |
| Which of the three changes does the work | not known |
| Whether a recorded position would be followed | not tested cleanly (`§ S57`, `§ S59`) |

There are two failures on this turn and they need different fixes. One is
about where a place is, and both the conversation and, partly, the state can
correct it. The other is about where a character is, and nothing tried today
has touched it.

#### The branch

Not merged. Half is not a fix, the header overclaims (`§ S64`), the first
message's role is unsettled (`§ S62`), and the route error would fail every
narration the change improves. The source changes are taken back off the
branch so that these entries can merge; `71027c4` and `94c9c99` stay in
history because runs were made from them.

As `§ S64` said, this is the last variant of turn 18 run today.

### S66 — 2026-10-10 · Pre-registration: the question 1 judge against the 114 hand marks of 2026-10-09

Spec 028 builds a judge for question 1 and says what makes it usable. This
entry records how it did on the run its prompt could be adjusted against, and
what is expected of it on the runs it has not seen. Written before those runs
are judged.

#### The judge

`task ev2:judge`, unicorn `4b6164f`: `claude-opus-5-5` at effort `high`, one
call per narration, prompt `2fd4637a`. It is sent Rubric v1 word for word, the
four seeded world facts, the opening narration, where Danny starts, the
player's input and the narration. It is not sent the hand marks.

#### The adjusting run

Run `2026-10-04T03-14-41Z`, the one Rubric v1 was written from. 43 narrations
judged; its 7 `error` reps have none.

| | |
|---|---|
| Agreement on the 41 pass/fail marks | 38 (0.93) |
| Judge pass, maintainer fail | 1 |
| Judge fail, maintainer pass | 2 |
| Judge `na` on a pass or fail | 0 |
| Judge `na` on the 2 `na` marks | 2 |

Turns 14 and 18 agree on every mark, 9 of 9 and 8 of 8. The three
disagreements:

| Rep | Mark | Judge | Sorted as |
|---|---|---|---|
| turn 08 rep 03 | fail | pass | criterion did not cover it |
| turn 29 rep 08 | pass | fail | criterion did not cover it |
| turn 24 rep 05 | pass | fail | not sorted by the maintainer |

- **Turn 08 rep 03** has Danny go "back down the ladder shaft toward the
  bridge access corridor" and meet Mara "one deck down". The maintainer read
  the corridor as the one outside the bridge hatch, which is not down a
  ladder. The judge read it as leaving by that corridor. The maintainer's
  word for it on 2026-10-10 is "genuinely fuzzy".
- **Turn 29 rep 08** says "descending past mid-deck" from a mid-deck start and
  then walks the mid-deck corridor. The archive README keeps it a pass for
  that walk. That note is outside the Rubric v1 section, so the judge did not
  have it, and it followed the rubric's turn 14 rep 01 example.
- **Turn 24 rep 05** puts the chief engineer "somewhere below you". From the
  start the history gives, the lower deck, nothing is below. The judge applied
  the rubric's inherited-start rule as written. The rubric's "Teo's bunk is
  just along this deck" example points the same way, so the mark may be the
  one that is off. That is the author's reading and not the maintainer's.

None of the three is the judge misreading its instructions, so the prompt was
not adjusted. It is frozen at `2fd4637a`.

#### The check

The seven marked runs of 2026-10-09, judged once: `2026-10-09T10-38-58Z`,
`T11-03-37Z`, `T13-09-50Z`, `T17-42-03Z`, `T18-19-03Z`, `T18-39-07Z` and
`T18-49-52Z`. That is 118 narrations: 114 marked pass or fail (38 pass, 76
fail) and 4 marked `na`. Turn 01 and the 2 `error` reps are not judged.

The limits are spec 028's, agreed 2026-10-10: at least 90% agreement, so at
most 11 disagreements, and at most 4 narrations the judge passes that the
maintainer failed.

#### Prediction

**104 to 109 of the 114 agree, and the judge passes 1 to 3 that the maintainer
failed. Both limits are met.**

- **Turn 18 and its copies, 68 marks, should agree almost throughout.** Most
  of the 55 fails are a descent to the lower deck or a climb to mid-deck from
  mid-deck. The adjusting run had both kinds of mark right.
- **Two turn 18 disagreements are expected by name.** Run
  `2026-10-09T13-09-50Z` rep 08, "You head back down", is a pass as a figure
  of speech (`§ S51`); the judge failed that phrase twice in the adjusting
  run. Run `2026-10-09T10-38-58Z` rep 09, "The walk back up from the cryo
  bay", is a pass, and the judge is likely to read a climb in it.
- **The passes that name no deck are the open risk.** Eight or so turn 18
  passes open "You head back to Mara's berth" and say nothing else about
  where it is. The judge passed "the walk to Mara's berth" twice in the
  adjusting run, reading no deck change as staying on mid-deck. If it marks
  these `na` and not pass, they are disagreements and the agreement limit is
  missed on them alone.
- **Turns 08, 24 and 29, 26 marks, should give 2 to 4 disagreements**, at the
  adjusting run's rate of one a case.

What each result would mean:

- **Both limits met:** the judge is usable for question 1 under Rubric v1, on
  these cases. The three unmarked runs of 2026-10-09 are the first it is
  pointed at.
- **Agreement missed on `na` against pass:** the rubric does not say what a
  narration that moves and names no deck is. That is a Rubric v2 question and
  not a fault in the judge.
- **More than 4 passed that the maintainer failed:** the judge is not usable
  as it is. The disagreements are read before anything else is tried.

#### What this cannot show

- **How the judge does on a case that is not in these runs.** Every mark is
  one session and one ship.
- **Much about turns 08 and 24**, with 8 marks each in the check.
- **Whether the judge varies.** Each narration is judged once.

#### Added 2026-10-10, before the check was read: one run was judged twice

The first attempt at run `2026-10-09T11-03-37Z` stopped on its 47th of 48
narrations and wrote no file. The judge gave turn 29 rep 09 a mark with a
blank reason, and the script took that for an error. It was fixed in unicorn
`8acf9f4`, which changes nothing the prompt hash covers.

The 46 marks made before the stop were printed and not saved. The maintainer
decided, before any of them was set against a hand mark, that the run is
judged again in full and **the second pass is the one that counts**. The 46
printed marks are compared with the second pass afterwards, as a measure of
how much the judge varies between two passes over the same narrations. They
are not used for agreement.

So six of the seven check runs are judged once and one is judged twice, with
the choice of pass made in advance.

### S67 — 2026-10-10 · The judge misses both limits: 98 of 114, and it passes 12 narrations the maintainer failed, nine of them one phrase

The check `§ S66` pre-registered. The seven marked runs of 2026-10-09 were
judged by `task ev2:judge` (unicorn `8acf9f4`, prompt `2fd4637a`,
`claude-opus-5-5`) and set against the hand marks with `task ev2:judge-check`.
The hand marks are as they stood before the judge ran; none has been changed.

#### The result

| | Result | Limit | |
|---|---|---|---|
| Agreement on the 114 pass/fail marks | 98 (0.86) | 0.90, so 103 | not met |
| Judge pass, maintainer fail | 12 | 4 | not met |
| Judge fail, maintainer pass | 4 | | |
| Judge `na` on a pass or fail | 0 | | |
| Judge `na` on the 4 `na` marks | 1 | | |

By spec 028 the judge is not usable as it is, and marking stays by hand.

`§ S66` predicted 104 to 109 agreeing and 1 to 3 passed that the maintainer
failed, with both limits met. Both parts were wrong.

| Case | Marks | Agree | Judge pass, maintainer fail | Judge fail, maintainer pass |
|---|---|---|---|---|
| turn 08 | 8 | 7 | 0 | 1 |
| turn 14 | 20 | 20 | 0 | 0 |
| turn 18 | 20 | 19 | 0 | 1 |
| turn 24 | 8 | 8 | 0 | 0 |
| turn 29 | 10 | 7 | 3 | 0 |
| turn 18, berth corrected | 9 | 6 | 1 | 2 |
| turn 18, berth retracted | 10 | 7 | 3 | 0 |
| turn 18, retracted, repeats removed | 10 | 9 | 1 | 0 |
| turn 18, position seeded | 10 | 8 | 2 | 0 |
| turn 18, return stated | 9 | 7 | 2 | 0 |

#### The 12 the judge passed

**Nine are one phrase.** Each opens with Danny going "back to mid-deck" or
"back toward mid-deck" from the cryo bay bulkhead, which is on mid-deck, with
no "up" or "down": berth corrected rep 10; berth retracted reps 05, 06 and 08;
repeats removed rep 06; position seeded reps 01 and 02; return stated reps 09
and 10.

The maintainer failed all nine on the route: a return to a deck is a claim
that he had left it. The judge passed all nine, and said why each time in
nearly the same words: the phrase is odd from a mid-deck start, and it names
no route the layout rules out. Where the narrations go
"back up" or "back down" to mid-deck, the judge failed them, 28 times in the
four retraction runs.

Rubric v1 does not say which reading is right. Its one route example is turn
14 rep 01, "past mid-deck", which is a deck passed through and not a deck
returned to. The adjusting run could not have shown this: it has no
constructed case and no narration with the phrase.

**Three are one sentence in turn 29**, reps 01, 07 and 10 of run
`2026-10-09T11-03-37Z`: "The walk down to the lower deck takes you past the
ladder shaft". The maintainer's notes call it "close but not correct" and
"isn't quite right". The judge read it as loose wording, on the ground that
the layout calls the shaft the only fast route and not the only one.

#### The 4 the judge failed

| Rep | Narration | Reading |
|---|---|---|
| turn 18 rep 09, run `2026-10-09T10-38-58Z` | "The walk back up from the cryo bay" | Predicted in `§ S66`. A climb from mid-deck to a berth on mid-deck |
| berth corrected rep 08 | "You head back down" | Predicted in `§ S66`. The known inconsistency of `§ S51` |
| berth corrected rep 05 | Mara puts the colonists "two decks below" her berth | The route is fine, which is what the mark's note covers. The cryo bay and the berths are both on mid-deck, so the judge found something the mark did not look at |
| turn 08 rep 01 | Mara is "two decks down" from the bridge | The mark's note says the narration does not put the terminal there. The judge read two decks down as the lower deck, against an opening that has her on mid-deck |

#### Sorting them

The author's sort, for the maintainer to confirm or change:

| | Count | Which |
|---|---|---|
| Criterion did not cover it | 13 | the nine "back to mid-deck", the three turn 29, berth corrected rep 08 |
| Mark may be wrong | 2 | turn 18 rep 09 "back up", berth corrected rep 05 |
| Not clear either way | 1 | turn 08 rep 01 |
| Judge wrong | 0 | |

No disagreement is the judge misreading the rubric it was given. Thirteen of
the sixteen come from three things the rubric does not state: whether a return
to the deck he is on is a route error, whether "back down" is a figure of
speech, and how strictly a route has to use the ladder shaft.

#### The `na` marks

The judge gave `na` on one of the four `na` marks and passed the other three:
turn 24 reps 01 and 05, and berth corrected rep 09. Its reason on rep 09 is
that a walk along a corridor with no ladder keeps the berth on mid-deck. That
is the reading under which it passed "the walk to Mara's berth" in the
adjusting run, where the maintainer passed it too.

`§ S66`'s open risk was the other way round: passes that name no deck coming
back `na`. That did not happen once.

#### How much the judge varies

Run `2026-10-09T11-03-37Z` was judged twice (`§ S66`). The 46 marks printed
by the first pass and the second pass's marks for the same reps differ on
one: turn 24 rep 01, fail and then pass, which is one of the hand `na` marks.
On the 43 of them that are hand pass or fail, the two passes agree throughout.
The disagreements above are not noise.

No answer in the seven judge files has a blank reason.

#### What follows

- **The judge is not adopted.** Runs of question 1 are still marked by hand.
- **The fault is in the rubric and not the judge.** Had the nine been written
  into the rubric as fails, the count would have been 107 of 114 with 3 passed
  that the maintainer failed, inside both limits. That is arithmetic on a
  result already seen and not a second check.
- **A second check needs marks the judge has not been set against.** All 155
  are now spent. The three unmarked runs of 2026-10-09 hold 40 narrations and
  could be marked by hand first.
- **Whether "back to mid-deck" is a route error is the maintainer's to
  settle**, and `§ S59` to `§ S61` already asked whether it is a turn of
  phrase. A Rubric v2 that answers it would be the next step, by the archive
  README's rule for changing the rubric.

#### What this does not show

- **That the judge is unreliable.** It was consistent with itself, across two
  passes and across nine copies of one phrase.
- **Anything about a case outside this session.**

### S68 — 2026-10-10 · Pre-registration: the judge under Rubric v2, against 65 new hand marks across all five turns

`§ S67` found the judge and the hand marks apart on three things Rubric v1
does not say. The maintainer ruled on all three on 2026-10-10, each as a fail,
and Rubric v2 says so. This is the second check, on narrations the judge has
not been set against. Written before the judge has marked any of them, and
without reading the new marks beyond counting them.

#### Rubric v2

In the archive README, and copied to
`apps/zoltar-be/eval-v2/judge-rubric-q1-v2.txt`. It restates v1 as a four-step
checklist, short enough to mark from, with the start table and the worked
examples under it. Three rulings are new:

- a return to the deck Danny is already on is a fail, whatever the direction
  word ("You head back to mid-deck" from mid-deck)
- "back up" or "back down" with no deck named is read as a deck change and
  not as a figure of speech
- a change of deck that does not go by the ladder shaft is a fail

The maintainer marks from the same text the judge is sent. Under v1 the marks
came first and the rubric was reconstructed from them.

#### The judge

Unchanged except for the rubric, two more starts, and two sentences of the
instructions around the rubric that described v1's first-person wording.
`claude-opus-5-5` at effort `high`, prompt `fd02544a`.

#### The marks

Hand-marked by the maintainer under Rubric v2 on 2026-10-10, before the judge
ran:

| Run | Cases | pass | fail | na | error |
|---|---|---|---|---|---|
| `2026-10-10T14-43-23Z` (unicorn `96acd03`, prompt `e83e8aaa`) | turns 08, 14, 18, 24 and 29 as captured, 10 reps each | 26 | 21 | 2 | 1 |
| `2026-10-09T19-10-04Z` | `turn18-corrected-sentence-added`, `turn18-retracted-sentence-removed` | 5 | 13 | 2 | 0 |
| | | **31** | **34** | 4 | 1 |

The first run is new, made for this check so that it covers every turn and
not turn 18 alone. The second is one of the three runs left unmarked on
2026-10-09, kept because the constructed cases are where "back to mid-deck"
turns up. The other two unmarked runs are 20 more narrations of turn 18 and
are left out.

Neither `marks.csv` has its `# rubric:` line filled in yet. Both are v2.

#### The limits

Spec 028's, scaled from 114 marks to 65:

| | First check | This check |
|---|---|---|
| Agreement | at least 0.90: 103 of 114 | at least 0.90: 59 of 65, so at most 6 disagreements |
| Judge pass, maintainer fail | at most 4 of 76 fails | at most 2 of 34 fails |

Four of 76 is 5.3% of the fails, and 5.3% of 34 is 1.8. **The 2 is the
author's proposal and needs the maintainer's agreement before the judge runs.**

#### One run first, to check the instructions

The judge has not been run under v2 at all. Before the 65 marks are spent on
it, it is run on `2026-10-09T17-42-03Z`: ten narrations, all marked fail, three
of which the v1 judge passed for "back to mid-deck" (`§ S67`). Under v2 all ten
should fail. If they do not, the instructions around the rubric may be
adjusted, and the rubric may not. This run is not part of the check.

#### Prediction

**58 to 62 of the 65 agree, and the judge passes 0 to 2 that the maintainer
failed. Both limits are met, the agreement limit not by much.**

- The three rulings covered 13 of `§ S67`'s 16 disagreements, and the judge
  gave the same answer to nine copies of one phrase and on 45 of 46 marks
  across two passes. Given a rule, it should apply it.
- `§ S66` predicted too high, by underrating how much of the marking the
  rubric did not state. v2 states more, and it is a first draft that restates
  v1 in fewer words. A short line may have moved a meaning.
- The likeliest disagreements are on turn 08, where two readings of one
  sentence were both defensible in `§ S66` and `§ S67`; on turn 24, where the
  inherited start makes "below" and "above" hard to read; and between pass and
  `na` on narrations that move without naming a deck.

What each result would mean:

- **Both limits met:** the judge is usable for question 1 under Rubric v2 on
  these five turns and their copies.
- **Agreement missed, with disagreements on one rule:** the rubric has another
  gap. Whether to close it is weighed against a third round of marking.
- **Disagreements scattered across rules and turns:** the rubric is not the
  problem. Either the marks vary more than a judge can match, or a judge is
  not the right tool for this question.

#### What this cannot show

- **How the judge does outside this session.**
- **Much about any one turn.** Each has ten marks or fewer.
- **Whether the rubric is right**, only whether two readers of it agree.

#### Added 2026-10-10, before the check: the limits are agreed and the instructions hold

The maintainer agreed both limits: at most 6 disagreements, and at most 2
narrations the judge passes that the maintainer failed.

The judge under v2 marked all ten narrations of run `2026-10-09T17-42-03Z` as
fails, reps 05, 06 and 08 among them, which the v1 judge passed. Its reasons
cite the new rule each time. The instructions were not adjusted and the prompt
is frozen at `fd02544a`. Both `marks.csv` files now carry `# rubric: v2`.

### S69 — 2026-10-10 · Under Rubric v2 the judge agrees on 56 of 65 and misses the agreement limit; six of the nine disagreements are turn 24, and this time the judge is the stricter reader

The second check, as `§ S68` pre-registered it. Runs `2026-10-10T14-43-23Z`
and `2026-10-09T19-10-04Z` were hand-marked under Rubric v2, committed to the
archive (`5b6aac3`), and then judged (`task ev2:judge`, unicorn `04cc5c5`,
prompt `fd02544a`, `claude-opus-5-5`). The hand marks are as they stood before
the judge ran.

#### The result

| | Result | Limit | |
|---|---|---|---|
| Agreement on the 65 pass/fail marks | 56 (0.86) | 59 (0.90) | not met |
| Judge pass, maintainer fail | 1 | 2 | met |
| Judge fail, maintainer pass | 8 | | |
| Judge `na` on a pass or fail | 0 | | |
| Judge `na` on the 4 `na` marks | 1 | | |

By the limits agreed in advance the judge is still not usable. `§ S68`
predicted 58 to 62 agreeing, which was too high again, and 0 to 2 passed that
the maintainer failed, which held.

| Case | Marks | Agree | Judge pass, maintainer fail | Judge fail, maintainer pass |
|---|---|---|---|---|
| turn 08 | 9 | 8 | 0 | 1 |
| turn 14 | 10 | 10 | 0 | 0 |
| turn 18 | 10 | 9 | 0 | 1 |
| turn 24 | 8 | 2 | 0 | 6 |
| turn 29 | 10 | 9 | 1 | 0 |
| turn 18, sentence added | 10 | 10 | 0 | 0 |
| turn 18, sentence removed | 8 | 8 | 0 | 0 |

The direction has reversed since `§ S67`. There the judge passed 12 that the
maintainer failed. Here it fails 8 that the maintainer passed, and passes 1.

#### What the three rulings did

They worked. The two constructed cases, where "back to mid-deck" turns up,
agree on all 18 marks, and turn 14 on all 10. None of the nine disagreements
is over a return to the starting deck.

#### Turn 24: the inherited start

Six of the nine are turn 24, all failed by the judge and passed by the
maintainer.

**Four are one thing** (reps 02, 04, 07 and 09). Danny walks from Mara's berth
to the mess hall with no change of deck. On the seeded layout that is right:
both are on mid-deck. But the rubric takes turn 24's start from the history,
which puts the berth on the lower deck, and says to work out an unnamed deck
from that start. So the judge puts the mess hall on the lower deck and fails
the walk. Rubric v1 gives this very case as a fail ("Teo's bunk is just along
this deck"), with the note that no rep had done it. Now four have, and the
maintainer passed all four.

The judge applied the rule as written, v1's and v2's alike. The marks say the
rule is not what the maintainer means: a narration that gets the layout right
without comment is being failed for not repeating the session's error.

**The other two go against a ruling made the same morning:**

- Rep 10 has "a walk back up and across" to Teo's bunk. The mark's note calls
  it "a turn of phrase, considering that it gets all the other detail
  correct". Rubric v2 says "back up" is not read as a figure of speech.
- Rep 08 has Danny "head down toward the mess hall". No deck is below the
  history's start, and the mess hall is not below the berth on the layout
  either.

#### The other three

| Rep | Mark | Judge | Reading |
|---|---|---|---|
| turn 18 rep 01, "The walk back down to Mara's berth" | pass | fail | The same ruling: "back down" with no deck named. The mark goes against it |
| turn 08 rep 10, "head back down the ladder shaft … toward the records terminal" | pass | fail | The terminal is on the upper deck with the bridge. A ladder down to it puts it on mid-deck. No note on the mark |
| turn 29 rep 08, "take the ladder shaft down to the lower deck, past the cargo bay, toward the engine room" | fail | pass | The mark's note reads "past the cargo bay" as the ladder passing it. The judge reads it as walking past it on the lower deck, where the layout has it |

#### Sorting them

The author's sort, for the maintainer to confirm or change:

| | Count | Which |
|---|---|---|
| The rubric says what the maintainer does not mean | 4 | turn 24 reps 02, 04, 07, 09 |
| The mark goes against the rubric as written | 4 | turn 24 reps 08 and 10, turn 18 rep 01, turn 08 rep 10 |
| Two defensible readings | 1 | turn 29 rep 08 |
| Judge wrong | 0 | |

Apart from turn 24 the count is 54 of 57 (0.95) with 1 passed that the
maintainer failed. That is arithmetic on a result already seen, and turn 24
was not set aside in advance.

#### The `na` marks

One of four agrees. The judge failed turn 24 rep 03 and passed turn 24 rep 05
and sentence-removed rep 09, the last on the ground that a berth with the cryo
bay "just down the corridor" is on mid-deck.

#### Reading it

`§ S68` gave three readings in advance, and the result falls between two of
them.

- **"Disagreements on one rule: the rubric has another gap."** True of four
  of the nine. It is a wrong rule and not a gap: the inherited-start rule has
  been in the rubric since 2026-10-07 and gives an answer the maintainer does
  not hold to.
- **"The marks vary more than a judge can match."** True of four more. Three
  are marks that depart from a ruling made hours earlier, which is the drift
  the maintainer described before marking.

Across both checks no disagreement has been sorted as the judge misreading its
rubric. In `§ S67` the rubric was silent and the judge filled the silence the
lenient way. Here the rubric speaks, the judge follows it, and it is the hand
marks that vary.

#### What follows

- **The judge is not adopted on this result.** The limit was agreed before the
  run and it was missed.
- **The inherited-start rule needs the maintainer's ruling.** One rule that
  fits these marks and every worked example but the "just along this deck" one:
  where the history's start is wrong against the layout, a narration passes if
  it is right from either start, and fails only if it is wrong from both.
- **Whether the four marks that go against the rubric stand is the
  maintainer's to say.** If they are revised, the agreement reported stays 56
  of 65.
- **A third check would need a third set of fresh marks.** Whether that is
  proportionate, against using the judge with a known weakness on turn 24, is
  a decision and not a finding.

### S70 — 2026-10-10 · The nine disagreements settled: two rules change, two marks change, and the judge is kept for comparisons only

`§ S69` left nine disagreements between the judge and the hand marks under
Rubric v2. The maintainer ruled on all of them on 2026-10-10. This entry is
the record of those rulings. Nothing here is a new measurement.

#### The rulings

| Disagreements | Ruling | What changes |
|---|---|---|
| Turn 24 reps 02, 04, 07 and 09: a walk to the mess hall with no change of deck | The marks are right and the rule is wrong | The rubric. On turn 24 a narration passes if it is right from either start, the history's or the seeded layout's, and fails only if wrong from both |
| Turn 18 rep 01, turn 24 reps 08 and 10: a bare "back down", "head down", "back up" | The marks are right and the rule is wrong | The rubric. "Up" or "down" counts as a deck change only when the narration names a deck or the ladder shaft with it |
| Turn 08 rep 10: down the ladder shaft from the bridge to the records terminal | The mark was wrong | The mark, from pass to fail. The shaft is named and the terminal is on the upper deck |
| Turn 29 rep 08: the ladder shaft down to the lower deck, "past the cargo bay" | The mark was wrong | The mark, from fail to pass. The cargo bay is on the lower deck |

`§ S69`'s sort had the three bare "up" and "down" marks as going against the
rubric as written. That was true and is not how they were settled: the
maintainer reversed the ruling of that morning and not the marks.

#### Why the "up" and "down" ruling was reversed

The Warden prompt (`mothership-m7.txt`, `e83e8aaa`) says nothing about decks,
movement, or when to say "up" and "down". The one rule that did was added on
2026-10-09 and reverted after `§ S49`, and it did not cover a figure of speech
either. People say "down to the kitchen" on one floor, and the Warden has been
given no reason to write otherwise. Failing a bare "back down" holds it to a
convention it was never told.

Two things this costs, both known when the ruling was made:

- **The maintainer has marked the phrase both ways**: a fail on 2026-10-04
  (turn 18 reps 06 and 09) and 2026-10-09, a pass in `§ S51` and on
  2026-10-10. The new rule settles which, and those earlier fails are not
  re-marked.
- **Sometimes the phrase is the error.** Nine of ten narrations of turn 18 as
  captured say "back down to the lower deck" outright, so a bare "back down"
  there probably carries the same belief. Under the new rule it is a silent
  pass, the weak evidence `§ S55` describes.

A prompt line keeping "up" and "down" for deck changes would be a fix attempt
with its own run. It is not part of this.

#### Rubric v3

Both rule changes are in Rubric v3, in the archive README and copied to
`apps/zoltar-be/eval-v2/judge-rubric-q1-v3.txt`. It is v2's checklist with
those two rules changed, and it is the one to mark from. The judge is pointed
at it: prompt `ab4b003d`. **The judge has not been run under v3.**

#### The marks

Run `2026-10-10T14-43-23Z` has two marks changed, each with a note, and the
marks as first made kept in `marks.2026-10-10.csv`. Its rubric line stays
`v2`.

| Case | As first marked | After the two changes |
|---|---|---|
| turn 08 | 4 pass, 5 fail (0.44) | 3 pass, 6 fail (0.33) |
| turn 29 | 8 pass, 2 fail (0.80, bar not met) | 9 pass, 1 fail (0.90, bar met) |

**The turn 29 change moves a case across the bar**, and it was made after
reading the judge's reason. `§ S69`'s agreement of 56 of 65 is against the
marks as first made and does not change.

Neither run has been re-marked under v3.

#### Where the judge stands

It missed its agreement limit in both checks and is not a replacement for
hand marks. What the two checks did show:

- **It gives the same mark to the same narration.** Two passes over 46
  narrations differ on one (`§ S67`).
- **Its disagreements have followed the rubric's wording.** Of 25 across the
  two checks, none was sorted as the judge misreading the rubric it was given.
- **The hand marks vary too.** The maintainer has marked one phrase both ways,
  and changed two of 65 marks on a second look.

So the maintainer's decision is to use it where sameness is what matters and
not where truth is:

- **For comparing two runs**, both judged under one prompt hash. A judge that
  leans one way leans the same way on both sides.
- **Not for the 0.90 bar.** Whether a case is good enough is still read from
  hand marks.

`ev2:compare` reads `marks.csv` only, so this needs a way to compare two
judge files before it can be done with the tool.

#### What is still owed

- **The maintainer's own agreement rate.** About 20 of today's narrations
  re-marked blind in a week or so, under Rubric v3. That number is what a
  judge's agreement should be measured against; 0.90 was set with only the 5%
  of marks changed on a second look to go on.
- **A check of the judge under v3**, if it is ever to be used for the bar.
