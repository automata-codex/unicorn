import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { manifestPath, promptTextPath, runDirName, runDirPath } from './paths';

const completedRepSchema = z.object({
  index: z.number().int().positive(),
  harnessVersion: z.string().min(1),
  rubricHashes: z.record(z.string(), z.string()),
  fixtureIds: z.array(z.string().min(1)),
  startedAt: z.string(),
  completedAt: z.string(),
});

export type CompletedRep = z.infer<typeof completedRepSchema>;

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  model: z.string().min(1),
  promptHash: z.string().min(1),
  temperature: z.number(),
  corpusVersion: z.string().min(1),
  createdAt: z.string(),

  /** Pre-registered; written once at directory creation, never edited
   * afterward. `completedReps.length` may exceed this — that is a visible,
   * intentional signal (N was extended because observed variance was
   * higher than expected), not something this schema prevents. */
  plannedReps: z.number().int().positive(),
  decisionRule: z.string().optional(),

  completedReps: z.array(completedRepSchema),
});

export type Manifest = z.infer<typeof manifestSchema>;

export interface CreateRunDirectoryOptions {
  root: string;
  model: string;
  promptHash: string;
  promptText: string;
  temperature: number;
  corpusVersion: string;
  plannedReps: number;
  decisionRule?: string;
  /** Injected rather than computed internally so callers (and their tests)
   * control directory naming and `manifest.createdAt` with one value. */
  createdAt: Date;
}

/**
 * Creates a new run directory, writing `manifest.json` and `prompt.txt`.
 * Refuses to clobber an existing directory — a collision means the caller
 * either reused a timestamp or meant to pass `--run-dir` instead.
 */
export function createRunDirectory(opts: CreateRunDirectoryOptions): string {
  const dirName = runDirName(opts.model, opts.promptHash, opts.createdAt);
  const runDir = runDirPath(opts.root, dirName);

  if (existsSync(runDir)) {
    throw new Error(
      `Run directory already exists, refusing to clobber: ${runDir}`,
    );
  }

  mkdirSync(join(runDir, 'reps'), { recursive: true });
  mkdirSync(join(runDir, 'rubrics'), { recursive: true });

  const manifest: Manifest = {
    schemaVersion: 1,
    runId: dirName,
    model: opts.model,
    promptHash: opts.promptHash,
    temperature: opts.temperature,
    corpusVersion: opts.corpusVersion,
    createdAt: opts.createdAt.toISOString(),
    plannedReps: opts.plannedReps,
    decisionRule: opts.decisionRule,
    completedReps: [],
  };

  writeFileSync(
    manifestPath(runDir),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
  writeFileSync(promptTextPath(runDir), opts.promptText, 'utf-8');

  return runDir;
}

export function readManifest(runDir: string): Manifest {
  const raw = readFileSync(manifestPath(runDir), 'utf-8');
  return manifestSchema.parse(JSON.parse(raw));
}

/**
 * The `--run-dir` guard: a run appended to an existing directory must match
 * the directory's identity. Reports every mismatch at once (not just the
 * first) so a wrong invocation is diagnosable from one error.
 */
export function assertManifestMatches(
  manifest: Manifest,
  expected: { model: string; promptHash: string; temperature: number },
): void {
  const mismatches: string[] = [];
  if (manifest.model !== expected.model) {
    mismatches.push(
      `model: manifest has "${manifest.model}", requested "${expected.model}"`,
    );
  }
  if (manifest.promptHash !== expected.promptHash) {
    mismatches.push(
      `promptHash: manifest has "${manifest.promptHash}", requested "${expected.promptHash}"`,
    );
  }
  if (manifest.temperature !== expected.temperature) {
    mismatches.push(
      `temperature: manifest has ${manifest.temperature}, requested ${expected.temperature}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `--run-dir "${manifest.runId}" does not match the requested run:\n` +
        mismatches.map((m) => `  - ${m}`).join('\n'),
    );
  }
}

/**
 * Read-modify-write of `manifest.json`, appended only after a rep's
 * `scores.jsonl` is flushed and closed by the caller — that ordering is the
 * whole commit protocol (see `ScoreWriter.close`). Writes to a temp file and
 * renames over the target so a crash mid-write can't leave a truncated
 * manifest and destroy the vouching record for every prior rep.
 *
 * Not safe against two processes appending concurrently — the runner calls
 * this sequentially, once per rep, from a single invocation; there is no
 * multi-process writer in this milestone.
 *
 * Returns a warning string when `completedReps.length` exceeds
 * `plannedReps` (visible, non-blocking — see the schema's doc comment);
 * `null` otherwise.
 */
export function appendCompletedRep(
  runDir: string,
  entry: CompletedRep,
): string | null {
  const manifest = readManifest(runDir);
  const updated: Manifest = {
    ...manifest,
    completedReps: [...manifest.completedReps, entry],
  };

  const target = manifestPath(runDir);
  const tempPath = `${target}.tmp-${process.pid}-${entry.index}`;
  writeFileSync(tempPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  renameSync(tempPath, target);

  if (updated.completedReps.length > updated.plannedReps) {
    return (
      `completedReps (${updated.completedReps.length}) exceeds plannedReps ` +
      `(${updated.plannedReps}) for run "${manifest.runId}" — N was ` +
      'extended after registration; confirm this was deliberate.'
    );
  }
  return null;
}

/**
 * `max(completedReps.index) + 1`, or `1` when empty. Deliberately reads the
 * manifest, not the disk: a crashed, unvouched rep directory gets *reused*
 * by the next run rather than orphaning an index — the point of "unvouched
 * reps are ignored, not repaired."
 */
export function nextRepIndex(manifest: Manifest): number {
  if (manifest.completedReps.length === 0) return 1;
  return Math.max(...manifest.completedReps.map((rep) => rep.index)) + 1;
}
