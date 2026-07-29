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
- Corpus version: `8071500a4952...` (short form; full hash in the run's `manifest.json`)
- Run directory: `claude-sonnet-4-6__97feadbd__2026-07-29T10-51-26Z`

**Basis.** Binomial variance is worst at p=0.5, and several fixtures in this corpus sit
near there. At N=10, the 95% CI half-width at p=0.5 is ~±31pp; tightening that to ±15pp
would need N≈40+, which isn't affordable for routine comparisons (a two-sided comparison
at N=10 over the full 15-fixture corpus cost ~$30/side in the calibration run; N=40 would
run ~$120/side, ~$240 for one comparison). N=10 is a deliberate precision-for-cost
tradeoff, not an oversight — the fixtures sitting near 0.5 (mostly the `turn24-*` judged
checks) carry real uncertainty at this N and should be read as "unsettled," not as a
precise estimate, until/unless the budget for a higher N is revisited.

**Observed at N=10, candidates for `repOverride` during supervised iteration** (rate 0.0
across all reps, confidently — n large enough that the result isn't just small-sample
noise):

- `turn01-unauditable-mapping` (0/6)
- `turn03-unauditable-mapping` (0/9)
- `turn03-unsurfaced-check` (0/10)
- `turn16-narrating-past-a-block` (0/10)
- `turn19-out-of-order-resolution` (0/9)
- `turn21-out-of-order-resolution` (0/9)

`turn14-unauditable-mapping` also read 0.0 but at n=2 (7 of its 10 reps were
`not_applicable`) — too small a sample to call it settled; it's a low-applicability
fixture, not a confidently-zero one, and needs disproportionately more reps than the rest
of the corpus to reach the same confidence, not fewer.

None of the above may take a permanent `repOverride` in the standing regression suite —
per the hazard above, a fixture settled today is exactly the one a future prompt edit
might destabilize, and a standing low-N override is deciding in advance not to notice.
`repOverride` is for deliberate, temporary use during a specific supervised-iteration
session only.

**Re-check trigger.** This N was estimated under the conditions listed above. A model
change, a meaningfully different corpus (fixture count or content), or a prompt rewrite
substantial enough to shift where fixtures sit relative to 0.5 all warrant revisiting this
number rather than assuming it still holds.

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

**A code change that alters what reaches the Warden warrants a full-suite run, even with
an untouched prompt hash.** `promptHash` only fingerprints the prompt text; it says
nothing about the snapshot builder, the tool schemas, the validator, or anything else
that shapes the request Claude actually sees. A run directory's identity is `(model,
promptHash)`, so two runs against an unchanged prompt but a changed snapshot builder look
identical by name — the only way to catch the regression is to have actually run the
suite. Treat "the prompt didn't change" as informative about the prompt, not as a reason
to skip the run.
