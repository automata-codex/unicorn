# 020 — Judge contract identity and the field-order swap: Implementation Plan

Multipart implementation plan for
`../specs/zoltar/020-judge-contract-identity-and-the-field-order-swap.md`. Each
part is sized for a manual code review and a single commit. **Pause after each
part for review before starting the next.**

**Grounding.** Written 2026-08-22 against `milestone-m77-playtest-and-fixtures`
at `a2c6a22`. Every `path:line` below was read in the working tree, not
inherited from the spec. Paths are relative to `apps/zoltar-be/` unless stated.

**Invariant for every part: the repo is green at each commit.** `npm run build`,
`npm test`, `npm run lint`.

**The spec's own invariant, and it is checkable rather than aspirational:**
`promptHash`, `assemblyHash` and `corpusVersion` are unmoved by every commit
here. Nothing in this plan touches a Warden-visible surface. If `assemblyHash`
moves, something went wrong — that is a bug in the change, not a re-baseline to
schedule.

---

## One thing the spec did not know

**`eval:judge-variance` discards rationales, so the spec's primary prediction
cannot currently be evaluated.** `judgeVarianceRowSchema`
(`scripts/eval-judge-variance.core.ts:16-28`) carries `fixtureId`, `checkId`,
`rubricHash`, `sourceRepIndex`, `trialIndex`, `verdict`, `judgeInvoked` and
`durationMs` — and no rationale. The trial loop
(`scripts/eval-judge-variance.core.ts:294-317`) has `observation.detail` in hand
and drops it on the floor.

The spec pre-registers *"contradictions on the after side: zero, or one"*,
*"measured by a direct read of every `fail` closing in the after-side variance
output"*. There are no closings in that output to read. The decision rule's
first and strongest clause is unevaluable as the harness stands.

Hence **Part 6**, which lands before either variance run. It is the one part
here the spec does not contain, and it is load-bearing rather than tidy: without
it, Part 9 can report a flip rate and nothing else, and the decision falls back
to the clause the spec explicitly says is *not* the point.

---

## Ordering

Eleven items. Nine are commits; **Parts 7 and 9 are runs, not commits** — they
spend judge budget and produce artifacts under `$ZOLTAR_EVAL_ROOT`.

| # | Title | Spec | Moves |
|---|---|---|---|
| 1 | The assembly goldens gate the run | P1 | nothing |
| 2 | The judge contract gets a render, a golden and a hash | P2 | nothing |
| 3 | The judge-contract golden gates the three judged commands | P1 | nothing |
| 4 | `judgeContractHash` is recorded wherever a judged verdict is | P2 | nothing |
| 5 | `eval:compare` reports the judge contract | P2 | nothing |
| 6 | `eval:judge-variance` keeps its rationales | — | nothing |
| 7 | **Variance, before side — contract A** | P4 | *(a run)* |
| 8 | `rationale` before `passed` | P3 | **`judgeContractHash`** |
| 9 | **Variance, after side, and the decision** | P4 | *(a run)* |
| 10 | `judge_verdict` gets the tool-syntax detector | P5 | nothing |
| 11 | `ADR-0102`, methodology, roadmap closeout | — | nothing |

**Parts 7 and 8 are the hard boundary.** Everything before 8 must be complete,
because contract A stops being the working tree's contract the moment 8 lands.
It remains recoverable from git — spec `§ Ordering` states this precisely, and
an earlier draft overstated it — but recovering it means a checkout and an old
build on the eval host, which is friction worth avoiding by running 7 in order.

**Part 10 is independent of everything.** It can land any time, including
before Part 1. It is listed late because it is the droppable part, not because
anything waits on it.

### What each part needs beyond the repo

- Parts 7 and 9 need a green `npm test` on the eval host (which Part 1 then
  enforces), `ZOLTAR_EVAL_ROOT` set, and the baseline run directory present.
- Judge budget: **120 calls per side, 240 total.** No Warden calls, no database.
- No fixture is touched at any point. `corpusVersion` does not move.

---

## Part 1 — The assembly goldens gate the run

*Spec Part 1, assembly half. No Warden-visible surface.*

The comparison exists today only inside `src/session/session.assembly.spec.ts`,
which reads each golden and asserts byte equality against the live render.
`scripts/eval-run.core.ts:212` calls `computeAssemblyHash()` and never asks
whether the goldens still match — which is how
`claude-sonnet-5__6717347d__2026-08-21T21-14-59Z` came to record
`assemblyHash 8e332e38` for a commit that produces `6dc28608`.

**Work.**

1. Add `findAssemblyGoldenMismatches(): AssemblyGoldenMismatch[]` to
   `src/session/session.assembly.ts`, returning `{ surface, file, reason }` for
   every golden that is `'missing'` or `'differs'`. It iterates
   `ASSEMBLY_GOLDEN_FILES` (`session.assembly.ts:267`) against
   `ASSEMBLY_GOLDEN_DIR` (`:280`). Needs `existsSync, readFileSync` from
   `node:fs`; `join` is already imported.
2. Return rather than throw. Policy — refuse or warn, which surfaces matter —
   belongs to the caller, and the spec needs the same comparison in a context
   where throwing is wrong.
3. Add `assertAssemblyGoldensCurrent()` to `eval/preflight.ts`, throwing
   `EvalPreflightError`.
4. Call it from `runEval` immediately before `computeAssemblyHash()`
   (`scripts/eval-run.core.ts:212`). **Not** routed through
   `deps.assertPreflight`, and **not** covered by `--skip-preflight` — mirror
   the comment `assertNoStubCheckers` already carries at
   `scripts/eval-run.core.ts:~255`, and extend `assertNoStubCheckers`'s own
   docblock reasoning: `--skip-preflight` covers assertions about the
   environment; this one covers whether the label about to be written is true.
5. The error message names both readings, because a failing golden is ambiguous
   and the two fixes are opposite: a stale workspace build (`npm run build` at
   the repo root, then re-run) or an uncommitted formatter edit
   (`UPDATE_ASSEMBLY_GOLDENS=1`, and the diff belongs in review). Name the
   mismatched file so a reader can tell which.

**Watch for.**

- **The spec keeps its per-file `expect(rendered).toBe(golden)` assertions.**
  Do not replace them with `expect(findAssemblyGoldenMismatches()).toEqual([])`.
  The mismatch list is machine-readable and produces a useless failure message;
  `toBe` produces the text diff that is the entire reason the goldens exist. Add
  the empty-list assertion *alongside* them, so the function the preflight
  depends on is itself covered. Two readers of the same files is the accepted
  cost, and it is small because both call `renderAssemblySurfaces()`.
- The `UPDATE_ASSEMBLY_GOLDENS=1` write path in the spec stays as it is. The
  shared function only reads.
- Preflight importing from `src/session/` is not a new direction —
  `eval/preflight.ts:3` already imports `../src/db/schema`.

**Done when.** Against a `@uv/game-systems` `dist` built before `revealed`
existed, `eval:run` exits before the first Warden turn naming
`state-snapshot.txt`; against a current build it starts. A deleted golden
produces the `missing` message rather than a crash. `--skip-preflight` does not
suppress either. Reproduce the stale-build case by deleting `revealed` from
`ASSEMBLY_PROBE`'s entities, per the `ADR-0099` addendum — it yields `8e332e38`
to the character.

---

## Part 2 — The judge contract gets a render, a golden and a hash

*Spec Part 2, first half. Nothing records the hash yet.*

`eval/checks/judged/judge.ts` holds four things that govern a verdict and none
that records them: `JUDGE_MODEL` (`:38`), `judgeVerdictSchema` (`:41`),
`JUDGE_VERDICT_TOOL` (`:47`), and — inline inside `runJudgeCall`, which is why
the spec had to name it separately — the system prompt and the closing
instruction `'Call judge_verdict with your verdict and a brief rationale.'`

**Work.**

1. Extract `JUDGE_SYSTEM_PROMPT` and `JUDGE_CLOSING_INSTRUCTION` as exported
   consts, referenced from `runJudgeCall`. Pure extraction: byte-identical
   prompt text, verifiable by the existing `judge.spec.ts` passing untouched.
2. Add `serializeJudgeContract()` — labelled, ordered join of model, system,
   closing instruction, and `JSON.stringify(JUDGE_VERDICT_TOOL, null, 2)`.
   Labels are included so moving text between two of them changes the hash
   rather than cancelling out, exactly as `serializeAssemblySurfaces`
   (`session.assembly.ts:286`) does.
3. Pretty-print the tool. `properties` and `required` both preserve the Zod
   shape's declaration order, so Part 8 reads as a moved line rather than a
   changed 800-character one. That diff is the point of the mechanism.
4. Add `computeJudgeContractHash()` — `hashPromptText(serializeJudgeContract())`
   from `../../../src/wardens/prompt-paths`, matching the import style of the
   existing `../../../src/anthropic/anthropic.service` type import.
5. Commit the golden at `eval/checks/judged/judge-contract-golden.txt`, with
   `JUDGE_CONTRACT_GOLDEN_PATH` resolved from `__dirname`.
6. Add `findJudgeContractGoldenMismatch(): 'missing' | 'differs' | null`.
7. Assert it in `judge.spec.ts`, with `UPDATE_JUDGE_CONTRACT_GOLDEN=1` as the
   explicit rewrite path. Same reasoning as the assembly spec's own comment: a
   golden that self-heals asserts nothing.

**Watch for.**

- **`.txt`, not `.json`, and the extension is the whole mechanism.** The
  assembly goldens are `.txt` including the tools JSON precisely so the
  formatter leaves them alone (`ADR-0099`; `session.assembly.ts:262-266`).
  Verified 2026-08-22: `biome check src/session/assembly-golden/` reports the
  directory *ignored* — biome does not handle `.txt` at all, so a golden is safe
  wherever it lives. **Do not "fix" this by excluding `eval/checks/` in
  `biome.json`.** The two existing exclusions (`eval/fixtures/`,
  `eval/retrieval-fixtures/`) are pure-data directories of `.json`, which biome
  *does* format; `eval/checks/` is almost entirely TypeScript, and excluding it
  would drop `registry.ts`, `run-check.ts`, `judge.ts`, `rubrics.ts` and the
  whole `structural/` tree out of the formatter and the organize-imports assist
  to protect a file that was never at risk. `npm run lint` passes only
  `src/ test/` to biome regardless.
- A spike of this serialization hashed the current contract to **`fbbd8e46`**.
  Treat that as an expected value to confirm at landing, not a target — it is a
  function of the exact serialization, and if the labels or ordering differ from
  the spike the value legitimately differs. Record whatever lands; Part 8's job
  is to move it.
- No behaviour change. Every verdict this commit produces is identical to the
  one before it.

**Done when.** The golden matches on a clean build; mutating one word of
`JUDGE_SYSTEM_PROMPT` fails `judge.spec.ts` by name and moves the hash; the
recorded pre-swap value is written into the commit message.

---

## Part 3 — The judge-contract golden gates the three judged commands

*Spec Part 1, judge half. Depends on Part 2.*

**Work.**

1. Add `assertJudgeContractGoldenCurrent()` to `eval/preflight.ts`.
2. Wire it into all three entry points that can spend judge calls:
   `runEval` (`scripts/eval-run.core.ts:195`), `runRescore`
   (`scripts/eval-rescore.core.ts:143`) and `runJudgeVariance`
   (`scripts/eval-judge-variance.core.ts:175`).
3. Do **not** add the assembly gate to the latter two. Neither renders an
   assembly surface and neither writes an `assemblyHash`; asserting something a
   command cannot affect trains people to skip preflight failures. The spec's
   `§ Part 1` table is the reference.

**Watch for.** `zodToJsonSchema` is a dependency, so this golden moves with
`node_modules` more directly than the assembly goldens move with the workspace
build. That is the argument for gating the two judge-only commands at all, and
it belongs in the function's docblock rather than only here.

**Done when.** All three commands refuse to start against a mutated contract;
`eval:rescore` and `eval:judge-variance` still start against a stale
`@uv/game-systems` build, because that is not their exposure.

---

## Part 4 — `judgeContractHash` is recorded wherever a judged verdict is

*Spec Part 2, second half. The threading commit.*

Five layers, in dependency order.

**Work.**

1. **`CheckObservation.judgeContractHash?`** (`eval/checks/run-check.ts:32`,
   beside `rubricHash`). Set in the judged branch at
   `eval/checks/run-check.ts:120` — **only when `judgeInvoked`**, which that
   branch already implies. A gated verdict was reached by no contract, and the
   `rubricHash` docblock's reasoning applies verbatim.
2. **`ScoredRow.judgeContractHash?`** (`eval/runs/scores.ts:82`), optional.
   Absent on structural rows, gated rows, and every row predating the field.
3. **`CompletedRep.judgeContractHash?`** (`eval/runs/manifest.ts:16` region),
   optional, one value not a map. Record `undefined` when a rep's judged checks
   somehow disagreed rather than picking one; the rows keep every value.
4. **`JudgeArtifactInput.judgeContractHash`** (`eval/runs/artifacts.ts:122`),
   beside `rubricHash`. Both `writeJudgeArtifact` and `writeJudgeArtifactAt`
   flow through this shape, so `eval:run` and `eval:rescore` pick it up together.
5. **`JudgeVarianceRow.judgeContractHash`**
   (`scripts/eval-judge-variance.core.ts:16`). Load-bearing for Parts 7 and 9:
   the two variance files must be distinguishable by contract from their
   contents alone.
6. **Re-score tense.** Re-graded rows get the *current* contract;
   carried-forward rows keep the source row's. Same split
   `corpusVersion`/`harnessVersion` already follow at
   `scripts/eval-rescore.core.ts:403-405` and `:434-448`.

**Watch for.**

- **`eval-run.core.ts` needs a `Set<string>` threaded into
  `runFixtureAndScore`.** `rubricHashesThisRep` is already a parameter on
  `RunFixtureAndScoreInput` (`scripts/eval-run.core.ts:452`); the contract-hash
  accumulator has to be added there, to the destructure at `:479`, and to the
  call site at `:372`. Missing any of the three is a compile error, so this is
  cheap to get wrong and impossible to ship wrong.
- Do **not** add it to `assertManifestMatches` (`eval/runs/manifest.ts:117`).
  Spec `§ Part 2` gives the reasoning: two gradings under one run id is a
  visibility problem, not an append-time error, and `rubricHashes` set the
  precedent.
- Every existing `manifest.spec.ts` / `scores.spec.ts` fixture stays valid,
  because every new field is optional. If a test breaks, a field was made
  required by accident.

**Done when.** A judged row carries the hash and a gated row does not; a rep
records one value; a re-score's re-graded rows carry today's contract while
carried-forward rows carry the original's.

---

## Part 5 — `eval:compare` reports the judge contract

*Spec Part 2, third half.*

**Work.**

1. **Mixed-contract detection.** `eval/runs/compare.ts:300-340` warns when a
   single check's rows span more than one `rubricHash`. The contract is
   process-wide, so this is a **run-level** warning, not a per-check one —
   different aggregation, same machinery. A run whose rows span two contracts
   was graded across a judge change partway through.
2. **Run-identity header.** Add a line beside
   `compare-report.ts:213`'s assembly-hash line.
3. **A/B warning**, beside `compare-report.ts:280-296`. Differing hashes warn;
   **a missing one reports *unknown*, never a match.** Every run on disk
   predates the field, and rendering absent as agreement is the exact failure
   the field exists to prevent.

**Watch for.** `compare-report.spec.ts:118` already has the
*"reports a missing assemblyHash as unknown rather than matching"* test. Copy
its shape rather than inventing one; the parallel is the point.

**Done when.** Two runs graded under different contracts warn; a run carrying
the field compared against one predating it says unknown; the existing
mixed-rubric warning is unchanged.

---

## Part 6 — `eval:judge-variance` keeps its rationales

*Not in the spec. See `§ One thing the spec did not know`. Must land before
Part 7.*

**Work.**

1. Add `rationale: z.string()` to `judgeVarianceRowSchema`
   (`scripts/eval-judge-variance.core.ts:16`), populated from
   `observation.detail` in the trial loop (`:294-317`), where it is already in
   scope and currently discarded.
2. Default it to `''` on parse, so re-reading a variance file written before
   this commit still validates — the same tolerance every other added field in
   this plan gets.
3. Leave the summary output alone. `FixtureCheckVariance` and `RubricVariance`
   aggregate verdicts; rationales are for the direct read, not the rollup, and
   putting them in a summary would bury the thing Part 9 needs to page through.

**Watch for.**

- **Size.** 120 rationales per side at a few hundred bytes each is well under a
  megabyte. No sampling, no truncation — a truncated closing is exactly the part
  a contradiction read needs, since the six known contradictions were all found
  by reading closings.
- Do not gate persistence on `verdict === 'fail'`. The 2026-08-21 scan found
  contradictions only among failures, but it *established* that by scanning all
  940 passes and finding none. Discarding pass rationales would make the
  converse check impossible to repeat.

**Done when.** A variance file carries one rationale per trial; an older
variance file still parses.

---

## Part 7 — Variance, before side (contract A)

*Spec Part 4, first half. A run, not a commit. ~120 judge calls.*

**Preconditions.** Parts 1–6 landed. Green `npm test` on the eval host — now
enforced by Parts 1 and 3 rather than remembered. `ZOLTAR_EVAL_ROOT` set.

```
task eval:judge-variance -- \
  <root>/eval-runs/claude-sonnet-5__6717347d__2026-08-21T21-14-59Z \
  --trials 3 \
  --fixtures turn24-over-resolution,turn24-hidden-info-leak,\
turn28-hidden-info-leak,5c34991b-turn10-roll-result-inversion
```

Four fixtures × 10 reps = 40 frozen inputs; `--trials 3` = 120 judge calls.
Verified present: all four fixture directories exist under `reps/001/` of that
run, and it has ten reps.

**Record from the output**, into the commit message or a scratch note that
Part 9 reads: the recorded `judgeContractHash` (expected `fbbd8e46` or whatever
Part 2 landed), per-check flip rates, `gatedInputs`, and the count of
verdict/rationale contradictions from a direct read of every `fail` closing.

**Watch for.**

- **`gatedInputs` must be 0.** None of `over-resolution`, `hidden-info-leak` or
  `roll-result-inversion` appears in `JUDGE_GATES`
  (`eval/checks/registry.ts:341-344`), which registers only
  `narrating-past-a-block` and `unauditable-mapping`. A non-zero value means the
  fixture selection is wrong or a gate was added, and the flip rates need
  re-reading before anything is concluded.
- Read the contradictions by hand. The spec's methodological note is a finding,
  not a preference: a classifier under-counts, because a check whose failures
  are often contradictions teaches it to read pass-language as fail-language.

**Done when.** A contract-A variance file exists and its four figures are
written down somewhere Part 9 can cite.

---

## Part 8 — `rationale` before `passed`

*Spec Part 3. The only commit that moves anything.*

**Work.**

1. `judgeVerdictSchema` (`eval/checks/judged/judge.ts:41`) becomes
   `{ rationale: z.string(), passed: z.boolean() }`.
2. Reword `JUDGE_CLOSING_INSTRUCTION` to ask for reasoning first and the verdict
   it leads to.
3. Reword `JUDGE_VERDICT_TOOL.description` — *"Report your verdict on whether
   this turn violates the rubric under review"* states the old order too.
4. Regenerate the golden with `UPDATE_JUDGE_CONTRACT_GOLDEN=1` and **read the
   diff**. It should show `rationale` moving above `passed` in both `properties`
   and `required`, plus the two rewordings, and nothing else.
5. Record the new hash in the commit message beside the old one.

**Watch for.**

- `JudgedVerdict` is `z.infer<typeof judgeVerdictSchema>`, so field order in the
  type is irrelevant to consumers. `runCheck` reads `judged.passed` and
  `judged.rationale` by name (`eval/checks/run-check.ts:117-118`). Nothing
  downstream should need a change; if something does, that is worth
  understanding before continuing.
- **This commit lands provisionally.** Part 9 may revert it. Keep it a single
  clean commit so the revert is one command, and say so in the message.

**Done when.** The emitted `input_schema` lists `rationale` first;
`judgeContractHash` has moved; `promptHash`, `assemblyHash` and `corpusVersion`
have not.

---

## Part 9 — Variance, after side, and the decision

*Spec Part 4, second half. A run, not a commit. ~120 judge calls.*

Identical invocation to Part 7, against the same run directory. The output
carries the new `judgeContractHash`, which is what makes the pair a comparison
rather than two files.

**Evaluate the spec's decision rule, in writing, in this order:**

1. **Contradictions on the after side.** Direct read of every `fail` closing.
   More than one → **revert Part 8**, regardless of flip rate. This clause is
   first because it is the one the change was aimed at.
2. **Flip rate.** Worse than the before side by more than 0.10 absolute on any
   of the three checks → **revert**.
3. **Verdict mix.** A shift materially larger than the known contradiction floor
   (6 of 401 failures corpus-wide; 18% within `OVER-RESOLUTION`) **pauses** the
   decision pending a read of what moved, rather than auto-shipping.
4. An improved flip rate is **not** required. The defect is contradiction, not
   instability.

**Watch for.**

- Write the evaluation before deciding, not after. The rule was pre-registered
  on 2026-08-22 specifically so this step is arithmetic rather than judgement.
- If Part 8 reverts, `judgeContractHash` returns to its Part 2 value and the
  identity work still stands on its own — that is the point of the sequencing,
  and the revert is a result rather than a failure.
- The six unmeasured judged checks stay unmeasured. Spec `§ What this does not
  measure` records the trigger for revisiting; do not quietly widen the run
  here.

**Done when.** Both variance files exist, the rule is evaluated in writing, and
Part 8 is either kept or reverted on its terms.

---

## Part 10 — `judge_verdict` gets the tool-syntax detector

*Spec Part 5. Independent of every other part; droppable.*

7 of 1,341 rationales carry leaked tool-call markup. `findToolCallSyntax`
(`src/session/session.tool-syntax.ts:99`) scans against two token sets:
`TOOL_CALL_ELEMENTS` (`:50` — `invoke`, `parameter`, `function_calls`,
`function_results`) and `SUBMIT_GM_RESPONSE_KEYS` (`:62`, derived from
`submitGmResponseSchema.shape`). Pointed at a rationale unchanged, it catches
`</invoke>` and `<parameter name=` and **misses `</rationale>`**, which is a
`judge_verdict` property name.

**Work.**

1. Parameterise the property-name set on `findToolCallSyntax`, defaulting to
   `SUBMIT_GM_RESPONSE_KEYS` so the Warden path is untouched by construction.
2. `PROPERTY_NAME_TAGS` (`:76`) is a module-level compiled `RegExp`. Cache
   per key set rather than recompiling per call; `tagPattern` (`:70`) is the
   builder. The existing `lastIndex` reset (`:103-104`) already handles reuse.
3. Call it over the rationale at judge-artifact write time, recording a flag on
   `JudgeArtifactInput` (`eval/runs/artifacts.ts:122`) — which reaches both
   `eval:run` and `eval:rescore` through the shared shape.
4. **Detect and record; do not fail the check.** A rationale that leaks markup
   still reached a verdict consistent with itself. Turning it into an `error`
   row removes a usable grade to punish a cosmetic defect — the opposite of the
   `TOOL-SYNTAX-LEAK` case, where the leak destroyed the payload.

**Watch for.** One implementation stays one implementation
(`session.tool-syntax.ts:92-97` says why). This is a signature change, not a
second detector.

**Done when.** The Warden path behaves identically; the seven known rationales
are detected by a scan over the corpus; a fresh judged run flags a leaking
rationale and still scores it.

---

## Part 11 — `ADR-0102`, methodology, roadmap closeout

**Work.**

1. **`ADR-0102`**, per spec `§ Resolved before drafting`: the
   two-hashes-one-defect reasoning, the widen-versus-add choice, and why it is
   a new entry rather than an `ADR-0099` addendum. State that it extends
   `ADR-0099` rather than replacing it; `superseded_by` stays `null` on both.
2. **`docs/eval-methodology.md § Re-scoring frozen runs`** — document
   `judgeContractHash`'s tense alongside the existing
   `corpusVersion`/`harnessVersion` note at `:703-706`. Same column names,
   different moment, and now three of them.
3. **`docs/eval-methodology.md § Running a comparison`** — the mixed-rubric
   paragraph (`:734-742`) gains its contract-level sibling.
4. **`docs/eval-methodology.md § Before trusting any judged rate`** — record
   what Part 9 concluded. The standing contradiction floor on every pre-Part-8
   judged failure rate does not go away when this spec closes; it is a property
   of every number already recorded, and this section is where it outlives the
   roadmap bullets.
5. **Roadmap** — tick both M7.7 bullets, with the outcome rather than a
   checkmark. If Part 8 reverted, say so and say why; a reverted experiment that
   answered its question is a closed bullet, not an open one.

**Watch for.** The data corrections stay in `eval-methodology.md` and are not
re-scored. Spec `§ What the swap costs` gives the reasoning — after Part 8 a
re-score is graded under contract B and is no longer like-for-like with the
contract-A numbers it would be correcting.

---

## Acceptance criteria → parts

| Spec `§ Done when` | Part |
|---|---|
| `eval:run` refuses against a stale build, not suppressible | 1 |
| `eval:rescore` / `eval:judge-variance` refuse against a stale contract golden | 3 |
| One implementation of the golden comparison | 1 |
| `judgeContractHash` live, golden-backed, recorded four places with correct tense | 2, 4 |
| `eval:compare` warns on differing, reports absent as unknown | 5 |
| Two variance files, distinguishable by contract | 6, 7, 9 |
| Decision rule evaluated in writing; Part 3 shipped or reverted | 9 |
| `promptHash`, `assemblyHash`, `corpusVersion` unmoved | every commit |
| Both roadmap bullets ticked; corrections stay in the methodology doc | 11 |
| `ADR-0102` written | 11 |

## Out of scope, restated

Carried from spec `§ Non-goals` so a reviewer does not have to hold both
documents open: no `@uv/*` version fold into `assemblyHash`; no widening of
`rubricHash`; no re-scoring of the six contradicting artifacts or the two
corrupted comparison points; no standing contradiction detector; no structural-
checker identity (declined, `roadmap.md § M7.7`); nothing Warden-visible; no
re-baseline.
