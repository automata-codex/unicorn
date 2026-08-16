/**
 * One-off CLI: re-key every eval fixture's `seededState.campaignState.resourcePools`
 * from the flat composite key to the nested owner/pool shape (M7.6 Part 1).
 *
 *   npx tsx scripts/one-off/rekey-fixture-pools.ts [--check]
 *
 * `--check` writes nothing and reports what would change — including, for the
 * unmodified case, that every fixture round-trips byte-identically. That
 * assertion is the point: `corpusVersion` hashes raw fixture bytes, so a
 * serializer that reflows anything would bump the version for fifteen files
 * this script never meant to touch.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  rekeyResourcePools,
  stringifyFixture,
} from './rekey-fixture-pools.core';

import type { ResourcePool } from '@uv/game-systems';

const FIXTURES_DIR = join(__dirname, '../../eval/fixtures');

interface FixtureShape {
  seededState: {
    campaignState: {
      resourcePools: Record<string, unknown>;
      entities: Record<string, unknown>;
    };
    gmContextBlob: { playerEntityIds?: string[] };
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const filenames = (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();

  let changed = 0;
  for (const filename of filenames) {
    const path = join(FIXTURES_DIR, filename);
    const original = await readFile(path, 'utf8');
    const fixture = JSON.parse(original) as FixtureShape;
    const state = fixture.seededState.campaignState;

    // Already nested — every value is a map of pools rather than a pool.
    const alreadyNested = Object.values(state.resourcePools).every(
      (value) =>
        typeof value === 'object' && value !== null && !('current' in value),
    );
    if (alreadyNested) {
      console.log(`${filename}: already nested, skipping`);
      continue;
    }

    const knownOwners = [
      ...(fixture.seededState.gmContextBlob.playerEntityIds ?? []),
      ...Object.keys(state.entities),
    ];
    const { pools, decisions } = rekeyResourcePools(
      state.resourcePools as Record<string, ResourcePool>,
      knownOwners,
    );
    state.resourcePools = pools;

    const next = stringifyFixture(fixture);
    if (next === original) {
      console.log(`${filename}: unchanged`);
      continue;
    }
    changed += 1;
    console.log(`${filename}:`);
    for (const line of decisions) console.log(`  ${line}`);
    if (!check) await writeFile(path, next);
  }

  console.log(
    check
      ? `\n--check: ${changed} fixture(s) would change.`
      : `\n${changed} fixture(s) rewritten.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
