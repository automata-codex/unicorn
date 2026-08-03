import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { rescoreDir } from './paths';
import { readRescoreRows, readVouchedRows } from './scores';

import type { ScoredRow } from './scores';

/**
 * Which grading a report renders.
 *
 * Once `eval:rescore` exists, a run directory holds more than one set of
 * verdicts over the same generator output: the run's own
 * `reps/<nnn>/scores.jsonl`, plus one file per re-score pass. Asking for "the
 * report for this run" is ambiguous, and the failure mode isn't a crash —
 * it's two people quoting numbers that came from different graders and
 * comparing them.
 *
 * `'auto'` is what a caller gets with no flag: the most recent re-score if
 * any exists, otherwise the run. It is never *silent* — the resolved source
 * is named in the report header and on stderr, which is what makes a default
 * acceptable here at all.
 */
export type ScoringSelector =
  | { kind: 'auto' }
  | { kind: 'run' }
  | { kind: 'latest-rescore' }
  | { kind: 'rescore'; timestamp: string };

export interface RescorePass {
  /** The filename-safe timestamp naming the pass — the `<timestamp>` in
   * `rescore/<timestamp>.jsonl`, and the directory name its judge
   * rationales live under. */
  timestamp: string;
  path: string;
}

/**
 * Every re-score pass in a run directory, oldest first.
 *
 * Only `*.jsonl` entries count: `rescoreJudgeArtifactPath` puts each pass's
 * judge rationales in a sibling *directory* named for the same timestamp, and
 * treating that as a pass would produce a phantom entry with no rows.
 */
export function listRescorePasses(runDir: string): RescorePass[] {
  const dir = rescoreDir(runDir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => ({
      timestamp: entry.name.slice(0, -'.jsonl'.length),
      path: join(dir, entry.name),
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export interface ResolvedScoring {
  kind: 'run' | 'rescore';
  /** Short human label for the report header, e.g. `re-score
   * 2026-07-30T09-00-00Z`. */
  label: string;
  /** The file (or directory) the rows were read from, named so a reader can
   * go look. */
  source: string;
  rows: ScoredRow[];
  /** `readVouchedRows`'s exclusion strings for a run. Empty for a re-score:
   * vouching was applied when the pass was written, and re-deriving it here
   * against a different rep set would invent exclusions. */
  exclusions: string[];
  /** True when no `--scoring` flag was given and the default landed on a
   * re-score rather than the run — callers say so on stderr. */
  defaultedToRescore: boolean;
  /**
   * Re-score only: what actually governed these verdicts, as recorded on the
   * rows — computed over **re-graded rows only.**
   *
   * Carried-forward rows keep the *source run's* stamps, because nothing
   * re-graded them. Folding those in makes every re-score with at least one
   * carried-forward row look like it spanned two harness versions, which is
   * provenance rather than grading divergence, and is exactly the false
   * signal that nearly got a run re-scored under a harness predating every
   * checker migration in this cycle.
   */
  corpusVersion?: string;
  harnessVersion?: string;
  /** Re-score only: rows whose verdict was copied because the source turn
   * errored before producing an artifact to re-grade. */
  carriedForward?: number;
  /** Re-score only: the harness that graded the carried-forward rows — the
   * source run's own. Reported because the count and its provenance are
   * worth seeing, never compared across sides as if it were this pass's
   * grader. */
  carriedForwardHarnessVersion?: string;
}

function distinct(values: (string | undefined)[]): string | undefined {
  const set = new Set(values.filter((v): v is string => v !== undefined));
  if (set.size === 0) return undefined;
  return [...set].sort().join(', ');
}

function readRescorePass(
  pass: RescorePass,
  defaultedToRescore: boolean,
): ResolvedScoring {
  const rows = readRescoreRows(pass.path);
  const regraded = rows.filter((r) => !r.carriedForward);
  const carried = rows.filter((r) => r.carriedForward);
  return {
    kind: 'rescore',
    label: `re-score ${pass.timestamp}`,
    source: pass.path,
    rows,
    exclusions: [],
    defaultedToRescore,
    corpusVersion: distinct(regraded.map((r) => r.corpusVersion)),
    harnessVersion: distinct(regraded.map((r) => r.harnessVersion)),
    carriedForward: carried.length,
    carriedForwardHarnessVersion: distinct(
      carried.map((r) => r.harnessVersion),
    ),
  };
}

function readRunScores(runDir: string): ResolvedScoring {
  const { rows, exclusions } = readVouchedRows(runDir);
  return {
    kind: 'run',
    label: "the run's own scores",
    source: join(runDir, 'reps', '<nnn>', 'scores.jsonl'),
    rows,
    exclusions,
    defaultedToRescore: false,
  };
}

export class ScoringSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringSourceError';
  }
}

/**
 * Reads the rows a report should render, per `selector`. Shared by
 * `eval:report` and `eval:compare` rather than implemented per command: the
 * two disagreeing about which grading they default to would manufacture the
 * exact cross-grader comparison this module exists to prevent.
 */
export function resolveScoring(
  runDir: string,
  selector: ScoringSelector,
): ResolvedScoring {
  if (selector.kind === 'run') return readRunScores(runDir);

  const passes = listRescorePasses(runDir);

  if (selector.kind === 'rescore') {
    const pass = passes.find((p) => p.timestamp === selector.timestamp);
    if (!pass) {
      throw new ScoringSourceError(
        `no re-score pass "${selector.timestamp}" in ${rescoreDir(runDir)}. ` +
          (passes.length === 0
            ? 'That directory holds no re-score passes.'
            : `Available: ${passes.map((p) => p.timestamp).join(', ')}`),
      );
    }
    return readRescorePass(pass, false);
  }

  if (passes.length === 0) {
    if (selector.kind === 'latest-rescore') {
      throw new ScoringSourceError(
        `--scoring rescore was requested but ${rescoreDir(runDir)} holds no ` +
          "re-score passes. Use --scoring run to render the run's own scores.",
      );
    }
    return readRunScores(runDir);
  }

  return readRescorePass(passes[passes.length - 1], selector.kind === 'auto');
}

/**
 * Parses the `--scoring` CLI value. Absent is `auto`; `rescore=<timestamp>`
 * pins one pass. Anything else is a usage error rather than a silent
 * fallback — a mistyped selector resolving to "whatever the default was" is
 * how a report ends up describing a grading nobody asked for.
 */
export function parseScoringArg(value: string | undefined): ScoringSelector {
  if (value === undefined) return { kind: 'auto' };
  if (value === 'run') return { kind: 'run' };
  if (value === 'rescore') return { kind: 'latest-rescore' };
  if (value.startsWith('rescore=')) {
    const timestamp = value.slice('rescore='.length).trim();
    if (!timestamp) {
      throw new ScoringSourceError(
        '--scoring rescore=<timestamp> needs a timestamp, e.g. ' +
          '--scoring rescore=2026-07-30T09-00-00Z',
      );
    }
    return { kind: 'rescore', timestamp };
  }
  throw new ScoringSourceError(
    `--scoring takes "run", "rescore", or "rescore=<timestamp>", got "${value}"`,
  );
}
