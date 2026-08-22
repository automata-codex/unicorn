# 020 — Identity for the judge contract and the build, and the field-order swap

**Status:** drafted 2026-08-22, not started. Plan at `../../plans/020-judge-contract-identity-and-the-field-order-swap-implementation-plan.md` — eleven items, of which two are runs rather than commits.
**Target path:** `docs/plans/020-judge-contract-identity-and-the-field-order-swap-implementation-plan.md`
**Type:** ephemeral implementation spec (archive after execution; the living record is `docs/decisions/` and the roadmap)
**Origin:** the two open bullets in `docs/roadmap.md § M7.7`, and `docs/eval-methodology.md § Before trusting any judged rate from this corpus`. Extends `ADR-0099` and its addendum.

---

## Context

Two open M7.7 bullets look like separate work and are one defect: **an identity that does not cover the surface it names.** `assemblyHash` misses the build; `rubricHash` misses the judge contract. Both were invisible in the same run, `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`.

**`assemblyHash` is a function of the build, not of the commit.** That run recorded `harnessVersion 1458aaf` with `assemblyHash 8e332e38`; the same commit produces `6dc28608` against a current workspace build. The eval host held a `@uv/game-systems` `dist` built before `ADR-0101` added `revealed` to `EntitySchema`, and `ASSEMBLY_PROBE.campaignStateData` is built with `MothershipCampaignStateSchema.parse`, so Zod stripped the unknown key and the probe rendered `undiscovered` for entities carrying `revealed: true`. Reproduced exactly. Nothing the Warden read was wrong — the probe feeds the hash and the goldens and is never sent — so the measurement stands and only the label on it is false. `ADR-0099`'s addendum carries the reasoning.

**The goldens detect this exactly, and were not run.** `session.assembly.spec.ts` asserts the live render matches the committed files, and against a stale `@uv/*` build it fails. Nothing today requires a green suite on the eval host before a run is labelled. The comparison exists only inside a test file, and `eval:run` never runs the test.

**`rubricHash` covers the rubric template and nothing else.** `rubricHashFor` (`eval/checks/registry.ts:595`) is `hashPromptText(rubricTextFor(checkId))`. Outside it sit `JUDGE_VERDICT_TOOL`, the judge system prompt, `JUDGE_MODEL` — and, not named in the roadmap bullet but equally load-bearing, the closing instruction *"Call judge_verdict with your verdict and a brief rationale"*, an inline string literal in `runJudgeCall`. Changing any of them changes how every judged tag is graded and moves no identity at all: `manifest.completedReps[].rubricHashes` unchanged, `eval:compare --filter-rubric CHECK=HASH` still matching, and the "graded by different checker code" warning silent. A before/after boundary that reads as like-for-like and is not.

**That gap blocks the fix it hides.** `judgeVerdictSchema` (`eval/checks/judged/judge.ts:41`) is `{ passed, rationale }` with `passed` **first**, and `runJudgeCall` forces the tool with `toolChoice: { type: 'any' }` — so the boolean is emitted before the model has written a word of reasoning, and cannot be retracted once the rationale talks its way out of it. A scan of all 1,341 `judge-*.json` on disk (940 pass / 401 fail, 15 runs) found **six verdicts that contradict their own rationale**, every one a `fail` under a pass rationale; the converse scan of all 940 passes found none. That asymmetry is the field-order hypothesis showing up in the data. It is concentrated rather than spread — `OVER-RESOLUTION` 4 of 22 failures (**18%**), `ROLL-RESULT-INVERSION` 1 of 2, `HIDDEN-INFO-LEAK` 1 of 38 — and it has already corrupted a comparison: the 2026-08-21 baseline's true `ROLL-RESULT-INVERSION` rate is **1.00, not 0.90**, so spec 019's *Unchanged, 0.90 → 0.90* is really **1.00 → 0.90**, a −0.10 regression `eval:compare` could not see.

So the sequence is forced: **identity coverage first, then the field-order swap, then `eval:judge-variance`** — otherwise the swap is a scoring change nothing records and its effect is unattributable.

---

## Goals

1. A run cannot be labelled with an `assemblyHash` no commit produces.
2. The judge contract — tool schema, system prompt, closing instruction, model — has a recorded identity, distinct from the rubric template's.
3. That identity travels with **scoring** records, so a re-score under a changed contract is visibly a different grading.
4. The field-order swap moves a recorded hash, and `eval:compare` says so.
5. Whether the swap helps or harms is settled by measurement against frozen input, not by argument.

## Non-goals

- **Folding resolved `@uv/*` versions into `assemblyHash`.** The other candidate in `ADR-0099`'s addendum. Rejected in favour of Part 1: the goldens already detect this exactly, a version list would need its own resolution and normalisation rules, and a hash that moves on every dependency bump reintroduces the `harnessVersion` failure — a signal that fires every time is one people learn to skip.
- **Widening `rubricHash`.** See Part 2; rejected on `ADR-0099`'s precedent, with a stronger case here.
- **Re-scoring the six known contradicting artifacts, or the two runs still used as comparison points.** See `§ What the swap costs`. It is judge spend, and after Part 3 a re-score is no longer like-for-like with anything graded before it — which makes it a worse correction than the prose one already in `eval-methodology.md`.
- **A standing rationale-versus-verdict contradiction detector.** The 2026-08-21 scan established that detecting it needs a direct read of failure closings, not a classifier: a per-check Naive Bayes found five of six and missed one of `OVER-RESOLUTION`'s four for a structural reason — a check whose failures are frequently contradictions teaches the model to read pass-language as fail-language. Part 3 is meant to remove the cause; Part 4 measures whether it did. Building a detector for a defect we are trying to eliminate is the wrong order. Revisit if Part 4 says the swap did not work.
- **`ADR-0097`'s open item on Warden-side tool-syntax emission.** Part 5 covers the judge, which `ADR-0097` explicitly scoped out. The Warden half stays open.
- **Anything Warden-visible.** No prompt, tool-schema, snapshot or fixture change. `promptHash`, `assemblyHash` and `corpusVersion` must all be unmoved by this spec — see `§ Ordering`.
- **M7.8's exclusion of the judge from known-answer meta-eval.** That exclusion rests on prose classification being irreducibly uncertain. Rationale-versus-verdict disagreement is checkable *without* a known answer, by reading one artifact against itself, which is why this work sits in M7.7 rather than waiting.

---

## Part 1 — `eval:run` refuses to start against stale goldens

Lift the golden comparison out of `session.assembly.spec.ts` into a function the harness can call, and gate the run on it.

- **`findAssemblyGoldenMismatches()`** in `src/session/session.assembly.ts`: returns the surfaces whose committed golden is missing or differs from the live render. It returns rather than throws so the policy — refuse, or warn — stays with the caller, and so the spec reuses the comparison instead of keeping a second one free to drift.
- **`assertAssemblyGoldensCurrent()`** in `eval/preflight.ts`, throwing `EvalPreflightError`, called from `runEval` beside `computeAssemblyHash()` (`scripts/eval-run.core.ts:212`).

**Not covered by `--skip-preflight`,** following `assertNoStubCheckers` rather than `assertRulesIndexPopulated`. The distinction those two already draw is the right one: `--skip-preflight` exists for assertions about *the environment*, which a self-hoster may legitimately know are fine. This one's subject is whether the label about to be written on a run is true, and there is no state of the world under which writing a false one is correct.

**The error message must name both readings**, because a failing golden is ambiguous and the two fixes are opposite. Either the host's workspace build is stale — `npm run build` at the root, then re-run — or a formatter was edited and the golden not committed, in which case `UPDATE_ASSEMBLY_GOLDENS=1` is right and the diff belongs in review. Naming the mismatched surface by filename is what lets a reader tell which.

**The judge contract gets the same gate, with a wider blast radius.** Part 2 adds `findJudgeContractGoldenMismatch()`; assert it here too. Its `input_schema` is produced by `zodToJsonSchema`, so it varies with a dependency version even more directly than the assembly surfaces vary with the workspace build. Scope differs per command and the difference is principled:

| Command | Assembly goldens | Judge contract golden |
|---|---|---|
| `eval:run` | asserted — it labels a run with `assemblyHash` | asserted |
| `eval:rescore` | not asserted — no Warden call, no `assemblyHash` written | asserted |
| `eval:judge-variance` | not asserted — same reason | asserted |

**Acceptance:** with a `@uv/game-systems` `dist` built before `revealed` existed, `eval:run` exits before the first Warden turn, naming `state-snapshot.txt`; with a current build it starts. Deleting a golden file produces the `missing` message, not a crash. `--skip-preflight` does not suppress either.

## Part 2 — `judgeContractHash`, and why it is not a wider `rubricHash`

A live hash over a rendered contract, with a committed golden — the `assemblyHash` mechanism, applied one layer out.

```
serializeJudgeContract() =
  # model              JUDGE_MODEL
  # system             JUDGE_SYSTEM_PROMPT
  # closingInstruction JUDGE_CLOSING_INSTRUCTION
  # tool               JSON.stringify(JUDGE_VERDICT_TOOL, null, 2)
```

`computeJudgeContractHash()` is `hashPromptText` of that — 8 hex chars, matching `promptHash` and `assemblyHash` so all three read alike in a manifest. Committed golden at `eval/checks/judged/judge-contract-golden.txt`, asserted by `judge.spec.ts`, updated by an explicit env var. The system prompt and the closing instruction must be extracted from their current inline positions in `runJudgeCall` into named exports to be hashable at all.

Pretty-printed rather than minified, for the reason the tools golden is: `properties` and `required` both preserve the Zod shape's declaration order, so **the field order Part 3 changes reads as a moved line** rather than a changed 800-character one. That is the diff this whole mechanism exists to put in front of a reviewer.

**`JUDGE_MODEL` is in the hash despite being neither a file nor a rendered surface.** It is the single largest determinant of a verdict, and a run graded by a different model is not comparable to one that was not.

### Why not widen `rubricHash`

`ADR-0099` rejected widening `promptHash` on the historical record, and the case here is stronger. Rubric hashes are not merely quoted in prose — they are **filenames on disk** (`rubrics/<hash>.txt`, `eval/runs/paths.ts:91`) and the right-hand side of `--filter-rubric CHECK=HASH`. Redefining what the token covers would reinterpret every recorded value in hindsight *and* rename every artifact that carries one.

`ADR-0099`'s rule settles which mechanism each half gets: **hash the file when the thing is a file, use a golden when what you care about is what code produces.** A rubric template is authored text and its content is its identity — `rubricHash`, unchanged. The tool schema, the system prompt and the closing instruction are assembled by `judge.ts`, so they get the golden.

### Where it is recorded, and why not the manifest top level

Beside `rubricHash`, not beside `assemblyHash`. The distinction is the point.

`assemblyHash` is **input** identity: frozen for a run, and asserted by `assertManifestMatches` because appending reps across a change would mix two prompts under one run id. `judgeContractHash` is **scoring** identity, and scoring is re-doable — `eval:rescore` re-grades frozen `warden-output.json` artifacts under whatever the registry holds today, writing into `rescore/<timestamp>/` while `manifest.json` keeps its creation-time values. A top-level manifest field would describe the original grading and silently mislabel every re-score. `harnessVersion` is already per-row for exactly this reason (`scripts/eval-rescore.core.ts:403`).

So:

- **`CheckObservation.judgeContractHash`** (`eval/checks/run-check.ts:32`, next to `rubricHash`) — set under the identical rule, **only when `judgeInvoked`**. A gated verdict was reached by no contract at all, and stamping one on it would imply otherwise; this is what keeps `eval:judge-variance` honest and the same argument applies unchanged.
- **`ScoredRow.judgeContractHash`** (`eval/runs/scores.ts:82`), optional. Absent on structural rows, gated rows, and every row predating the field.
- **`CompletedRep.judgeContractHash`** (`eval/runs/manifest.ts`), optional, one value not a map — unlike a rubric, the contract is process-wide. A rep whose judged checks somehow disagreed records `undefined` rather than one of the two; the rows still carry every value.
- **`JudgeVarianceRow.judgeContractHash`** (`scripts/eval-judge-variance.core.ts:19`, next to `rubricHash`). Load-bearing for Part 4: the before and after variance files must be distinguishable by contract from their contents alone.
- **`eval:rescore` rows** get the *current* contract on re-graded rows, and keep the source row's on carried-forward rows — the same tense split `corpusVersion`/`harnessVersion` already follow, and it must be documented in `eval-methodology.md § Re-scoring frozen runs` alongside them.

**`eval:compare` extends, it does not gain a new concept.** Its existing per-check mixed-hash detection (`eval/runs/compare.ts:300-340`) warns when one check's rows span more than one `rubricHash`; extend the same machinery to `judgeContractHash`, which — being process-wide — warns across the whole run rather than per check. And in the run-identity header (`compare-report.ts:213`, `:280-296`): report a differing hash between run A and run B as a warning, and **a missing one as *unknown*, never as a match.** Every run on disk predates the field; rendering absent as agreement is the failure the field exists to prevent, arriving through the back door.

**Not added to `assertManifestMatches`.** Appending reps under a changed judge contract is not the failure that guard exists for. It is not two prompts under one run id — it is two gradings, which the per-rep record makes visible and `eval:rescore` can repair. `rubricHashes` already set that precedent: scoring identity is recorded, not asserted.

**Acceptance:** the golden matches on a clean build; mutating one word of the system prompt fails `judge.spec.ts` by name and moves the hash; a judged row carries the hash and a gated row does not; `eval:compare` between a run carrying the field and one predating it says *unknown*.

## Part 3 — The swap: `rationale` before `passed`

`judgeVerdictSchema` becomes `{ rationale: z.string(), passed: z.boolean() }`, and the closing instruction is reworded to ask for reasoning first and the verdict it leads to. The tool description follows — *"Report your verdict on whether this turn violates the rubric under review"* states the current order too.

A few lines of judge-side code. It moves `judgeContractHash` and **neither `promptHash` nor `assemblyHash`** — which is precisely what makes Part 2 the prerequisite rather than a nicety.

**It is not obviously a pure win and must not be shipped as one.** A verdict conditioned on reasoning is better calibrated; a long rationale can also talk itself into a conclusion. Both are live hypotheses and Part 4 is how the choice is settled. **Part 3 lands provisionally and is reverted if Part 4's rule says so** — the revert is one commit, and the pre-registered rule is what makes reverting a result rather than a retreat.

**Acceptance:** the emitted `input_schema` lists `rationale` before `passed` in both `properties` and `required`; the golden diff shows exactly that plus the reworded instruction; `judgeContractHash` moves.

## Part 4 — `eval:judge-variance`, before and after

Per step 1 of `eval-methodology.md § Running a comparison`: *if a rubric flips against fixed input, the instability is in the grader, and no comparison built on top of it means anything.* Here the question is narrower and sharper — does conditioning the verdict on the rationale make the grader more stable or less.

**Both sides cost judge calls.** The frozen inputs are already on disk, so there is no Warden spend and no database; there is no way to obtain the before side without paying for it, because it is a re-grade like any other. Run it **after Part 2 lands and before Part 3**, so the two variance files carry distinct contract hashes.

**Fixture selection differs from the methodology doc's worked example, deliberately.** That list (`turn16`/`turn21-narrating-past-a-block`, three `unauditable-mapping`) was chosen for spec 018's rubrics. Choose by where the defect actually lives instead — the three checks the contradictions concentrate in, against the current baseline `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`:

```
task eval:judge-variance -- <run-dir> --trials 3 \
  --fixtures turn24-over-resolution,turn24-hidden-info-leak,\
turn28-hidden-info-leak,5c34991b-turn10-roll-result-inversion
```

Four fixtures over a 10-rep run is 40 frozen inputs; `--trials 3` is **120 judge calls per side, 240 for the pair.** Cheaper than the doc's 150-per-side example and better targeted.

**None of these three checks carries a `judgeGate`** (`JUDGE_GATES` registers only `narrating-past-a-block` and `unauditable-mapping`), so `gatedInputs` is 0 and every frozen input reaches the rubric. That is a second reason to prefer this set: the doc's caution that a rubric validated on two inputs because a gate absorbed eighteen has not been validated does not apply here, and the flip rate needs no asterisk.

This run also covers `turn24-hidden-info-leak`, which holds one of the six confirmed contradictions (rep 007), and `5c34991b-turn10-roll-result-inversion`, which holds another and is the tag whose baseline correction is 0.90 → 1.00. Both defects are inside the measured set rather than adjacent to it.

**Acceptance:** two variance files, distinguishable by `judgeContractHash` from their contents alone, evaluated against `§ Decision rule`.

## Part 5 — Nothing guards `judge_verdict`

Independent of Parts 1–4 and of each other's ordering; included because it was found in the same scan and has nowhere else to sit. **Droppable without touching the sequence** — it is the one part here with a genuine scope choice.

7 of 1,341 rationales carry leaked tool-call markup (`</rationale>`, `</invoke>`, `<parameter name=`), one of them in the spec 019 run itself (rep 005, `turn24-over-resolution`). All seven have verdicts consistent with their rationales, so this **corrupts the audit trail rather than the score.** `TOOL-SYNTAX-LEAK` guards `submit_gm_response`; `ADR-0097` scoped the Warden only.

**"Nearly nothing" undersells it slightly, and the gap is worth stating before someone budgets an hour for it.** `findToolCallSyntax` (`src/session/session.tool-syntax.ts:99`) scans against two token sets: `TOOL_CALL_ELEMENTS` (`invoke`, `parameter`, `function_calls`, `function_results`) and `SUBMIT_GM_RESPONSE_KEYS`, derived from `submitGmResponseSchema.shape`. Pointed at a judge rationale as it stands, it would catch `</invoke>` and `<parameter name=` and **miss `</rationale>`**, which is a `judge_verdict` property name and not a `submit_gm_response` one. So the property-name list has to be parameterised — a small refactor, not a call-site change, and the one implementation must stay one implementation.

Scope: detect and record on the judge artifact; do not fail the check. A rationale that leaks markup still reached a verdict consistent with itself, and turning that into an `error` row would remove a usable grade to punish a cosmetic defect — the opposite of the `TOOL-SYNTAX-LEAK` case, where the leak destroyed the payload.

**Acceptance:** `findToolCallSyntax` takes its property-name set as an argument with no behaviour change to the Warden path; the seven known rationales are detected by a scan over the corpus; a fresh judged run records the flag on a leaking rationale and still scores it.

---

## Ordering

1. **Part 1** — no Warden-visible surface, no scoring change, independent of everything below. It lands first because it is what makes any subsequent labelled run trustworthy, including this spec's own.
2. **Part 2** — records the *current* contract. No behaviour change: the same verdicts, now with a name.
3. **Part 4, before side** — under contract A, which now has a recorded hash.
4. **Part 3** — the swap. Moves the hash.
5. **Part 4, after side** — under contract B.
6. **Decide** against `§ Decision rule`. Ship or revert Part 3.
7. **Part 5** — any time.

Steps 3 and 5 are the constraint, and it is one of convenience rather than of possibility — stated precisely because an earlier draft of this spec overstated it. Once Part 3 lands, contract A is gone from the *working* tree but not from git: `eval:judge-variance` run from the pre-swap commit is a genuine contract-A measurement, and `judgeContractHash` is exactly what labels the resulting file correctly rather than ambiguously. So the before side is recoverable at the cost of a checkout and an old build on the eval host — friction, not a closed door. Run it in order anyway; the reason to prefer that is cost and cleanliness, not necessity.

What genuinely does **not** work is landing 2 and 3 together and calling the before side "the artifacts already on disk". Those artifacts are single verdicts, not repeated trials, and a flip rate cannot be computed from them.

**Invariant, per M7.6:** the repo is green at every commit — `npm run build`, `npm test`, `npm run lint`.

**This spec buys no re-baseline and owes none.** `ADR-0094`'s batching rule does not apply: nothing here is Warden-visible, so there is no Warden behaviour to re-measure. `promptHash`, `assemblyHash` and `corpusVersion` must all be unmoved on landing — **if `assemblyHash` moves, something in Part 1 or Part 2 touched a Warden-visible surface by accident, and that is a bug in this spec, not a re-baseline to schedule.** That is a cheap, sharp check and it should be run explicitly.

---

## Predictions, pre-registered 2026-08-22 before any run

Per `ADR-0085`. There is no honest `eval:compare` across a scoring boundary, so predictions are the only route to attributing a moved number to this work.

**Contract identity.** A spike of the Part 2 serialization hashed the current contract to `fbbd8e46`. That value is a function of the exact serialization Part 2 settles on, so it is **an acceptance check to record at landing, not a prediction** — what is pre-registered is that Part 3 moves it and Parts 1, 2 and 5 do not.

**Flip rate: no directional prediction, and that is deliberate.** Both mechanisms are live — better calibration versus a rationale talking itself into a conclusion — and pre-registering a direction here would be inventing a belief to be scored against. What is pre-registered is the ceiling in `§ Decision rule`.

**Contradictions on the after side: zero, or one.** This is the real prediction and the one most worth being wrong about. If the field-order hypothesis is right, a verdict conditioned on completed reasoning cannot contradict that reasoning except by ordinary model error. **If contradictions persist at anything like the baseline concentration, the hypothesis is wrong** — the boolean's position was not the cause, the fix is not the fix, and Part 3 should be reverted regardless of what the flip rate did. Measured by a direct read of every `fail` closing in the after-side variance output, not a classifier, for the reason the 2026-08-21 scan established. **The harness cannot do this today** — `judgeVarianceRowSchema` (`scripts/eval-judge-variance.core.ts:16`) records no rationale, so there are no closings in a variance file to read. Planning found it; the plan's Part 6 fixes it, and must land before either variance run.

**Verdict mix shifts slightly toward `pass`, and a large shift is a red flag rather than a win.** A boolean emitted before reasoning defaults toward `false`; removing that should remove some false failures. The known contradiction floor is 6 of 401 failures corpus-wide and 18% within `OVER-RESOLUTION`. A shift on this fixture set of roughly that size is the fix working. **A much larger one means the swap changed what is being measured rather than repairing how it is recorded**, and wants investigation before shipping — a judge that now passes everything is not a calibrated judge.

**`gatedInputs` is 0 on both sides.** None of the three checks carries a `judgeGate`. If it is not 0, the fixture selection is wrong or a gate was added, and the flip rates need re-reading before anything is concluded from them.

### What this does not measure

Read the numbers above with this list, not after it.

- **Every judged check other than the three.** `MISSING-DELTA`, `UNSURFACED-CHECK`, `SCENE-JUMP`, `NARRATING-PAST-A-BLOCK`, `UNAUDITABLE-MAPPING`, `MISSING-CANON-CAPTURE` are all graded through the same contract and none is in the variance set. The swap applies to them; the evidence does not. This is a deliberate cost trade and it should be stated in the run report rather than discovered later.
- **Whether the swap changes the *correct* verdict rate.** Flip rate measures grader stability against frozen input; a judge that is stably wrong scores perfectly on it. Nothing here establishes accuracy, which is `§ M7.8`'s remit and needs known answers.

**Widening to the other six is declined, with a trigger instead of a spend — decided 2026-08-22.** Three of the six are not cleanly measurable in any case: `UNEXPLAINED-DELTA` has no fixture carrying it for the third run running, and `NARRATING-PAST-A-BLOCK` and `UNAUDITABLE-MAPPING` both carry `judgeGate`s, so their flip rates would need exactly the asterisk this fixture set was chosen to avoid. The remaining three — `UNSURFACED-CHECK`, `SCENE-JUMP`, `MISSING-DELTA` — are measurable and are not going dark: every run after the swap produces contract-B rates for all nine judged checks, so a move will be visible. What would be missing is the *controlled* A-versus-B delta, and that is only needed once something looks wrong. **The trigger:** if any of the six moves beyond ordinary run-to-run noise on the first post-swap re-baseline, buy the before/after for that check specifically, by running variance at the pre-swap commit per `§ Ordering`. **What makes this a trigger rather than a gamble:** all three measured checks are ones where `fail` means the Warden erred and the observed contradictions ran fail-under-a-pass-rationale. A rubric whose natural default runs the other way could plausibly respond to the swap differently — not worth ~200 judge calls to rule out in advance, and the reason the trigger is written down rather than left to notice.
- **`OVER-RESOLUTION`'s true rate.** It stays a ceiling until the affected runs are re-scored, which this spec declines to do.
- **Anything Warden-side.** No Warden call is made by any part of this spec.

### Decision rule

Written before any number is seen.

- **Revert Part 3** if the after-side contradiction count exceeds one, regardless of flip rate.
- **Revert Part 3** if the after-side flip rate is worse than the before side by more than **0.10 absolute** on any of the three checks.
- **Ship Part 3** if contradictions are 0 or 1 and no check's flip rate worsens by more than 0.10.
- **A flip rate that *improves* is not required.** The defect being fixed is contradiction, not instability; demanding an improvement in a number the change was not aimed at is how a real fix gets rejected.
- **Any verdict-mix shift materially larger than the known contradiction floor pauses the decision** pending a read of what moved, rather than auto-shipping on the two clauses above.

---

## What the swap costs, and why the corrections stay in prose

**Part 3 makes every judged rate in the corpus non-comparable to any produced after it**, unless re-scored. That is not a side effect to minimise — it is the honest consequence of changing a grader, and Part 2 exists so it is visible in `eval:compare` rather than silent.

This is also why the two live data corrections stay corrections rather than becoming re-scores. `eval-methodology.md` records that the 2026-08-21 baseline's true `ROLL-RESULT-INVERSION` is 1.00 rather than 0.90, and spec 019's `HIDDEN-INFO-LEAK` 1.00 rather than 0.95. Re-scoring those runs would fix the numbers and cost judge spend — but **after Part 3 the re-score would be graded under contract B, so the corrected figures would no longer be like-for-like with the contract-A numbers they are meant to correct.** A re-score before Part 3 would be comparable and is still judge spend for two single-value fixes already documented in prose. Neither is worth it. The prose correction is the cheaper and the more honest instrument, and `eval-methodology.md § Before trusting any judged rate from this corpus` is where it lives — it outlives the roadmap bullet, which gets ticked and stops being read.

**The standing contradiction floor on any pre-Part-3 judged failure rate is roughly 1.5% corpus-wide and 18% for `OVER-RESOLUTION`.** That does not go away when this spec closes; it is a property of every number already recorded.

---

## Done when

- `eval:run` refuses to start against a stale workspace build, naming the surface, not suppressible by `--skip-preflight`.
- `eval:rescore` and `eval:judge-variance` refuse to start against a stale judge-contract golden.
- The golden comparison has exactly one implementation, shared by the spec and the preflight.
- `judgeContractHash` is computed live, backed by a committed golden, and recorded on judged rows, on completed reps, on variance rows, and on re-score rows with the correct tense.
- `eval:compare` warns on a differing contract hash and reports an absent one as unknown.
- Two variance files exist, before and after, distinguishable by contract hash from their contents alone.
- The decision rule has been evaluated in writing and Part 3 is either shipped or reverted on its terms.
- `promptHash`, `assemblyHash` and `corpusVersion` are unmoved.
- Both M7.7 bullets are ticked; the data corrections stay in `eval-methodology.md`; `eval-methodology.md § Re-scoring frozen runs` documents the new column's tense.
- **`ADR-0102`** records the two-hashes-one-defect reasoning and the widen-versus-add choice.

## Resolved before drafting

- **Which of `ADR-0099`'s two candidate mechanisms.** The golden gate, not the version fold. The roadmap bullet already called it cheaper and more honest; the added reason is that a version-derived hash reintroduces `harnessVersion`'s always-fires failure.
- **Widen `rubricHash` or add a hash.** Add. Rubric hashes are filenames on disk and CLI arguments, not just prose, so widening is worse here than the widening `ADR-0099` already rejected.
- **Manifest top level or per-row.** Per-row and per-rep. The judge contract is scoring identity and scoring is re-doable; `eval:rescore` is the case that decides it.
- **Whether `assertManifestMatches` gains a clause.** No. Two gradings under one run id is a visibility problem, not an append-time error, and `rubricHashes` set that precedent.
- **Which fixtures the variance run uses.** The three checks the contradictions concentrate in, not the methodology doc's worked example — and they happen to be ungated, so the flip rate needs no asterisk.
- **A new ADR, not an `ADR-0099` addendum — decided 2026-08-22.** `ADR-0099`'s title scopes it to *the code-built **prompt** surfaces*; the judge is the grader, not something the Warden reads, and a reader looking for "which judge graded this run" would never search there. `ADR-0099` also already carries one addendum, on the build hole, and a second unrelated decision inside it would make one entry about two things. **`ADR-0102`**, stating that it extends `ADR-0099` rather than replacing it.
- **Whether the structural checkers get the same treatment — no, decided 2026-08-22**, and on repair cost rather than severity: `eval:rescore` regrades deterministic checkers for free, so a structural mislabelling is undoable at zero spend, while the judged half has no such hatch. Reasoning and the revisit condition are in `docs/roadmap.md § M7.7`.
- **Whether the closing instruction is part of the contract.** Yes. The roadmap bullet lists three surfaces; the instruction is a fourth, it states the order the model is asked to work in, and Part 3 rewords it.

## Open

Nothing blocking. Both questions this spec opened were settled 2026-08-22; the two items below are recorded elsewhere and are not this spec's to close.

- **Playtest telemetry** still stores the GM context render as a block count, so a playtest turn's GM context is unrecoverable where an eval run archives the whole request. Scoped, with a `store-on-change` recommendation replacing `ADR-0099`'s original suggestion, as its own bullet in `docs/roadmap.md § M7.7`. Not spec 020's business: a session-side write path, no bearing on the judge or on run labelling.
- **Structural-checker identity** — the other half of the grading gap `judgeContractHash` covers one side of. Declined with reasoning in `docs/roadmap.md § M7.7`.
