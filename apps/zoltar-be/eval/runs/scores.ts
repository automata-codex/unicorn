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
 * `judgeConfidence` is deliberately absent — no rubric emits one (an
 * earlier, undocumented design decision; self-reported LLM confidence was
 * rejected), and a permanently-empty optional column reads as an invitation
 * to fill it. JSONL rows are append-friendly, so adding it later if a
 * rubric ever does emit one is non-breaking.
 */
export const scoreRowSchema = baseScoreRowSchema.superRefine((row, ctx) => {
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
});

export type ScoreRow = z.infer<typeof scoreRowSchema>;

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
 * Append-only writer for one rep's `scores.jsonl`. `close()` awaits the
 * underlying stream's `finish` event so "flush and close, *then* vouch via
 * `appendCompletedRep`" is a real ordering guarantee — this is the whole
 * commit protocol, not an incidental detail.
 */
export class ScoreWriter {
  private stream: WriteStream | null = null;

  open(path: string): void {
    this.stream = createWriteStream(path, { flags: 'a' });
  }

  append(row: ScoreRow): void {
    if (!this.stream) {
      throw new Error('ScoreWriter.append called before open()');
    }
    const validated = scoreRowSchema.parse(row);
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

export function readScoreRows(path: string): ScoreRow[] {
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

    const result = scoreRowSchema.safeParse(parsed);
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
