import {
  createHarnessSession,
  runFixtureTurn,
  seedScratchAdventure,
  teardownScratchAdventure,
} from '../eval/harness-runner';

import type { RunEvalDeps } from './eval-run.core';

/**
 * The real wiring — deliberately its own file, separate from
 * `eval-run.core.ts`, for the same reason `eval/turn-result.ts` is split
 * from `eval/harness-runner.ts`: `harness-runner.ts` imports `AppModule`,
 * whose `@Module()` decorator eagerly runs `ConfigModule.forRoot()`'s env
 * validation the moment the file is loaded — not lazily, not only when a
 * Nest DI container is actually instantiated. `eval-run.spec.ts` imports
 * `runEval` from `eval-run.core.ts` for its stub-deps unit tests and must
 * never trigger that validation just by doing so. Only the real CLI
 * (`eval-run.ts`) and the integration test (`eval-run.spec-int.ts`) import
 * this file.
 *
 * A dynamic `import()` inside `eval-run.core.ts` was tried instead of this
 * split and doesn't work: TypeScript's `nodenext` module resolution
 * requires an explicit extension on a dynamic import's relative specifier,
 * but `@swc-node/register` — required for the CLI's decorator-metadata
 * support (see `eval-run.ts`'s header) — resolves dynamic imports via
 * Node's CJS `require()`, which looks for a literal `harness-runner.js`
 * file that doesn't exist. No single specifier satisfies both. A real file
 * split, not a lazy import, is what `turn-result.ts` already does for this
 * exact hazard, and it sidesteps the conflict entirely.
 */
export function defaultRunEvalDeps(): RunEvalDeps {
  return {
    turnExecutor: {
      seed: seedScratchAdventure,
      runTurn: runFixtureTurn,
      teardown: teardownScratchAdventure,
    },
    harnessSessionFactory: createHarnessSession,
    clock: () => new Date(),
  };
}
