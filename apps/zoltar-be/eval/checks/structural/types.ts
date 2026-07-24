/**
 * `NOT_APPLICABLE` is distinct from `PASSED`: it means the turn never
 * produced the event(s) this checker looks for at all (no dice_roll this
 * turn, no player entity identifiable, no block pending, ...) — there was
 * nothing to evaluate, not a confirmed absence of the violation. Collapsing
 * this into `PASSED` (the original design) hides a real coverage gap: a
 * fixture that goes NOT_APPLICABLE every run provides zero regression
 * coverage for the failure mode it exists to catch, while still reading as
 * "100% passing" in `report.ts`'s per-tag summary.
 */
export type StructuralOutcome = 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';

/**
 * One structural checker's verdict on a single fixture's `TurnExecutionResult`.
 * `actual` is the report's "Actual: ..." line — the fixture's own `check`
 * text (free text, authored per-fixture) supplies "Expected: ...", so a
 * checker never needs to restate what was expected, only what it found.
 */
export interface StructuralVerdict {
  outcome: StructuralOutcome;
  actual: string;
}
