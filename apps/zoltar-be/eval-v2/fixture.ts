import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The fixture files are the old harness's (`eval/fixtures/*.json`). This
 * schema reads only what a replay uses and ignores the rest — `tag`,
 * `applicability`, `assertion` and friends belong to the old harness's
 * checkers. It deliberately does not import `eval/fixture.schema.ts`.
 */
const FIXTURES_DIR = join(__dirname, '..', 'eval', 'fixtures');

const messageRowSchema = z.object({
  role: z.enum(['player', 'gm', 'system']),
  content: z.string(),
  createdAt: z.string(),
});

const pendingCanonRowSchema = z.object({
  summary: z.string(),
  context: z.string(),
  status: z.enum(['pending', 'promoted', 'discarded']),
  sequenceNumber: z.number().int().nullable().optional(),
});

export const fixtureSchema = z.object({
  id: z.string().min(1),
  // Dice-result turns go through a different SessionService method and need
  // a seeded dice request. No case needs that yet, so they are refused here
  // rather than half-supported.
  playerInput: z.object({
    type: z.literal('message', {
      errorMap: () => ({
        message:
          'only "message" turns are supported; dice-result cases are not',
      }),
    }),
    content: z.string().min(1),
  }),
  seededState: z.object({
    // Left loose: the app validates both when it reads them back.
    campaignState: z.record(z.unknown()),
    gmContextBlob: z
      .object({
        // The first id is the one seeded into `character_sheet`. Without it
        // the turn runs with actingEntityId validation switched off.
        playerEntityIds: z.array(z.string().min(1)).min(1),
      })
      .passthrough(),
    messages: z.array(messageRowSchema),
    pendingCanon: z.array(pendingCanonRowSchema),
    pendingDiceRequests: z
      .array(z.unknown())
      .max(0, 'fixtures with a pending dice request are not supported'),
  }),
});

export type Fixture = z.infer<typeof fixtureSchema>;

export function parseFixture(raw: unknown, label: string): Fixture {
  const result = fixtureSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`fixture "${label}" is not replayable: ${issues}`);
  }
  return result.data;
}

export function loadFixture(id: string): Fixture {
  const path = join(FIXTURES_DIR, `${id}.json`);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`fixture "${id}" not found at ${path}`);
  }
  const fixture = parseFixture(JSON.parse(text), id);
  if (fixture.id !== id) {
    throw new Error(
      `fixture file "${id}.json" declares id "${fixture.id}"; they must match`,
    );
  }
  return fixture;
}
