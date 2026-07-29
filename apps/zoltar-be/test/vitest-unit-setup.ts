/**
 * Vitest `setupFiles` entry for the default (unit) config — the mirror
 * image of `vitest-integration-setup.ts`, for the opposite reason. Unit
 * tests are supposed to need no real secrets at all: no DB, no Anthropic
 * calls, everything stubbed. But `ConfigModule` (`src/config/config.module.ts`)
 * wraps `NestConfigModule.forRoot({isGlobal: true, validate: validateEnv})`
 * as a static `@Module()` decorator argument, which runs `validateEnv`
 * *eagerly* the moment `config.module.ts` is imported — not lazily, not
 * only when a Nest DI container is actually instantiated. Any file that
 * transitively imports `AppModule` (even just to reference a function it
 * never calls) drags that validation in.
 *
 * A developer's shell almost always has `DATABASE_URL`/`ANTHROPIC_API_KEY`/
 * `VOYAGE_API_KEY` ambiently exported (from the repo-root `.env`, sourced
 * by a shell profile) — so a "unit test" file that accidentally acquired
 * this dependency would pass locally every time and only fail in CI's
 * clean checkout, which has no `.env` at all. That's exactly what happened
 * to `scripts/eval-run.spec.ts`: it passed locally throughout development
 * and only failed once it reached CI.
 *
 * Deleting these here — before any test file's own module graph resolves —
 * makes that failure mode deterministic and local: if a unit test
 * accidentally reaches `AppModule`, it throws the same "Invalid environment
 * configuration" error on every developer's machine, not just in CI.
 */
for (const key of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'VOYAGE_API_KEY']) {
  delete process.env[key];
}
