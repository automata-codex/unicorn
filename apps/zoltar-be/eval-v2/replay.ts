import { Test } from '@nestjs/testing';
import { asc, eq } from 'drizzle-orm';

import { AppModule } from '../src/app.module';
import { DB_TOKEN } from '../src/db/db.provider';
import * as schema from '../src/db/schema';
import { SessionService } from '../src/session/session.service';
import { WardenPromptsService } from '../src/wardens/warden-prompts.service';

import type { Db } from '../src/db/db.provider';
import type { SendMessageResult } from '../src/session/session.service';
import type { Fixture } from './fixture';

export interface App {
  db: Db;
  sessionService: SessionService;
  /** The Warden prompt every turn in this process will use. */
  prompt: { filename: string; hash: string };
  close: () => Promise<void>;
}

/**
 * Boots the real `AppModule` with nothing overridden, so a replayed turn runs
 * the same code a played turn does. Must run under a loader that emits
 * decorator metadata (`@swc-node/register`); plain `tsx` does not.
 */
export async function bootApp(): Promise<App> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  // `init()` and not only `compile()`: WardenPromptsService loads its prompt
  // files in an init hook.
  await moduleRef.init();

  const { filename, hash } = moduleRef
    .get(WardenPromptsService)
    .getSelected('mothership');

  return {
    db: moduleRef.get<Db>(DB_TOKEN),
    sessionService: moduleRef.get(SessionService),
    prompt: { filename, hash },
    close: () => moduleRef.close(),
  };
}

export interface ReplayPrereqs {
  systemId: string;
  userId: string;
}

/**
 * The two rows a scratch campaign needs and never creates: the Mothership
 * system and a user to own the campaign (the first by id).
 */
export async function findPrereqs(db: Db): Promise<ReplayPrereqs> {
  const [system] = await db
    .select({ id: schema.gameSystems.id })
    .from(schema.gameSystems)
    .where(eq(schema.gameSystems.slug, 'mothership'))
    .limit(1);
  if (!system) {
    throw new Error(
      "no game_system row with slug 'mothership' — seed the system first.",
    );
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .orderBy(asc(schema.users.id))
    .limit(1);
  if (!user) {
    throw new Error('no user row — create a user to own scratch campaigns.');
  }

  return { systemId: system.id, userId: user.id };
}

export interface Scratch {
  campaignId: string;
  adventureId: string;
  userId: string;
}

/**
 * Writes a fixture's saved state into a new campaign and adventure, ready
 * for one turn. `name` becomes the campaign name, so leftovers from a
 * crashed run can be found by hand.
 */
export async function seedScratch(
  db: Db,
  fixture: Fixture,
  prereqs: ReplayPrereqs,
  name: string,
): Promise<Scratch> {
  const { campaignState, gmContextBlob, messages, pendingCanon } =
    fixture.seededState;

  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(schema.campaigns)
      .values({
        systemId: prereqs.systemId,
        name,
        visibility: 'private',
        diceMode: 'soft_accountability',
      })
      .returning();

    await tx.insert(schema.campaignMembers).values({
      campaignId: campaign.id,
      userId: prereqs.userId,
      role: 'owner',
    });

    await tx.insert(schema.campaignStates).values({
      campaignId: campaign.id,
      system: 'mothership',
      data: campaignState,
    });

    const [adventure] = await tx
      .insert(schema.adventures)
      .values({
        campaignId: campaign.id,
        callerId: prereqs.userId,
        status: 'ready',
      })
      .returning();

    await tx.insert(schema.gmContexts).values({
      adventureId: adventure.id,
      blob: gmContextBlob,
    });

    // `sendMessage` takes player entity ids from this table and overwrites
    // the blob's list with them. No sheet means an empty list, which switches
    // off actingEntityId validation — a path production does not take.
    await tx.insert(schema.characterSheets).values({
      campaignId: campaign.id,
      userId: prereqs.userId,
      system: 'mothership',
      data: { entityId: gmContextBlob.playerEntityIds[0] },
    });

    if (messages.length > 0) {
      await tx.insert(schema.messages).values(
        messages.map((m) => ({
          adventureId: adventure.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.createdAt),
        })),
      );
    }

    if (pendingCanon.length > 0) {
      await tx.insert(schema.pendingCanon).values(
        pendingCanon.map((c) => ({
          adventureId: adventure.id,
          summary: c.summary,
          context: c.context,
          status: c.status,
          sequenceNumber: c.sequenceNumber ?? null,
        })),
      );
    }

    return {
      campaignId: campaign.id,
      adventureId: adventure.id,
      userId: prereqs.userId,
    };
  });
}

/** Deletes the scratch campaign; cascades remove everything under it. */
export async function teardownScratch(
  db: Db,
  campaignId: string,
): Promise<void> {
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
}

/** One real turn: real prompt, real tool loop, real Anthropic call. */
export function runTurn(
  sessionService: SessionService,
  fixture: Fixture,
  scratch: Scratch,
): Promise<SendMessageResult> {
  return sessionService.sendMessage({
    adventureId: scratch.adventureId,
    campaignId: scratch.campaignId,
    playerUserId: scratch.userId,
    playerMessage: fixture.playerInput.content,
  });
}
