# Fixture/check reachability validation (design only)

**Status: Deferred 2026-07-31.** Not built and not scheduled. The PASS-unreachable case it was written for (turn16) is already fixed; the FAIL-unreachable case it warns about has no instance in the corpus. Revisit when a pinned 1.00 turns out to be a checker artifact, or when corpus expansion makes hand-review of new (fixture, check) pairs impractical — whichever comes first.

---

## The defect class

Every other defect found in this cycle lived *inside a checker*: a regex that couldn't match,
a prose dependency that failed open, a gate that absorbed its own inputs. All of them were
findable by reading checkers, and all of them were eventually found that way.

`turn16-narrating-past-a-block` is not that. The fixture seeds a `dice_request` that was
resolved with `target: null` — a faithful capture of real production state, since
`dice_requests.target` is nullable and `capture-fixture` copies the row verbatim. The checker
treated any resolved request with a null target as a self-ruling violation — a defensible
rule, and a genuinely non-lexical signal. **Neither artifact is wrong on its own.** The pair
is: every rep of that fixture carried the seeded request into `result.diceRequests`, so the
checker returned `FAILED` before the Warden's behaviour was consulted at all.

Nothing in the codebase could have surfaced that by inspection of either side. It cost 20 reps
across two models, an entry in `eval-methodology.md`'s "confidently zero" list, an
N-calibration that treated the fixture as signal, and a correction in `cacf6e5`'s commit
message that `600cc73` then had to walk back.

## The question worth answering

Per `(fixtureId, checkId)` pair: **does the assertion have both a reachable pass and a
reachable fail against this fixture's own seeded state?**

Three failure shapes, with sharply different symptoms:

| Unreachable | Rate reads | How it presents |
|---|---|---|
| `PASS` | 0.00 every rep | A devastating model finding. This is `turn16`. |
| `FAIL` | 1.00 every rep | A solved category. **More dangerous** — nobody investigates good news. |
| both | `n/a`, N 0 | Already visible: item 8's `App` column and zero-denominator reporting. |

The third case is covered. The first two are not, and they are invisible to everything built so
far — a pinned rate has `App` 1.00 and a full denominator. It looks like the healthiest row in
the report.

This is the natural complement to item 8. That work made a *denominator* collapse visible; this
makes a *verdict* collapse visible. Neither can see the other's failure.

---

## Q1: Is this statically decidable?

**No, and it shouldn't be attempted.** Checkers are arbitrary TypeScript over
`TurnExecutionResult` — a struct of five DB row-sets plus a service result. Deciding whether
some inhabitant of that type yields `PASS` is reachability over arbitrary code, undecidable in
general; a bounded symbolic execution would be a large, fragile lift for a corpus of nine
checks.

**Probe artifacts instead.** Construct a `TurnExecutionResult` that *should* pass and one that
*should* fail, run the real checker against it together with the real fixture, and assert the
verdicts come out as intended. This is the practice `decisions.md` already records — "for any
check whose denominator moved sharply, hand-construct output that *should* produce each verdict
and confirm the checker agrees" — made systematic instead of reactive.

The new and load-bearing part is the binding: **probes are constructed against the fixture's own
`seededState`**, not against a blank slate. That is precisely where `turn16` died. A probe built
without the seeded `pendingDiceRequests` passes cleanly and proves nothing.

### The circularity hazard

If probes are written by reading the checker, they encode the same misunderstanding and agree
trivially. This is the "second implementation of the same rule, free to drift" hazard
`decisions.md` already names for `judgeContext`, pointed at the validator instead of the rubric.

**Probes must be derived from the fixture's `assertion`** — the fixture's own declaration of
what correct behaviour is — and never from the checker's implementation. Then agreement is
evidence and disagreement is the finding. Concretely: the passing probe is "a turn that
satisfies this fixture's `assertion`"; the failing probe is "a turn that violates it in the way
`tag` names."

This is a discipline, not something the type system can enforce. It should be stated at the top
of whatever file probes live in, and it is the first thing to check in review of a new probe.

---

## Q2: Does it cover judged checks?

Three tiers, and the honest answer is "not all of them."

**Tier 1 — structural checks** (`missing-canon-capture`, `out-of-order-resolution`,
`system-rolled-player-action`). Full pass/fail reachability. Deterministic, free, no API calls.

**Tier 2 — judged checks with a `judgeGate`** (`narrating-past-a-block`, `unauditable-mapping`).
Probe *the gate*, not the judge: can the gate fall through to the rubric against this fixture?
A gate that returns `FAILED` or `NOT_APPLICABLE` for every constructible turn makes the judge
unreachable, which is the same defect wearing a different hat — and it is exactly what
`judge-variance` found when `unauditable-mapping`'s gate absorbed most of its frozen inputs.
`turn16` is in this tier, and is caught here.

**Tier 3 — ungated judged checks** (`hidden-info-leak`, `over-resolution`, `unsurfaced-check`,
`scene-jump`). Out of scope. Verdict reachability would require real judge calls, with judge
variance sitting on top of the answer, and a "probe" that costs money and can flip is not a
validator. **This gap must be stated in the output rather than implied away** — a report saying
"corpus validated" while silently covering 5 of 9 checks is the same class of overclaim this
whole document is about.

Coverage today: **5 of 9 checks**, and both checks whose defects motivated the work.

### Already-covered special case, worth keeping

A fixture declaring `applicability[checkId].applies === false` for a check in its corpus is a
zero-coverage pair, decidable statically with no probes at all. Item 8's
`fixture-gated-never-applies` finding already reports it. That stays as-is; this design does not
subsume it.

---

## Q3: Where does it run?

Three options, and the answer is all three, in this implementation order:

1. **One-time audit** — clears the existing 14-fixture corpus. This is where the backlog of
   unknown unknowns gets paid down, and it is how you find out whether the design works at all.
2. **CI over the whole corpus** — the load-bearing one. `turn16`'s defect was created when a
   *checker rule* met an *existing fixture*: either side moving can break a pair, so validation
   pinned to fixture-authoring time would have missed it entirely. This has to re-run on every
   change to `eval/checks/` as well as `eval/fixtures/`.
3. **`capture-fixture` at authoring time** — fast feedback, fail-closed on a new fixture, so a
   mis-authored fixture never reaches a run. Necessary but insufficient on its own, for the
   reason above.

Runtime is pure computation: no DB, no Anthropic, no network — the same constraint `eval:report`
holds and can be enforced the same way, with a guard test. Fast enough for every push.

---

## Q4: What would it have cost to catch `turn16`?

**One passing probe.**

`turn16`'s assertion says the Warden should acknowledge a block — a stat value the player never
supplied — and not narrate past it. The passing probe is a turn that does exactly that:
`playerText` acknowledging the missing value, no new rolls, and the fixture's seeded
`pendingDiceRequests` carried in as captured, because that is what the real turn does.

Run that against the pre-`cacf6e5` checker: it scans `result.diceRequests` for a resolved
request with `target === null`, finds the seeded one, and returns `FAILED`. `PASS` is
unreachable. Flagged.

- **Detection cost:** milliseconds, zero API spend, at the moment the checker rule was written.
- **Actual cost incurred:** 20 reps across two models, a "confidently zero" entry in the
  methodology doc, an N-calibration that treated the fixture as signal, and a published
  correction that was itself wrong and needed a second correction.

That is the concrete test this design was asked to pass, and it passes.

---

## Shape

An optional `probes` on `EvalCheck`, alongside `judgeGate` and `judgeContext`:

```ts
probes?: {
  /** A turn satisfying `fixture.assertion`. Built from the assertion — never
   *  from this checker's implementation. */
  passing: (fixture: EvalFixture) => TurnExecutionResult;
  /** A turn violating it in the way `tag` names. */
  failing: (fixture: EvalFixture) => TurnExecutionResult;
};
```

The validator walks `selectChecksForFixture` for every fixture, runs the check against both
probes, and asserts a `PASS` from one and a `FAIL` from the other — or, for tier 2, that the
gate falls through on the passing probe. Output names each unreachable verdict with the pair
that produced it, and states the tier-3 checks it did not cover.

## Open questions to settle before building

- **Who owns probe construction.** Per-check (the check knows what its tag means; 9 of them) or
  per-fixture (the probe knows the scenario; 14 of them). Leaning per-check with the fixture as
  input, but this is not obvious and the wrong choice makes every probe awkward.
- **A synthetic `TurnExecutionResult` base is needed.** Today the only ones in existence are
  frozen run artifacts. Mutating a frozen artifact toward pass/fail is tempting and cheap, but
  creates a chicken-and-egg for exactly the case that matters most — a newly authored fixture
  with no run behind it yet.
- **Whether a failing probe is constructible for every tag without re-implementing the
  checker.** This is the risk that sinks the design. For `out-of-order-resolution`, "a turn that
  violates ordering" may be impossible to construct without encoding the ordering rule — at
  which point the probe *is* the checker and validates nothing.

## Recommended prototype before committing

Two checks: **`out-of-order-resolution`** (tier 1, and the one most likely to expose the
circularity problem) and **`narrating-past-a-block`** (tier 2, and the one that would have caught
`turn16`).

**Failure condition, stated in advance.** An earlier draft phrased this as: *if probe
construction cannot be kept clearly independent of the checker's own logic, the design does not
work.* That criterion is unusable as written, because "clearly independent" is a judgment made
by whoever wrote the probe — the one person who has already read the checker and can no longer
tell which of their choices came from the assertion and which came from the implementation. It
asks the least qualified party for the verdict.

The testable form: **can the probe be written by someone working only from the fixture's
`assertion` text, without opening the checker file?** That is a procedure, not an assessment. It
can be run, and it can fail in a way the author cannot rationalise away.

Two outcomes, both worth having:

- **The probe can be written from the assertion.** Then agreement between probe and checker is
  evidence, and disagreement is the finding — which is the property the whole design depends on.
- **The assertion is too vague to determine what a passing turn looks like.** Then the finding
  is about the *assertion*, and it is a real defect regardless: a fixture whose stated
  expectation can't distinguish a passing turn from a failing one is not grading what its author
  thought it was. This is worth discovering whether or not this design is ever built, which
  makes the prototype cheap even in the branch where it kills the design.

A validator that agrees with the checker because it was written from the checker is worse than
no validator — it converts an unknown risk into a false assurance, which is the exact trade this
document exists to argue against.
