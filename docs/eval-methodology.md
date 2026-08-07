# Eval Methodology Notes

Lessons about how to run the Warden eval harness, as distinct from what it measures.
Decisions with alternatives-and-rationale belong in `decisions.md`; this file is for
methodology that would otherwise become folklore.

---

## Rep allocation: variable N vs. uniform N

Warden output is stochastic, so a fixture doesn't pass or fail — it passes at a rate.
That makes the number of reps per fixture (N) a real decision rather than a config
default. The axis that determines it is **whether you know where to look**, not whether
anything changed.

**Variable N is for supervised iteration.** You have two prompt candidates, opinions
about which fixtures discriminate between them, and you're reading the output as it
comes. Fixtures sitting at 0/10 or 10/10 under both candidates are settled and burning
compute; the ones in the middle are where the signal is. Unequal N causes no statistical
problem here — the metric is a per-fixture rate, so fixtures simply end up with different
confidence intervals.

**Uniform N is for the standing regression suite**, and the reason is that the suite runs
precisely when you *don't* know where to look. You tuned against six fixtures; the
collateral damage is in the other thirty-four, and any rep allocation written in advance
encodes the same assumptions the edit came from. A fixture that was settled last quarter
is exactly the one a prompt edit might destabilize, so assigning it N=2 permanently is
deciding in advance not to detect it breaking — which cuts against the
recall-over-precision asymmetry the harness exists to serve. Per-fixture rep counts are
also a config surface that goes stale, and unattended runs want one knob.

**These are two stages of one change, not two occasions.** Iterate at variable N on the
fixtures you're working, then run the full suite at uniform N to find out what else
moved. The regression suite is emphatically not "the thing you run when the prompt and
model are unchanged" — that's when it has the least to say. It's what you run *because*
something changed and the blast radius is unknown. Code changes count: a snapshot-builder
edit, a schema addition, a validator tweak, anything altering what reaches the Warden,
warrants a full suite run even with an untouched prompt hash. The one genuine use for an
unchanged-everything run is re-measuring baseline drift, since a stable model string
doesn't guarantee stable behavior indefinitely.

**The hazard to avoid is adaptive N.** Stratifying on *prior* information — this fixture
has been stable across the last six comparisons, give it fewer reps — is legitimate.
Adding reps mid-run because a fixture looks borderline is not, because "until it
resolves" tends to mean "until it lands where I expected." Same failure as extending N
until the new prompt looks better, at fixture granularity. Set N (and any per-fixture
overrides) before the run; don't adjust during it. If reps get extended anyway, the
manifest's `plannedReps` / `completedReps` split makes it visible rather than silent.

**N is calibrated, not chosen.** The early exploratory reps exist to produce a per-fixture
variance estimate, and that estimate is the deliverable — write down the resulting number
with its basis (corpus version, model, observed variance), or in four months N=10 is just
a thing the config says. The number really means "enough reps for the noisiest fixture I
care about." Adding fixtures or switching models doesn't automatically invalidate it, but
it was estimated under conditions that no longer hold, so it warrants a re-check rather
than an assumption.

---

## Current baseline N

**N = 10**, for the standing regression suite / full-corpus baseline runs. Calibrated
2026-07-29 against:

- Model: `claude-sonnet-4-6`
- Prompt: `mothership-m7.txt`, hash `97feadbd`
- Corpus version at calibration: `8071500a4952...` (short form; full hash in the run's
  `manifest.json`)
- Run directory: `claude-sonnet-4-6__97feadbd__2026-07-29T10-51-26Z`

**Corpus version updated 2026-07-29 to `4c9f2e73efd7...` — a grader fix, not a re-run.**
`turn{19,21}-{system-rolled-player-action,out-of-order-resolution}.json` gained a
fixture-authored `applicability` field so those two checks stop inferring applicability from
whether the model happened to produce a `dice_roll` event (see `decisions.md`). The Warden
outputs already on disk for both `claude-sonnet-4-6__97feadbd__2026-07-29T10-51-26Z` and
`claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z` are byte-identical to before — only the
grading of `system-rolled-player-action` / `out-of-order-resolution` against them changed.
`eval:compare` will (correctly) warn on any pairing against a run scored under
`8071500a4952...`; re-score under the new corpus version rather than suppressing the warning.
Re-grading the two runs above against the fix:

- `system-rolled-player-action`: `claude-sonnet-4-6` — `turn19` 1/8 (2 excluded as
  `not_applicable`) → 3/10 (0 excluded); `turn21` unchanged at 2/9. `claude-sonnet-5` —
  `turn19` 0/0 (10 excluded) → 10/10; `turn21` 2/2 (8 excluded) → 8/10 — the 2 prior passes
  were the exact violation this check exists to catch (a system-rolled to-hit roll with no
  damage-conditional phrasing, which the pre-fix pattern-only rule missed) and now correctly
  read `FAILED`.
- `out-of-order-resolution`: unchanged for both runs — `claude-sonnet-4-6` stays 0/9 on both
  fixtures, `claude-sonnet-5` stays fully `not_applicable` on both. The situation now gates
  correctly, but under the regex still in place at this point the check had no ordering
  evidence to read. This was read at the time as the fixtures being too short — one turn, under
  a model that splits the to-hit request from its resolution — and the fix was assumed to be
  extending turn19/21 through the follow-up turn. **That reading was wrong twice over**: the
  regex was the problem (the structural deferred-gate rule reads 5/10 and 2/8 off the *same*
  artifacts), and extending the fixtures would have guaranteed a PASS rather than measured one.
  See `decisions.md`, "`out-of-order-resolution` reads the deferred gate, and declines the
  in-turn case."

> **Superseded 2026-07-31 by the structural check migrations
> (`4c9f2e73efd7...` → `88fa84bd8329...`).** The numbers immediately above were
> the correct reading under the checkers as they stood on 2026-07-29 and are kept
> because they are what the two runs were originally scored against. Four of them
> have since moved, and one turned out to be an artifact. See "Structural check
> migrations" below for the current figures. They are now reproducible on demand
> via `eval:rescore` rather than existing only as prose here — which is what this
> whole block was doing before, and the reason the command exists.

**Basis.** Binomial variance is worst at p=0.5, and several fixtures in this corpus sit
near there. At N=10, the 95% CI half-width at p=0.5 is ~±31pp; tightening that to ±15pp
would need N≈40+, which isn't affordable for routine comparisons (a two-sided comparison
at N=10 over the full 15-fixture corpus cost ~$30/side in the calibration run; N=40 would
run ~$120/side, ~$240 for one comparison). N=10 is a deliberate precision-for-cost
tradeoff, not an oversight — the fixtures sitting near 0.5 (mostly the `turn24-*` judged
checks) carry real uncertainty at this N and should be read as "unsettled," not as a
precise estimate, until/unless the budget for a higher N is revisited.

### Settled fixtures — candidates for `repOverride` during supervised iteration

This section listed the fixtures observed at rate 0.0 across every rep at N=10, on the grounds
that a settled fixture is burning compute during supervised iteration. **The original list is
retracted.** It read:

> `turn01-unauditable-mapping` (0/6), `turn03-unauditable-mapping` (0/9),
> `turn03-unsurfaced-check` (0/10), `turn16-narrating-past-a-block` (0/10),
> `turn19-out-of-order-resolution` (0/9), `turn21-out-of-order-resolution` (0/9)

**Four of those six were measuring the harness, not the Warden**, and the list's own framing
is what made that hard to see: "confidently zero, n large enough that the result isn't just
small-sample noise" describes a *statistical* confidence that was entirely real and completely
beside the point. A large n does not make a checker correct. `turn16` is the starkest case —
all 10 reps failed on a `dice_request` the *fixture* seeded with a null target, so the check
was grading fixture capture rather than model behaviour.

### Re-derived from the re-scored reports (corpus `88fa84bd8329`, harness `600cc73`)

Under `claude-sonnet-4-6`, the model the original list was measured against:

| Fixture / check | Rate | App | Status |
| --- | --- | --- | --- |
| `turn01-unauditable-mapping` | 0.00 (0/10) | 1.00 | **confirmed zero** — judged, full denominator |
| `turn03-unsurfaced-check` | 0.00 (0/10) | 1.00 | **confirmed zero** — but see the model note below |
| `turn16-narrating-past-a-block` | 0.00 (0/10) | 1.00 | **confirmed zero** — rule was invalid, rate survived re-measurement |
| `turn21-system-rolled-player-action` | 0.00 (0/7) | 0.78 | new entry; N=7, 2 reps undecided, not settled |
| `turn03-unauditable-mapping` | 0.10 (1/10) | 1.00 | **moved off zero** |
| `turn19-out-of-order-resolution` | 0.50 (5/10) | 1.00 | **moved off zero** |
| `turn21-out-of-order-resolution` | 0.25 (2/8) | 0.89 | **moved off zero** |

Three of the six survive, one at a denominator too thin to call settled, and one
(`turn21-system-rolled-player-action`) appears that wasn't on the list at all. Note that
`turn02-missing-canon-capture` is *not* a zero-rate entry and never belonged on such a list:
it is a zero-*denominator* case (10/10 `not_applicable`, App 0.00), which is a different
condition with a different remedy — fixture work, not reps.

**The list must be re-derived per model, not carried across a swap.** `turn03-unsurfaced-check`
reads 0.00 (0/10) under 4.6 and **0.70 (7/10)** under `claude-sonnet-5`, same prompt, same
fixture. "Confidently zero" means confidently zero *for the model it was measured under*,
which is a weaker claim than it looks on a list that doesn't name the model in every row. Under
Sonnet 5 the zeros are `turn01-unauditable-mapping` (0/9), `turn03-unauditable-mapping` (0/7)
and `turn16-narrating-past-a-block` (0/10) — a different list.

**Ceilings belong on this list too, and are the harder half.** The same re-derivation surfaces
`turn21-narrating-past-a-block` at 1.00 under both models and
`turn{19,21}-out-of-order-resolution` at 1.00 (20/20) under Sonnet 5. A pinned 1.00 is exactly
as likely to be a checker artifact as a pinned 0.00 and far less likely to be investigated,
because it presents with full applicability and a healthy denominator and nobody audits good
news. See `decisions.md`, "A rate that never moves is a harness suspect, not a finding."

`turn14-unauditable-mapping` reads 0.11 (1/9) under 4.6 and has a zero denominator under
Sonnet 5 (7 `not_applicable`, 3 errors). It is a low-applicability fixture, not a
confidently-zero one, and needs disproportionately *more* reps than the rest of the corpus to
reach the same confidence, not fewer.

None of the above may take a permanent `repOverride` in the standing regression suite —
per the hazard above, a fixture settled today is exactly the one a future prompt edit
might destabilize, and a standing low-N override is deciding in advance not to notice.
`repOverride` is for deliberate, temporary use during a specific supervised-iteration
session only.

**Re-check trigger.** This N was estimated under the conditions listed above. A model
change, a meaningfully different corpus (fixture count or content), or a prompt rewrite
substantial enough to shift where fixtures sit relative to 0.5 all warrant revisiting this
number rather than assuming it still holds.

> **The trigger fired on 2026-08-03**, when `DEFAULT_SYNTHESIS_MODEL` moved to
> `claude-sonnet-5`. N=10 was calibrated against per-fixture variance under
> `claude-sonnet-4-6`, and Sonnet 5 does not sit where 4.6 sat: several fixtures that
> carried real variance under 4.6 are now pinned at 1.00, and the three `turn24-*`
> fixtures that lost half their reps to errors under 4.6 now complete. Both moves change
> which fixture is the noisiest one N is supposed to cover — which is the whole basis of
> the number. **N=10 is carried forward unchanged for now**, because re-calibrating
> against an empty `rules_chunk` index would only have to be redone once the index was
> populated. **Repointed 2026-08-07:** M7.2 populated the index but deliberately bought no
> Warden-level measurement — the re-baseline moved to M7.5 (`docs/decisions.md § Rules
> ingestion pipeline and retrieval quality are separate milestones`). Re-derive N from the
> **M7.5** re-baseline, and treat the current value as inherited rather than estimated
> until then.

---

## The retrieval quality bar (M7.5, set 2026-08-07)

A different measurement from everything else in this file — `task eval:retrieval`
scores the rules index deterministically against page-labeled fixtures, with no judge
and no Anthropic call anywhere in it. It lives here anyway rather than in its own
document, because the two are the same discipline about what a number means, and
because the failure modes this file catalogues (a rate over a shrinking denominator,
a target chosen after the fact, a comparison across incomparable provenance) all
reappear on the retrieval side wearing different clothes.

**Set against M7.2's first measurement, not guessed in advance.** The baseline is
`docs/rules-extraction-findings.md § S15.2`, confirmed to reproduce in `§ S16.1`
before the bar was written down.

| Metric | Baseline (n) | Bar | Why this number |
|---|---|---|---|
| `recall@3`, `authored` | 100.0% (14) | **hold at 100.0%** | Saturated. There is no improvement to ask for, so the only honest target is a regression floor |
| `recall@3`, `warden-observed` | 91.3% (23) | **≥ 95.6%** | 2 misses down to at most 1. One fixture is 4.3 pp on n=23, so a smaller bar would be asking for less than one event |
| `MRR`, answerable | 0.802 (37) | **≥ 0.85** | 0.048 above the confirmation run, outside the ±0.03 run-to-run spread `§ S15.7` measured. Clearing it is an effect, not a lucky re-run |

**Separate targets per query style, never averaged.** The Warden's own
`rules_lookup` queries are keyword-stuffed and fuzzy; hand-authored questions are
tidy. `§ S15.2` measured an 8.7 pp recall gap and 0.30 of MRR between them. A single
blended number hides exactly the finding the `queryStyle` split exists to surface —
an index that scores well on tidy questions and badly on the ones the Warden actually
emits.

**No `recall@5` target.** It is reported; tuning against it optimizes for a `limit`
the Warden rarely uses (the tool's default is 3).

**What clearing the bar concretely means, stated because a percentage on n=23
obscures it:** the `warden-observed` set has two misses. One (`rq-015`) needs page
12's tables to extract at all — a fixup-patch problem, not a chunking one. So the bar
turns on a single reachable fixture. Read the per-fixture table, not just the rate.

**The stopping rule is measured on the metrics with headroom.** Three iteration
rounds that fail to move aggregate and `warden-observed` `recall@3` by more than 5 pp
close the milestone with the bar restated as "not reached." It is deliberately *not*
measured on `authored`, which is at 100% and cannot move — see
`docs/decisions.md § The retrieval stopping rule is measured on the metrics with
headroom`.

**Provenance is part of the measurement.** `ingest.py` writes marker version,
chunking parameters, embed model, and chunk count to `ingestion/.ingest-manifest.json`,
and the harness copies it into every report. A score compared across different
provenance is not a comparison — the same rule `corpusVersion` and `harnessVersion`
enforce on the Warden side. An absent manifest renders as "Unknown" rather than
being quietly skipped.

**This bar is a milestone criterion, not a build gate.** `task eval:retrieval` needs
a populated index and makes real Voyage calls, so it cannot run in CI and does not
fail a build. Its *scorer* is unit-tested in CI; the score is not.

### Outcome, recorded 2026-08-07: not reached

Three iteration rounds ran (`docs/rules-extraction-findings.md § S17`–`§ S19`) and the
milestone closed on the stopping rule, not on the bar.

| Metric | Bar | Shipped index (61 chunks) | |
|---|---|---|---|
| `recall@3`, `authored` | hold 100.0% | 100.0% | met |
| `recall@3`, `warden-observed` | ≥ 95.6% | 91.3% | **missed by one fixture** |
| `MRR`, answerable | ≥ 0.85 | 0.842 – 0.856 | **indeterminate** |

**The MRR row is the methodology lesson, and it is about the bar rather than the
index.** Eight scorings at one unchanged configuration alternate between 0.842 and
0.856 — a spread of 0.0135, which is 0.5/37 exactly: one fixture swapping ranks 1 and
2, because `hnsw` is an approximate index and two chunks whose similarity differs in
the third decimal have no guaranteed order between traversals (`§ S22`).

So the bar sits *inside* the noise band, and a run that clears it and a run that does
not are the same index observed twice. It was set at 0.85 precisely to sit outside the
±0.03 band measured on the M7.2 index; the shipped index's band is narrower (±0.007)
but the improvement is smaller too, and the final margin is 0.001. **A threshold
chosen to exceed yesterday's noise is not automatically outside tomorrow's.**

`recall@3` had no such problem — identical on all eight runs, and on every run of every
round. **Set retrieval bars on recall; report MRR as colour.** The next bar should
either be set on recall alone or state a required number of repeat runs as part of the
criterion.

---

## Structural check migrations (2026-07-31)

**Corpus version `4c9f2e73efd7...` → `88fa84bd8329...`. Scoring-only** — no `playerInput`
and no `seededState` was touched, so every `warden-output.json` on disk stays exactly as
valid as it was and re-scoring in place is a real measurement. Naming the kind is the
convention this file established; this is the first bump to follow it.

Five fixtures' `assertion` blocks moved from `structural` to `judged`
(`turn{01,03,14}-unauditable-mapping`, `turn{16,21}-narrating-past-a-block`) as part of
migrating those two checks. Two new rubrics: `unauditable-mapping` `c97c75ba`,
`narrating-past-a-block` `febc02d6`.

### Current figures

Structural checks, re-scored off the frozen artifacts with no API spend:

| Fixture / check | was | now |
| --- | --- | --- |
| `turn19-system-rolled-player-action` (4.6) | 3/10 | 3/10 |
| `turn21-system-rolled-player-action` (4.6) | 2/9 | **0/7**, 2 undecided |
| `turn19-system-rolled-player-action` (S5) | 10/10 | 10/10 |
| `turn21-system-rolled-player-action` (S5) | 8/10 | 8/10 |
| `turn19-out-of-order-resolution` (4.6) | 0/9 | **5/10** |
| `turn21-out-of-order-resolution` (4.6) | 0/9 | **2/8** |
| `turn{19,21}-out-of-order-resolution` (S5) | all `not_applicable` | **1.00, 20/20** |

### Judged checks: grader stability confirmed 2026-07-31

`eval:judge-variance --trials 3` against both new rubrics, both frozen runs: **0 flips on
every frozen input** — 144 trials over 48 inputs on 4.6, 141 over 36 judged inputs on
Sonnet 5, with no input disagreeing across its three trials. Zero flips over 48 inputs
bounds the per-input flip rate at roughly ≤6% (95%); it is not a claim of determinism, and a
fixture whose rate later looks implausible is worth more trials on that one input.

The rubrics discriminate rather than answering the same way regardless of input, which a 0%
flip rate alone would not establish: `turn21-narrating-past-a-block` passes on every rep of
both models while `turn16-narrating-past-a-block` fails on every rep of both, under the same
rubric.

| Fixture (judged) | 4.6 | Sonnet 5 |
| --- | --- | --- |
| `turn01-unauditable-mapping` | 0/10 | 0/9 (1 gated) |
| `turn03-unauditable-mapping` | 1/10 | 0/7 (3 gated) |
| `turn14-unauditable-mapping` | 1/9 | n/a — all 7 gated |
| `turn16-narrating-past-a-block` | 0/10 | 0/10 |
| `turn21-narrating-past-a-block` | 9/9 | 10/10 |

`unauditable-mapping` is the strongest signal in the corpus: 2 passes across 45 judged
inputs spanning both models. The Warden essentially never states a result-to-meaning mapping
before a spontaneous roll. Under the regex this read as 15 and 4 verdicts respectively, with
the shortfall indistinguishable from the rule not recognising the phrasing; it is now 29 and
16 verdicts with the remainder explicitly accounted for as turns that rolled nothing.

### What moved, and why it matters more than the numbers

**Three of these rates were measuring the harness.** `turn16-narrating-past-a-block` read
0/10 under *both* models because the check failed every rep on a `dice_request` the fixture
itself seeded with `target: null` — a value fixed at capture time, before the Warden under
test ever ran.

> **The rule was invalid; the number turned out to be right.** Judge-variance against the
> migrated rubric fails `turn16` on 10 of 10 reps under *both* models, graded by a judge
> that never sees the seeded request. So the old rate was correct by accident. This is worth
> keeping straight: "the checker was measuring the wrong thing" and "the finding was wrong"
> are separate claims, and only the first was established by finding the defect. The second
> needed an independent measurement, which is what re-scoring under a different mechanism
> provides. `turn19-out-of-order-resolution` read 0/9 largely because its regex matched
*NPC* damage rolls ("Contractor rifle damage if hit") that were never gated by the player's
pending request. Neither was a fact about model behaviour.

#### `turn16`'s full correction history, because it has been mis-stated more than once

Stated in order, since every partial version of this story is misleading in a different
direction:

1. `turn16-narrating-past-a-block` read **0/10 under both models**, and was written up as a
   confidently-zero model finding.
2. The checker had a real defect: it treated any resolved `dice_request` with `target === null`
   as a self-ruling violation, and the *fixture* seeded exactly such a request at capture time.
   Every rep failed before the Warden's behaviour was consulted. The detector bug was genuine
   and was fixed in **`cacf6e5`**, which migrated the check to judged with a structural gate.
3. **The rate did not move.** Under the migrated rubric, graded by a judge that never sees the
   seeded request, `turn16` still fails 10 of 10 under both models.
4. So the original number was **correct by accident** — right answer, invalid derivation. It
   was not evidence when it was published, and it is evidence now, and those are two different
   states that happen to display the same digits.
5. The commit message for `cacf6e5` overstated the correction (it read as though the finding
   itself was retracted); `600cc73` walked that back. The doc-level version was wrong twice
   before landing here.

The conclusion that matters for future work: **`turn16` is a genuine, reproducible Warden
failure and one of only two in the corpus that survive the Sonnet 5 upgrade.** It belongs at
the top of the next prompt-iteration pass, alongside `unauditable-mapping`. Nothing about the
checker defect diminishes it — and the temptation to quietly drop a finding whose derivation
turned out to be broken is exactly what step 4 exists to resist.

**A model-stability gap closed.** `unauditable-mapping`'s classifier reached a verdict on
15 of 20 reps under 4.6 and 4 of 20 under Sonnet 5 against an unchanged prompt — the clearest
demonstration in this corpus that a regex over prose encodes the idiom of whichever model
was current when it was written. The structural replacement reaches one on 20 of 20 and 16
of 20, and all four remaining exclusions are turns that rolled nothing at all.

**Two checks now report undecided where they used to guess.** `system-rolled-player-action`
returns `not_applicable` when nothing binds to the player by the leading-name convention
*and* unattributable system-side rolls are present (2 of 40 reps, both on 4.6 turn21, where
they were that fixture's only two passes). `out-of-order-resolution` returns it when the
turn left no pending gate, naming the missing `gatedByRollId`. Both cost denominator on
purpose: a rep whose verdict rests on a prose match having failed is not evidence.

**One check was reviewed and deliberately left structural.** `missing-canon-capture` reports
`not_applicable` on all 20 reps, and that is correct — the narration genuinely never
introduces the detail `turn02` asks about, verified by normalised and loose matching alike.
Migrating it to a judge would have converted an honest zero denominator into a spurious
1.00, because a binary judge verdict cannot express "nothing to grade." The defect is in the
fixture, which asks about a detail neither model reproduces and therefore grades nothing;
that is fixture work, not a checker change.

### Before trusting any judged rate from this corpus

`eval:judge-variance` against both new rubrics, per step 1 of the comparison procedure
above. New rubric, grader stability unverified, and the two structural halves changed what
reaches them:

```
task eval:judge-variance -- <run-dir> --trials 3 \
  --fixtures turn16-narrating-past-a-block,turn21-narrating-past-a-block,\
turn01-unauditable-mapping,turn03-unauditable-mapping,turn14-unauditable-mapping
```

`--trials` is re-grades **per frozen input**, not a count of source reps. Every vouched
`(rep, fixture)` pair is one frozen input and the run fixes how many there are — nothing
subsamples them. Five fixtures over a 10-rep run is 50 frozen inputs, so `--trials 3` is 150
judge calls. This is the opposite axis from `eval:run --reps`, which is why the flag is not
called `--reps`.

Note that `unauditable-mapping` carries a structural pre-filter, so some frozen inputs never
reach its rubric. Those are excluded from the flip-rate denominator and reported separately
as `gatedInputs` — a rubric validated on two inputs because a gate absorbed the other
eighteen has not been validated, and the flip rate alone will not say so.

---

## Re-scoring frozen runs

`eval:rescore` re-grades a run's `warden-output.json` artifacts under the current checker
registry — no Warden calls, no database, structural checks free. It is the right tool after
a scoring-only bump or a checker change, and the wrong one after an input-affecting bump,
where the artifacts were produced under conditions that no longer hold.

Rows land at `<run-dir>/rescore/<timestamp>.jsonl`, never under `reps/` — same argument as
`judge-variance`. Keyed by timestamp rather than `corpusVersion` because a checker change
moves no fixture bytes, so successive re-scores would collide on that name.

**Read the column tenses carefully.** On a re-score row, `model` / `promptHash` describe
*generation* and are copied from the manifest; `corpusVersion` / `harnessVersion` describe
*scoring* and are recomputed. Same column names, different moment. `source*` columns keep
the originals.

Rows with no artifact to re-grade (the turn errored before writing one) are carried forward
rather than dropped, so a re-score file is a complete replacement for a run's rows — omitting
them would make a re-scored report look cleaner than the run it describes.

**`eval:compare` does not read re-score rows**, only `reps/*/scores.jsonl`. A comparison
across re-scored numbers has to be read from the `eval:rescore` report directly for now.

---

## Running a comparison

The commands exist now, so the order they're meant to run in is worth naming rather than
leaving implicit:

1. **`eval:judge-variance`** against a small frozen run, once per judged rubric in play.
   Run this *before* trusting any prompt comparison. If a rubric flips against fixed
   input, the instability is in the grader, and no `eval:compare` output built on top of
   it means anything until the rubric is fixed. It's cheap — no Warden calls, frozen
   input — so skipping it is never the right call.
2. **Baseline run** — `eval:run` against the current production prompt, uniform N, full
   corpus, `--decision-rule` written down before looking at any numbers.
3. **Candidate run** — `eval:run` against the prompt variant under test, same N, same
   corpus, its own `--decision-rule`.
4. **`eval:compare`** the two run directories. It pairs on `(fixtureId, checkId)`, puts
   regressions first, and echoes both `--decision-rule`s in the header next to the numbers
   they govern — it does not evaluate the rule for you.

**Mixed-rubric warnings.** A run covering several judged checks spans several rubric
hashes as a matter of course — one hash per check's rubric template — and `eval:compare`
does not warn about that. It warns only when a *single* check's own rows span more than
one hash, meaning that check's rubric template was edited partway through the run, so its
reps aren't graded by the same criteria. The warning names that one check; every other
check's rates in the report are unaffected and can still be trusted. It also prints the
exact fix: `--filter-rubric CHECK=HASH`, scoped to the named check, repeatable if more than
one check drifted. Don't reach for a bare hash — the flag requires the check id so it can
never accidentally drop an unrelated check's results.

**A code change that alters what reaches the Warden warrants a full-suite run, even with
an untouched prompt hash.** `promptHash` only fingerprints the prompt text; it says
nothing about the snapshot builder, the tool schemas, the validator, or anything else
that shapes the request Claude actually sees. A run directory's identity is `(model,
promptHash)`, so two runs against an unchanged prompt but a changed snapshot builder look
identical by name — the only way to catch the regression is to have actually run the
suite. Treat "the prompt didn't change" as informative about the prompt, not as a reason
to skip the run.

---

## Two kinds of corpus bump

`corpusVersion` is a content hash over the fixture files, which is the right property for
detecting that *something* changed and the wrong one for deciding what to do about it. Two
materially different edits produce the same kind of hash change:

**Input-affecting.** The edit changes what reaches the Warden — `playerInput`, the captured
state snapshot, anything the turn is executed against. Every `warden-output.json` on disk
was produced under different conditions and is no longer evidence about the current corpus.
The only valid response is a fresh run.

**Scoring-only.** The edit changes how existing output is graded — the `applicability`
field, `assertion.facts` a checker reads, a checker's own logic. Frozen artifacts remain
exactly as valid as they were; re-scoring them in place is a real measurement, not an
approximation of one.

The `8071500a4952...` → `4c9f2e73efd7...` bump was scoring-only, which is why re-grading
the two existing runs off disk produced genuine corrected rates with no API spend and no
re-run. That distinction was obvious to the person who made the edit and will not be
obvious to anyone reading the hash six months later.

**Convention: name the kind in the bump note**, next to the hash, in the same place the
change is described. The two mistakes this prevents are not symmetric — re-running after a
scoring-only bump wastes money and nothing else, while reusing artifacts after an
input-affecting bump silently produces numbers that look fine and mean nothing. Default to
re-running when the note is missing or the kind is unclear.

---

## A model swap audits the harness as much as the model

The first full-corpus run against a new model is two experiments wearing one coat. It
measures the model, and it measures whether the corpus was quietly encoding assumptions
about the *previous* model's behaviour. Budget for the second one — the 4.6 → Sonnet 5
baseline surfaced two harness defects, and neither was visible from any number of runs
against 4.6 alone.

**Fixtures can encode a model's failure profile.** `turn19`/`turn21` capture a single turn,
which was sufficient to observe `out-of-order-resolution` under 4.6 because 4.6 compressed
a to-hit request and its resolution into one turn — itself the OVER-RESOLUTION failure.
Sonnet 5 splits them across a turn boundary and defers, so the in-turn ordering case never
arises for it. The fixture wasn't wrong; it was calibrated, without anyone deciding to
calibrate it, to a failure mode the new model doesn't have.

> **A correction, because the first reading of this was wrong.** This was originally written as
> "the ordering evidence now lands on a turn the fixture doesn't contain," with the implied fix
> of extending turn19/21 through the follow-up turn. Both halves were mistaken. The evidence
> was in the captured turn — the structural deferred-gate rule reads it off the same frozen
> artifacts (Sonnet 5, 20/20) — and the extension would have been unsound anyway, because a
> deferred gate ends the turn and any dependent roll on the follow-up turn is after resolution
> by construction. A model swap can make a fixture look too small when the actual defect is in
> the checker; check the checker before rewriting the corpus, since only one of those two is
> reversible for free.

**Heuristic classifiers standing in front of structural checks are the highest-risk
surface.** Three confirmed instances now, all the same defect wearing different symptoms:

1. **`UNSURFACED-CHECK`** — a regex classifier missed a stakes-gating roll phrased as a
   question ("Does anything react to Alvarez moving…") rather than with a fixed keyword, and
   returned a false pass on a real run. Migrated to a judge call. This one surfaced without a
   model swap.
2. **`system-rolled-player-action`** — matched on damage-roll phrasing, which reliably caught
   4.6 because 4.6 over-rolls and produces damage rolls constantly. Sonnet 5 rolls to-hit and
   stops, so the matcher saw nothing and returned PASS on turns containing the exact violation
   the check exists to catch — again a false pass, not merely a false `not_applicable`.
3. **`unauditable-mapping`'s `NARRATIVE_SELECTION_PATTERN`** — returned false
   `NOT_APPLICABLE` on twelve turns of `"Ambient station event check"`, which is the model's
   own dominant phrasing for exactly the roll type the check exists to grade. This is the
   quietest of the three and the most instructive: it produced no wrong verdicts, only missing
   ones, so it presented as low applicability rather than as a defect. The rate it left behind
   was computed over the turns the regex happened to recognise.

The pattern across all three is that a regex over prose encodes the idiom of whichever model
was current when it was written, and silently stops matching when that changes. A model swap
is what makes them visible at once; it is not what creates them.

**Practical rule: on a new model's first run, treat large applicability shifts and large
rate jumps as harness suspects before recording them as model findings.** Both defects
above announced themselves as suspiciously good news — a category going to 1.00, a pile of
turns becoming non-applicable. Neither read as a bug at first glance. The check is cheap:
for any check whose denominator moved sharply, hand-construct output that *should* produce
each verdict and confirm the checker agrees.

---

## Denominators are not automatically model-neutral

Every earlier instance of a prose dependency corrupted a *verdict*. `isAttributedTo` corrupts
a *denominator*: binding a roll to the acting entity by the Warden's leading-name convention
left 3 of 20 reps unbindable under 4.6 and 0 of 20 under Sonnet 5, because the two models
phrase `purpose` differently. A comparison whose two sides are computed over differently-sized
and differently-selected populations is not the comparison it appears to be, and no amount of
care reading the rate will surface it.

So when comparing models, check the denominators before the rates, and check whether anything
inside the applicability path depends on wording. This is the strongest practical argument for
reporting applicability alongside rate rather than leaving it derivable: a rate moving because
its denominator moved looks identical to a rate moving because behaviour moved.

**The reports now do this, so the check is no longer manual.** `eval:report` carries an `App`
column on the per-fixture and per-tag tables; `eval:compare` carries `App A`/`App B`/`ΔApp` on
every row and an `Applicability shifts` section ranked by magnitude, which is where a
denominator collapse shows up even when no rate delta can be computed. Applicability is
`N / (N + NA)` with errors excluded — an errored rep never determined whether the check
applied. Read it next to the `Src` column: the same number is a harness defect on a
fixture-gated check and a behavioural measure on an artifact-gated one. See `decisions.md`,
"Applicability is reported alongside every rate."

One more thing to check before comparing two runs: **which grading each side was rendered
from.** A run directory can hold its own `scores.jsonl` plus several `eval:rescore` passes.
Both commands take `--scoring` and name the resolved grading in their headers; `eval:compare`
warns when the two sides land on different ones.

A related lesson from the same audit: `out-of-order-resolution` carried a roll-before-
`player_action` clause that could never fire, because `writeTurnEvents` writes `player_action`
unconditionally first and a scratch adventure seeds no prior `game_events`. Dead code in a
checker is invisible from run data — it produces no verdicts and no errors — and is caught only
by the practice already recorded above: hand-construct output that *should* produce each
verdict, and confirm the checker agrees.

---

## Un-rankable is a numerator problem, not a sample-size problem

`eval:compare` sorts by rate delta, which means the row it puts at the top is the row a reader
treats as the headline. In the 4.6 → Sonnet 5 re-scored comparison, the Regressions section
was headed by `turn03-unauditable-mapping` at **0.10 → 0.00**. That is one passing rep out of
ten against zero out of seven. Fisher's exact test gives p ≈ 1.0 — the two sides are, on this
evidence, indistinguishable.

**An `N < 5` floor does not catch it.** N was 10 and 7; both sides clear any plausible sample-size
threshold. The pair is un-rankable at *any* N, because the numerators are 1 and 0. No count
threshold can express that, and a significance test can — which is the whole argument for having
one, stated as narrowly as possible: not "the harness should be statistically rigorous," but
"there exists a specific, recurring failure that only a significance test detects."

**Both belong, and they decline different things.** The N floor declines to rank pairs that are
genuinely thin. The Fisher test declines to rank pairs whose move isn't distinguishable from
noise regardless of thickness. Neither subsumes the other: a 1-of-10 vs 0-of-7 pair passes the
floor and fails the test; a 3-of-4 vs 0-of-4 pair fails the floor and would pass the test.

**Implemented as a rankability gate, never a display filter.** This distinction is the reason
the section exists. Non-significant rows still render — in a band beneath the ranked ones,
labelled as not distinguishable from noise — because a small move that recurs across three
consecutive runs is a real signal, and a filter would destroy the only evidence that could ever
establish it. The failure being avoided is the same one recorded under a warning's suggested
remedy in `decisions.md`: resolving an inconsistency by deleting it. Suppressing a row makes the
report look decisive; it does not make it correct.

**Cost, when someone wants it.** Fisher's exact for a 2×2 is a hypergeometric tail sum, roughly
twenty lines with no dependency, and it slots into `isRankable` alongside the existing N floor.
It is not built today. The reason to write this down rather than build it now is that the gate
only matters once comparisons are run often enough that nobody re-derives each headline by hand,
and at present they still are.
