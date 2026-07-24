import type * as schema from '../src/db/schema';
import type {
  SendMessageResult,
  SessionService,
} from '../src/session/session.service';

/**
 * The full row set a structural or judged checker needs to inspect.
 *
 * Deliberately its own file, separate from `harness-runner.ts`: this type
 * (and `getWinningResponseEvent` below) needs to be importable by checkers
 * and the judge without pulling in `harness-runner.ts`'s own imports —
 * `AppModule`, `SessionService`, `@nestjs/testing` — which eagerly run
 * `ConfigModule.forRoot()`'s env validation on module load (see
 * `config.module.ts`), not lazily at bootstrap. A unit-test spec file that
 * only needs `getWinningResponseEvent` has no business triggering that
 * validation just by importing it; a plain unit-test run's `process.env`
 * has none of the real secrets `validateEnv` requires, and the resulting
 * unhandled rejection fails CI even though no test actually exercised
 * anything Nest-related. Every import in this file is `import type`
 * specifically so this module can never carry runtime side effects.
 */
export interface TurnExecutionResult {
  gameEvents: (typeof schema.gameEvents.$inferSelect)[];
  /** The turn's telemetry row, if the turn reached `applyTurnAtomic` (the
   * `diceResult` path without auto-advance never writes one). */
  telemetry: typeof schema.adventureTelemetry.$inferSelect | null;
  pendingCanon: (typeof schema.pendingCanon.$inferSelect)[];
  campaignState: Record<string, unknown>;
  diceRequests: (typeof schema.diceRequests.$inferSelect)[];
  /** Whatever `SessionService`'s own call returned, for debugging/report detail. */
  serviceResult:
    | { kind: 'message'; result: SendMessageResult }
    | {
        kind: 'diceResult';
        result: Awaited<ReturnType<SessionService['submitDiceResult']>>;
      };
}

/**
 * The `gm_response`/`correction` event whose `playerText`/`gmUpdates` is
 * what actually reached the player this turn: the correction's, if a
 * correction fired (`writeTurnEvents` always writes it immediately after
 * the original, before `state_update`, so the higher-sequence one of the
 * two is always the winner), otherwise the original `gm_response`'s.
 * Shared by `NARRATING-PAST-A-BLOCK` and the judge call — both need "the
 * text the player actually saw," not the (possibly-superseded) original.
 */
export function getWinningResponseEvent(
  result: TurnExecutionResult,
): typeof schema.gameEvents.$inferSelect | undefined {
  return result.gameEvents
    .filter(
      (e) => e.eventType === 'gm_response' || e.eventType === 'correction',
    )
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
}
