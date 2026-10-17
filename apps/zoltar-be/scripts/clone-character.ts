#!/usr/bin/env tsx
/**
 * clone-character CLI — copies a campaign's character into a new campaign with
 * no adventure, so a synthesis or a short steered playtest can start without
 * re-running character creation. See `cloneCharacter` in
 * `clone-character.core.ts` for what is copied and what is not.
 *
 * Usage:
 *   npx tsx scripts/clone-character.ts <source-campaign-id>
 *   npx tsx scripts/clone-character.ts <source-campaign-id> --name "Addendum test 1"
 *
 * Or via the task wrapper:
 *   task playtest:clone-character -- <source-campaign-id>
 *
 * The new campaign belongs to the source character's owner.
 */

import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

import { CloneCharacterError, cloneCharacter } from './clone-character.core';

interface CliArgs {
  sourceCampaignId: string;
  nameOverride: string | null;
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
      name: { type: 'string' },
    },
  });
  if (positionals.length === 0) {
    throw new UsageError(
      'missing <source-campaign-id>. Usage: clone-character <source-campaign-id> [--name <string>]',
    );
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `unexpected extra arguments: ${positionals.slice(1).join(', ')}`,
    );
  }
  return {
    sourceCampaignId: positionals[0],
    nameOverride: typeof values.name === 'string' ? values.name : null,
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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  try {
    const result = await cloneCharacter(db, {
      sourceCampaignId: cli.sourceCampaignId,
      nameOverride: cli.nameOverride ?? undefined,
    });

    for (const w of result.warnings) {
      process.stderr.write(`warning: ${w}\n`);
    }
    process.stdout.write(
      `cloned ${result.entityId} from campaign ${cli.sourceCampaignId}\n` +
        `  campaign: ${result.campaignId} — ${result.campaignName}\n` +
        `  owner:    ${result.ownerId}\n\n` +
        `Campaign URL: ${result.campaignUrl}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof CloneCharacterError) {
      process.stderr.write(`${err.message}\n`);
      return err.exitCode;
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
