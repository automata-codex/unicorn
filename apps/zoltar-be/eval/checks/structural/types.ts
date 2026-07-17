/**
 * One structural checker's verdict on a single fixture's `TurnExecutionResult`.
 * `actual` is the report's "Actual: ..." line — the fixture's own `check`
 * text (free text, authored per-fixture) supplies "Expected: ...", so a
 * checker never needs to restate what was expected, only what it found.
 */
export interface StructuralVerdict {
  passed: boolean;
  actual: string;
}
