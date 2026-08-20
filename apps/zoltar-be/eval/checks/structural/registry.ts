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
  // `MISSING-DELTA` and `ROLL-RESULT-INVERSION` were wired here as stubs
  // until 2026-08-20, when both became judged checks and left
  // `structuralFailureModeTags`. This record is total over that list, so
  // their entries had to go with them — the totality is what made removing
  // them from one place and not the other a type error rather than a silent
  // double registration.
};
