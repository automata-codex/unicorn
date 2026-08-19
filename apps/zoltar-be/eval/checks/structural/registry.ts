import { checkCarryoverArithmetic } from './carryover-arithmetic';
import { checkMissingCanonCapture } from './missing-canon-capture';
import { checkOutOfOrderResolution } from './out-of-order-resolution';
import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import { checkToolSyntaxLeak } from './tool-syntax-leak';
import { checkUnimplemented } from './unimplemented';

import type {
  EvalFixture,
  structuralFailureModeTags,
} from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/** Derived from `structuralFailureModeTags`, not re-listed by hand — that
 * list is the single source of truth for which tags are structural. */
type StructuralTag = (typeof structuralFailureModeTags)[number];

/**
 * One checker per structural tag (spec: "Judge rubrics: one per tag, not
 * one per fixture" applies equally to structural checks). The `eval:harness`
 * CLI (Part 7) dispatches a structural fixture to its checker by `tag`.
 */
export const structuralCheckers: Record<
  StructuralTag,
  (result: TurnExecutionResult, fixture: EvalFixture) => StructuralVerdict
> = {
  'OUT-OF-ORDER-RESOLUTION': (result, fixture) =>
    checkOutOfOrderResolution(result, fixture),
  'SYSTEM-ROLLED-PLAYER-ACTION': (result, fixture) =>
    checkSystemRolledPlayerAction(result, fixture),
  'MISSING-CANON-CAPTURE': (result, fixture) =>
    checkMissingCanonCapture(result, fixture),
  'CARRYOVER-ARITHMETIC': (result, fixture) =>
    checkCarryoverArithmetic(result, fixture),
  // Takes no fixture: its subject is the narration alone, which is what
  // makes it universal rather than tag-independent.
  'TOOL-SYNTAX-LEAK': (result) => checkToolSyntaxLeak(result),
  // Stubs. They grade nothing and report `NOT_APPLICABLE` on every rep —
  // see `checkUnimplemented` for why that, and not `PASSED`. Wired here
  // rather than left out because this record is total over
  // `structuralFailureModeTags`, so a tag with no entry is a type error;
  // that totality is what will make the real checkers unmissable when they
  // land.
  'MISSING-DELTA': () => checkUnimplemented('MISSING-DELTA'),
  'ROLL-RESULT-INVERSION': () => checkUnimplemented('ROLL-RESULT-INVERSION'),
};
