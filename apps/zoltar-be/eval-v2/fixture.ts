import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The fixture files are the old harness's (`eval/fixtures/*.json`). This
 * schema reads only what a replay uses and ignores the rest — `tag`,
 * `applicability`, `assertion` and friends belong to the old harness's
 * checkers. It deliberately does not import `eval/fixture.schema.ts`.
 */
const FIXTURES_DIR = join(__dirname, '..', 'eval', 'fixtures');

/**
 * Constructed cases: a captured fixture edited by hand to ask something the
 * session never did. They live here and not in `eval/fixtures/` because the
 * old harness computes its corpus version from that directory. `cases.ts`
 * says what each one was made from and what was changed.
 */
const CONSTRUCTED_DIR = join(__dirname, 'constructed');

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

  // Capture folds the player message that triggers the turn into the seeded
  // history (`src/replay/reconstruct-state.ts` step 5), and the replay sends
  // `playerInput.content` as that turn's input. `seedScratch` drops the
  // seeded copy so the Warden sees the message once; a fixture that does not
  // end this way has nothing safe to drop, so it is refused here.
  const { playerInput, seededState } = result.data;
  const last = seededState.messages.at(-1);
  if (last?.role !== 'player' || last.content !== playerInput.content) {
    throw new Error(
      `fixture "${label}" is not replayable: the last seeded message must be the player message in playerInput.content`,
    );
  }
  return result.data;
}

export function loadFixture(id: string): Fixture {
  const captured = join(FIXTURES_DIR, `${id}.json`);
  const constructed = join(CONSTRUCTED_DIR, `${id}.json`);
  if (existsSync(captured) && existsSync(constructed)) {
    throw new Error(
      `fixture "${id}" exists as both a captured and a constructed case; ids must be unique`,
    );
  }
  const path = existsSync(constructed) ? constructed : captured;
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
