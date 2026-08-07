# Spec — Multi-Run Eval Harness Infrastructure

Extends M7.4 (Warden Eval Harness). M7.4 ships fixtures, checks, and a single-pass runner
that emits a markdown report. This spec adds repetition, machine-readable scoring, and
paired comparison across prompt/model versions.

Methodology rationale for rep allocation lives in `docs/eval-methodology.md` and is not
restated here. This document specifies format and behavior.

---

## Motivation

Warden output is stochastic. A single pass over the corpus produces a set of pass/fail
verdicts that are not reproducible and are not the measurement of interest — the
measurement is a per-fixture *pass rate* over N reps. Comparing prompt versions therefore
requires running each fixture N times under each version and comparing paired rates.

The current script conflates two jobs: executing the corpus and rendering a human report.
This spec separates them. Execution produces machine-readable scores; rendering reads
those scores. Nothing downstream ever parses markdown.

---

## Part 1 — On-disk layout

Flat files are the source of truth. No database. Run artifacts follow existing report
conventions and belong in the private artifacts repo under `automata-codex`.

**Root path resolution.** The runner code lives with the M7.4 harness in `apps/zoltar-be`;
the artifacts live in a separate repo. `ZOLTAR_EVAL_ROOT` is an absolute path to the
parent of `eval-runs/`. Required by every command in this spec; fail fast with a clear
message if unset. No path is ever resolved relative to the backend working directory.

```
$ZOLTAR_EVAL_ROOT/
  eval-runs/
    <model>__<promptHash8>__<createdAt>/     # a "run directory"
      manifest.json
      prompt.txt                              # full Warden prompt, verbatim
      rubrics/
        <rubricHash8>.txt                     # judge rubric text, deduped by hash
      reps/
        001/
          scores.jsonl                        # this rep's rows, append-only
          <fixtureId>/
            warden-output.json                # full submit_gm_response payload
            warden-request.json               # assembled context sent to the Warden
            judge-<checkId>.json              # verdict + reasoning text
        002/
          ...
```

**Directory identity is `(model, promptHash)` and is immutable.** If either changes, it is
a new run directory. Every other environment fact — harness version, rubric hashes,
corpus version — is recorded per row, because reps may be appended to a directory weeks
apart under a changed harness.

`prompt.txt` lives at directory level precisely because the prompt hash is immutable
there. This preserves the existing convention that the durable artifact carries full
prompt text rather than depending on the DB.

---

## Part 2 — Manifest

`manifest.json`, written at directory creation and updated after each rep completes.

```typescript
{
  schemaVersion: 1,
  runId: string,              // directory name
  model: string,              // e.g. "claude-sonnet-5"
  promptHash: string,
  temperature: number,
  corpusVersion: string,      // content hash — see below
  createdAt: string,          // ISO8601

  plannedReps: number,        // pre-registered; written once, NEVER edited
  decisionRule?: string,      // free text, pre-registered, e.g. "ship if no fixture
                              // drops >0.2 and median rises"

  completedReps: Array<{
    index: number,
    harnessVersion: string,
    rubricHashes: Record<string, string>,   // checkId -> rubricHash
    fixtureIds: string[],                   // which fixtures this rep covered
    startedAt: string,
    completedAt: string
  }>
}
```

**`plannedReps` vs `completedReps` is deliberate and must not be collapsed.** Extending N
because observed variance was higher than expected is legitimate; doing it silently is
not. `completedReps.length > plannedReps` is a visible, intentional signal — the runner
warns on it but does not block.

**The manifest is the commit record.** A `completedReps` entry is appended only after that
rep's `scores.jsonl` is flushed and closed. A crashed rep therefore leaves a rep directory
the manifest does not vouch for. All aggregation filters to vouched `(repIndex,
fixtureId)` pairs; unvouched reps are ignored, not repaired.

Because scores are per-rep, an unvouched rep is also removable by deleting one directory,
and `reps/` on disk is an independent cross-check against the manifest — the one artifact
the vouching scheme otherwise depends on entirely.

`fixtureIds` per rep is what makes variable N fall out of the format for free — a rep may
cover a subset of the corpus, and per-fixture rep counts are derived by scanning vouched
entries.

**`corpusVersion` is a content hash**, not a hand-maintained string: SHA-256 over the
fixture file contents concatenated in `fixtureId` sort order, displayed truncated. A
hand-maintained version depends on remembering to bump it, and the failure mode — two runs
labeled identically against different fixtures — is silent and poisons a comparison. The
readability cost is real but is paid once per report header.

---

## Part 3 — Score rows

`reps/<index>/scores.jsonl`, append-only, one file per rep. Grain: **one row per
`(fixtureId, checkId, repIndex)`.**

Rows still carry `repIndex` despite being partitioned by it on disk. Path-derived identity
would force every reader to parse paths, and the redundancy costs nothing.

```typescript
{
  // --- run identity, denormalized onto every row ---
  runId: string,
  model: string,
  promptHash: string,
  temperature: number,
  corpusVersion: string,
  harnessVersion: string,

  // --- observation ---
  repIndex: number,
  fixtureId: string,
  checkId: string,
  tag: string,                    // failure-mode taxonomy tag, e.g. "FABRICATION"
  checkMode: 'structural' | 'judged',
  verdict: 'pass' | 'fail' | 'not_applicable' | 'error',

  rubricHash?: string,            // judged checks only
  judgeConfidence?: number,       // judged checks only, if the rubric emits one
  notApplicableReason?: string,   // required when verdict is 'not_applicable'
  errorMessage?: string,          // required when verdict is 'error'

  artifactPath: string,           // relative to run directory
  durationMs: number,
  recordedAt: string
}
```

Rows are self-identifying so that aggregation across directories is
concatenate-and-filter with no path parsing. This is redundant on disk and imports
cleanly into a table if a query layer is ever wanted.

**Judge reasoning text does not go in the row.** It is bulky and read only during
investigation. It lives in `judge-<checkId>.json` under the rep's artifact directory; the
row carries `artifactPath`.

### Verdict semantics

Four states, not two. The distinction matters for rate computation:

- **`pass` / `fail`** — the check ran and reached a verdict. These are the only verdicts
  in the rate denominator.
- **`not_applicable`** — the check could not run against this fixture. Primary cause: the
  check depends on schema fields captured after the fixture was frozen (see Part 6).
  Excluded from the denominator entirely.
- **`error`** — the Warden call failed, the judge call failed, or the check threw.
  Excluded from the denominator, but **counted and surfaced**. A transient API failure
  must never be indistinguishable from a regression.

---

## Part 4 — Runner (`eval:run`)

```
eval:run --prompt <path> --model <id> --reps <n> [--fixtures <ids>]
         [--run-dir <existing>] [--temperature <t>]
```

Behavior:

1. Resolve prompt hash from `--prompt`. If `--run-dir` is given, assert `(model,
   promptHash, temperature)` matches the manifest; abort on mismatch. Otherwise create a
   new directory and write `manifest.json` + `prompt.txt`.
2. Determine rep index range: `max(existing completedReps.index) + 1` onward.
3. For each rep, create `reps/<index>/` and open its `scores.jsonl`. For each fixture:
   execute the Warden turn against the frozen fixture input, persist request/response
   artifacts, run every check, append rows.
4. Flush and close the rep's `scores.jsonl`, then append the `completedReps` entry. In
   that order.
5. Write any rubric texts not already present under `rubrics/` keyed by hash.

Constraints:

- **The runner never calls `reconstructStateAsOfTurn`.** Fixture inputs are frozen at
  authoring time; this is an existing M7.4 invariant and is restated here because the
  runner is the code most tempted to violate it.
- **Default temperature matches production.** Lowering it shrinks variance but measures
  something that is not shipped. Buy statistical power with N instead. `--temperature` is
  available for deliberate experiments and is recorded per row.
- **Reps are independently parallelizable with no coordination.** Each rep owns its own
  `scores.jsonl` and its own artifact subtree, so there is no shared writer, no mutex, and
  no interleaved-line risk if reps ever run as separate processes. **There is no merge
  step** — aggregation globs. A merge would create a second write path, a window where
  scores live in two places with an ambiguous authority question, and work that has to
  re-run every time a rep is appended weeks later.
- **N is uniform by default.** A per-fixture override may be declared in fixture metadata
  (`repOverride: number`). Overrides are read at run start and are not adjustable during a
  run. The runner has no adaptive mode and must not acquire one.

---

## Part 5 — Aggregation and comparison

### `eval:report <run-dir>`

Globs `reps/*/scores.jsonl`, filters to manifest-vouched reps, renders markdown. Replaces
the current script's rendering half. Reports per-fixture pass rate, per-tag rollup, error
counts, and anything excluded as unvouched or not-applicable — exclusions are reported,
never silently dropped. Must never read the DB.

### `eval:compare <run-dir-a> <run-dir-b>`

Paired comparison. **Pairs on `(fixtureId, checkId)` — never compares aggregate rates
alone.** Each fixture is its own control; aggregate-only comparison mixes prompt effect
with fixture-difficulty variance, which matters given a corpus weighted toward
combat-forward turns.

Output per pair: rate A, rate B, delta, N on each side. Sorted by delta. Each side's
`decisionRule`, if recorded, is echoed in the header so the pre-registered rule sits next
to the numbers it governs; the tool does not evaluate it.

- **Regressions are surfaced first and weighted heavier than improvements.** A change that
  lifts the median while tanking two fixtures is usually a bad trade — those two are
  characterized failure modes.
- **Heterogeneous directories are detectable and usable.** If rows within a directory span
  multiple `rubricHash` or `harnessVersion` values, the comparison warns and offers
  `--filter-rubric` / `--filter-harness` to reduce to a consistent subset rather than
  discarding the directory.
- If a fixture is `not_applicable` on one side only, report it as such rather than
  computing a delta against a partial denominator.

### `eval:judge-variance <run-dir> [--trials <n>]`

> Shipped as `--trials`, not `--reps` as specced. The flag sets how many times each frozen
> input is re-graded; it does not select how many source reps are used, which the run fixes.
> Under the specced name it was read as `eval:run --reps` — the opposite axis — so a
> 10-rep run looked like it was ignoring the flag. See `docs/eval-methodology.md`.

Re-runs judged checks N times against **frozen Warden outputs already on disk** — no
Warden calls. Isolates grader variance from generator variance.

This should be run once per rubric before any prompt comparison is interpreted. If a
rubric swings against fixed input, the instability is in the rubric and nothing
downstream is meaningful until it is fixed. It is cheap; there is no reason to skip it.

---

## Part 6 — Fixture schema compatibility

Fixtures are frozen at capture time. Checks written later may depend on fields captured
later — the anticipated case is `rollType` / `gatedByRollId` / `actingEntityId` on
`roll_dice`.

- Fixtures carry `fixtureSchemaVersion`.
- Checks declare `requiresFixtureSchema: number` (or a required-field list).
- When a fixture does not satisfy a check's requirement, the runner emits
  `not_applicable` with `notApplicableReason`, **not `fail`**.

Without this, a schema addition produces a wall of false regressions across the existing
corpus and the harness gets distrusted at exactly the moment it is most needed.

---

## Part 7 — Out of scope

- Any database. Revisit only when hand-rolled aggregation scripts start duplicating each
  other across many prompt versions. At that point the DB is a **derived index over the
  score files, rebuildable by re-import** — not a store.
- Adaptive rep allocation.
- CI integration.
- A corpus-labeling tool for verified negatives. Related and wanted, but a separate
  concern from run execution.

---

## Resolved decisions

These were open during drafting and are settled. Recorded here so the reasoning survives
the spec, which is an ephemeral task artifact.

1. **Path resolution** — `ZOLTAR_EVAL_ROOT` env var, absolute path to the parent of
   `eval-runs/`. Keeps runner code in `apps/zoltar-be` while artifacts live in the private
   repo, with no relative-path coupling between them.
2. **`corpusVersion`** — content hash over fixture files, not a hand-maintained string.
   Trades report readability for the elimination of a silent failure mode.
3. **Rep parallelism** — per-rep `scores.jsonl`, no merge step, aggregation globs. Chosen
   for crash isolation (a bad rep is one directory to delete) and process-parallel write
   safety. Ordering across reps is not preserved and does not need to be, since rows are
   self-identifying.
4. **`decisionRule` enforcement** — none. It is recorded free text that `eval:compare`
   echoes into its output so the pre-registered rule sits next to the results it is meant
   to govern. Structured enforcement is premature; the value is in having written the rule
   down before seeing the numbers, not in the tool checking it.
