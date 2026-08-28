/**
 * Checks that every eval run has been dispositioned in
 * `docs/eval-methodology.md § Current baseline N`.
 *
 * The failure this exists to catch is not "the baseline is wrong" — it is a run
 * that *happened* and was never recorded as either accepted or rejected as the
 * standing comparison point. On 2026-08-28 that section named
 * `fa4e6e2f__2026-08-21` while four later full-corpus runs sat in the archive,
 * one of which a bump note in the same file measures a corpus change against.
 * Nothing noticed, because nothing was looking.
 *
 * **The obvious check is the wrong one.** "Newest run equals recorded standing
 * point" is false by design: not every run is accepted as a baseline, and
 * exploratory runs are normal. That assertion would fire constantly, be
 * silenced, and catch nothing. The invariant here is weaker and true: a run
 * newer than the standing point must be **mentioned somewhere in the file** —
 * accepted, superseded, voided, or merely named. Saying "this ran and was not
 * accepted" satisfies it, which is the point.
 */

/**
 * A run directory name: `<model>__<promptHash>__<timestamp>`. The timestamp is
 * ISO-8601 with `:` replaced by `-`, so it sorts lexicographically in
 * chronological order and no date parsing is needed.
 */
export const RUN_ID_PATTERN =
  /[A-Za-z0-9.\-]+__[0-9a-f]{8}__\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/g;

/** The line `§ Current baseline N` carries the standing point on. */
const STANDING_POINT_MARKER = '**Last recorded:**';

export interface BaselineCheckInput {
  /** Full text of `docs/eval-methodology.md`. */
  methodologyText: string;
  /** Directory names of runs that actually produced a `manifest.json`. */
  runIds: readonly string[];
}

export type BaselineCheckResult =
  | { kind: 'ok'; standingPoint: string; newerRuns: number }
  | { kind: 'undispositioned'; standingPoint: string; runs: string[] }
  | { kind: 'unreadable'; problem: string };

export function timestampOf(runId: string): string | null {
  const match = runId.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)$/);
  return match ? match[1] : null;
}

/**
 * The run id named as the current standing comparison point.
 *
 * Returns `null` rather than guessing when the marker is missing. The caller
 * reports that as a failure, never as a skip: a check that silently passes
 * when it cannot find its own input is worse than no check, and this one is
 * being added precisely because a quiet gap went unnoticed for four runs.
 */
export function findStandingPoint(methodologyText: string): string | null {
  const markerIndex = methodologyText.indexOf(STANDING_POINT_MARKER);
  if (markerIndex === -1) return null;

  const after = methodologyText.slice(
    markerIndex + STANDING_POINT_MARKER.length,
  );
  const match = after.match(new RegExp(RUN_ID_PATTERN.source));
  return match ? match[0] : null;
}

export function checkBaselineDisposition(
  input: BaselineCheckInput,
): BaselineCheckResult {
  const standingPoint = findStandingPoint(input.methodologyText);
  if (!standingPoint) {
    return {
      kind: 'unreadable',
      problem:
        `no \`${STANDING_POINT_MARKER}\` line naming a run id was found in ` +
        'docs/eval-methodology.md — § Current baseline N must state the ' +
        'standing comparison point in one place, and this check cannot run ' +
        'without it',
    };
  }

  const standingTimestamp = timestampOf(standingPoint);
  if (!standingTimestamp) {
    return {
      kind: 'unreadable',
      problem: `the standing point "${standingPoint}" carries no parseable timestamp`,
    };
  }

  // Mentioned *anywhere* in the file, not only in this section. A run named in
  // a bump note or a variance measurement has been dispositioned by anyone
  // reading the file, and requiring a second mention in one blessed section
  // would fail honest records.
  const mentioned = new Set(
    input.methodologyText.match(RUN_ID_PATTERN) ?? undefined,
  );

  const undispositioned = input.runIds
    .filter((id) => {
      const timestamp = timestampOf(id);
      return timestamp !== null && timestamp > standingTimestamp;
    })
    .filter((id) => !mentioned.has(id))
    .sort();

  const newerRuns = input.runIds.filter((id) => {
    const timestamp = timestampOf(id);
    return timestamp !== null && timestamp > standingTimestamp;
  }).length;

  return undispositioned.length > 0
    ? { kind: 'undispositioned', standingPoint, runs: undispositioned }
    : { kind: 'ok', standingPoint, newerRuns };
}
