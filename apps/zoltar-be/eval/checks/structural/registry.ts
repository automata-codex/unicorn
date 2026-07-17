import { checkMissingCanonCapture } from './missing-canon-capture';
import { checkNarratingPastABlock } from './narrating-past-a-block';
import { checkOutOfOrderResolution } from './out-of-order-resolution';
import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import { checkUnauditableMapping } from './unauditable-mapping';
import { checkUnsurfacedCheck } from './unsurfaced-check';

import type {
  EvalFixture,
  structuralFailureModeTags,
} from '../../fixture.schema';
import type { TurnExecutionResult } from '../../harness-runner';
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
  'OUT-OF-ORDER-RESOLUTION': (result) => checkOutOfOrderResolution(result),
  'SYSTEM-ROLLED-PLAYER-ACTION': (result) =>
    checkSystemRolledPlayerAction(result),
  'UNAUDITABLE-MAPPING': (result) => checkUnauditableMapping(result),
  'MISSING-CANON-CAPTURE': (result, fixture) =>
    checkMissingCanonCapture(result, fixture),
  'NARRATING-PAST-A-BLOCK': (result) => checkNarratingPastABlock(result),
  'UNSURFACED-CHECK': (result) => checkUnsurfacedCheck(result),
};
