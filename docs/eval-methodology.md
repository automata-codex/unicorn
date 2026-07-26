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
