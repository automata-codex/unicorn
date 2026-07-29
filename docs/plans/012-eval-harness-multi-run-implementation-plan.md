# Multi-Run Eval Harness — Implementation Plan

Multipart implementation plan for `docs/specs/zoltar/012-eval-harness-multi-run.md`.
Each part is sized for a manual code review and a single commit. Pause after each part
for review before starting the next.

**Dependency order.** The on-disk format (Part 1) is the contract every command reads or
writes, so it goes first, and it is pure `fs` + Zod — no DB, no network, easiest thing in
this milestone to review in isolation. Fixture-format additions and corpus hashing
(Part 2) and the unified check registry (Part 3) both depend only on Part 1's row type.
Part 4 gives the harness model/temperature control and turns a completed turn into
durable artifacts. `eval:run` (Part 5) is the integration point for 1–4. `eval:report`
(6), `eval:compare` (7), and `eval:judge-variance` (8) all read what Part 5 writes and are
independent of each other — they could be reordered or parallelized, but 6 before 7 is
natural since 7 reuses 6's rate math. Part 9 retires the M7.4 single-pass path now that
its replacement exists. Part 10 is an ops/data pass with no new code.

**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.**

---

## Pre-flight: what the existing code already gives us, and what it doesn't

Resolved up front by reading the M7.4 harness and the session pipeline, so each part can
execute rather than re-derive.

### Already there, reuse as-is

- **`hashPromptText` already returns exactly 8 hex chars.**
  `src/wardens/prompt-paths.ts` does `sha256(text).slice(0, 8)`. That is the spec's
  `promptHash8` with no new hashing code, and it is the same hash M7.1 telemetry already
  records per turn (`AdventureTelemetryPayload.wardenPrompt.hash`) — so a run directory
  name is directly greppable against playtest telemetry.
- **`AnthropicService.callSession` already accepts a per-call `model`.**
  `SessionService` never passes one, so it falls through to `DEFAULT_SYNTHESIS_MODEL`
  (`claude-sonnet-4-6`). `--model` needs no production change — only a wrapper that
  supplies it (Part 4).
- **`createHarnessSession()` bootstraps the real `AppModule`** via `@nestjs/testing`, and
  `TestingModule` supports `.overrideProvider()`. That is the seam for injecting a
  recording/model-forcing `AnthropicService` without touching `SessionService`.
- **Env vars already load from a file, not the shell.** Every `eval:*` / `playtest:*`
  task in `Taskfile.yml` runs with `dir: apps/zoltar-be` and `--env-file=.env`, and
  `apps/zoltar-be/.env` is a symlink to the repo-root `.env` (gitignored, created during
  onboarding). `ZOLTAR_EVAL_ROOT` therefore goes in that one file and needs no shell
  export anywhere. Two details this milestone should fix rather than inherit: the existing
  `package.json` scripts omit `--env-file` (only the Taskfile wrappers have it), so
  `npm run eval:harness` fails where `task eval:harness` works — every new script in this
  milestone puts `--env-file=.env` in **both** entry points; and Node's `--env-file` does
  not override a variable already present in the environment, so a stale exported
  `ZOLTAR_EVAL_ROOT` silently wins over the file. `resolveEvalRoot`'s error message names
  the file as the place to set it, and the value it resolved is echoed in every command's
  first line of output so a shell override is visible rather than mysterious.
- **Fixture loading, seeding, turn execution, teardown, structural checkers, judge
  rubrics, and `eval:replay` all survive unchanged.** This milestone replaces the *run
  orchestration and reporting* around them, not the execution core. `seedScratchAdventure`
  / `runFixtureTurn` / `teardownScratchAdventure` are called by the new runner exactly as
  `runHarness` calls them today.
- **The `reconstructStateAsOfTurn` invariant is already honored.** `runFixtureTurn` reads
  only `fixture.seededState`; nothing in `eval/` imports `src/replay/`. Part 5 adds a
  guard test so the spec's restated constraint is mechanically enforced rather than
  merely documented.

### Gaps the spec assumes are closed but aren't

- **There is no `temperature` anywhere in the codebase.** Neither `CallSessionParams` nor
  `CallMessagesParams` has the field, so nothing is sent and the API default (1.0) applies.
  The spec requires temperature in the manifest, on every score row, and as a `--temperature`
  flag. Part 4 adds `temperature?: number` to both param types and passes it through in
  `AnthropicService` — four lines, the only production change in this milestone. The
  runner's default is `1.0` (recorded explicitly), which is behaviorally identical to what
  production sends today; "default temperature matches production" is satisfied by
  recording the effective value, not by omitting the field.
- **Telemetry does not contain the assembled Warden request.**
  `AdventureTelemetryPayload.originalRequest` stores only `{model, systemBlocks: number,
  messageCount: number, promptTokens, completionTokens}` — counts, not content. The spec's
  `warden-request.json` therefore cannot be derived from the telemetry row. Part 4's
  recording wrapper captures the real `CallSessionParams` at the SDK boundary instead.
  Note that one fixture turn makes **several** `callSession` calls (each inner-tool-loop
  iteration, plus a correction round if one fires), so `warden-request.json` holds an
  ordered array of requests, not one object.
- **`warden-output.json` must carry more than `submit_gm_response`.** The spec describes
  it as "full `submit_gm_response` payload," but `eval:judge-variance` (Part 8) re-runs
  judged checks against frozen Warden output with no Warden call *and no database* — the
  scratch campaign is torn down at the end of each fixture. `runJudgeCall` needs
  `gameEvents` (it summarizes the whole tool-call sequence, not just the narration), and
  structural checkers need `telemetry`/`pendingCanon`/`diceRequests`/`campaignState`.
  **Decision: `warden-output.json` is the serialized `TurnExecutionResult`** — a strict
  superset containing the `submit_gm_response` payload inside its `gm_response` game
  event. Anything less makes Part 8 impossible without either re-seeding or keeping every
  scratch campaign forever.
- **Fixtures have no `fixtureSchemaVersion` and no `repOverride`.** Both are added in
  Part 2. The existing 15 fixture files must keep parsing untouched — `fixtureSchemaVersion`
  gets a Zod `.default(1)`, same pattern `pendingDiceRequests` already uses for exactly
  this reason.
- **There is no `checkId` concept.** A fixture today carries one `assertion`, dispatched
  by `tag` through either `structuralCheckers` or `judgeRubrics`. Part 3 introduces a
  single registry that gives each check a stable id and a declared fixture-schema
  requirement.
- **The current error path maps a failed turn to `FAILED`.** `runHarness` catches a
  thrown turn and records it as a failed `FixtureResult` (with a long comment explaining
  why aborting was worse). Under the new format that is exactly the conflation the spec's
  fourth verdict exists to prevent: a transient API failure must not be indistinguishable
  from a regression. The new runner emits `error` rows instead. This is a deliberate
  behavior change, not a regression from M7.4.

### Decisions this plan takes that the spec leaves implicit

Flagged here rather than buried in a part, because each is a place where a reviewer might
reasonably want something else.

1. **`checkId` does not encode `checkMode`.** `checkId` is the failure-mode tag in
   lower-kebab (`out-of-order-resolution`, `hidden-info-leak`); `checkMode` is its own
   column, exactly as the spec's row type has it. This matters because a check has
   already migrated modes once in this repo — `UNSURFACED-CHECK` moved structural →
   judged after a real-run false pass — and `eval:compare` pairs on `(fixtureId,
   checkId)`. If the id encoded the mode, that migration would silently un-pair every
   historical comparison for that check.
2. **One check per fixture, for now.** The spec's Part 4 says "run every check" and its
   row grain allows N checks per fixture. Today the corpus supplies exactly one, because
   a judged check needs per-fixture `assertion.facts` (`perceptionBoundary`,
   `expectedScope`, …) that only exist for the fixture's own tag — running
   `HIDDEN-INFO-LEAK` against a fixture authored for `SCENE-JUMP` has no boundary text to
   grade against, and would cost an API call per fixture-check pair to produce it.
   `selectChecksForFixture()` returns an array from day one so the row format and every
   reader are already N-ready; the corpus is what's 1:1, not the format. Confirmed
   2026-07-26.
3. **`harnessVersion` is the git short SHA, not a hand-maintained constant** — with a
   `-dirty` suffix when the working tree has uncommitted changes under `apps/zoltar-be/`,
   and `unknown` outside a git checkout. This is the same argument the spec makes for
   `corpusVersion` being a content hash: a hand-bumped string fails silently when someone
   forgets, and the failure mode (two reps labeled identically under different checker
   semantics) poisons exactly the weeks-apart append the field exists to disambiguate.
4. **`corpusVersion` hashes the whole fixture directory, never the `--fixtures` subset.**
   It identifies the corpus, not the selection. A subset run records which fixtures it
   covered in `completedReps[].fixtureIds`, which is the spec's own mechanism for that.
5. **`--model` is required, with no default.** Directory identity is `(model,
   promptHash)`. Defaulting it to `DEFAULT_SYNTHESIS_MODEL` invites a run whose directory
   name says one thing while the reader assumes another the day that constant changes.
6. **`--prompt <path>` must resolve to a file already in `src/wardens/prompts/`.**
   `WardenPromptsService` loads that directory once at `onModuleInit` and selects via
   `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP=<filename>`; there is no supported path by which an
   arbitrary file becomes the live Warden prompt. The runner accepts a path (per the
   spec's signature), reads it for `prompt.txt` + hash, and asserts basename-exists and
   content-matches against `promptsDir()`, failing with a message that says to put the
   variant there. No new production hook, and `prompt.txt` still carries verbatim text.
7. **`eval:judge-variance` writes its output beside the run, not into `reps/`.**
   `reps/*/scores.jsonl` rows mean "one observation of generator + grader together." A
   grader-only re-run is a different measurement and would corrupt every pass-rate
   denominator if appended there. It writes `judge-variance/<timestamp>.jsonl` in the run
   directory and prints a summary. This is an extension beyond the spec, which doesn't say
   where the output goes.
8. **`eval:harness` (M7.4's single-pass runner) is retired in Part 9**, not kept
   alongside. The spec's premise is that execution and rendering are separated and nothing
   downstream parses markdown; leaving the old command in place keeps a second write path
   that produces no score rows, which is the thing this milestone exists to eliminate.
   `eval:replay` survives and gets an artifact-based mode, which covers the
   quick-iteration use `eval:harness` was serving. Confirmed 2026-07-26.
9. **Judge verdicts stay binary — no confidence scoring, and no `judgeConfidence` column.**
   The spec's row type lists `judgeConfidence?: number` conditionally ("if the rubric
   emits one"); no rubric emits one, because self-reported LLM confidence was rejected
   earlier in this project's design. That decision was never written down — the only trace
   is `judgeVerdictSchema` being `{passed, rationale}` — so Part 9 records it in
   `decisions.md`. The field is omitted from `scoreRowSchema` entirely rather than kept as
   an optional that nothing populates: a permanently-empty column reads as an invitation
   to fill it. JSONL rows are append-friendly, so if a rubric ever does emit one, adding
   an optional field later is non-breaking and old rows simply lack it. Confirmed
   2026-07-26.

---

## Part 1 — On-disk format: paths, manifest, score rows

Foundational. Pure `node:fs` + Zod: no DB, no network, no Nest. Everything here is unit
testable against a temp directory.

**`apps/zoltar-be/eval/runs/paths.ts`:**

- `resolveEvalRoot(): string` — reads `ZOLTAR_EVAL_ROOT`, asserts it is set, absolute, and
  an existing directory; throws a message naming the variable and what it should point at
  (the parent of `eval-runs/`, in the private `automata-codex` artifacts repo). Deliberately
  **not** added to `src/config/env.schema.ts` — that schema validates the *server's*
  environment and every entry in it is required at app boot; a CLI-only variable belongs
  at the CLI boundary.
- `runDirName(model, promptHash, createdAt)` → `<model>__<promptHash8>__<createdAt>` with
  `createdAt` in a filename-safe ISO form (`2026-07-26T14-32-10Z` — colons are legal on
  APFS/ext4 but not on Windows and are miserable to quote in a shell).
- `runDirPath`, `manifestPath`, `promptTextPath`, `rubricPath(hash)`, `repDir(index)`
  (zero-padded to 3: `reps/001`), `scoresPath(index)`, `fixtureArtifactDir(index,
  fixtureId)`, `judgeArtifactPath(index, fixtureId, checkId)`. Every path in this milestone
  is built here; no other module concatenates path segments.
- `listRepDirsOnDisk(runDir): number[]` — the independent cross-check the spec calls for,
  so `eval:report` can name reps that exist on disk but aren't vouched.

**`apps/zoltar-be/eval/runs/manifest.ts`:**

- `manifestSchema` — Zod, mirroring the spec's Part 2 type exactly, `schemaVersion: z.literal(1)`.
- `createRunDirectory({root, model, promptHash, promptText, temperature, corpusVersion,
  plannedReps, decisionRule})` — creates the directory, writes `manifest.json` and
  `prompt.txt`, returns the resolved path. Refuses to clobber an existing directory.
- `readManifest(runDir)`, `assertManifestMatches(manifest, {model, promptHash,
  temperature})` — the `--run-dir` guard from spec Part 4 step 1, with a message that
  prints both sides of each mismatch.
- `appendCompletedRep(runDir, entry)` — read-modify-write of `manifest.json`. Writes to a
  temp file and `rename`s over the target, so a crash mid-write can't leave a truncated
  manifest and destroy the vouching record for every prior rep. Returns a warning string
  when `completedReps.length > plannedReps` (visible, non-blocking, per spec).
- `nextRepIndex(manifest)` — `max(completedReps.index) + 1`, `1` when empty. Note in a
  comment that this deliberately reads the manifest, not the disk: a crashed unvouched rep
  directory gets *reused* by the next run rather than orphaning an index, which is the
  point of "unvouched reps are ignored, not repaired."

**`apps/zoltar-be/eval/runs/scores.ts`:**

- `scoreRowSchema` — Zod, the spec's Part 3 type with `superRefine` enforcing the two
  conditional requirements: `notApplicableReason` required iff verdict is
  `not_applicable`, `errorMessage` required iff verdict is `error`. `judgeConfidence` is
  the one field from the spec's type deliberately **not** carried — see pre-flight
  decision 9; the doc comment says so, so its absence reads as a decision rather than an
  oversight when someone diffs this against the spec.
- `ScoreWriter` — `open(path)` / `append(row)` (validates, then writes one line) /
  `close()`. Backed by an `fs.createWriteStream` in append mode, with `close()` awaiting
  the stream's `finish` event so "flush and close, *then* vouch" is a real ordering
  guarantee rather than a hopeful one. This ordering is the whole commit protocol; a
  comment should say so.
- `readScoreRows(path)` — parses each line, throws a `ScoreRowError` naming file and line
  number on a malformed row.
- `readVouchedRows(runDir)` — the spec's aggregation primitive: read the manifest, glob
  `reps/*/scores.jsonl`, keep only rows whose `(repIndex, fixtureId)` appears in a
  `completedReps` entry, return `{rows, exclusions}` where `exclusions` names every
  unvouched rep directory and every row dropped. Lives here rather than in the report
  module because Parts 6, 7, and 8 all need it and none of them should reimplement the
  vouching rule.

**Tests (`eval/runs/paths.spec.ts`, `manifest.spec.ts`, `scores.spec.ts`):**

- `resolveEvalRoot` throws when unset, when relative, when nonexistent; succeeds on a temp
  dir. Path builders produce the spec's exact layout for a known input.
- Manifest create/read round-trip; `assertManifestMatches` rejects a changed model, prompt
  hash, and temperature independently; `appendCompletedRep` is atomic (write a manifest,
  append twice, confirm both entries and valid JSON throughout); the over-plannedReps
  warning fires and does not throw; `nextRepIndex` on empty, contiguous, and gapped
  `completedReps`.
- Score rows: valid pass/fail rows; `not_applicable` without a reason rejected; `error`
  without a message rejected; writer/reader round-trip; `readScoreRows` on a truncated
  final line reports the line number.
- `readVouchedRows`: a run directory with three rep dirs where only two are vouched
  returns only vouched rows and names the third in `exclusions`; a rep vouched for a
  fixture subset drops the extra fixture's rows and says so.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Commit.

---

## Part 2 — Fixture format additions and corpus identity

Small, self-contained, and touches the 15 committed fixture files' contract — worth its
own review rather than being buried in Part 3.

**`apps/zoltar-be/eval/fixture.schema.ts`:**

- `FIXTURE_SCHEMA_VERSION = 1` exported constant; `fixtureSchemaVersion:
  z.number().int().positive().default(1)` on `evalFixtureSchema`. Existing fixture files
  parse unchanged. Doc comment explains the contract: the version describes *what was
  captured*, so it is bumped when `capture-fixture` starts recording a field it didn't
  before (the anticipated case per spec Part 6 is `rollType` / `gatedByRollId` /
  `actingEntityId` on `roll_dice`), never when a checker changes.
- `repOverride: z.number().int().positive().optional()` — the spec's per-fixture N
  override, read at run start only. Doc comment points at `docs/eval-methodology.md`'s
  adaptive-N hazard and states plainly that nothing may write this field at runtime.

**`apps/zoltar-be/scripts/capture-fixture.core.ts`:** emit `fixtureSchemaVersion:
FIXTURE_SCHEMA_VERSION` in the assembled fixture.

**`apps/zoltar-be/eval/corpus-version.ts`:**

- `computeCorpusVersion(fixturesDir): Promise<string>` — SHA-256 over every fixture file's
  **raw bytes**, concatenated in `fixtureId` sort order, full hex. Raw bytes, not
  re-serialized parsed JSON, so a whitespace-only edit still changes the version (the
  point is detecting "different fixtures," and a normalizing hash quietly decides some
  differences don't count). Ordering is by the fixture's `id` field per spec, with
  filename as tie-break; a file that fails to parse is a hard error here rather than a
  skip, because a corpus hash that silently omits a broken file is worse than no hash.
- `shortCorpusVersion(hash)` → first 12 chars, for report headers. The full hash goes on
  every row.

**Tests (`eval/corpus-version.spec.ts`, additions to `eval/fixture.schema.spec.ts`):**

- Schema: a fixture file without `fixtureSchemaVersion` parses to `1`; an explicit `2`
  survives; `0`/`-1`/`1.5` rejected; `repOverride` optional and positive-int-only.
- Corpus hash: stable across two calls; unchanged when files are renamed but ids and
  contents are the same *and* sort order is unaffected; changed by a one-byte content
  edit; changed by adding a fixture; changed by removing one. A directory whose files
  are read in a different `readdir` order produces the same hash.
- Run the existing suite to confirm all 15 committed fixtures still load.

**Review gate.** `tsc --noEmit` clean. `npm test` green, including the existing
fixture-loader tests untouched. Commit.

---

## Part 3 — Unified check registry and four-verdict evaluation

Replaces the ad-hoc `structuralCheckers` / `runJudgeCall` split at the dispatch layer with
one registry that knows every check's id, mode, tag, and fixture-schema requirement — and
produces the spec's four verdicts instead of three outcomes. The checkers and rubrics
themselves are untouched.

**`apps/zoltar-be/eval/checks/registry.ts`:**

```typescript
interface EvalCheck {
  id: string;                       // 'out-of-order-resolution' — stable across a mode migration
  tag: FailureModeTag;
  mode: 'structural' | 'judged';
  requiresFixtureSchema?: number;   // minimum fixtureSchemaVersion
  requiredFixtureFields?: string[]; // dotted paths, checked against the fixture
  rubricHash?: () => string;        // judged only
}
```

- `evalChecks: Record<string, EvalCheck>` — one entry per tag, built from
  `structuralFailureModeTags` + `judgedFailureModeTags` so the two lists stay the single
  source of truth for mode. No check declares `requiresFixtureSchema` today (all nine work
  against v1 fixtures); the field exists so the first `roll_dice`-schema-dependent check
  lands without a wall of false regressions across the existing corpus, per spec Part 6.
  Add one deliberately-unsatisfiable check id in the *test* fixtures, not the real
  registry, to exercise the gate.
- `selectChecksForFixture(fixture): EvalCheck[]` — today, the one check whose `tag` matches
  the fixture's. Doc comment records decision 2 from pre-flight.
- `rubricHashFor(checkId)` — SHA-256 of the rubric **template** text, 8 chars, matching
  `hashPromptText`'s convention. The template, not the fact-interpolated text: the spec
  keys `rubrics/<rubricHash8>.txt` and `manifest.completedReps[].rubricHashes` by
  `checkId`, so one hash per rubric, deduped across fixtures. `rubricTextFor(checkId)`
  returns the template for writing that file.

**`apps/zoltar-be/eval/checks/run-check.ts`:**

- `runCheck(check, fixture, turnResult, anthropic): Promise<CheckObservation>` where
  `CheckObservation = {verdict: 'pass'|'fail'|'not_applicable'|'error', detail: string,
  rubricHash?, notApplicableReason?, errorMessage?, durationMs}`.
- Order of operations: fixture-schema gate first (→ `not_applicable` with a reason naming
  the required version and the fixture's), then dispatch by mode. Structural
  `PASSED`/`FAILED`/`NOT_APPLICABLE` map to `pass`/`fail`/`not_applicable` (the structural
  `NOT_APPLICABLE` reason — "no dice_roll this turn" and friends — becomes
  `notApplicableReason`; `StructuralVerdict.actual` already carries that text). A judged
  verdict maps to `pass`/`fail`.
- **Anything thrown becomes `error`, never `fail`** — a `JudgeOutputError`, an API
  failure, a checker rejecting a malformed fixture. `errorMessage` carries the message;
  `detail` carries a short marker. This is the M7.4 behavior change called out in
  pre-flight; the doc comment should reference the old `runHarness` comment it supersedes
  and say why the trade-off flipped (there, a hard abort lost the whole run; here, an
  `error` row is recorded and the run continues, so nothing is lost by refusing to call it
  a failure).
- **`eval/checks/judged/judge.ts` is not touched.** `judgeVerdictSchema` stays
  `{passed, rationale}` — binary, no confidence field, per pre-flight decision 9. This
  also means every rubric template stays byte-identical and therefore every `rubricHash`
  computed here is comparable against any future run.

**Tests (`eval/checks/registry.spec.ts`, `eval/checks/run-check.spec.ts`):**

- Registry: every tag in `failureModeTagSchema` has exactly one check; ids are unique,
  lower-kebab, and match their tag; `mode` agrees with `structuralFailureModeTags` /
  `judgedFailureModeTags`; `rubricHashFor` is stable across calls and differs between
  rubrics; every judged check has a rubric registered.
- `runCheck`: structural pass/fail/n-a mapping (hand-built `TurnExecutionResult`, no DB);
  a check with `requiresFixtureSchema: 2` against a v1 fixture yields `not_applicable`
  with a reason and **never invokes the checker** (spy asserts zero calls — the whole
  point is not paying for a judge call on an inapplicable fixture); a checker that throws
  yields `error` with the message; a judge call that throws `JudgeOutputError` yields
  `error`, not `fail`; a mocked judge returning `{passed: false}` yields `fail`.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Commit.

---

## Part 4 — Model/temperature control and durable turn artifacts

Everything needed to run a turn *under a named model and temperature* and write it to
disk in a form later commands can re-read without a database.

**`apps/zoltar-be/src/anthropic/anthropic.service.ts`** — the only production change in
this milestone:

- `temperature?: number` on `CallMessagesParams` and `CallSessionParams`; passed through
  to `client.messages.create` in both methods. Omitted when undefined, so existing
  behavior is byte-identical for every current caller.

**`apps/zoltar-be/eval/runs/recording-anthropic.ts`:**

- `RecordingAnthropicService` — wraps a real `AnthropicService`.
  - `callSession(params)`: forces `model` and `temperature` from the harness config,
    records `{request: params, response: message}` into the current capture buffer, and
    forwards. Every inner-tool-loop iteration and the correction round land in that
    buffer in call order.
  - `callMessages(params)`: **passes through untouched.** The judge goes through this
    method, is pinned to `JUDGE_MODEL` (`claude-sonnet-5`) by design per the M7.4 spec's
    deliberate generator/grader model asymmetry, and must not inherit the Warden's
    `--model` or `--temperature`. Forgetting this would make `--temperature 0` silently
    change the grader too, which is precisely the confound `eval:judge-variance` exists to
    measure. Worth a comment and a dedicated test.
  - `beginFixture()` / `takeCaptured()` — capture buffer lifecycle, driven per fixture by
    the runner.
- `createHarnessSession({model, temperature})` in `eval/harness-runner.ts` gains optional
  options; when given, it `.overrideProvider(AnthropicService)` with the recorder before
  `.compile()`. Called with no options it behaves exactly as today, so `eval-replay.ts`
  and the existing integration tests are unaffected.

**`apps/zoltar-be/eval/runs/artifacts.ts`:**

- `serializeTurnResult(result)` / `deserializeTurnResult(json)` — `TurnExecutionResult`
  contains Drizzle rows with real `Date` objects (`createdAt` and friends); JSON
  round-trips them to strings. Serialization is `JSON.stringify` as-is; deserialization
  revives the known date-bearing fields so a rehydrated result is structurally what a
  checker expects. Round-trip test asserts checker-visible equality, not deep equality —
  the honest bar, and the doc comment should say which fields are revived and that a new
  date column added to any of these tables needs adding here.
- `writeFixtureArtifacts(runDir, repIndex, fixtureId, {wardenRequests, turnResult})` —
  writes `warden-request.json` (the ordered array of captured `CallSessionParams`, each
  with its raw response) and `warden-output.json` (the serialized `TurnExecutionResult`;
  see pre-flight for why this is a superset of the spec's wording).
- `writeJudgeArtifact(runDir, repIndex, fixtureId, checkId, {verdict, rationale,
  rubricHash})` → `judge-<checkId>.json`.
- `readTurnResultArtifact(runDir, repIndex, fixtureId)` — the inverse Part 8 needs.
- `relativeArtifactPath(...)` — the `artifactPath` value that goes on a score row, always
  relative to the run directory per spec.

**Tests (`src/anthropic/anthropic.service.spec.ts` additions,
`eval/runs/recording-anthropic.spec.ts`, `eval/runs/artifacts.spec.ts`):**

- `AnthropicService`: with the SDK client mocked, `temperature` is forwarded when given
  and the key is absent from the request object when not.
- Recorder (fake inner service, no network): `callSession` gets the forced model and
  temperature even when the caller supplied neither; a caller-supplied model on
  `callSession` is overridden (the harness's `--model` wins — it's what the directory name
  claims); `callMessages` is forwarded byte-identically with no model or temperature
  injected; multiple `callSession` calls within one `beginFixture()` accumulate in order;
  `takeCaptured()` clears the buffer.
- Artifacts: `TurnExecutionResult` round-trip through disk preserves every field a checker
  reads (assert by running a real structural checker against both the original and the
  rehydrated result and comparing verdicts — the actual property that matters); artifact
  paths match Part 1's layout; `relativeArtifactPath` never returns an absolute path.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Confirm `npm run
test:integration` still passes for the existing `harness-runner.spec-int.ts` (the
`createHarnessSession` signature changed). Commit.

---

## Part 5 — `eval:run`

The integration point. Everything above is exercised here for the first time.

**`apps/zoltar-be/scripts/eval-run.core.ts`:**

- `runEval(args, deps)` where `deps` injects the turn executor (`{seed, runTurn,
  teardown}`), the clock, and the harness-session factory. **This injection is the
  reviewability point of this part**: it makes the rep/manifest/commit-protocol
  orchestration — the genuinely subtle code — unit-testable with a stub executor, no DB
  and no API key, while the real wiring stays a thin default.
- Flow, per spec Part 4:
  1. Resolve `ZOLTAR_EVAL_ROOT`. Read `--prompt`, hash it, assert it matches a file in
     `promptsDir()` (pre-flight decision 6), set `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP` to
     its basename **before** any harness session is created — `WardenPromptsService`
     resolves selection once in `onModuleInit`.
  2. `--run-dir` given → `readManifest` + `assertManifestMatches`; otherwise
     `computeCorpusVersion` and `createRunDirectory`.
  3. Rep index range from `nextRepIndex`; run `--reps` of them. Per-fixture N: uniform
     `--reps`, except a fixture with `repOverride` runs in only the first `min(reps,
     repOverride)` of them. Overrides are resolved once, before rep 1, into a plain
     `Map<fixtureId, number>` that the loop reads and nothing writes — the "no adaptive
     mode" constraint made structural rather than promised.
  4. Per rep: create `reps/<index>/`, open the `ScoreWriter`, and for each fixture — seed,
     `beginFixture()`, run the turn, write artifacts, run every selected check, append a
     row per check, teardown (unless `--keep-scratch`). A thrown turn produces one `error`
     row per selected check and moves to the next fixture.
  5. `close()` the writer, **then** `appendCompletedRep` with `fixtureIds` set to the
     fixtures actually attempted, `harnessVersion`, and `rubricHashes` for the judged
     checks used. In that order, and with a comment saying a crash between them is the
     designed-for case, not a bug.
  6. Write any `rubrics/<hash>.txt` not already present.
- `harnessVersion` helper: `git rev-parse --short HEAD` plus a `-dirty` suffix from `git
  status --porcelain apps/zoltar-be`, `unknown` on failure. Executed once per invocation,
  not per rep.
- Returns a summary (`runDir`, reps run, row counts by verdict, warnings) for the CLI to
  print. **No markdown.** Rendering is Part 6's job and this must not grow a report.

**`apps/zoltar-be/scripts/eval-run.ts`:** `parseArgs` for `--prompt` (required), `--model`
(required), `--reps` (required, positive int), `--fixtures` (comma-separated fixture
**ids**, not a directory — matching the spec's signature; the directory defaults to
`apps/zoltar-be/eval/fixtures/` resolved from the package root the way `eval-replay.ts`
already does, overridable with `--fixtures-dir`), `--run-dir`, `--temperature` (default
`1.0`), `--decision-rule`, `--keep-scratch`. Same `UsageError` / `main().then(...)`
shape as every other script here. Deliberately no `--tag` filter — `--fixtures <ids>`
covers the supervised-iteration workflow and a second overlapping selector is a way to
run something other than what you think you ran.

The file header carries the same prominent warning `eval-harness.ts` does — real DB, real
token-costing calls, and now **N times** the cost — plus the `node -r @swc-node/register`
requirement (this script bootstraps Nest DI; `tsx` doesn't emit `design:paramtypes` and
every injection silently becomes `undefined`).

**Wiring:** `package.json` → `"eval:run": "node -r @swc-node/register -r reflect-metadata
--env-file=.env scripts/eval-run.ts"`. `Taskfile.yml` → an `eval:run` task matching the
existing `eval:harness` shape (`dir: apps/zoltar-be`, same `@swc-node/register` comment,
`--env-file=.env`), with `ZOLTAR_EVAL_ROOT` named in its `desc`. Per the pre-flight env
note, `--env-file` goes in **both** entry points so `npm run` and `task` behave
identically — the same applies to every script added in Parts 6–8.

**Tests (`scripts/eval-run.spec.ts` unit, `scripts/eval-run.spec-int.ts` integration):**

- Unit, stub executor, temp `ZOLTAR_EVAL_ROOT`: a 3-rep run produces 3 rep directories,
  3 vouched `completedReps`, and `reps × fixtures × checks` rows. Appending 2 more reps to
  the same `--run-dir` continues at index 4 and leaves `plannedReps` untouched. A
  mismatched model/prompt/temperature against `--run-dir` aborts before writing anything.
  A stub turn that throws yields `error` rows (not `fail`) and does not abort the rep. A
  stub that throws *after* some rows are written still vouches the rep for the fixtures it
  covered. Simulating a crash between `close()` and `appendCompletedRep` (call the parts
  directly) leaves a rep directory that `readVouchedRows` ignores and reports.
  `repOverride: 1` on one fixture with `--reps 3` gives that fixture 1 row-set and the
  others 3. Over-running `plannedReps` warns and completes.
- A guard test asserting nothing under `eval/` or `scripts/eval-*` imports
  `src/replay/reconstruct-state` — the spec's restated invariant, made mechanical.
- Integration (`RUN_LIVE_EVAL_TESTS`-gated, same convention as M7.4): one fixture, two
  reps, real DB and real model. Assert the artifact tree exists and is well-formed, rows
  validate, the manifest vouches both reps, and no `__eval__` campaigns survive.

**Review gate.** `tsc --noEmit` clean. Unit tests green. One real run by hand:
`task eval:run -- --prompt src/wardens/prompts/mothership-m7.txt --model claude-sonnet-4-6
--reps 2 --fixtures turn19-out-of-order-resolution,turn24-scene-jump`. Inspect the run
directory by eye — `manifest.json`, both `scores.jsonl`, one `warden-request.json`, one
`warden-output.json`, one `judge-*.json`. Confirm `psql` shows no leftover `__eval__`
campaigns. Commit.

---

## Part 6 — `eval:report`

Pure rendering over Part 1's `readVouchedRows`. No DB, no network, no Anthropic.

**`apps/zoltar-be/eval/runs/rates.ts`:**

- `computeRates(rows)` → per `(fixtureId, checkId)`: `{pass, fail, notApplicable, error,
  n, rate}` where `n = pass + fail` and `rate = pass / n` (`null` when `n === 0` — an
  undefined rate is a real state and must not render as `0.00`).
- `rollupByTag(rates)` — per-tag aggregate, plus the count of fixtures in that tag with no
  usable denominator.
- `summarizeExclusions(rows, exclusions, repDirsOnDisk)` — unvouched reps, not-applicable
  rows grouped by reason, error rows grouped by message. Everything excluded is named.

**`apps/zoltar-be/eval/runs/report-multi.ts`:**

- `renderRunReport(manifest, rates, exclusions)` → markdown: a header carrying runId,
  model, prompt hash, temperature, short corpus version, planned vs. completed reps, and
  the `decisionRule` verbatim if recorded; a per-fixture-per-check rate table with N; the
  per-tag rollup; an errors section; an exclusions section. Sorted deterministically
  (fixtureId, then checkId) so two reports diff cleanly.
- Renders valid markdown for a run with zero vouched reps — that is what you get after a
  crashed first rep, and it must say so rather than throw.

**`apps/zoltar-be/scripts/eval-report.ts`:** one positional (`<run-dir>`, absolute or
relative to `$ZOLTAR_EVAL_ROOT/eval-runs/`), optional `--output`, stdout otherwise.
`package.json` + `Taskfile.yml` entries, both with `--env-file=.env`. Plain `tsx` is fine
here — no Nest DI. Note this command needs `ZOLTAR_EVAL_ROOT` but nothing else from
`.env`; it must not fail for want of a `DATABASE_URL` it never uses.

**Tests (`eval/runs/rates.spec.ts`, `eval/runs/report-multi.spec.ts`):**

- Rates: `not_applicable` and `error` excluded from the denominator; all-n/a gives
  `rate: null` and `n: 0`; a fixture present in some reps and absent in others gets the
  right N; a mix across two checks of one fixture keeps them separate.
- Report: golden-string assertions (written literally in the test, not snapshot files, so
  a format change shows up as a readable diff in review) for a mixed run, a zero-vouched
  run, and a run with a `decisionRule`. A guard test asserting `report-multi.ts` and
  `rates.ts` import nothing from `src/db` — the spec's "must never read the DB," made
  mechanical.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Run `eval:report` against Part
5's real run directory and read it. Commit.

---

## Part 7 — `eval:compare`

Paired comparison. All pure functions over two row sets; the only new judgment is how to
present regressions.

**`apps/zoltar-be/eval/runs/compare.ts`:**

- `comparePairs(ratesA, ratesB)` — pairs on `(fixtureId, checkId)`, emitting per pair
  `{rateA, rateB, delta, nA, nB, status}` where `status` distinguishes `paired`,
  `a-only` / `b-only` (fixture absent from one side), and `not-applicable-one-side` —
  reported as such, never delta'd against a partial denominator, per spec.
- `orderForDisplay(pairs)` — **regressions first**, sorted by delta ascending, then
  improvements, then unchanged, then the unpaired/n-a group. The spec's weighting is a
  presentation rule (a change lifting the median while tanking two fixtures is usually a
  bad trade), so it lives in ordering and section headings, not in a score.
- `detectHeterogeneity(rows)` — returns the distinct `rubricHash` and `harnessVersion`
  values per side; when a side spans more than one, the comparison warns and prints the
  exact `--filter-rubric` / `--filter-harness` invocation that would reduce it to a
  consistent subset. Never discards the directory on its own.
- `applyFilters(rows, {rubricHash, harnessVersion})`.

**`apps/zoltar-be/eval/runs/compare-report.ts`:** renders the comparison, echoing **both**
manifests' `decisionRule` in the header (pre-registered rule sitting next to the numbers
it governs; the tool does not evaluate it — spec resolved decision 4), and both sides'
corpus versions with a loud warning if they differ, since a cross-corpus comparison is the
silent-poisoning case `corpusVersion` was made a content hash to prevent.

**`apps/zoltar-be/scripts/eval-compare.ts`:** two positionals, `--filter-rubric`,
`--filter-harness`, `--output`. `package.json` + `Taskfile.yml`, both with
`--env-file=.env`. Like `eval:report`, needs only `ZOLTAR_EVAL_ROOT`.

**Tests (`eval/runs/compare.spec.ts`, `compare-report.spec.ts`):**

- Synthetic rate sets: a straightforward improvement, a straightforward regression, a
  mixed set where the aggregate rises while two fixtures fall (assert both fall to the top
  of the output — this is the spec's motivating case and deserves a named test);
  differing N per side reported honestly; a fixture on one side only; n/a on one side only
  not producing a delta.
- Heterogeneity: a directory spanning two rubric hashes warns and prints a runnable
  filter; applying that filter yields a consistent subset; a differing `corpusVersion`
  between sides warns.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Commit. (A real two-directory
comparison needs a second prompt variant's run — do it opportunistically in Part 10 rather
than blocking this gate on it.)

---

## Part 8 — `eval:judge-variance`

Grader variance, isolated from generator variance. Reads frozen artifacts; makes no Warden
calls.

**`apps/zoltar-be/scripts/eval-judge-variance.core.ts`:**

- For each vouched `(repIndex, fixtureId)` with a judged check, `readTurnResultArtifact`,
  rehydrate, and run that check `--reps` times (default 3) against the identical frozen
  input. Structural checks are skipped with a note — they are deterministic over fixed
  input, so re-running them measures nothing.
- Output rows: `{fixtureId, checkId, rubricHash, sourceRepIndex, trialIndex, verdict,
  durationMs}` → `judge-variance/<timestamp>.jsonl` in the run directory
  (pre-flight decision 7: **not** into `reps/`, which would corrupt every pass-rate
  denominator).
- Summary: per `(fixtureId, checkId)` the verdict distribution and a flip rate; per rubric
  an aggregate flip rate; and an explicit headline — "rubric X flipped on N of M frozen
  inputs" — because the whole reason to run this is to find out whether anything
  downstream is interpretable at all.
- Needs `ANTHROPIC_API_KEY` and an `AnthropicService`, but **no database and no Nest DI**
  — construct `AnthropicService` directly with the env-only `ConfigService` stub
  `eval-replay.ts` already uses (extract that helper into
  `eval/runs/env-config-service.ts` and have both scripts import it, rather than a second
  copy). That keeps this runnable via plain `tsx`.

**`apps/zoltar-be/scripts/eval-judge-variance.ts`:** `<run-dir>` positional, `--reps`,
`--fixtures`, `--output`. `package.json` + `Taskfile.yml`, both with `--env-file=.env`
(this one needs `ANTHROPIC_API_KEY` as well as `ZOLTAR_EVAL_ROOT`, still no
`DATABASE_URL`). Header warns it costs `judged fixtures × vouched reps × --reps` real
judge calls.

**Tests (`scripts/eval-judge-variance.spec.ts`):**

- Fabricated run directory on disk + a stubbed judge: a deterministic judge yields a zero
  flip rate; a judge scripted to alternate yields the expected flip rate and distribution;
  structural checks are skipped and reported as skipped; output lands in
  `judge-variance/`, never in `reps/`, and existing `scores.jsonl` files are byte-unchanged
  afterward (assert this explicitly — it is the one destructive mistake this command could
  make).
- One `RUN_LIVE_EVAL_TESTS`-gated live run against a real rubric.

**Review gate.** `tsc --noEmit` clean. `npm test` green. Run for real against Part 5's run
directory at `--reps 3` and read the summary. Commit.

---

## Part 9 — Retire the single-pass path; docs and decisions

Now that `eval:run` + `eval:report` cover what `eval:harness` did, remove the second write
path (pre-flight decision 8). Mostly deletion — small, but worth its own review because it
removes committed, working code.

- **Delete** `scripts/eval-harness.ts`, `scripts/eval-harness.core.ts`,
  `scripts/eval-harness.spec-int.ts`, `eval/report.ts`, `eval/report.spec.ts`, and the
  `eval:harness` entries in `package.json` / `Taskfile.yml`.
- **Repoint `eval:replay`** at Part 3's registry instead of the deleted `evaluateFixture`,
  and add an artifact-based mode: `--run-dir <dir> --rep <n> --fixture <id>` re-evaluates
  a frozen artifact with no database at all, alongside the existing `--adventure-id` path
  (which still matters for `--keep-scratch` inspection). ~30 lines given Part 8 already
  built `readTurnResultArtifact` and the shared env-only config stub. This makes the
  artifact tree, not a surviving scratch campaign, the primary checker-iteration surface —
  which is what makes tearing down scratch rows by default safe.
- **`docs/decisions.md`** — entries for the pre-flight decisions with alternatives and
  rationale: checkId excluding checkMode; one-check-per-fixture with an N-ready format;
  `warden-output.json` as the full turn result; `harnessVersion` from git; `error` as a
  distinct verdict superseding M7.4's failure conflation; judge-variance output living
  outside `reps/`; retiring `eval:harness`; and **judge verdicts staying binary** — the
  one decision here that predates this milestone and was never recorded anywhere but the
  shape of `judgeVerdictSchema` (pre-flight decision 9).
- **`docs/environments.md`** — `ZOLTAR_EVAL_ROOT`: what it points at (the parent of
  `eval-runs/` in the private `automata-codex` artifacts repo), that it belongs in the
  repo-root `.env` and is picked up via `--env-file` by both `npm run` and `task` (no
  shell export, and a shell export would silently win over the file), and that it is
  CLI-only and deliberately absent from `env.schema.ts`.
- **`docs/eval-methodology.md`** — a short "running a comparison" section: judge-variance
  first, then baseline, then candidate, then compare; and the reminder that a code change
  altering what reaches the Warden warrants a full-suite run even with an untouched prompt
  hash (the doc already argues this; the commands to do it now exist and should be named).

**Review gate.** `tsc --noEmit` clean. Full `npm test` and `npm run test:integration`
green with the deleted specs gone. `task eval:replay` exercised by hand in both modes.
Commit.

---

## Part 10 — Calibration pass: rubric stability, then a baseline N

No new code. This is the pass `docs/eval-methodology.md` demands and the reason the
harness exists — "N is calibrated, not chosen," and the estimate is the deliverable.
Expect it to surface small bugs in Parts 1–9; fixing them here is what this pass is for.

- Run `eval:judge-variance` once per judged rubric (`HIDDEN-INFO-LEAK`, `OVER-RESOLUTION`,
  `UNSURFACED-CHECK`, `SCENE-JUMP`) against a small frozen run. **If a rubric flips against
  fixed input, stop and fix the rubric** — nothing downstream is meaningful until it is
  stable, and this is cheap enough that skipping it is never the right call.
- Baseline run: the current production Warden prompt, `--reps 10`, full corpus,
  `--decision-rule` written down *before* looking at any numbers.
- From the per-fixture rates, compute a variance estimate and record in
  `docs/eval-methodology.md`: the chosen uniform N, its basis (corpus version, model,
  observed variance), and the date. Per the doc, N means "enough reps for the noisiest
  fixture I care about" — write the number *with* its basis or in four months it is just a
  thing the config says.
- Note any fixture whose rate is 0.0 or 1.0 across all 10 reps as a candidate for
  `repOverride` during supervised iteration — and equally, note that it must **not** get a
  permanent override in the standing regression suite, for the reason the methodology doc
  gives.
- Commit the run artifacts to the private `automata-codex` repo (not this one), and record
  the run directory name in the methodology doc so the estimate is traceable.

**Review gate.** Rubric stability confirmed per rubric. Baseline run complete and its
report read end to end. `docs/eval-methodology.md` updated with N, its basis, and the run
directory. This closes the milestone.

---

## Testing summary

**Unit tests:**
- Part 1: `runs/paths.spec.ts`, `runs/manifest.spec.ts`, `runs/scores.spec.ts`.
- Part 2: `corpus-version.spec.ts`, `fixture.schema.spec.ts` additions.
- Part 3: `checks/registry.spec.ts`, `checks/run-check.spec.ts`.
- Part 4: `anthropic.service.spec.ts` additions, `runs/recording-anthropic.spec.ts`,
  `runs/artifacts.spec.ts`.
- Part 5: `scripts/eval-run.spec.ts` (stub executor — the commit-protocol tests).
- Part 6: `runs/rates.spec.ts`, `runs/report-multi.spec.ts`.
- Part 7: `runs/compare.spec.ts`, `runs/compare-report.spec.ts`.
- Part 8: `scripts/eval-judge-variance.spec.ts`.

**Integration tests:** Part 5's `scripts/eval-run.spec-int.ts` (real DB + real model,
gated behind `RUN_LIVE_EVAL_TESTS` per the M7.4 convention). Parts 6–8 need no integration
tests — none of them touches the DB, and Part 6 has a guard test asserting exactly that.

**Guard tests** (cheap, and each encodes a spec constraint that is otherwise only a
promise): no `src/replay/` import from `eval/` (Part 5); no `src/db/` import from the
report modules (Part 6); judge-variance never writes under `reps/` (Part 8).

**Typecheck:** every part ends with `tsc --noEmit` green on `zoltar-be`.

**Manual verification:** Parts 5, 6, 8, and 10 each involve a real run against a real DB
and real Anthropic calls. Multiplied by N, these cost meaningfully more than M7.4's
single-pass runs — keep `--fixtures` narrow and `--reps` at 2 for everything before
Part 10.

---

## Out of scope

Per spec Part 7, plus what follows from it:

- Any database. The score files are the store; a query layer would be a derived index over
  them, rebuildable by re-import.
- Adaptive rep allocation, in any form. `repOverride` is read once before rep 1 and the
  runner holds it in a structure nothing writes to.
- CI integration. These stay manually-invoked local tools, same status as the M7.1 report
  generator.
- A corpus-labeling tool for verified negatives.
- Statistical significance testing on the comparison. `eval:compare` reports rates,
  deltas, and N; it does not compute confidence intervals or p-values, and the spec's
  decision to leave `decisionRule` unenforced free text is the same judgment applied one
  layer down.
- New fixtures. The corpus is Part 8 of the M7.4 plan's business; this milestone changes
  how the existing corpus is run, not what's in it. The three single-instance tags
  (`MISSING-CANON-CAPTURE`, `UNSURFACED-CHECK`, `OVER-RESOLUTION`) still need their second
  confirmed instance per the M7.4 fixture-count bar — still Alex's action item, still not
  resolved here.
