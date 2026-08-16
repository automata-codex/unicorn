import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import { assertRulesIndexPopulated, EvalPreflightError } from './preflight';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedSystem(): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(schema.gameSystems)
    .values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .returning();
  return row.id;
}

describe('assertRulesIndexPopulated', () => {
  it('aborts loudly when rules_chunk is empty for the system', async () => {
    // The whole point: a run against an empty index produces numbers that look
    // fine and mean nothing, because every retrieval-dependent fixture fails
    // for infrastructure reasons indistinguishable from Warden failures.
    await seedSystem();

    await expect(
      assertRulesIndexPopulated(getTestDb() as never),
    ).rejects.toThrow(EvalPreflightError);
  });

  it('names the rulebook and the escape hatch in the message', async () => {
    await seedSystem();

    await expect(
      assertRulesIndexPopulated(getTestDb() as never),
    ).rejects.toThrow(/Wounds Table[\s\S]*--skip-preflight/);
  });

  it('passes once a chunk exists for that system', async () => {
    const systemId = await seedSystem();
    const db = getTestDb();
    await db.insert(schema.rulesChunks).values({
      systemId,
      source: 'psg.pdf',
      sectionPath: ['Combat', 'Wounds'],
      content: 'Wounds Table…',
    });

    await expect(
      assertRulesIndexPopulated(db as never),
    ).resolves.toBeUndefined();
  });

  it('counts only the requested system, not any populated one', async () => {
    // A host with some *other* system ingested must still abort for
    // Mothership — the count has to be scoped or it reports on the wrong
    // rulebook.
    const db = getTestDb();
    await seedSystem();
    const [other] = await db
      .insert(schema.gameSystems)
      .values({
        slug: 'other-system',
        name: 'Other',
        indexSource: 'user_provided',
      })
      .returning();
    await db.insert(schema.rulesChunks).values({
      systemId: other.id,
      source: 'other.pdf',
      sectionPath: ['x'],
      content: 'unrelated',
    });

    await expect(assertRulesIndexPopulated(db as never)).rejects.toThrow(
      EvalPreflightError,
    );
  });

  it('aborts when the system row itself is missing', async () => {
    await expect(
      assertRulesIndexPopulated(getTestDb() as never),
    ).rejects.toThrow(/no game_system row/);
  });
});
