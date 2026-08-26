---
id: ADR-0102
title: The judge contract gets its own identity, and the verdict follows the reasoning
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

`ADR-0099` gave the code-built Warden surfaces an identity and, in its addendum, recorded that the identity varies with the build rather than the commit. Both halves of that entry turn out to be one defect with two faces, and the second face is on the grading side: **an identity that does not cover the surface it names.** `assemblyHash` missed the build; `rubricHash` missed the judge contract. Both were invisible in the same run, `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`.

`rubricHashFor` (`eval/checks/registry.ts:595`) is `hashPromptText(rubricTextFor(checkId))` — the rubric template and nothing else. Outside it sat `JUDGE_VERDICT_TOOL`, the judge system prompt, `JUDGE_MODEL`, and the closing instruction, which no prior write-up listed and which states the order the model is asked to work in. Changing any of them changes how every judged tag is graded and moved **no identity at all**: `manifest.completedReps[].rubricHashes` unchanged, `eval:compare --filter-rubric CHECK=HASH` still matching, the "graded by different checker code" warning silent. A before/after boundary that reads as like-for-like and is not.

## A separate hash, not a wider `rubricHash`

`ADR-0099` rejected widening `promptHash` on the historical record. The case here is stronger, because rubric hashes are not merely quoted in prose — they are **filenames on disk** (`rubrics/<hash>.txt`, `eval/runs/paths.ts:91`) and the right-hand side of `--filter-rubric CHECK=HASH`. Redefining what the token covers would reinterpret every recorded value in hindsight *and* rename every artifact carrying one.

`ADR-0099`'s rule settles which mechanism each half gets: **hash the file when the thing is a file, use a golden when what you care about is what code produces.** A rubric template is authored text and its content is its identity — `rubricHash`, unchanged. The tool schema, the system prompt and the closing instruction are assembled by `judge.ts`, so they get the `assemblyHash` treatment: a live hash over a labelled render, backed by a committed `.txt` golden. `JUDGE_MODEL` is folded in despite being neither a file nor a surface — it is the largest single determinant of a verdict, and a run graded by a different model is not comparable to one that was not.

**This is a new entry rather than an `ADR-0099` addendum** because that entry's scope is *the code-built prompt surfaces* — what the Warden reads. The judge is the grader, and a reader looking for "which judge graded this run" would not search there. It extends `ADR-0099`'s reasoning rather than replacing it; neither is superseded.

## Scoring identity is recorded, not asserted

`judgeContractHash` lives on the score row, the completed rep, the judge artifact and the variance row — **not** at the manifest top level, and **not** in `assertManifestMatches`.

`assemblyHash` is *input* identity: frozen for a run, and asserted, because appending reps across a change would mix two prompts under one run id. The judge contract is *scoring* identity, and scoring is re-doable — `eval:rescore` re-grades frozen artifacts into `rescore/<timestamp>/` while `manifest.json` keeps its creation-time values, so a manifest-level field would describe the original grading and mislabel every re-score. `harnessVersion` is already per-row for exactly this reason. `rubricHashes` set the precedent that scoring identity is made visible rather than asserted, and this follows it.

Re-graded rows take the current contract; **carried-forward rows keep the source's**, or every re-score containing one would look like it spanned a judge change.

`eval:compare` warns at **run level** rather than per check, and that asymmetry with the mixed-rubric warning is the point: the harness ships one rubric per judged check, so several rubric hashes in a run is normal. The contract is process-wide, so two of them means the whole run was graded two ways — no subset to filter to, and the remedy is `eval:rescore` rather than a flag. An absent hash reports as **unknown**, never as a match.

## The goldens now gate the runs

`ADR-0099`'s addendum left two candidate fixes for the build-varying hash and chose neither. The cheaper and more honest one is taken here: the goldens already detect a stale `@uv/*` build exactly, and nothing required them to have been run. `assertAssemblyGoldensCurrent` refuses `eval:run`; `assertJudgeContractGoldenCurrent` refuses `eval:run`, `eval:rescore` and `eval:judge-variance` — every entry point that can spend judge calls. Neither is covered by `--skip-preflight`, following `assertNoStubCheckers`: that flag is for assertions about the environment, and these are about whether the label being written is true.

Folding resolved `@uv/*` versions into the hash was rejected. A hash that moves on every dependency bump reintroduces `harnessVersion`'s failure — a signal that fires every time is one people learn to skip.

## `rationale` before `passed`

The tool call is forced (`toolChoice: { type: 'any' }`) and a model emits an object's fields in schema order, so with `passed` first the boolean was produced before a word of reasoning existed and could not be retracted once the rationale talked its way out of it. A scan of all 1,341 `judge-*.json` on disk found six verdicts contradicting their own rationale — every one a `fail` under a rationale arguing the turn was fine, with **zero** in the converse direction across 940 passes. That asymmetry is the hypothesis showing up in the data.

**Shipped on measurement rather than on the argument**, because it is not obviously a pure win: a verdict conditioned on reasoning is better calibrated, but a long rationale can also talk itself into a conclusion. `eval:judge-variance` ran on both sides of the change against 38 frozen inputs, 114 judge calls each, under a decision rule pre-registered before either run.

**The result, and the single strongest piece of it.** `roll-result-inversion` rep 004 carried *both* contradictions on the before side, closing on *"there is nothing confirmable as inverted"* and *"this does not fail the rubric on the stated criteria"* — under `verdict: fail`. After the swap the same frozen input returns `pass` three times, reasoning the same way. Same argument, verdict now following it. Contradictions across the after side: **zero**, by direct read of the one failure and a converse scan of all 112 passes.

Two things kept honest rather than tidied away. `hidden-info-leak`'s flip rate moved 0.00 → 0.10, passing the rule by exactly zero margin. And one trial in 114 errored where the before side had none — plausibly a model running long on the rationale and omitting the now-last `passed` field, equally plausibly a transient API failure, and one event cannot separate them. `judgeVarianceRowSchema` now persists `errorMessage` so the next run can attribute what this one could not.

## What this deliberately does not cover

**The structural checkers.** `corpusVersion` hashes fixture files and says nothing about the code that grades them; this covers the judged half only. Declined on repair cost rather than severity — `eval:rescore` regrades deterministic checkers for free, so a structural mislabelling is undoable at zero spend, where the judged half has no such hatch. `docs/roadmap.md § M7.7`.

**Accuracy.** Flip rate measures grader stability against frozen input; a judge that is stably wrong scores perfectly on it. Nothing here establishes that a verdict is *correct*, which is `§ M7.8`'s remit and needs known answers.

**The six other judged checks.** The change applies to all nine; the evidence covers three. The trigger for buying the rest is recorded in the spec rather than pre-emptively spent.
