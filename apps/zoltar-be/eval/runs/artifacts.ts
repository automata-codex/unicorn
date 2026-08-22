import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import {
  fixtureArtifactDir,
  judgeArtifactPath,
  wardenOutputPath,
  wardenRequestPath,
} from './paths';

import type { TurnExecutionResult } from '../turn-result';
import type { CapturedWardenCall } from './recording-anthropic';

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
 * Writes just `warden-request.json` — the ordered array of captured
 * `CallSessionParams` + raw response, several per turn (one per
 * inner-tool-loop iteration plus a correction round if one fired). Exported
 * on its own, not just as half of `writeFixtureArtifacts`, so a turn that
 * throws before producing a `TurnExecutionResult` can still persist
 * whatever the Warden was asked before the failure — an `error` row's
 * `artifactPath` should point at something real, not a `warden-output.json`
 * that was never written.
 */
export function writeWardenRequestArtifact(
  runDir: string,
  repIndex: number,
  fixtureId: string,
  wardenRequests: CapturedWardenCall[],
): void {
  mkdirSync(fixtureArtifactDir(runDir, repIndex, fixtureId), {
    recursive: true,
  });
  writeFileSync(
    wardenRequestPath(runDir, repIndex, fixtureId),
    JSON.stringify(wardenRequests, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Writes `warden-request.json` (see `writeWardenRequestArtifact`) and
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
  writeWardenRequestArtifact(runDir, repIndex, fixtureId, input.wardenRequests);
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
  /**
   * The judge contract this verdict was graded under. Optional for the same
   * reason the row's is — artifacts written before the field existed do not
   * carry it, and an absent value means unknown. Both `eval:run` and
   * `eval:rescore` write through this shape, so they pick it up together.
   */
  judgeContractHash?: string;
  /**
   * The check's `judgeContext` output, when it has one — the events the
   * structural half narrowed the question to. Without it, a rationale about
   * "the rolls under review" can't be tied back to which rolls those were,
   * which is most of what makes a verdict investigable for a check like
   * `unauditable-mapping`.
   */
  judgeContext?: string;
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
  writeJudgeArtifactAt(
    judgeArtifactPath(runDir, repIndex, fixtureId, checkId),
    input,
  );
}

/** The same write against a caller-chosen path, for `eval:rescore`, whose
 * rationales must not land on (or be confused with) the original run's. */
export function writeJudgeArtifactAt(
  absolutePath: string,
  input: JudgeArtifactInput,
): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(input, null, 2) + '\n', 'utf-8');
}

/** The inverse of `writeFixtureArtifacts`'s `warden-output.json` half —
 * `eval:judge-variance` (Part 8) re-runs judged checks against this with no
 * database at all. */
export function readTurnResultArtifact(
  runDir: string,
  repIndex: number,
  fixtureId: string,
): TurnExecutionResult {
  const raw = readFileSync(
    wardenOutputPath(runDir, repIndex, fixtureId),
    'utf-8',
  );
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
