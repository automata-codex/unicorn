import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(__dirname, '..');

/**
 * Fake but schema-valid — satisfies `validateEnv`'s shape checks
 * (`src/config/env.schema.ts`) without needing real connectivity or a real
 * API key. Every test in this file only checks that a module graph
 * *resolves* under a given loader; none of them ever reach a real DB or
 * Anthropic call.
 */
const FAKE_ENV = {
  ...process.env,
  DATABASE_URL: 'postgresql://fake:fake@localhost:5432/fake',
  ANTHROPIC_API_KEY: 'fake-key-for-module-resolution-smoke-test',
  VOYAGE_API_KEY: 'fake-key-for-module-resolution-smoke-test',
};

/**
 * `tsc --noEmit` and Vitest's own transform (`unplugin-swc`, ESM mode) both
 * agree a module resolves — and neither one is the loader the real CLI
 * scripts actually run under. `eval-run.ts`/`eval-judge-variance.ts` need
 * `@swc-node/register` specifically for NestJS decorator metadata (see
 * `eval-run.ts`'s header comment); the rest run under plain `tsx`. A
 * relative specifier can satisfy `tsc`'s `nodenext` module resolution and
 * Vitest's transform while still failing under `@swc-node/register`'s CJS
 * `require()` resolution — that happened once already (a dynamic
 * `import('../eval/harness-runner.js')` needed the `.js` extension to
 * satisfy `tsc`, but `@swc-node/register` went looking for a literal,
 * nonexistent `harness-runner.js` file). These tests spawn each script's
 * *real* invocation to catch that class of bug directly, since no amount
 * of `tsc`/Vitest agreement rules it out.
 */
describe('CLI entrypoint loading — exercises the real production loader, not Vitest’s', () => {
  it('eval-run.default-deps.ts resolves its harness-runner.ts import under @swc-node/register', () => {
    // `eval-run.core.ts` deliberately never value-imports `harness-runner.ts`
    // (see its guard test in `eval-run.spec.ts`) — the real wiring lives
    // here instead, and only the CLI needs it to actually resolve at
    // runtime. Requiring it is enough to prove the import resolves; it
    // doesn't need to be called.
    const stdout = execFileSync(
      'node',
      [
        '-r',
        '@swc-node/register',
        '-r',
        'reflect-metadata',
        '-e',
        "require('./scripts/eval-run.default-deps.ts'); process.stdout.write('LOADED_OK');",
      ],
      { cwd: PACKAGE_ROOT, encoding: 'utf-8', env: FAKE_ENV },
    );
    expect(stdout).toContain('LOADED_OK');
  });

  it('eval-run.ts (the full CLI) loads and reaches its usage error, not a module-resolution crash', () => {
    let stderr = '';
    let status: number | null = 0;
    try {
      execFileSync(
        'node',
        [
          '-r',
          '@swc-node/register',
          '-r',
          'reflect-metadata',
          'scripts/eval-run.ts',
        ],
        {
          cwd: PACKAGE_ROOT,
          encoding: 'utf-8',
          env: FAKE_ENV,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err) {
      const failure = err as { status: number | null; stderr: string };
      status = failure.status;
      stderr = failure.stderr;
    }
    expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/missing --prompt/);
    expect(status).toBe(2);
  });

  it('eval-run.ts reaches defaultRunEvalDeps() with valid args and gets past it cleanly', () => {
    // The previous test can't catch a bug inside `defaultRunEvalDeps()`
    // specifically — argument parsing throws its `UsageError` and returns
    // *before* `runEval(..., defaultRunEvalDeps())` is ever reached (the
    // exact reason this test suite needed a second attempt: the first
    // version of this file made the same mistake). This one supplies
    // just-valid-enough args to get past `parseCliArgs`, so
    // `defaultRunEvalDeps()` actually evaluates — that's where the real
    // module-resolution bug lived. `ZOLTAR_EVAL_ROOT` is deliberately left
    // unset so `runEval` fails immediately afterward, on the very next
    // line (`resolveEvalRoot()`), with no DB or Anthropic call in between:
    // a "Cannot find module" error means `defaultRunEvalDeps()` itself
    // never resolved; a "ZOLTAR_EVAL_ROOT" error means it did.
    const envWithoutEvalRoot: Record<string, string | undefined> = {
      ...FAKE_ENV,
    };
    delete envWithoutEvalRoot.ZOLTAR_EVAL_ROOT;

    let stderr = '';
    let status: number | null = 0;
    try {
      execFileSync(
        'node',
        [
          '-r',
          '@swc-node/register',
          '-r',
          'reflect-metadata',
          'scripts/eval-run.ts',
          '--prompt',
          'fake-prompt.txt',
          '--model',
          'claude-sonnet-4-6',
          '--reps',
          '1',
        ],
        {
          cwd: PACKAGE_ROOT,
          encoding: 'utf-8',
          env: envWithoutEvalRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err) {
      const failure = err as { status: number | null; stderr: string };
      status = failure.status;
      stderr = failure.stderr;
    }
    expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/ZOLTAR_EVAL_ROOT/);
    expect(status).not.toBe(0);
  });
  it('eval-rescore.ts loads under plain tsx and reaches its usage error', () => {
    // `eval-rescore.ts` runs under tsx, not @swc-node/register — it never
    // builds a Nest DI container. Same class of bug is still possible
    // (a relative specifier that satisfies tsc and Vitest but not the real
    // loader), so it gets the same smoke test.
    let stderr = '';
    let status: number | null = 0;
    try {
      execFileSync('npx', ['tsx', 'scripts/eval-rescore.ts'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf-8',
        env: FAKE_ENV,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const failure = err as { status: number | null; stderr: string };
      status = failure.status;
      stderr = failure.stderr;
    }
    expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/expected exactly one positional argument/);
    expect(status).toBe(2);
  });
});
