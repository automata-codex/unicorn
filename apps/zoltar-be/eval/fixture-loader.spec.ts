import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadFixtures } from './fixture-loader';
import { FIXTURE_SCHEMA_VERSION } from './fixture.schema';

import type { EvalFixture } from './fixture.schema';

const SEEDED_STATE = {
  campaignState: {},
  gmContextBlob: {},
  pendingCanon: [],
  messages: [],
  pendingDiceRequests: [],
  capturedAt: '2026-07-15T00:00:00.000Z',
};

function fixture(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    id: 'turn19-out-of-order-resolution',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    sourceAdventureId: '00000000-0000-0000-0000-000000000001',
    sourceSequenceNumber: 19,
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    seededState: SEEDED_STATE,
    playerInput: { type: 'message', content: 'I fire at the xenomorph.' },
    assertion: {
      mode: 'structural',
      check: 'no damage roll before to-hit roll resolves',
    },
    ...overrides,
  };
}

describe('loadFixtures', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-fixtures-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads every valid fixture file in the directory', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(fixture({ id: 'a' })));
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify(
        fixture({
          id: 'b',
          tag: 'HIDDEN-INFO-LEAK',
          assertion: {
            mode: 'judged',
            rubric: 'HIDDEN-INFO-LEAK',
            facts: { perceptionBoundary: 'airlock only' },
          },
        }),
      ),
    );

    const { fixtures, errors } = await loadFixtures(dir);

    expect(errors).toEqual([]);
    expect(fixtures.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('ignores non-JSON files in the directory', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(fixture({ id: 'a' })));
    writeFileSync(join(dir, 'README.md'), '# not a fixture');

    const { fixtures, errors } = await loadFixtures(dir);

    expect(errors).toEqual([]);
    expect(fixtures.map((f) => f.id)).toEqual(['a']);
  });

  it('collects errors for malformed JSON without aborting the rest of the load', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(fixture({ id: 'a' })));
    writeFileSync(join(dir, 'broken.json'), '{ not valid json');

    const { fixtures, errors } = await loadFixtures(dir);

    expect(fixtures.map((f) => f.id)).toEqual(['a']);
    expect(errors).toHaveLength(1);
    expect(errors[0].filename).toBe('broken.json');
    expect(errors[0].issues[0]).toMatch(/invalid JSON/);
  });

  it('collects errors for JSON that fails schema validation, keyed by filename', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(fixture({ id: 'a' })));
    writeFileSync(
      join(dir, 'invalid-shape.json'),
      JSON.stringify({ hello: 'world' }),
    );

    const { fixtures, errors } = await loadFixtures(dir);

    expect(fixtures.map((f) => f.id)).toEqual(['a']);
    expect(errors).toHaveLength(1);
    expect(errors[0].filename).toBe('invalid-shape.json');
    expect(errors[0].issues.length).toBeGreaterThan(0);
  });

  it('filters by tag when opts.tags is given', async () => {
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify(fixture({ id: 'a', tag: 'OUT-OF-ORDER-RESOLUTION' })),
    );
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify(
        fixture({
          id: 'b',
          tag: 'UNSURFACED-CHECK',
          assertion: {
            mode: 'judged',
            rubric: 'UNSURFACED-CHECK',
            facts: {},
          },
        }),
      ),
    );

    const { fixtures } = await loadFixtures(dir, {
      tags: ['UNSURFACED-CHECK'],
    });

    expect(fixtures.map((f) => f.id)).toEqual(['b']);
  });

  it('returns an empty result for an empty directory, without erroring', async () => {
    const { fixtures, errors } = await loadFixtures(dir);

    expect(fixtures).toEqual([]);
    expect(errors).toEqual([]);
  });
});
