/**
 * M7.4 eval:harness CLI — replays fixed, pre-seeded turns through the real
 * turn pipeline under a given Warden prompt variant, and asserts whether
 * each turn's known failure mode recurs.
 *
 * *** Hits a real database and makes real, token-costing Anthropic calls
 * for most fixtures. *** Not CI-safe, not free to run repeatedly — a
 * manually-invoked local tool, same status as the M7.1 report generator
 * (spec "Out of Scope: CI integration").
 *
 * **Not run via plain `tsx`, unlike every other script in this directory.**
 * This is the only script that bootstraps a real NestJS DI container
 * (`eval/harness-runner.ts`'s `createHarnessSession`), and `tsx` (esbuild)
 * does not emit the `design:paramtypes` decorator metadata Nest's
 * constructor injection relies on — every `@Injectable()` silently receives
 * `undefined` for its dependencies instead. `@swc-node/register` does emit
 * it correctly (confirmed empirically), so this runs via plain `node` with
 * that register hook instead. See `npm run eval:harness` / the `task
 * eval:harness` wrapper below — don't invoke this file directly via `tsx`.
 *
 * Usage:
 *   node -r @swc-node/register -r reflect-metadata --env-file=.env \
 *     scripts/eval-harness.ts \
 *     --fixtures apps/zoltar-be/eval/fixtures/ \
 *     --tag OUT-OF-ORDER-RESOLUTION,HIDDEN-INFO-LEAK \
 *     --prompt-variant mothership-m7-candidate-1.txt \
 *     --output eval-reports/my-run.md \
 *     [--keep-scratch]
 *
 * Or, much simpler, via the task wrapper (which bakes in the flags above):
 *   task eval:harness -- --fixtures ... --tag ... --prompt-variant ... --output ...
 *
 * --prompt-variant must already be a filename present under
 * `src/wardens/prompts/` — this CLI doesn't deploy prompt files, only
 * selects among ones already there (via `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP`,
 * not the bare `WARDEN_PROMPT_OVERRIDE` the spec's own example implies —
 * see the implementation plan's pre-flight note). Omit it to run whatever
 * `WardenPromptsService` selects by default (highest-versioned prompt file).
 *
 * --output writes the rendered report to the given path (creating parent
 * directories as needed); prints to stdout if omitted. This deviates from
 * the spec's illustrative `--output report` example — "report" there reads
 * as a placeholder value, not a literal keyword any convention in this repo
 * recognizes (playtest-review.ts's own default is a real directory path,
 * `playtest-reports/`, never the bare word "report") — pass an explicit
 * path instead.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { failureModeTagSchema } from '../eval/fixture.schema';

import { runHarness } from './eval-harness.core';

import type { FailureModeTag } from '../eval/fixture.schema';

interface CliArgs {
  fixturesDir: string;
  tags?: FailureModeTag[];
  promptVariant?: string;
  output?: string;
  keepScratch: boolean;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      fixtures: { type: 'string' },
      tag: { type: 'string' },
      'prompt-variant': { type: 'string' },
      output: { type: 'string' },
      'keep-scratch': { type: 'boolean', default: false },
    },
  });

  if (typeof values.fixtures !== 'string' || values.fixtures.length === 0) {
    throw new UsageError(
      'missing --fixtures <dir>. Usage: eval-harness --fixtures <dir> ' +
        '[--tag <tag1,tag2,...>] [--prompt-variant <filename>] ' +
        '[--output <path>] [--keep-scratch]',
    );
  }

  let tags: FailureModeTag[] | undefined;
  if (typeof values.tag === 'string') {
    tags = values.tag.split(',').map((raw) => {
      const trimmed = raw.trim();
      const result = failureModeTagSchema.safeParse(trimmed);
      if (!result.success) {
        throw new UsageError(
          `--tag "${trimmed}" is not a known failure mode tag. Valid tags: ` +
            failureModeTagSchema.options.join(', '),
        );
      }
      return result.data;
    });
  }

  return {
    fixturesDir: values.fixtures,
    tags,
    promptVariant:
      typeof values['prompt-variant'] === 'string'
        ? values['prompt-variant']
        : undefined,
    output: typeof values.output === 'string' ? values.output : undefined,
    keepScratch: values['keep-scratch'] === true,
  };
}

async function main(): Promise<number> {
  let cli: CliArgs;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const { report, results, loadErrors } = await runHarness({
    fixturesDir: cli.fixturesDir,
    tags: cli.tags,
    promptVariant: cli.promptVariant,
    keepScratch: cli.keepScratch,
  });

  for (const loadError of loadErrors) {
    process.stderr.write(`warning: ${loadError.message}\n`);
  }

  if (cli.output) {
    await mkdir(dirname(cli.output), { recursive: true });
    await writeFile(cli.output, report);
    process.stdout.write(`report written to ${cli.output}\n`);
  } else {
    process.stdout.write(report);
  }

  const anyFailed = results.some((r) => !r.passed);
  const anyLoadErrors = loadErrors.length > 0;
  return anyFailed || anyLoadErrors ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
