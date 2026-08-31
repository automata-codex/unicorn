# Eval Methodology Notes

Lessons about how to run the Warden eval harness, as distinct from what it measures.
Decisions with alternatives-and-rationale belong in `decisions.md`; this file is for
methodology that would otherwise become folklore.

**Dated records in here predate `docs/eval-findings.md`, and new ones do not go
here.** `§ Structural check migrations`, the two `§ Bump note` sections,
`§ Same-prompt run-to-run variance`, and the measured tables under `§ Current
baseline N` are all records of what happened on a particular date — which is
`eval-findings.md`'s subject, not this file's. They accumulated before that file
existed, each arriving with a lesson attached that made it feel at home, and they
stay: several are cited from ADRs and `§ Outcome` is cited from
`docs/plans/013-m7.5-open-work.md`, which is frozen.

The test for a new entry: **a rule you would apply to the next run belongs here; a
number you got from the last one belongs in `eval-findings.md`.** A rule may quote
the measurement that establishes it — `§ Un-rankable is a numerator problem` and
`§ Before trusting any judged rate from this corpus` both do — and that is
different from the measurement being the point.

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

**The standing comparison point, in one place.** This is the only entry to update
when a baseline is accepted. The dated sections below are history — kept for the
corrections and caveats attached to each, not to be read as competing claims about
what is current.

- **Last recorded:** `claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`, prompt
  `e83e8aaa`, assembly `ada7fb8a`, corpus `c077bc456af7`. Full corpus, 10 reps.
  Accepted 2026-08-28 against the rule pre-registered in
  `docs/eval-findings.md § S38`; results and disposition in `§ S39`.

**Superseded `claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z` (prompt
`fa4e6e2f`, corpus `abbce198026c`) on 2026-08-28.** That run stays the correct
comparison point for anything measured before plan 021's `roll_dice.purpose`
change; it is not the current baseline.

**The five runs between the two, none of which was accepted as a standing
point:**

- `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z` — the re-baseline `§ S36`
  diagnoses `UNAUDITABLE-MAPPING` against.
- `claude-sonnet-5__995083c8__2026-08-23T13-24-26Z` — partial, 7 reps.
- `claude-sonnet-5__f0753f86__2026-08-23T14-39-39Z` and
  `claude-sonnet-5__f0753f86__2026-08-23T16-26-10Z` — the accidental
  same-prompt pair measured in `§ Same-prompt run-to-run variance`.
- `claude-sonnet-5__e83e8aaa__2026-08-24T11-21-49Z` — the most recent, and what
  `§ Bump note — 2026-08-24` measures a corpus change against without declaring
  it a baseline.

`claude-sonnet-5__e83e8aaa__2026-08-24T11-21-49Z` is the one of the five that
matters: plan 021's change was measured and held there (`UNAUDITABLE-MAPPING`
9/10 at applicability 10/50, dispositioned in `c3de56a`), and it is the
like-for-like comparison point for `§ S39`. Compare against its `rescore/` rows
rather than its `reps/` rows wherever `SCENE-JUMP` is involved — the two disagree
by half a point under different rubrics.

**What the next full-corpus run owes.** A standing list, emptied as each item
is scored. It is the manual stand-in for a check that does not exist — see
**What `baseline-check` does not check** below for why, and for the two shapes
that keep falling through.

- **`docs/eval-findings.md § S41`**, outstanding since 2026-08-29. The four
  fixtures the `UNAUDITABLE-MAPPING` widening added (corpus `c077bc456af7` →
  `6bc7eee3970f`) have never executed, and no rescore can reach them. Score it
  in the run's own write-up. **Its falsifier is per-fixture applicability, not
  the rollup** — three of its five predictions name individual fixtures
  (`2c0ba938-turn25/45/51-` and `5c34991b-turn44-unauditable-mapping`), and the
  rollup is explicitly not readable as a movement across this bump.

**Scoped rider runs, dispositioned by hand.** These are not baseline candidates,
and while `baseline-check` does enumerate them, all it asks is that the run id
appear somewhere in this file — see the correction under **What `baseline-check`
does not check**. Each is recorded here on landing, with a real disposition
rather than a bare mention, until M7.8's `baseline-check` item closes.

- **`claude-sonnet-5__e83e8aaa__2026-08-31T13-18-04Z`** — run A of the
  `ship_layout` restructure experiment, pre-registered in
  `docs/eval-findings.md § S42`. Scoped to the two newly captured fixtures, 20
  reps, `promptHash e83e8aaa` and `assemblyHash ada7fb8a` unmoved, corpus
  `301302000143`. **Read and dispositioned in `§ S43`.** Baseline only, no
  comparison drawn: `2c0ba938-turn18` 0.35 (7/20), `2c0ba938-turn24` 0.89
  (16/18), applicability full on both. Its void condition did not fire, so
  `turn18` stands as the treatment fixture run B is read on. **Not a standing
  point**, and nothing in it supersedes the entry above.

**Named in full deliberately.** `task docs:baseline-check` matches run
directories against this file by full run id, so a prompt hash or a truncated
timestamp does not count as having dispositioned a run — and the first version of
this paragraph, which used bare hashes, is what the check caught. It also omitted
`995083c8` entirely.

**What `baseline-check` does not check.** The tool verifies exactly one
pairing: every run directory under `$ZOLTAR_EVAL_ROOT/eval-runs` newer than the
standing point is named somewhere in this file. Everything outside that pairing
is enforced by memory, and two shapes have now fallen through it. They share a
root, so they are recorded together rather than each beside its own incident.

- **A run on disk that is not a baseline candidate.** The Haiku 4.5 control arm
  (`§ S40`) sat undispositioned for twelve days. Diagnosed in `ADR-0082`'s
  closing addendum. **The proposed fix, recorded here because it was raised when
  `§ S40` was written and left only in that session's transcript:** teach
  `baseline-check` about `--fixtures`-scoped rider runs, rather than adding a
  separate target for them. Cheaper than it sounds — a rider run is already a
  directory with a manifest, and the manifest names its fixture scope.

  **Correction, 2026-08-31 — this bullet overstated the gap, and the overstatement
  has been repeated since.** It read "the check could not catch it — a control arm
  is not a baseline candidate, and neither is a `--fixtures`-scoped rider run, so
  nothing verifies one was ever read." Two things are wrong with that. The check
  did not exist during the twelve days (`docs/tooling/baseline-check.ts` landed
  2026-08-28 in `709d7ba`, the same day the arm was dispositioned), so it did not
  fail to catch anything. And it does **not** skip rider runs: it enumerates every
  directory under `eval-runs` carrying a `manifest.json`, which a scoped run
  writes like any other. Demonstrated 2026-08-31 — `baseline-check` went from "0
  newer run(s)" to "1 newer run(s), all accounted for" across run A of the
  `ship_layout` experiment, having required it be named first.

  **The real gap is narrower and still worth the M7.8 item.** The check verifies
  that a run id *appears in this file*, not that anything was read: a bare mention
  in a list satisfies it, and a rider run that needs a different kind of
  disposition than a baseline candidate is indistinguishable to it. That is what
  the fixture-scope hook in the manifest would buy. `§ S42` and `§ S43` were
  drafted against the overstated version and say the runs are "invisible" to the
  check; they are corrected in place.
- **A pre-registration with no run at all.** `§ S41` predicts the behaviour of
  four fixtures that have never executed, against a run that has no date. There
  is no run directory for the check to enumerate, so it cannot key on anything.
  Earlier pre-registrations never exposed this because they were written days
  before the run they were for — `§ S38` was written for a run that landed the
  same day, and `§ S39` scored it.

Both are the same failure at different stages of one pipeline, which is what
`ADR-0082`'s addendum means by "the same failure, one stage later": the arm was
two days from being dropped from a checklist, then its result sat for twelve,
and now a prediction about a result waits on nothing but this list. **Neither
fix subsumes the other** — one teaches the check about run directories it
currently skips, the other about a record that has no run directory yet. Both
belong to M7.8, which already owns grading the harness rather than the Warden.

**Check the archive before citing a baseline**, and when one is accepted, say so here rather than by adding a fourth
dated section: three of them accreted because each new baseline was recorded
beside the last instead of replacing it, which is how a reference section becomes
a chronology.


### 2026-08-10 — the standing point moved to `c45a142a`

**N is still 10 and has not been re-calibrated.** What changed is everything it was
calibrated *against*, so the calibration basis above is now historical and the standing
comparison point is:

- Model: **`claude-sonnet-5`** — `claude-sonnet-4-6` was retired from baselining rather
  than re-run, a recorded scope deviation
  (`docs/plans/014-turn19-roll-ownership.md`). Both-model baselines no longer exist
- Prompt hash: **`c45a142a`**
- Corpus version: **`83fe9ee82341`**
- Run directory: **`claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z`**
- Full corpus, 10 reps, zero errors. Tag figures in
  `docs/rules-extraction-findings.md § S34`

**Superseded `…T12-18-32Z` (`§ S33`, corpus `104b2d944252`) on 2026-08-10.** That run
remains the correct comparison point for anything measured before the `<entities>`
player-source change; it is not the current baseline.

**`promptHash` does not separate these two runs, and that is a trap worth stating.**
The `<entities>` change lives in the snapshot builder, not `mothership-m7.txt`, so both
runs carry `c45a142a` and their directory names claim the same `(model, promptHash)`
identity while the Warden saw materially different input. Only `corpusVersion` and
`harnessVersion` distinguish them, and only `eval:compare`'s corpus warning surfaces it
automatically. **A snapshot-builder change is an input change that the run's own naming
cannot express** — read the manifest, not the directory name, whenever two runs share a
prompt hash.

**The N=10 estimate is inherited, not re-derived.** Per "N is calibrated, not chosen"
above, this warrants a re-check rather than an assumption: the number came from
per-fixture variance measured under a different model, a different prompt, and an
*empty* `rules_chunk` index. Nothing here re-measured variance. Treat N=10 as carried
forward on the same precision-for-cost reasoning in "Basis" below, and re-derive it if a
comparison ever turns on a difference near the ±31pp half-width.

**A tag rate can certify a fixture rather than the corpus.** `§ S34` accepted this
baseline on `SYSTEM-ROLLED-PLAYER-ACTION` reading 1.00 (20/20) while the artifacts show
the Warden rolling the player's declared action six times — every occurrence on a
`turn24-*` fixture, which carries no `system-rolled-player-action` check. The rate is
honest about the two fixtures it grades and says nothing about the other thirteen. This
is the denominator failure this file already catalogues, displaced one level: not a rate
over a shrinking denominator, but a rate over a denominator that never covered the
behaviour. **Before reading a tag as a corpus-level claim, check which fixtures carry
that check.** **Closed 2026-08-16 for this tag** — the three `turn24-*` fixtures now
carry a `system-rolled-player-action` check and the re-scored rate is 0.88 (44/50); see
`§ S35` and `ADR-0096`. The rule above outlives the instance, and a fixture carries a
check because someone authored it there, so it can go wrong again the same way.

### 2026-08-16 — the standing point moved to `ccac7d1c`

**N is still 10 and still has not been re-calibrated.** The standing comparison point moves to
M7.6's re-baseline:

- Model: **`claude-sonnet-5`**
- Prompt hash: **`ccac7d1c`**
- Corpus version: **`1c2a418cf68c`** as of 2026-08-16; the run was scored under **`2cfaf351a760`**,
  an **input-affecting** bump (`§ Two kinds of corpus bump`) — every pool key changed format and ten
  pools appear, so `campaignState` changed for all 15 fixtures. The bump to `1c2a418cf68c` is
  **scoring-only** and is graded off this run's frozen artifacts (see the note below)
- Run directory: **`claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z`**
- Full corpus, 10 reps, zero errors. The closeout and category calls for this run are below

**Superseded `claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z` (corpus `83fe9ee82341`).** That run
stays the correct comparison point for anything measured before M7.6's snapshot changes. It is not
the current baseline.

**`eval:compare` across this boundary is meaningless, and that is not a warning to suppress.** Six
Warden-visible changes ride the one run — the snapshot's `owner.pool` addressing,
`<character_attributes>`, the pool-delta array with `reason`/`maxDelta`/`damageType`,
`characterState`, the wounds chain, and the re-keyed corpus. No per-tag delta against `c45a142a` is
honest, which is why M7.6's category calls are argued from §6.3 predictions and absolute rates
instead.

**This baseline certifies less than a full-corpus run normally does.** Read it with the run's own
"What this run does not measure" section: `characterState`'s five families have no floor from it at
all, the absolute-vs-delta count excepted, and M7.6's two new checks — `CARRYOVER-ARITHMETIC` and
`UNEXPLAINED-DELTA` — carry no denominator because no fixture yet exercises them. Three of fifteen
fixtures (`UNAUDITABLE-MAPPING`) contributed zero applicable reps, and `turn16-narrating-past-a-block`
is a known-defective fixture (`ADR-0082`, addendum 2026-08-16). **Nine of fifteen fixture rows read 1.00 and almost none of them are
evidence.**

**Corpus version updated 2026-08-16 to `1c2a418cf68c...` — a coverage fix, not a re-run.**
The three `turn24-*` fixtures gained a fixture-authored `applicability` entry for
`system-rolled-player-action` (and `fixtureSchemaVersion` 1 → 2), which now attaches that check
to them — `ADR-0096`. **Scoring-only**: `seededState`, `playerInput` and `assertion` are
untouched on all 15 fixtures, so every `warden-output.json` on disk was produced under unchanged
conditions. Re-scored in place rather than re-run, both runs, `--fixtures` scoped to the five
fixtures now carrying the check:

- `claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z` (the current baseline) — `SYSTEM-ROLLED-PLAYER-ACTION`
  0.90 (18/20) → **0.94 (47/50)**, applicability 1.00 (50/50). No verdict changed across all 80
  rows; the three new fixture-check pairs are additive.
- `claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z` (`§ S34`) — 1.00 (20/20) → **0.88 (44/50)**, the
  six occurrences `§ S34` counted by hand. One judged verdict flipped on this run
  (`turn24-scene-jump / scene-jump`, `fail → pass`, `SCENE-JUMP` 0.90 → 1.00) — **judge variance on
  an ungated judged check, not a consequence of the corpus edit**; see `ADR-0080`.

Reports at `<run-dir>-rescore-srpa-turn24.md`, raw rows under each run's `rescore/`. `eval:compare`
will correctly warn on any pairing against a run scored under `2cfaf351a760...`; re-score rather
than suppress. Full write-up in `docs/rules-extraction-findings.md § S35`.

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

### 2026-08-21 — the standing point moved to `fa4e6e2f` (the last one recorded)

**N is still 10 and still has not been re-calibrated.** The standing comparison point moves to
018's re-baseline:

- Model: **`claude-sonnet-5`**
- Prompt hash: **`fa4e6e2f`**
- Assembly hash: **`3d8df5f3`** (`ADR-0099`)
- Corpus version: **`abbce198026c`** — an **input-affecting** bump from `cbc840d21158`
  (`§ Two kinds of corpus bump`), because seven fixtures gained `gmContextBlob.playerEntityIds`
  and the `<entities>` block therefore gained a `player_character` line it did not have
- Run directory: **`claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z`**
- Full corpus (22 fixtures), 10 reps, **four errored turns** — not zero, and all four attributed
  before any number was read. The closeout and category calls for this run are below

**Correction, 2026-08-21: this run's `ROLL-RESULT-INVERSION` is 1.00, not the 0.90 its report
renders.** Its single failure is a judge contradicting its own rationale — the text closes on
*"Marking as passed (no violation)."* under `verdict: fail` (rep 003,
`5c34991b-turn10-roll-result-inversion`). The tag has one other failure in the whole corpus and
that one is genuine, so this is 1 of 2. **Anything compared against this baseline on that tag must
use 1.00**, and the first comparison to hit it already went wrong: spec 019's `eval:compare` listed
`ROLL-RESULT-INVERSION` under *Unchanged* at 0.90 → 0.90, when the truth is 1.00 → 0.90. See
`§ Before trusting any judged rate from this corpus`.

**Settled 2026-08-23: that −0.10 was not a real regression, and the record
below is superseded.** Both runs were re-scored under judge contract
`01620ef7`, scoped to the one fixture carrying the tag, and both return 1.00
(10/10). The corrected comparison is **1.00 → 1.00**. See
`§ Bump note — 2026-08-23`. The reasoning that anticipated it, preserved:

**Follow-up 2026-08-22: that −0.10 is probably not a real regression.** Spec 020's variance runs located
spec 019's single `ROLL-RESULT-INVERSION` failure — it is **rep 004**, and that is the same frozen input
which fails 3/3 under the old judge contract and passes 3/3 under the new one (`ADR-0102`). So both sides
of the comparison were reading 0.90 for the same reason, and the corrected figure is most likely
1.00 → 1.00 — genuinely *Unchanged*, arrived at by two wrong numbers rather than one.

**The mechanism differs from the baseline's above and the two should not be blurred.** Rep 004's recorded
artifact is a **consistent** fail, closing on *"a probable inversion reaching the player"* — it is not a
contradiction. The input sits on a decision boundary and the field order decided which side of it the
judge landed on. A contract-dependent verdict and a self-contradicting verdict are different defects with
the same cause.

**This reopens a re-score option spec 020 declined, on better grounds than it had.** The objection was
that a re-score under the new contract is not like-for-like with the contract-A numbers it corrects — true
against history, but re-scoring *both* runs under contract B makes them like-for-like with **each other**,
which is what a comparison actually needs. Roughly 20 judge calls for this one tag across two runs. Not
spent.

**Superseded `claude-sonnet-5__ccac7d1c__2026-08-18T11-48-47Z` (corpus `1c2a418cf68c`).** That run
stays the correct comparison point for anything measured before 018's snapshot and tool-schema
changes. It is not the current baseline.

**`claude-sonnet-5__fa4e6e2f__2026-08-20T20-20-01Z` is void and is not a comparison point for
anything.** Seven of its 22 fixtures ran with `playerEntityIds` unset, so `attributionContext`
returned `'unknown'` for every roll on them and `renderEntities` never told the Warden which entity
was the player. Its fifteen older fixtures were unaffected and its
`SYSTEM-ROLLED-PLAYER-ACTION` figure is quoted below as a legitimate midpoint; nothing else from it
should be cited.

#### What this run establishes

`SYSTEM-ROLLED-PLAYER-ACTION`, measured **like-for-like on the five shared fixtures** rather than
off the rollup, because the rollup's denominator moved when seven fixtures joined:

| Run | Rate | Failures |
|---|---|---|
| `ccac7d1c__2026-08-18` | 0.92 (45/49) | 4 |
| `fa4e6e2f__2026-08-20` (void run, old fixtures valid) | 0.96 (45/47) | 2 |
| `fa4e6e2f__2026-08-21` | **0.98 (47/48)** | 1 |

Monotone across three runs. **Read as "018's skills render did not hurt", not as a win** — at one
failure the interval is very wide, and no prediction called for an improvement. The pre-registered
risk was the opposite: that handing the Warden `+10`/`+15` would invite it to resolve the player's
own checks. It did not.

**The two newly-judged tags discriminate, which is the result that matters about them.**
`MISSING-DELTA` 0.75 (15/20), splitting 0.70 / 0.80 across its two fixtures. `ROLL-RESULT-INVERSION`
0.90 (9/10). The decision rule's "≥0.90 is a blind rubric, not a pass" clause fires on the latter at
exactly the threshold — and the movement off the void run's 1.00 is the evidence that clause exists
to look for. A blind rubric stays pinned; this one found the inversion. **One occurrence in ten is
thin**, and the honest reading is that the Warden reproduces the captured inversion at roughly 10%
rather than systematically.

`MISSING-DELTA` 0.60 → 0.75 across the two runs is **not** a comparison. The bump between them was
input-affecting.

#### Tool-syntax emission: the 2026-08-18 figure was the optimistic tail

Counted as **turns abandoned for tool-syntax leak ÷ (fixtures × reps)**, which is the only honest
denominator — the `TOOL-SYNTAX-LEAK` check reads 1.00 in every one of these runs because an
abandoned turn produces no `gm_response` and leaves the denominator as an `error`
(`ADR-0097` addendum 3):

| Run | Emission |
|---|---|
| `ccac7d1c__2026-08-16` (unmitigated) | 4/150 — 2.7% |
| `ccac7d1c__2026-08-18` (schema descriptions) | 1/150 — 0.67% |
| `fa4e6e2f__2026-08-20` | 3/220 — 1.36% |
| `fa4e6e2f__2026-08-21` | 3/220 — 1.36% |

**Two independent runs agreeing at 1.36% reframe the 0.67%.** The schema-description mitigation
reduced emission from 2.7% and did not come close to eliminating it; `ADR-0097`'s open item stays
open, and the run report that called 1/150 "suggestive at p≈0.09, not the clean sweep the decision
rule wanted" was right to hedge.

**A gate written against the check rate cannot see any of this.** 018's first decision rule said
`TOOL-SYNTAX-LEAK >= 0.99` and would have passed a run where every turn leaked. Gate on emission.

#### What this run does not measure

Read every number above with this list, not after it.

- **`UNAUDITABLE-MAPPING` is 0.00 (0/10)** — ten failures out of ten, identical to the void run and
  therefore robust to the `playerEntityIds` change. Applicability 0.20 (10/49): **four of its five
  fixtures never apply**, so one fixture carries the entire tag. M7.6's §6.3 prediction that
  applicability would rise off 0/30 is finally fulfilled, and what it revealed is bad. Nothing in
  018 addressed it.
- **`MISSING-CANON-CAPTURE` has now measured nothing for three consecutive runs** — 0/10
  applicability every time, because the narration never introduces the marker phrase the fixture
  waits for. The fixture, not the Warden, is what needs changing.
- **`CARRYOVER-ARITHMETIC` and `UNEXPLAINED-DELTA` remain registered with no fixture carrying
  either.** Third run in a row measuring neither.
- **018's own additions are largely unexercised.** No fixture carries `crewRole`, `instinctRoll` or
  `rollModifiers`, so Contractor Instinct, the role-derived skill chain and the roll-modifier render
  emit nothing anywhere in the corpus. The skills render is exercised only by the fifteen older
  fixtures; the seven `5c34991b-*` captures carry no `characterState` at all. **The wounds-pool
  enumeration (Part 7) has no fixture running a wounds chain**, so the fix that motivated the
  milestone's sharpest finding is untested by this run.
- **`NARRATING-PAST-A-BLOCK` 0.66 is still `turn16`**, the rules-impossible fixture from `ADR-0082`'s
  addendum, failing 10/10. Not evidence about the Warden. Re-authoring remains owed.
- **Five tags read exactly 1.00 and are suspects, not passes** (`ADR-0082`).

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
> Warden-level measurement — the re-baseline moved to M7.5 (`ADR-0012`). Re-derive N from the
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
`ADR-0022`.

**Provenance is part of the measurement.** `ingest.py` writes marker version,
chunking parameters, embed model, and chunk count to `ingestion/.ingest-manifest.json`,
and the harness copies it into every report. A score compared across different
provenance is not a comparison — the same rule `corpusVersion` and `harnessVersion`
enforce on the Warden side. An absent manifest renders as "Unknown" rather than
being quietly skipped.

**This bar is a milestone criterion, not a build gate.** `task eval:retrieval` needs
a populated index and makes real Voyage calls, so it cannot run in CI and does not
fail a build. Its *scorer* is unit-tested in CI; the score is not.

### Outcome, recorded 2026-08-07: not reached by the milestone; cleared afterwards by a label fix

> **Update, same day.** A post-milestone label audit (`§ S23`) corrected one
> fixture and all three metrics now clear: `authored` 100.0%,
> `warden-observed` **95.7%**, MRR **0.869–0.883**. This does **not** convert
> the milestone into a bar-met close. Three chunking rounds moved aggregate
> `recall@3` by 0.0 pp; the entire +2.7 pp came from the relabel. The
> stopping rule fired on the former and is unaffected by the latter. The
> table below is the state the milestone actually closed in, and the MRR row
> remains the methodology lesson regardless of which side of the bar the
> number later landed on.

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

**A judged `fail` does not always mean the rationale agreed.** A scan of all 1,341 `judge-*.json`
on disk (2026-08-21, 940 pass / 401 fail, 15 runs) found **six verdicts that contradict their own
rationale** — every one a `fail` under a rationale arguing the turn was fine. The converse scan
over all 940 passes found none, and that asymmetry has a cause: `judgeVerdictSchema`
(`eval/checks/judged/judge.ts:41`) is `{ passed, rationale }` with `passed` **first**, and the tool
call is forced, so the boolean is emitted before any reasoning exists and cannot be retracted once
the rationale talks its way out of it.

It is concentrated rather than spread, so a corpus-wide error bar understates the affected checks:

| Check | Contradictions | of failures |
|---|---|---|
| `OVER-RESOLUTION` | 4 | 22 — **18%** |
| `ROLL-RESULT-INVERSION` | 1 | 2 |
| `HIDDEN-INFO-LEAK` | 1 | 38 |

**What this means in practice.** A failure rate on `OVER-RESOLUTION` is a ceiling, not a
measurement — roughly a fifth of its recorded failures are the grader, not the Warden. Two of the
six sit in runs actively used as comparison points (the 2026-08-21 baseline above, and spec 019's
`6717347d` run, whose `HIDDEN-INFO-LEAK` is therefore 1.00 rather than 0.95). Neither number moves
until those runs are re-scored, which is judge spend.

**The six, by path**, relative to `$ZOLTAR_EVAL_ROOT/eval-runs/`, so acting on them needs no
re-scan. All six are `verdict: fail` under a rationale concluding the opposite:

```
claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z/reps/003/5c34991b-turn10-roll-result-inversion/judge-roll-result-inversion.json
claude-sonnet-5__6717347d__2026-08-21T21-14-59Z/reps/007/turn24-hidden-info-leak/judge-hidden-info-leak.json
claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z/reps/007/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z/reps/008/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z/rescore/2026-08-09T20-50-55Z/007/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-4-6__97feadbd__2026-07-29T10-51-26Z/rescore/2026-08-09T20-51-01Z/005/turn24-over-resolution/judge-over-resolution.json
```

The first two are the ones that matter — they sit in runs still used as comparison points. The
other four are `97feadbd`-era history and affect no live comparison.

**Detecting it needs a direct read, not a classifier.** A per-check Naive Bayes over rationale text
found five of the six, and missed one of `OVER-RESOLUTION`'s four for a structural reason worth
knowing: a check whose failures are frequently contradictions teaches the model to read pass-language
as fail-language. The reliable pass was reading all 401 failure closings.

**Separately, 7 of 1,341 rationales carry leaked tool-call markup** (`</rationale>`, `</invoke>`,
`<parameter name=`), including one in the `6717347d` run. Their verdicts match their rationales, so
this corrupts the audit trail rather than the score — but `TOOL-SYNTAX-LEAK` guards
`submit_gm_response` and nothing guarded `judge_verdict` (`ADR-0097` scoped the Warden only).

**Guarded since 2026-08-22** (`ADR-0102`): the Warden's detector is now pointed at judge rationales with
the `judge_verdict` property names, and re-scanning all 1,341 artifacts finds exactly these seven — the
confirmation the count above was asserted without. By path, for the reason the six contradictions are
listed by path, so acting on one needs no re-scan:

```
claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/008/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/009/turn24-scene-jump/judge-scene-jump.json
claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z/reps/009/turn16-narrating-past-a-block/judge-narrating-past-a-block.json
claude-sonnet-5__6717347d__2026-08-21T21-14-59Z/reps/005/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z/reps/002/turn24-over-resolution/judge-over-resolution.json
claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z/reps/008/turn24-hidden-info-leak/judge-hidden-info-leak.json
claude-sonnet-5__fa4e6e2f__2026-08-20T20-20-01Z/reps/006/5c34991b-turn10-narrating-past-a-block/judge-narrating-past-a-block.json
```

Detection is recorded on the artifact and never fails the check: all seven carry verdicts consistent with
their rationales, so failing them would discard a usable grade to punish a cosmetic defect.

**Fixed 2026-08-22 (spec 020, `ADR-0102`), and the corrections above still stand.** `judgeVerdictSchema`
now emits `rationale` before `passed`, so the verdict is conditioned on completed reasoning rather than
narrating one already spent, and `judgeContractHash` records which contract graded a row so the boundary
is visible. Measured rather than asserted: `eval:judge-variance` on both sides of the change, 114 judge
calls each over 38 frozen inputs, contradictions **2 of 6 failures → 0**. The strongest single piece of
evidence is that the one input carrying both before-side contradictions now returns `pass` three times,
reasoning exactly as it did when it returned `fail`.

**None of that repairs the artifacts already on disk.** Every judged rate produced before
`judgeContractHash 01620ef7` still carries the contradiction floor described above — roughly 1.5%
corpus-wide, 18% within `OVER-RESOLUTION` — and re-scoring those runs now would grade them under the new
contract, which is no longer like-for-like with the contract-A numbers it would be correcting. The prose
correction remains the right instrument.

**One caveat on the `HIDDEN-INFO-LEAK` correction specifically, added 2026-08-22.** Re-grading rep 007 six
times across the two variance runs reaches `fail` on grounds the original rationale never considered: the
narration states raw roll totals, which the rubric prohibits independently of the perception boundary. The
recorded artifact is a genuine contradiction and 1.00 stands on its own terms — but the inference behind it
("the rationale says no violation, so the failure is the grader") does not hold for this artifact, and the
re-grades that disagree are disagreeing about **rubric scope** rather than showing the grader
malfunctioned. That ambiguity was tracked as its own item until the rubric was
disambiguated on 2026-08-22 — see `§ 2. HIDDEN-INFO-LEAK's rubric disambiguated` below.

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
*generation* and are copied from the manifest; `corpusVersion` / `harnessVersion` /
`judgeContractHash` describe *scoring* and are recomputed. Same column names, different
moment. `source*` columns keep the originals.

`judgeContractHash` is the newest of the three and the easiest to misread. It fingerprints the
judge **contract** — the `judge_verdict` tool schema, the judge system prompt, the closing
instruction and `JUDGE_MODEL` — none of which `rubricHash` covers. Two runs can carry identical
rubric hashes and have been graded two different ways; before this field existed, nothing
recorded that. It is set only where a judge was actually invoked, so structural rows and rows a
`judgeGate` settled carry none, and an absent value means *unknown*, never *unchanged*.

Rows with no artifact to re-grade (the turn errored before writing one) are carried forward
rather than dropped, so a re-score file is a complete replacement for a run's rows — omitting
them would make a re-scored report look cleaner than the run it describes. **A carried-forward
row keeps the source's `judgeContractHash` along with its other `source`-tense values**, because
nothing re-graded it — relabelling it with today's contract would make every re-score containing
one look like it spanned a judge change.

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

**Mixed-*contract* warnings are a different animal, and there is no filter for them.** The
rubric warning above can name one affected check and say the rest of the report is fine. The
judge contract is process-wide — one tool schema, one system prompt, one model for every judged
check in the run — so a run spanning two of them was graded two different ways *in its entirety*.
`eval:compare` reports that at run level rather than per check, and prescribes `eval:rescore`
rather than a filter, because there is no subset of rows to narrow to. Structural rows are
excluded from the comparison: they carry no contract, and counting their absence as a second
value would flag every mixed-mode run, which is every run.

The same rule governs the A/B header line. Contracts that differ between the two sides warn;
a contract missing on either side reports as **unknown**, never as a match. Every run frozen
before this field existed carries none, so expect the unknown form on any comparison reaching
back past 2026-08-22.

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

**Set-membership.** Added 2026-08-23, because a third kind exists and the two
above do not cover it. The edit adds or removes a *fixture*, leaving every
surviving fixture's inputs and grading untouched. Frozen artifacts for the
survivors remain exactly as valid as they were, so `eval:rescore` is a real
measurement here too and no Warden call is owed — but the **denominators
move**, which neither category above addresses. A rate that changes across
such a bump has not necessarily measured anything about the Warden: dropping
a fixture that failed 10/10 raises its tag arithmetically.

The distinction from scoring-only matters in one direction only. Both permit a
rescore; only scoring-only permits comparing the resulting rate against the
prior run's as a like-for-like figure. After a set-membership bump, per-tag
movement needs the like-for-like-on-shared-fixtures treatment
`SYSTEM-ROLLED-PLAYER-ACTION` already gets above — restricted to the fixtures
present on both sides — before it means anything.

**Sampling.** Added 2026-08-28 with `ADR-0113`, and the heading now undercounts
by two. The edit changes a fixture's `repOverride` — how many reps it runs — and
nothing else. No input reaching the Warden moved, no grading of existing output
moved, and no fixture was added or removed, so frozen artifacts stay exactly as
valid as they were and `eval:rescore` is unaffected. What moves is the **sample
size from this run forward**.

Read it the way a set-membership bump is read, and for the same reason: the
denominator changes without the Warden changing. A fixture dialled from 10 reps
to 1 contributes a tenth of the rows it used to, so its tag's rate is now
weighted differently across fixtures even though every fixture is still present.
Restrict per-tag comparisons to like-for-like on shared fixtures *at comparable
N*, or read the per-fixture breakdown instead of the rollup.

The reason it is not simply set-membership: the fixture is still there, still
graded, and still pairs on `(fixtureId, checkId)` across every archived run. That
is the whole point of dialling a fixture down rather than retiring it, and a
label that said "removed" would describe the opposite of what happened.

The `8071500a4952...` → `4c9f2e73efd7...` bump was scoring-only, which is why re-grading
the two existing runs off disk produced genuine corrected rates with no API spend and no
re-run. That distinction was obvious to the person who made the edit and will not be
obvious to anyone reading the hash six months later.

**Convention: name the kind in the bump note**, next to the hash, in the same place the
change is described. The two costly mistakes are not symmetric — re-running after a
scoring-only bump wastes money and nothing else, while reusing artifacts after an
input-affecting bump silently produces numbers that look fine and mean nothing. Default to
re-running when the note is missing or the kind is unclear.

That default is right for the ambiguity it was written against — input-affecting
versus scoring-only — and wrong for a set-membership bump, where re-running buys a
full Warden run to answer a question arithmetic already answers. So name the kind;
do not leave a removal to the default and hope.

---

## Bump note — 2026-08-23, one bump carrying three changes

Corpus `abbce198026c` → **`ead033182d6a`**, a **set-membership** bump.
`HIDDEN-INFO-LEAK`'s `rubricHash` `4cf7fda1` → **`13305f34`** in the same
change. Three edits, batched deliberately because they touch **disjoint
tags** — there is nothing to disentangle afterwards, and each is independently
predicted below.

**1. `turn16-narrating-past-a-block` retired.** 22 fixtures → 21. `ADR-0082`'s
second addendum settled the cause: the fixture's `blockDescription` stalled
the Warden until it learned "Alvarez's Instinct score", Alvarez is the player
character, and `ADR-0100` made Instinct an `npc`-only field — so no value the
player could supply ever unblocked the turn, and no run could pass it. It had
never had a satisfiable block.

**Confirmed arithmetically 2026-08-23, from the archived reports, with no
spend.** `turn16` carried exactly two checks, so the removal touches exactly
two tags:

| Run | `NARRATING-PAST-A-BLOCK` before | `turn16`'s contribution | After |
|---|---|---|---|
| `fa4e6e2f__2026-08-21T11-05-26Z` | 0.66 (19/29) | 0 pass / 10 fail | **1.00 (19/19)** |
| `6717347d__2026-08-21T21-14-59Z` | 0.70 (21/30) | 1 pass / 9 fail | **1.00 (20/20)** |

`turn21` and the `5c34991b-turn10` capture pass every rep of both runs, which
is the whole of what is left. **This is a denominator change, not a Warden
improvement, and must not be read as one.**

**A correction to a figure then on the roadmap, found while checking this:**
the M7.7 entry cited 0.66 "on the 2026-08-21 re-baseline", but 0.66 is
`fa4e6e2f` (the 11-05 run, four errored turns) and the spec 019 re-baseline is
`6717347d` (21-14) at 0.70. Two runs share the date and the entry conflated
them. **0.70 is the correct figure**, and it is recorded here rather than
there: the roadmap no longer carries run figures.

**The prediction below was too strong, and this is the correction rather than
a quiet fix.** "No third tag moves" is right about *rates* and wrong about
*denominators*: `turn16`'s second check was `tool-syntax-leak`, 10/10 pass on
both runs, so `TOOL-SYNTAX-LEAK` goes 216 → 206 with its rate unchanged at
1.00. A set-membership bump moves every denominator the removed fixture
contributed to — which is exactly why the kind needed naming.

**2. `HIDDEN-INFO-LEAK`'s rubric disambiguated.** The perception boundary now
scopes the whole question; the numeric phrases are illustrations of a
beyond-boundary leak rather than an independent global prohibition. Resolved
that way because the global reading contradicts `UNSURFACED-CHECK`, which
fails a turn for resolving a player-facing roll silently — if narrating a roll
the player is party to were also a leak, the two checks would demand opposite
things on the same turn. **Every prior `HIDDEN-INFO-LEAK` rate is now
non-comparable.**

**3. The `ROLL-RESULT-INVERSION` re-score** on both comparison runs under
judge contract `01620ef7` — **run 2026-08-23, and the prediction held
exactly.** Both sides return **1.00 (10/10)**, so the corrected comparison is
**1.00 → 1.00, genuinely *Unchanged***. The phantom −0.10 is deleted: it was
two wrong numbers rather than one.

- Baseline `fa4e6e2f__2026-08-21T11-05-26Z`: 10/10 pass, no transitions. Its
  0.90 was the self-contradicting rep 003 verdict, which contract `01620ef7`
  grades as `pass`.
- After side `6717347d__2026-08-21T21-14-59Z`: 0.90 → 1.00, **exactly one
  transition, rep 004 `fail→pass`** — the rep spec 020's variance runs had
  already located as failing 3/3 under `fbbd8e46` and passing 3/3 under
  `01620ef7`. Predicted before the run, and it is the only rep that moved.

Reports: `…-rescore-rri-01620ef7.md` beside each run. Scoped to the one
fixture carrying the tag, so no other judged rate acquired a second
contract-B figure. The fixture carries no `hidden-info-leak` check, so change
2 above could not confound it.

### Predictions, pre-registered before any run

Recorded here rather than after, because the disjointness claim above is what
justifies batching and it should be falsifiable:

- `NARRATING-PAST-A-BLOCK` rises to 1.00 on a denominator smaller by exactly
  `turn16`'s reps. Nothing else about the tag changes. **Confirmed
  2026-08-23** on both runs, arithmetically.
- `HIDDEN-INFO-LEAK` moves only as the scoping change dictates. Its
  `turn24` rep 007 — the 1 `fail` / 2 `pass` split that surfaced the
  ambiguity — should stop splitting and settle on `pass`. **Confirmed
  2026-08-23**, and isolated cleanly: `eval:judge-variance --trials 3` over
  both `hidden-info-leak` fixtures, run at the *same* judge contract
  (`01620ef7`) as spec 020's after-side variance, so the rubric is the only
  variable between them.

  | | `turn24` | `turn28` | rep 007 |
  |---|---|---|---|
  | rubric `4cf7fda1` (spec 020) | 29/30 | 30/30 | `fail`/`pass`/`pass` |
  | rubric `13305f34` (today) | **30/30** | **30/30** | **`pass`/`pass`/`pass`** |

  59 `pass`, 0 `fail`, and one transient `error` (rep 002 trial 2, *check
  "hidden-info-leak" threw*) which is a failed call rather than a verdict.
  All three rep 007 rationales now reason from the boundary's scope
  explicitly — the disambiguation did the work it was written to do, rather
  than the split resolving by chance.
- **No third tag moves.** If one does, the disjointness claim was wrong and
  the bump needs splitting before any of its numbers are trusted.
  **Partly falsified 2026-08-23, and the claim is narrowed rather than
  dropped:** no third tag's *rate* moves, but `TOOL-SYNTAX-LEAK`'s
  *denominator* does, 216 → 206, because `turn16` carried it too. Disjoint in
  the sense that justified batching — no two of the three changes touch the
  same tag's rate — and not disjoint in denominators, which no set-membership
  bump can be.
- `ROLL-RESULT-INVERSION` corrects to **1.00 → 1.00**, genuinely unchanged,
  replacing a recorded −0.10 regression that was two wrong numbers rather
  than one. Spec 019's single failure is rep 004, which fails 3/3 under
  contract `fbbd8e46` and passes 3/3 under `01620ef7`.
  **Confirmed 2026-08-23** — see change 3 above. The remaining three
  predictions are still open; they need the re-baseline.

---

## Same-prompt run-to-run variance, measured 2026-08-23

Two full-corpus runs landed at **identical `promptHash` `f0753f86`,
`assemblyHash` `ada7fb8a` and corpus `ead033182d6a`** — `14-39-39Z` and
`16-26-10Z`. The second was launched intending to test plan 022 and ran the
unchanged prompt because the host did not have the commit; the archived
`prompt.txt` files are byte-identical. An accident, and the only whole-corpus
variance estimate this project has.

| Tag | `14-39-39Z` | `16-26-10Z` | Δ | N |
|---|---|---|---|---|
| `UNAUDITABLE-MAPPING` | 1.00 (app 0.20) | 1.00 (app 0.20) | **0.00** | 10/50 |
| `NARRATING-PAST-A-BLOCK` | 0.95 | 0.95 | 0.00 | ~20 |
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.89 | 0.92 | +0.03 | ~75 |
| `SCENE-JUMP` | 0.22 | 0.30 | +0.08 | 9/10 |
| `MISSING-DELTA` | 0.80 | 0.90 | +0.10 | 20 |
| `ROLL-RESULT-INVERSION` | 0.89 | 1.00 | **+0.11** | 9/10 |

**Nothing changed between these two runs except the dice.** So on this corpus,
a single-fixture tag can move **0.11 for free**, and a 20-rep tag 0.10.

Consequences for how these numbers get read:

- **A decision rule with a 0.90 floor cannot adjudicate a 0.89.** Plan 021's
  second run was called just-under-floor at 0.89; the replication says 0.92.
  That call was inside noise and should not have been treated as a finding.
- **Single-fixture tags need a movement threshold wider than 0.10** before
  anything is attributed to a change. `SCENE-JUMP`, `ROLL-RESULT-INVERSION`,
  `UNSURFACED-CHECK`, `OVER-RESOLUTION` and both `UNAUDITABLE-MAPPING`-bearing
  tags all sit at N ≤ 10.
- **Artifact-level predictions beat rate-level ones.** "No remaining failure
  carries a violating roll of class X" is checkable at N=1 and immune to this;
  "the rate rises to 0.95" is not.
- **Stability is itself evidence.** `UNAUDITABLE-MAPPING` returning 1.00 at
  applicability 0.20 (10/50) twice, to the rep, is a much stronger result than
  the single run suggested — plan 021's gain replicates exactly.

Budget a replication before attributing any sub-0.10 movement on a small tag
to a change. Two runs at one prompt cost the same as one run at each of two
prompts, and the first pair buys a denominator for reading every later pair.

---

## Bump note — 2026-08-24, `SCENE-JUMP` disambiguated

Corpus `ead033182d6a` → **`f6186723bc49`**, **scoring-only**: one `assertion`
fact on one fixture, `seededState` and `playerInput` untouched, so every frozen
`warden-output.json` was produced under unchanged conditions and
`eval:rescore` grades them honestly. `SCENE-JUMP`'s `rubricHash` `ba1cff52` →
**`01a4288c`** in the same change. **`promptHash` `e83e8aaa` and
`assemblyHash` `ada7fb8a` are unmoved** — nothing Warden-visible is touched.

**The boundary is the player character, not the fiction.** The old template
forbade *"beginning a new NPC encounter"* without saying whether an off-screen
thread the player can only hear counts as one. Judges split openly on it — 8 of
9 rationales on `f0753f86__14-39-39Z` and 6 of 10 on `e83e8aaa` flagged the
boundary as borderline or ambiguous, in both directions, including passes — and
the tag read 0.88, 0.22, 0.30 and 0.50 across four runs, two of which used a
byte-identical prompt. Resolved narrow, because the broad reading would forbid
the Warden from advancing off-screen threads, which `CLAUDE.md` and `ADR-0101`
explicitly require it to do. Same argument shape as `HIDDEN-INFO-LEAK`'s
resolution against `UNSURFACED-CHECK`.

The fixture's `expectedScope` moved with it: it previously described the Delta
thread only as one *"the player has not directed Alvarez toward"*, which
implied the thread was untouchable. It now says the thread may develop and be
perceived, and names what is actually forbidden — relocating Alvarez into it or
committing her to a response.

**Every prior `SCENE-JUMP` rate is non-comparable**, which costs nothing: none
of them was measuring the Warden.

**Measured 2026-08-24 by rescore** on `e83e8aaa__2026-08-24T11-21-49Z`, scoped
to the one fixture — 10 judge calls, no Warden spend. **0.50 → 1.00**, five
`fail→pass` transitions.

**The rate is the lesser half of the result. The ambiguity is gone:**

| | flagged `borderline` / `ambiguous` / `arguably` |
|---|---|
| `f0753f86__14-39-39Z` (rubric `ba1cff52`) | 8 of 9 |
| `e83e8aaa` (rubric `ba1cff52`) | 6 of 10 |
| `e83e8aaa` rescored (rubric `01a4288c`) | **0 of 10** |

That matters more than 1.00, because a rate that moved while the rationales
still wrestled with the boundary would mean the coin had merely landed the same
way ten times. It did not: the reasoning changed. A flipped rep now reads
*"she is not relocated to Lab B, not placed into that encounter, and not made
to act or decide anything regarding it"* — the corrected boundary applied
directly, with no hedging anywhere in the ten.

**This fixture has stopped discriminating, as predicted.** 1.00 with no
dissent is `ADR-0082`'s blind-rubric shape — accepted because an
undiscriminating fixture is honest where a coin flip is not. The tag
needs its second instance from the M7.7 playtest regardless, and the mode to
capture is the one `docs/playtest-scenarios.md` describes — the player leaves
ambiguously and the Warden skips the transit — which this fixture never tested.

---

## Bump note — 2026-08-29, `UNAUDITABLE-MAPPING` widened from one fixture to four

Corpus `c077bc456af7` → **`6bc7eee3970f`**, a **set-membership** bump. Four
fixtures added, none removed, no surviving fixture's `seededState`,
`playerInput`, `applicability` or `assertion` touched. **`promptHash`
`e83e8aaa` and `assemblyHash` `ada7fb8a` are unmoved** — nothing Warden-visible
is in this change. Plan: `docs/plans/023-widen-unauditable-mapping-coverage.md`.

| Fixture | Source | Direction |
|---|---|---|
| `2c0ba938-turn25-unauditable-mapping` | 2026-08-24 playtest, seq 76 | pass |
| `2c0ba938-turn45-unauditable-mapping` | 2026-08-24 playtest, seq 144 | pass |
| `2c0ba938-turn51-unauditable-mapping` | 2026-08-24 playtest, seq 165 | pass |
| `5c34991b-turn44-unauditable-mapping` | 2026-08-16 playtest, seq 149 | tripwire |

**Two other checks gain rows, and the count is not the interesting number.**
`selectChecksForFixture` selects on an applicability *block being present*, not
on `applies` being true, so every one of the four captures adds a row per rep to
both tag-independent checks:

| Check | Attached before | Added | Of which gradeable |
|---|---|---|---|
| `OUT-OF-ORDER-RESOLUTION` | 6 blocks (+2 tagged) = 8 fixtures | 4 | **1** |
| `SYSTEM-ROLLED-PLAYER-ACTION` | 18 blocks (7 true, 11 false) | 4 | **0** |

The seven `applies: false` blocks are exclusion rows by construction and are
kept deliberately: per `docs/playtest-scenarios.md § Capture discipline` an
answered `applies: false` surfaces in the report's `fixture-gated-never-applies`
finding, where a deleted entry is visible nowhere. Neither check's **rate**
moves — `not_applicable` rows sit outside it — but both **applicabilities** do,
which is why `§ S41`'s rule to read applicability before every rate applies to
the two floors as much as to the tag being widened.

**The one gradeable addition is deliberate.**
`2c0ba938-turn51-unauditable-mapping` carries `applies: true` for
`OUT-OF-ORDER-RESOLUTION` because it is the corpus's only turn with a genuine
two-stage chain — a repair attempt, then a consequence contingent on its failure
— and that check's in-turn branch is the one `§ S39` reads 1.00 (33/33) on
having found nothing, whose fail direction `§ S40` showed is reachable only when
the model populates `gatedByRollId`. The source turn ordered the two correctly,
so a pass is the expected outcome and this is denominator, not a catch. It is
still set-membership rather than the scoring-only shape `§ S37` recorded,
because the attachment rides in on a *new* fixture and no surviving fixture's
grading changed.

**The rate and the applicability will both move for reasons that have nothing
to do with the Warden.** The tag went into this bump reading 1.00 (10/10) at
applicability 10/50, with every row from `5c34991b-turn01`. Three of the four
additions are turns the Warden already handled correctly, annotated
`FIXTURE-CANDIDATE-PASS` in the playtest report, and the fourth is a turn it
handled incorrectly under a prompt that has since been fixed. A rollup that
comes back 1.00 at applicability 40/90 has measured a wider corpus, not a
better Warden, and quoting it as a milestone gain would credit M7.7 with an
improvement it did not earn.

**Like-for-like is `5c34991b-turn01` alone.** Per `§ Two kinds of corpus bump`,
a set-membership bump moves denominators without moving the Warden, so per-tag
movement has to be restricted to fixtures present on both sides before it means
anything — the same treatment `§ S35` and `§ S37` give a widened check.

**No rescore can settle this one.** Frozen artifacts for the twenty-seven
survivors stay exactly as valid as they were, and `eval:rescore` remains a real
measurement for them. But the four new fixtures have never executed, so there
is nothing on disk to re-grade: their first numbers cost a Warden run. Fold
them into the next full re-baseline rather than buying a scoped run — the
pass-direction caveat above means the result is not decision-bearing on its
own.

**After this bump the tag has no live fail-direction fixture, and cannot get
one by capture.** A fixture is seeded state plus player input, re-run under
whatever prompt is current, so a turn captured from a pre-fix playtest stops
failing the moment the fix works. `5c34991b-turn01` is the demonstration:
**fail 10/10** under `6717347d`, **pass 10/10** under `e83e8aaa`, from
byte-identical seeded state. `5c34991b-turn44` is therefore a regression
tripwire — it failed under `ccac7d1c` and should now pass, and a fail is the
defect returning — not a fail-side fixture. The real fail side is already
frozen on disk across three runs (`6717347d` reps 001–010, `e83e8aaa`
2026-08-24 rep 010, `e83e8aaa` 2026-08-28 reps 001–010) and belongs to M7.8's
known-answer pairs, which need no Warden call.

**One thing in the same change moves no hash at all**, stated so nobody hunts
for it: `unauditableMappingJudgeContext` now has a committed golden under
`eval/checks/judged/judge-context-golden/`, closing the `ADR-0105` gap that
`ungrounded-contractor-target.spec.ts` named. It guards what the judge reads;
it is test-side only, and `rubricHash` `c97c75ba` is unmoved.

---

## Bump note — 2026-08-31, `SEEDED-CANON-CONTRADICTION` widened from three fixtures to five

Corpus `6bc7eee3970f` → **`301302000143`**, a **set-membership** bump. Two
fixtures added, none removed, no surviving fixture's `seededState`,
`playerInput`, `applicability` or `assertion` touched. **`promptHash`
`e83e8aaa` and `assemblyHash` `ada7fb8a` are unmoved** — nothing Warden-visible
is in this change. Pre-registration: `docs/eval-findings.md § S42`.

| Fixture | Source | Direction | Contradicted referent |
|---|---|---|---|
| `2c0ba938-turn18-seeded-canon-contradiction` | 2026-08-24 playtest, seq 53 | fail | `ship_layout` |
| `2c0ba938-turn24-seeded-canon-contradiction` | 2026-08-24 playtest, seq 73 | fail | `crew_roster` |

**Both were verified gradeable against `game_event` before capture, not after.**
`turn24`'s contradicted value — `crew_roster`, placing Petrov in the engine room
he is narrated as being *two decks from* — is written at **seq 72, during turn
23**, so it is resident in a fixture seeding from seq 73. Had it been written by
turn 24 itself there would have been nothing to contradict and every rep would
have returned `not_applicable`: `turn02` (`ADR-0115`) arriving in a new place.
The sequence numbers of the adjacent fixtures narrowed it to turn 23 or turn 24
and could not settle which; the event rows settled it.

**These two exist so the tag can measure the `ship_layout` restructure at all.**
The standing point reads 0.87 (26/30) with **four failures, three of them on
`turn14`** — `turn08` 9/10, `turn14` 7/10, `turn29` 10/10 — against judged
run-to-run variance `§ S39` measured at 2/10 on a byte-identical prompt. The
argument, the two scoped runs, and the per-fixture decision rule are in `§ S42`.

**`turn24` is a control, not a second treatment case**, and the distinction is
the point of capturing it: its referent is `crew_roster`, which the restructure
does not touch, so a lift there as large as `turn14`'s means the effect is not
deck-lookup-specific.

**Neither fixture has executed, so no rescore can reach them** — the same
position `§ S41`'s four are in. Their first numbers cost a Warden run, which is
`§ S42`'s run A.

**Both tag-independent checks gain rows.** `selectChecksForFixture` selects on
an applicability block being present rather than on `applies` being true, so
each capture adds a row per rep to `system-rolled-player-action` and
`out-of-order-resolution`. All four blocks are `applies: false`, answered from
the scenario rather than deleted, so they are exclusion rows by construction and
surface in the report's `fixture-gated-never-applies` finding. Neither rate
moves; both applicabilities do.

**One thing worth recording about `turn18`'s `applies: false`.** Unlike the
usual case, that turn *does* carry a `dice_roll` (seq 54) — Mara's Instinct
check, `actingEntityId: mara_odinsen`, `system_generated`, no `requestId`. The
reason is stated in the fixture so the entry is not misread as "no rolls this
turn": there is no *player* action here for the system to have rolled. This
adventure emits no `dice_request` events at any sequence, which is why
`out-of-order-resolution` is `applies: false` on both.

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

### A weaker-model control arm cannot probe every check, and which ones is decidable in advance

Recorded 2026-08-28 from the Haiku 4.5 arm (`docs/eval-findings.md § S40`), which was
scoped to two pinned checks and settled exactly one of them.

The arm's premise is that a weaker generator failing a pinned check is evidence the
check can reach `fail` at all. That holds only where the fail direction depends on
**what the model narrates**. It does not hold where the fail direction depends on the
model **populating a structural field the check reads** — because the weaker the
model, the less reliably it fills that field, so the arm shrinks the very denominator
it was bought to exercise. The instrument and its target are anti-correlated, and no
increase in N repairs it: a model that never emits `gatedByRollId` never produces a
turn `out-of-order-resolution`'s in-turn branch can grade.

**So decide before scoping the arm, not after reading it.** For each candidate check,
ask what a `fail` requires the generator to have *emitted*. Prose only — the arm is
valid. A field the checker reads — the arm is not, and the check goes to a
hand-authored known-answer pair (M7.8), which supplies the field instead of hoping.

**A second shape from the same run: a check can pass on absence with full
applicability.** `out-of-order-resolution`'s applicability guard requires a pending
gating request, deliberately, so that a Warden which stopped issuing gates could not
score 1.00 by doing less. Haiku issued the request and then rolled nothing at all —
guard satisfied, nothing to order, automatic pass, `App` 1.00. **An applicability gate
on the *setup* does not guarantee the check had anything to grade**; where a check's
assertion is negative, the gate needs to require the material the negative is asserted
over, not just the condition that makes the question sensible.

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

---

## A fixture cannot grade what the seed already contains (2026-08-27)

`turn02-missing-canon-capture` reported `not_applicable` on **157 reps across 16 runs** — both
models, every prompt revision between 2026-07-29 and 2026-08-24. It never once graded. The
audit on `checkMissingCanonCapture` had already established, at 20 reps, that the exclusions
were *correct*: the marker phrase the fixture waits for genuinely never appears. What it did
not establish is why, and the why generalises past this fixture.

**The turn asks about something the fixture itself seeds.** The player asks whether Alvarez has
a map of the station; `worldFacts.station_layout_overview` already carries the layout — the
central hub, four radial modules, habitat ring, ladder shaft, Lab C's quarantine notice. The
Warden reads it back. That is correct behaviour, it introduces nothing, and there is nothing to
capture.

**Which makes the obvious repair a trap.** The natural fix is to re-author the marker to a
phrase the narration *does* produce every rep — "habitat ring", "ladder shaft". Both are
restated seeded canon, so the check would then fail the turn on every rep for not durably
writing a fact that was already durable. An honest zero denominator traded for a manufactured
0.00. `ADR-0081` rejects the judged migration for the mirror-image reason (a spurious 1.00);
this is the same trade in the other direction, and it is worth naming because the marker looks
like the defect right up until you check what the fixture seeds.

**The general rule.** A fixture that grades whether a turn wrote something down must seed a
world in which that something is *absent*. Nothing in the authoring path checks this: the
marker phrase, the `expects:` text and the seeded state are authored independently, and
`capture-fixture` cannot know which world fact the author has in mind. Until it does, the
question belongs on the authoring checklist — **is the expected detail absent from
`seededState.campaignState.worldFacts`, and absent from the seeded message window?** If it is
present in either, the fixture is measuring the Warden's willingness to duplicate itself.

**What replaced it.** `turn02` is retired rather than repaired — its source adventure
(`18be155e`) is no longer in the database to recapture from — in favour of two fixtures from
`2c0ba938`, one per direction. `turn21` is the fail side: the insurance file's contents live in
`gmContextBlob.narrative`, invisible to the player and absent from `worldFacts`, so narrating
them moves a GM secret into shared canon and owes a durable write. `turn23` is the pass side and
exists because the `worldFacts`-diff branch had never executed against real output across those
157 reps; the player asks who the crew are, five of the six are unnamed in the seeded context,
and the original turn wrote `crew_roster`.

**Marker stability is now an authoring criterion, not an accident.** A phrase the Warden invents
fresh each rep gates on a coin flip. Both replacements are pinned instead: `hazard multiplier`
is vocabulary the Warden reads off its own seeded context, and `bridge crew` is echoed from the
player's own question. Neither is a guess at how a model might word something — which is the
property `turn02`'s `RESTRICTED — VERIDIAN INTERNAL` lacked.

**Still unexercised: the `pending_canon` branch.** `2c0ba938` proposes canon on no turn at all,
and the only rows in any source adventure are `5c34991b` seq 14 and seq 34. A fixture for that
branch has to come from there.
