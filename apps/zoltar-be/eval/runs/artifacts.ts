import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  fixtureArtifactDir,
  judgeArtifactPath,
  wardenOutputPath,
  wardenRequestPath,
} from './paths';

import type { CapturedWardenCall } from './recording-anthropic';
import type { TurnExecutionResult } from '../turn-result';

/**
 * `JSON.stringify` as-is, pretty-printed for the "inspect the run directory
 * by eye" review gate — `deserializeTurnResult` doesn't care about
 * whitespace. `TurnExecutionResult` carries Drizzle rows with real `Date`
 * fields (`createdAt`/`reviewedAt`/`resolvedAt`), which `JSON.stringify`
 * turns into ISO strings; `deserializeTurnResult` is the inverse that
 * revives them.
 */
export function serializeTurnResult(result: TurnExecutionResult): string {
  return JSON.stringify(result, null, 2);
}

function withRevivedDate<T extends Record<string, unknown>>(
  row: T,
  field: keyof T,
): T {
  const value = row[field];
  if (typeof value !== 'string') return row;
  return { ...row, [field]: new Date(value) };
}

/**
 * Revives every field a checker actually reads: `gameEvents[].createdAt`,
 * `telemetry.createdAt`, `pendingCanon[].createdAt`/`.reviewedAt`,
 * `diceRequests[].createdAt`/`.resolvedAt`. `serviceResult` is left as
 * plain JSON-round-tripped data (its dates stay strings) — no checker reads
 * it (see `turn-result.ts`'s own doc comment: "for debugging/report detail"
 * only), so reviving it would add nested-type modeling for a field this
 * round-trip doesn't need to be honest about.
 *
 * A new `Date`-typed column added to `game_event`, `adventure_telemetry`,
 * `pending_canon`, or `dice_request` needs a matching revival added here —
 * otherwise a checker that reads it will see a string where it expects a
 * `Date`.
 */
export function deserializeTurnResult(json: string): TurnExecutionResult {
  const parsed = JSON.parse(json) as TurnExecutionResult;

  return {
    ...parsed,
    gameEvents: parsed.gameEvents.map((row) =>
      withRevivedDate(row, 'createdAt'),
    ),
    telemetry: parsed.telemetry
      ? withRevivedDate(parsed.telemetry, 'createdAt')
      : null,
    pendingCanon: parsed.pendingCanon.map((row) =>
      withRevivedDate(withRevivedDate(row, 'createdAt'), 'reviewedAt'),
    ),
    diceRequests: parsed.diceRequests.map((row) =>
      withRevivedDate(withRevivedDate(row, 'createdAt'), 'resolvedAt'),
    ),
  };
}

export interface WriteFixtureArtifactsInput {
  wardenRequests: CapturedWardenCall[];
  turnResult: TurnExecutionResult;
}

/**
 * Writes `warden-request.json` (the ordered array of captured
 * `CallSessionParams` + raw response — several per turn, one per
 * inner-tool-loop iteration plus a correction round if one fired) and
 * `warden-output.json` (the full serialized `TurnExecutionResult` — a
 * strict superset of `submit_gm_response`'s payload, since
 * `eval:judge-variance` re-runs judged checks against this artifact with no
 * database at all and needs `gameEvents`/`telemetry`/`pendingCanon`/
 * `diceRequests`, not just the narration).
 */
export function writeFixtureArtifacts(
  runDir: string,
  repIndex: number,
  fixtureId: string,
  input: WriteFixtureArtifactsInput,
): void {
  mkdirSync(fixtureArtifactDir(runDir, repIndex, fixtureId), {
    recursive: true,
  });

  writeFileSync(
    wardenRequestPath(runDir, repIndex, fixtureId),
    JSON.stringify(input.wardenRequests, null, 2) + '\n',
    'utf-8',
  );
  writeFileSync(
    wardenOutputPath(runDir, repIndex, fixtureId),
    serializeTurnResult(input.turnResult) + '\n',
    'utf-8',
  );
}

export interface JudgeArtifactInput {
  verdict: 'pass' | 'fail';
  rationale: string;
  rubricHash: string;
}

/** Judge reasoning text — bulky, read only during investigation — lives
 * here rather than on the score row. */
export function writeJudgeArtifact(
  runDir: string,
  repIndex: number,
  fixtureId: string,
  checkId: string,
  input: JudgeArtifactInput,
): void {
  mkdirSync(fixtureArtifactDir(runDir, repIndex, fixtureId), {
    recursive: true,
  });

  writeFileSync(
    judgeArtifactPath(runDir, repIndex, fixtureId, checkId),
    JSON.stringify(input, null, 2) + '\n',
    'utf-8',
  );
}

/** The inverse of `writeFixtureArtifacts`'s `warden-output.json` half —
 * `eval:judge-variance` (Part 8) re-runs judged checks against this with no
 * database at all. */
export function readTurnResultArtifact(
  runDir: string,
  repIndex: number,
  fixtureId: string,
): TurnExecutionResult {
  const raw = readFileSync(wardenOutputPath(runDir, repIndex, fixtureId), 'utf-8');
  return deserializeTurnResult(raw);
}

/** The `artifactPath` value that goes on a score row — always relative to
 * the run directory, per spec. A thin wrapper so every caller derives it
 * the same way rather than hand-rolling `path.relative`. */
export function relativeArtifactPath(
  runDir: string,
  absolutePath: string,
): string {
  return relative(runDir, absolutePath);
}
