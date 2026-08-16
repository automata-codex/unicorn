import {
  type MothershipCharacterSheet,
  MothershipCharacterSheetSchema,
  type MothershipClass,
} from '@uv/game-systems';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import { CampaignRepository } from '../campaign/campaign.repository';
import { CampaignService } from '../campaign/campaign.service';
import * as schema from '../db/schema';

import { CharacterRepository } from './character.repository';
import { CharacterService } from './character.service';

let service: CharacterService;
let campaignRepo: CampaignRepository;

beforeAll(async () => {
  await setupTestDb();
  const db = getTestDb() as never;
  campaignRepo = new CampaignRepository(db);
  service = new CharacterService(
    new CharacterRepository(db),
    new CampaignService(campaignRepo) as never,
    campaignRepo,
  );
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedCampaign(): Promise<string> {
  const db = getTestDb();
  const [system] = await db
    .insert(schema.gameSystems)
    .values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .returning();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: system.id,
      name: 'Test',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db.insert(schema.users).values({ id: 'u1', email: 'a@x.test' });
  await db.insert(schema.campaignMembers).values({
    campaignId: campaign.id,
    userId: 'u1',
    role: 'owner',
  });
  await campaignRepo.insertState({
    campaignId: campaign.id,
    system: 'mothership',
    data: {
      schemaVersion: 1,
      resourcePools: {},
      characterState: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
  });
  return campaign.id;
}

/** Every roll is [3, 4] (sum 7) except maxHp, which is [6]. */
const ROLLS = {
  strength: [3, 4],
  speed: [3, 4],
  intellect: [3, 4],
  combat: [3, 4],
  sanity: [3, 4],
  fear: [3, 4],
  body: [3, 4],
  maxHp: [6],
  credits: [3, 4],
  trinket: [42],
  patch: [17],
};

function sheetFor(
  cls: MothershipClass,
  adjustedStat?: 'strength' | 'speed' | 'intellect' | 'combat',
): MothershipCharacterSheet {
  return {
    entityId: 'vasquez',
    name: 'Vasquez',
    class: cls,
    creationRolls: ROLLS,
    ...(adjustedStat ? { creationChoices: { adjustedStat } } : {}),
  };
}

/** The published class table (PSG "Step 3"), independent of the derivation. */
const CLASS_TABLE: Record<
  MothershipClass,
  {
    stats: Record<string, number>;
    saves: Record<string, number>;
    chosen: number;
    wounds: number;
  }
> = {
  marine: {
    stats: { combat: 10 },
    saves: { body: 10, fear: 20 },
    chosen: 0,
    wounds: 3,
  },
  android: {
    stats: { intellect: 20 },
    saves: { fear: 60 },
    chosen: -10,
    wounds: 3,
  },
  scientist: {
    stats: { intellect: 10 },
    saves: { sanity: 30 },
    chosen: 5,
    wounds: 2,
  },
  teamster: {
    stats: { strength: 5, speed: 5, intellect: 5, combat: 5 },
    saves: { sanity: 10, fear: 10, body: 10 },
    chosen: 0,
    wounds: 2,
  },
};

async function readPools(
  campaignId: string,
): Promise<Record<string, { current: number; max: number | null }>> {
  const db = getTestDb();
  const [row] = await db
    .select()
    .from(schema.campaignStates)
    .where(eq(schema.campaignStates.campaignId, campaignId));
  return (
    row.data as {
      resourcePools: Record<
        string,
        Record<string, { current: number; max: number | null }>
      >;
    }
  ).resourcePools.vasquez;
}

describe('CharacterService.create (integration) — starting ceilings reconcile', () => {
  // The milestone's acceptance criterion, end to end: create a character of
  // each class through the service and require every seeded ceiling to equal
  // the creation rolls plus the published class arithmetic. Part 2 asserts the
  // same thing against the pure derivation; this asserts it against what
  // actually reaches `campaign_state`.
  const cases: Array<[MothershipClass, 'strength' | 'intellect' | undefined]> =
    [
      ['marine', undefined],
      ['teamster', undefined],
      ['android', 'strength'],
      ['android', 'intellect'],
      ['scientist', 'strength'],
      ['scientist', 'intellect'],
    ];

  for (const [cls, chosen] of cases) {
    const label = chosen ? `${cls} (chose ${chosen})` : cls;

    it(`seeds reconcilable pools for a ${label}`, async () => {
      const campaignId = await seedCampaign();
      const sheet = sheetFor(cls, chosen);

      await service.create(campaignId, 'u1', sheet);

      const pools = await readPools(campaignId);
      const table = CLASS_TABLE[cls];
      const rolled = (key: keyof typeof ROLLS) =>
        ROLLS[key].reduce((a, b) => a + b, 0);

      for (const stat of ['strength', 'speed', 'intellect', 'combat']) {
        const expected =
          rolled(stat as keyof typeof ROLLS) +
          25 +
          (table.stats[stat] ?? 0) +
          (chosen === stat ? table.chosen : 0);
        expect(pools[stat].max, stat).toBe(expected);
        expect(pools[stat].current, stat).toBe(expected);
      }

      for (const save of ['sanity', 'fear', 'body']) {
        const expected =
          rolled(save as keyof typeof ROLLS) + 10 + (table.saves[save] ?? 0);
        expect(pools[save].max, save).toBe(expected);
      }

      expect(pools.hp.max).toBe(rolled('maxHp') + 10);
      expect(pools.hp.current).toBe(pools.hp.max);
      expect(pools.wounds).toEqual({ current: 0, max: table.wounds });
      expect(pools.stress).toEqual({ current: 2, max: null });
      expect(pools.credits.current).toBe(rolled('credits') * 10);
    });
  }

  it('seeds fresh character state alongside the pools', async () => {
    const campaignId = await seedCampaign();
    await service.create(campaignId, 'u1', sheetFor('marine'));

    const db = getTestDb();
    const [row] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    const state = (row.data as { characterState: Record<string, unknown> })
      .characterState;
    expect(state.vasquez).toEqual({
      conditions: [],
      skills: [],
      equipment: [],
      wornArmor: null,
      minimumStress: 2,
      bleeding: 0,
      pendingDeathSave: null,
    });
  });

  it('removes both the pools and the state when the sheet is deleted', async () => {
    const campaignId = await seedCampaign();
    await service.create(campaignId, 'u1', sheetFor('marine'));

    await service.delete(campaignId, 'u1');

    const db = getTestDb();
    const [row] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    const data = row.data as {
      resourcePools: Record<string, unknown>;
      characterState: Record<string, unknown>;
    };
    expect(data.resourcePools).toEqual({});
    expect(data.characterState).toEqual({});
  });
});

describe('the sheet the creation form produces', () => {
  // The form builds its payload from the same shapes; this pins the contract
  // it has to satisfy, so a form change that drops `creationChoices` fails
  // here rather than at the API boundary.
  it('accepts a sheet from every class the form can produce', () => {
    for (const [cls, chosen] of [
      ['marine', undefined],
      ['teamster', undefined],
      ['android', 'speed'],
      ['scientist', 'combat'],
    ] as const) {
      expect(() =>
        MothershipCharacterSheetSchema.parse(sheetFor(cls, chosen as never)),
      ).not.toThrow();
    }
  });

  it('rejects an Android sheet that forgot to record the chosen Stat', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse(sheetFor('android')),
    ).toThrow();
  });
});
