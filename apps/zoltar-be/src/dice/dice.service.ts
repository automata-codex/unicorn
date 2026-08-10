import { Injectable } from '@nestjs/common';
import { DiceNotationError, executeDiceRoll } from '@uv/game-systems';

import type { RollDiceInput, RollDiceOutput } from '../session/session.schema';

/**
 * Surfaces dice-notation errors to the session-level tool loop so they can be
 * returned to Claude as `tool_result { is_error: true }`. Keeps
 * `DiceNotationError` (from `@uv/game-systems`) out of callers that only know
 * about backend-local error types.
 */
export class DiceInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceInvocationError';
  }
}

/**
 * What this service actually needs, which is only the notation.
 *
 * Deliberately narrower than `RollDiceInput`. The tool schema also carries
 * `purpose`, `rollType`, `actingEntityId`, and `gatedByRollId` — all of them
 * bookkeeping for the audit trail and the structural checkers, none of them
 * anything a dice roller should have an opinion about. Taking the whole tool
 * input here would make every future tool-schema field a change to this
 * file's type surface for no reason; M7.5 added three at once and would have
 * done exactly that.
 */
export type GmRollRequest = Pick<RollDiceInput, 'notation'>;

/**
 * The roll itself, without the per-turn `rollId` that `roll_dice` returns.
 * That id is allocated by the tool loop, which is the only thing that knows
 * how many rolls this turn has already issued.
 */
export type GmRollResult = Omit<RollDiceOutput, 'rollId'>;

@Injectable()
export class DiceService {
  rollForGm(input: GmRollRequest): GmRollResult {
    try {
      return executeDiceRoll(input.notation);
    } catch (err) {
      if (err instanceof DiceNotationError) {
        throw new DiceInvocationError(err.message);
      }
      throw err;
    }
  }
}
