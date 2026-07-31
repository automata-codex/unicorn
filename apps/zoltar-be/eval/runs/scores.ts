import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { z } from 'zod';

import { readManifest } from './manifest';
import { listRepDirsOnDisk, repDirName, scoresPath } from './paths';

export const verdictSchema = z.enum([
  'pass',
  'fail',
  'not_applicable',
  'error',
]);
export type Verdict = z.infer<typeof verdictSchema>;

export const checkModeSchema = z.enum(['structural', 'judged']);
export type CheckMode = z.infer<typeof checkModeSchema>;

/**
 * Which writer produced a row. `run` rows come from `eval:run` — one
 * observation of generator and grader together. `rescore` rows come from
 * `eval:rescore` — the same frozen generator output re-graded under later
 * checker code, which is a different measurement with a different meaning
 * for half the columns (see `rescoreRowSchema`).
 *
 * Optional (not defaulted) on the run side, so `eval:run`'s on-disk format
 * stays byte-identical to every row already written — this command exists
 * to reproduce historical numbers, and a gratuitous format change in the
 * same commit would be one more thing to rule out when a rate moves. The
 * absence of the field *is* the run marker.
 *
 * Discrimination still works in both directions, which is the point:
 * `readScoreRows` rejects a rescore file (`'rescore'` doesn't match the
 * `'run'` literal) and `readRescoreRows` rejects a scores file (a missing
 * field doesn't match the required `'rescore'` literal). Neither can
 * quietly fold the other's verdicts into a pass-rate denominator.
 */
export const rowKindSchema = z.enum(['run', 'rescore']);
export type RowKind = z.infer<typeof rowKindSchema>;

const baseScoreRowSchema = z.object({
  // --- run identity, denormalized onto every row ---
  runId: z.string().min(1),
  model: z.string().min(1),
  promptHash: z.string().min(1),
  temperature: z.number(),
  corpusVersion: z.string().min(1),
  harnessVersion: z.string().min(1),

  // --- observation ---
  repIndex: z.number().int().positive(),
  fixtureId: z.string().min(1),
  checkId: z.string().min(1),
  tag: z.string().min(1),
  checkMode: checkModeSchema,
  verdict: verdictSchema,

  /**
   * Where this row's check gets its `not_applicable` verdicts, copied from
   * the registry at scoring time — see `EvalCheck.applicabilitySource`. On
   * the row rather than looked up from the check id at read time because it
   * can change when a checker is migrated, and a row must keep describing
   * the rules it was actually scored under. Optional for rows written
   * before the field existed.
   */
  applicabilitySource: z.enum(['fixture', 'artifact', 'none']).optional(),
  /** Whether a judge call produced this verdict — see
   * `CheckObservation.judgeInvoked`. Absent on older rows. */
  judgeInvoked: z.boolean().optional(),
  rubricHash: z.string().optional(),
  notApplicableReason: z.string().optional(),
  /** Stable grouping key for `notApplicableReason` — see
   * `CheckObservation.notApplicableReasonCode`. Absent on older rows and on
   * any row whose reason has no per-rep-variable content; both cases group
   * on `notApplicableReason` itself. */
  notApplicableReasonCode: z.string().optional(),
  errorMessage: z.string().optional(),

  artifactPath: z.string().min(1),
  durationMs: z.number().nonnegative(),
  recordedAt: z.string(),
});

/**
 * The verdict/detail pairing every row must satisfy, shared by both row
 * kinds rather than restated — a rescore row is under exactly the same
 * obligation to name why something was `not_applicable` or what errored.
 */
function refineVerdictDetail(
  row: { verdict: Verdict; notApplicableReason?: string; errorMessage?: string },
  ctx: z.RefinementCtx,
): void {
  if (row.verdict === 'not_applicable' && !row.notApplicableReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'notApplicableReason is required when verdict is "not_applicable"',
      path: ['notApplicableReason'],
    });
  }
  if (row.verdict === 'error' && !row.errorMessage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'errorMessage is required when verdict is "error"',
      path: ['errorMessage'],
    });
  }
}

/**
 * `judgeConfidence` is deliberately absent — no rubric emits one (an
 * earlier, undocumented design decision; self-reported LLM confidence was
 * rejected), and a permanently-empty optional column reads as an invitation
 * to fill it. JSONL rows are append-friendly, so adding it later if a
 * rubric ever does emit one is non-breaking.
 */
export const scoreRowSchema = baseScoreRowSchema
  .extend({ rowKind: z.literal('run').optional() })
  .superRefine(refineVerdictDetail);

export type ScoreRow = z.infer<typeof scoreRowSchema>;

/**
 * The columns a rate reads — everything `computeRates`, `rollupByTag` and
 * `summarizeExclusions` touch, and nothing about which writer produced the
 * row. Both `ScoreRow` and `RescoreRow` are assignable to it, which is what
 * lets one set of aggregation functions serve a run and a re-score of that
 * run without a second implementation to keep in step.
 */
export type ScoredRow = z.infer<typeof baseScoreRowSchema>;

/**
 * A re-graded row: same frozen `warden-output.json`, same generator, later
 * checker code.
 *
 * **The inherited columns change tense, and that is the one thing to know
 * about this schema.** `model`, `promptHash`, `temperature` and `runId` still
 * describe *generation* — they're copied from the source run's manifest and
 * are as true as they ever were. `corpusVersion` and `harnessVersion` now
 * describe *scoring*: they are recomputed at re-score time and record the
 * fixtures and checker code that produced this verdict, not the ones the
 * turn was generated under. Same column names, different moment. The
 * `source*` columns below keep the originals so a row says what moved
 * without needing the run it came from.
 *
 * `repIndex` is deliberately not renamed to something like `sourceRepIndex`:
 * it is the same rep, and keeping the name is what lets `computeRates`,
 * `rollupByTag` and `summarizeExclusions` consume these rows unchanged —
 * regenerating a run's rates under new checkers is the entire point.
 */
export const rescoreRowSchema = baseScoreRowSchema
  .extend({
    rowKind: z.literal('rescore'),
    /** When this re-score pass ran — the same value on every row of one
     * pass, matching the `<timestamp>.jsonl` filename. */
    rescoredAt: z.string(),
    /** `corpusVersion` / `harnessVersion` as the *source row* carried them.
     * Equal to the re-score-time values when nothing moved, which is the
     * normal case for `corpusVersion` on a checker-only change. */
    sourceCorpusVersion: z.string().min(1),
    sourceHarnessVersion: z.string().min(1),
    /** The source row's verdict, kept so a diff never needs both files
     * open. */
    sourceVerdict: verdictSchema,
    /**
     * True when the verdict was copied from the source row rather than
     * recomputed, because no `warden-output.json` exists for this
     * `(repIndex, fixtureId)` — the original turn errored before producing
     * one, so there is nothing to re-grade and never will be. Copied rather
     * than dropped so a re-score file is a complete replacement for the
     * run's rows: omitting them would silently shrink the error accounting
     * `eval:report` renders, and make a re-scored report look cleaner than
     * the run it describes.
     */
    carriedForward: z.boolean().default(false),
  })
  .superRefine(refineVerdictDetail);

export type RescoreRow = z.infer<typeof rescoreRowSchema>;

export class ScoreRowError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly lineNumber: number,
    detail: string,
  ) {
    super(`${filePath}:${lineNumber}: ${detail}`);
    this.name = 'ScoreRowError';
  }
}

/**
 * Append-only JSONL writer, validating every row against a schema before it
 * reaches the file. `close()` awaits the underlying stream's `finish` event
 * so "flush and close, *then* vouch via `appendCompletedRep`" is a real
 * ordering guarantee — that is the whole commit protocol on the `eval:run`
 * side, not an incidental detail.
 */
class JsonlRowWriter<TIn, TOut> {
  private stream: WriteStream | null = null;

  constructor(
    private readonly schema: { parse: (input: TIn) => TOut },
    private readonly label: string,
  ) {}

  open(path: string): void {
    this.stream = createWriteStream(path, { flags: 'a' });
  }

  append(row: TIn): void {
    if (!this.stream) {
      throw new Error(`${this.label}.append called before open()`);
    }
    const validated = this.schema.parse(row);
    this.stream.write(JSON.stringify(validated) + '\n');
  }

  async close(): Promise<void> {
    if (!this.stream) return;
    const stream = this.stream;
    this.stream = null;
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
      stream.end();
    });
  }
}

/** Writer for one rep's `reps/<nnn>/scores.jsonl`. */
export class ScoreWriter extends JsonlRowWriter<
  z.input<typeof scoreRowSchema>,
  ScoreRow
> {
  constructor() {
    super(scoreRowSchema, 'ScoreWriter');
  }
}

/**
 * Writer for one re-score pass's `rescore/<timestamp>.jsonl`. Streamed
 * rather than accumulated and written once at the end: a full-corpus
 * re-score makes a judge call per judged fixture-rep and takes long enough
 * that losing the whole file to a crash at 90% would mean paying for those
 * calls twice.
 */
export class RescoreWriter extends JsonlRowWriter<
  z.input<typeof rescoreRowSchema>,
  RescoreRow
> {
  constructor() {
    super(rescoreRowSchema, 'RescoreWriter');
  }
}

function readJsonlRows<T>(
  path: string,
  schema: { safeParse: (input: unknown) => z.SafeParseReturnType<unknown, T> },
): T[] {
  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  return lines.map((line, i) => {
    const lineNumber = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new ScoreRowError(
        path,
        lineNumber,
        `invalid JSON: ${(err as Error).message}`,
      );
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new ScoreRowError(
        path,
        lineNumber,
        result.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      );
    }
    return result.data;
  });
}

export function readScoreRows(path: string): ScoreRow[] {
  return readJsonlRows(path, scoreRowSchema);
}

/**
 * Rejects a `reps/<nnn>/scores.jsonl` file outright, via `rowKind`'s literal —
 * the two files are the same shape and mixing them up would produce a
 * plausible-looking, meaningless rate.
 */
export function readRescoreRows(path: string): RescoreRow[] {
  return readJsonlRows(path, rescoreRowSchema);
}

export interface VouchedRowsResult {
  rows: ScoreRow[];
  /** Every unvouched rep directory and every row dropped, named in plain
   * text — the spec's "exclusions are reported, never silently dropped." */
  exclusions: string[];
}

/**
 * The aggregation primitive every reader (`eval:report`, `eval:compare`,
 * `eval:judge-variance`) shares rather than reimplementing the vouching
 * rule: read the manifest, read each vouched rep's `scores.jsonl`, and keep
 * only rows whose `(repIndex, fixtureId)` appears in that rep's
 * `completedReps` entry.
 */
export function readVouchedRows(runDir: string): VouchedRowsResult {
  const manifest = readManifest(runDir);
  const exclusions: string[] = [];
  const rows: ScoreRow[] = [];

  const vouchedIndices = new Set(manifest.completedReps.map((r) => r.index));
  for (const index of listRepDirsOnDisk(runDir)) {
    if (!vouchedIndices.has(index)) {
      exclusions.push(
        `rep ${repDirName(index)} exists on disk but is not vouched for in ` +
          'manifest.json (crashed or in-progress run) — excluded',
      );
    }
  }

  for (const entry of manifest.completedReps) {
    const path = scoresPath(runDir, entry.index);
    if (!existsSync(path)) {
      exclusions.push(
        `rep ${repDirName(entry.index)} is vouched in manifest.json but ` +
          'scores.jsonl is missing on disk — excluded',
      );
      continue;
    }

    const vouchedFixtures = new Set(entry.fixtureIds);
    for (const row of readScoreRows(path)) {
      if (row.repIndex !== entry.index) {
        exclusions.push(
          `rep ${repDirName(entry.index)}: row for fixture "${row.fixtureId}" ` +
            `has repIndex ${row.repIndex}, expected ${entry.index} — dropped`,
        );
        continue;
      }
      if (!vouchedFixtures.has(row.fixtureId)) {
        exclusions.push(
          `rep ${repDirName(entry.index)}: row for fixture "${row.fixtureId}" ` +
            "is not in this rep's vouched fixtureIds — dropped",
        );
        continue;
      }
      rows.push(row);
    }
  }

  return { rows, exclusions };
}
