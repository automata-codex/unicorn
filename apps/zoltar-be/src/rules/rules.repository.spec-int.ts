import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import { RulesRepository } from './rules.repository';

const DIM = 1024;

/**
 * Pad a prefix of non-zero values out to DIM with zeros. Simpler to reason
 * about than random 1024-element arrays — tests below use short prefixes that
 * make cosine similarities easy to predict.
 */
function vec(prefix: number[]): number[] {
  if (prefix.length > DIM) throw new Error('prefix exceeds vector dimension');
  return [...prefix, ...Array(DIM - prefix.length).fill(0)];
}

let repo: RulesRepository;

beforeAll(async () => {
  await setupTestDb();
  repo = new RulesRepository(getTestDb() as any);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedSystem(slug: string): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(schema.gameSystems)
    .values({ slug, name: slug, indexSource: 'user_provided' })
    .returning();
  return row.id;
}

async function seedChunk(args: {
  systemId: string;
  source: string;
  content: string;
  embedding: number[];
}): Promise<void> {
  const db = getTestDb();
  const vecLit = `[${args.embedding.join(',')}]`;
  await db.execute(sql`
    INSERT INTO rules_chunk (system_id, source, section_path, content, embedding)
    VALUES (
      ${args.systemId},
      ${args.source},
      ARRAY['root']::text[],
      ${args.content},
      ${vecLit}::vector
    )
  `);
}

describe('RulesRepository.findByCosineSimilarity (integration)', () => {
  it('returns an empty array when the index has no rows for the system (M7 default)', async () => {
    const systemId = await seedSystem('mothership');

    const results = await repo.findByCosineSimilarity({
      systemId,
      embedding: vec([1, 0, 0]),
      limit: 3,
    });

    expect(results).toEqual([]);
  });

  it('orders populated rows by decreasing cosine similarity', async () => {
    const systemId = await seedSystem('mothership');

    // Three vectors with known cosine similarities to the query [1, 0, 0, …]:
    //   A = [1, 0, 0, …] → 1.0 (exact match)
    //   B = [1, 1, 0, …] → 1 / sqrt(2) ≈ 0.707
    //   C = [0, 1, 0, …] → 0.0 (orthogonal)
    await seedChunk({
      systemId,
      source: 'A',
      content: 'chunk-A',
      embedding: vec([1, 0, 0]),
    });
    await seedChunk({
      systemId,
      source: 'B',
      content: 'chunk-B',
      embedding: vec([1, 1, 0]),
    });
    await seedChunk({
      systemId,
      source: 'C',
      content: 'chunk-C',
      embedding: vec([0, 1, 0]),
    });

    const results = await repo.findByCosineSimilarity({
      systemId,
      embedding: vec([1, 0, 0]),
      limit: 3,
    });

    expect(results.map((r) => r.source)).toEqual(['A', 'B', 'C']);
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[1].similarity).toBeCloseTo(1 / Math.SQRT2, 5);
    expect(results[2].similarity).toBeCloseTo(0, 5);
  });

  it('respects the limit', async () => {
    const systemId = await seedSystem('mothership');
    for (const src of ['A', 'B', 'C', 'D', 'E']) {
      await seedChunk({
        systemId,
        source: src,
        content: src,
        embedding: vec([1, 0, 0]),
      });
    }

    const results = await repo.findByCosineSimilarity({
      systemId,
      embedding: vec([1, 0, 0]),
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });

  it('excludes rows from other systems (system_id filter)', async () => {
    const mothershipId = await seedSystem('mothership');
    const osrId = await seedSystem('ose');

    await seedChunk({
      systemId: mothershipId,
      source: 'mothership-chunk',
      content: 'panic table',
      embedding: vec([1, 0, 0]),
    });
    await seedChunk({
      systemId: osrId,
      source: 'ose-chunk',
      content: 'saving throws',
      embedding: vec([1, 0, 0]),
    });

    const results = await repo.findByCosineSimilarity({
      systemId: mothershipId,
      embedding: vec([1, 0, 0]),
      limit: 5,
    });

    expect(results.map((r) => r.source)).toEqual(['mothership-chunk']);
  });
});
