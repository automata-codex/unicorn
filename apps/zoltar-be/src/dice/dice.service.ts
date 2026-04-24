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

@Injectable()
export class DiceService {
  rollForGm(input: RollDiceInput): RollDiceOutput {
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
