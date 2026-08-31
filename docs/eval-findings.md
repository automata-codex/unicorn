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

**Both runs are invisible to `baseline-check`.** A `--fixtures`-scoped run is not
a baseline candidate and nothing verifies it was read, which is exactly how the
Haiku control arm sat undispositioned for twelve days (`§ S40`, `ADR-0082`).
Each needs dispositioning by hand in `docs/eval-methodology.md § Current baseline
N` when it lands, until M7.8's `baseline-check` item closes.

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
