/**
 * Vitest `setupFiles` entry for the integration config — runs and completes
 * *before* a test file's own module graph is imported, which matters for
 * exactly one reason: `ConfigModule` (`src/config/config.module.ts`) wraps
 * `NestConfigModule.forRoot({isGlobal: true, validate: validateEnv})` as a
 * static `@Module({imports: [...]})` decorator argument. That decorator
 * evaluates exactly once, the first time Node imports `config.module.ts` —
 * not once per `Test.createTestingModule().compile()` call. Since ES
 * imports are hoisted before any of an importing file's own top-level code
 * runs, a spec-int file that does `process.env.DATABASE_URL = ...` at its
 * own top level (after already importing something that transitively pulls
 * in `AppModule`/`ConfigModule`) is *always too late* — `ConfigService`
 * ends up serving whatever `DATABASE_URL` was ambient at that first import,
 * silently pointing a full-`AppModule` bootstrap (`eval/harness-runner.ts`'s
 * `createHarnessSession`) at the real dev database instead of `zoltar_test`.
 * (Discovered the hard way while building Part 7's `eval-harness.spec-int.ts` —
 * confirmed the same bug was already present in Part 3's
 * `harness-runner.spec-int.ts`, silently seeding/tearing down scratch
 * campaigns against the real dev DB the whole time.)
 *
 * Fix: set `DATABASE_URL` here, in a file Vitest guarantees runs before any
 * test file (and therefore before `AppModule` is ever imported) — not
 * inside the test files themselves.
 */
import { getTestDatabaseUrl } from './db-test-helper';

try {
  process.loadEnvFile();
} catch {
  // No .env file found (e.g. CI without the repo-root symlink) — rely on
  // whatever's already in the ambient environment.
}

process.env.DATABASE_URL = getTestDatabaseUrl();
