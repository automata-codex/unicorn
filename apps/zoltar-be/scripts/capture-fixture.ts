#!/usr/bin/env tsx
/**
 * M7.4 capture-fixture CLI — captures a single turn's seeded state via
 * M7.3's `reconstructStateAsOfTurn` and writes it into an `EvalFixture`
 * JSON file, ready for a human to fill in `playerInput`/`assertion` by
 * hand. This tool has no other logic of its own (see `capture-fixture.core.ts`).
 *
 * Usage:
 *   npx tsx scripts/capture-fixture.ts <adventure-id> <target-sequence-number> \
 *     --tag OUT-OF-ORDER-RESOLUTION \
 *     --id turn19-out-of-order-resolution \
 *     --output apps/zoltar-be/eval/fixtures/turn19-out-of-order-resolution.json
 *
 * Or via the task wrapper:
 *   task eval:capture-fixture -- <adventure-id> <target-sequence-number> \
 *     --tag ... --id ... --output ...
 *
 * Re-running against an existing `--output` path requires `--force` —
 * re-capturing over a hand-edited fixture is always a deliberate,
 * by-hand re-authoring action (spec "Out of Scope"), never automatic.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { failureModeTagSchema } from '../eval/fixture.schema';
import * as schema from '../src/db/schema';
import { ReplayError } from '../src/replay/reconstruct-state';

import { captureFixture } from './capture-fixture.core';

import type { FailureModeTag } from '../eval/fixture.schema';

interface CliArgs {
  adventureId: string;
  targetSequenceNumber: number;
  tag: FailureModeTag;
  id: string;
  output: string;
  force: boolean;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tag: { type: 'string' },
      id: { type: 'string' },
      output: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });

  if (positionals.length < 2) {
    throw new UsageError(
      'missing arguments. Usage: capture-fixture <adventure-id> ' +
        '<target-sequence-number> --tag <tag> --id <fixture-id> --output <path> [--force]',
    );
  }
  if (positionals.length > 2) {
    throw new UsageError(
      `unexpected extra arguments: ${positionals.slice(2).join(', ')}`,
    );
  }

  const [adventureId, targetSequenceNumberRaw] = positionals;
  const targetSequenceNumber = Number(targetSequenceNumberRaw);
  if (!Number.isInteger(targetSequenceNumber) || targetSequenceNumber < 0) {
    throw new UsageError(
      `<target-sequence-number> must be a non-negative integer, got "${targetSequenceNumberRaw}"`,
    );
  }

  if (typeof values.tag !== 'string') {
    throw new UsageError('--tag is required');
  }
  const tagResult = failureModeTagSchema.safeParse(values.tag);
  if (!tagResult.success) {
    throw new UsageError(
      `--tag "${values.tag}" is not a known failure mode tag. Valid tags: ` +
        failureModeTagSchema.options.join(', '),
    );
  }

  if (typeof values.id !== 'string' || values.id.length === 0) {
    throw new UsageError('--id is required');
  }
  if (typeof values.output !== 'string' || values.output.length === 0) {
    throw new UsageError('--output is required');
  }

  return {
    adventureId,
    targetSequenceNumber,
    tag: tagResult.data,
    id: values.id,
    output: values.output,
    force: values.force === true,
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

  if (existsSync(cli.output) && !cli.force) {
    process.stderr.write(
      `${cli.output} already exists. Pass --force to overwrite an existing ` +
        'fixture file (re-capturing over a hand-edited fixture is a ' +
        'deliberate action, not something this tool does by default).\n',
    );
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  try {
    const fixture = await captureFixture(db, {
      adventureId: cli.adventureId,
      targetSequenceNumber: cli.targetSequenceNumber,
      tag: cli.tag,
      id: cli.id,
    });

    await writeFile(cli.output, `${JSON.stringify(fixture, null, 2)}\n`);

    process.stdout.write(
      `captured fixture "${cli.id}" (tag: ${cli.tag}) from adventure ` +
        `${cli.adventureId} @ sequence ${cli.targetSequenceNumber}\n` +
        `  written to: ${cli.output}\n\n` +
        'playerInput and assertion are placeholders — fill them in by hand ' +
        'before this fixture is usable by the harness.\n',
    );
    return 0;
  } catch (err) {
    if (err instanceof ReplayError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    await pool.end();
  }
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
