import {
  deriveMothershipCharacterResourcePools,
  emptyMothershipCharacterState,
  type MothershipCampaignState,
  type MothershipCharacterSheet,
} from '@uv/game-systems';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CampaignRepository } from '../src/campaign/campaign.repository';
import { CampaignService } from '../src/campaign/campaign.service';
import { CharacterRepository } from '../src/character/character.repository';
import { CharacterService } from '../src/character/character.service';
import * as schema from '../src/db/schema';
import { vasquezSheet } from '../src/synthesis/synthesis.fixtures';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import { CloneCharacterError, cloneCharacter } from './clone-character.core';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000301';
const USER_ID = 'user-clone-owner';

const STARTING = {
  startingSkills: [{ skill: 'Military Training', tier: 'trained' as const }],
  startingEquipment: [{ item: 'Revolver', charges: 12 }],
  wornArmor: {
    item: 'Standard Battle Dress',
    apBase: 7,
    apCurrent: 7,
    destroyed: false,
    dr: 0,
    o2Remaining: null,
    features: [],
  },
};

async function seed(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.users).values({ id: USER_ID, email: 'owner@test' });
}

/** Builds a source campaign through the same services the app uses. */
async function createSource(): Promise<string> {
  const db = getTestDb();
  const campaignRepo = new CampaignRepository(db);
  const campaignService = new CampaignService(campaignRepo);
  const characterService = new CharacterService(
    new CharacterRepository(db),
    campaignService,
    campaignRepo,
  );
  const campaign = await campaignService.create(
    { name: 'Source', visibility: 'private', diceMode: 'commitment' },
    USER_ID,
  );
  await characterService.create(campaign.id, USER_ID, vasquezSheet, STARTING);
  return campaign.id;
}

/** Simulates play: damage, a used-up item, and a synthesized NPC. */
async function play(campaignId: string): Promise<void> {
  const db = getTestDb();
  const repo = new CampaignRepository(db);
  const data = (await repo.getStateData(campaignId)) as MothershipCampaignState;
  data.resourcePools.vasquez.hp.current = 3;
  data.resourcePools.vasquez.wounds.current = 1;
  data.resourcePools.burned_out_medic = { stim_supply: { current: 2, max: 6 } };
  data.characterState.vasquez.equipment = [{ item: 'Revolver', charges: 4 }];
  data.entities = {
    burned_out_medic: { status: 'alive', visible: true, revealed: true },
  };
  await db
    .update(schema.campaignStates)
    .set({ data })
    .where(eq(schema.campaignStates.campaignId, campaignId));
}

async function snapshotCreationState(campaignId: string): Promise<void> {
  const db = getTestDb();
  const repo = new CampaignRepository(db);
  const [adventure] = await db
    .insert(schema.adventures)
    .values({ campaignId, status: 'in_progress', mode: 'freeform' })
    .returning();
  await db.insert(schema.adventureSynthesisSnapshots).values({
    adventureId: adventure.id,
    gmContextSchemaVersion: 1,
    gmContextBlob: {},
    campaignStateSchemaVersion: 1,
    campaignStateData: (await repo.getStateData(campaignId)) ?? {},
  });
}

/** Makes the source's sheet look like one created before `startingLoadout`. */
async function dropStartingLoadout(campaignId: string): Promise<void> {
  const db = getTestDb();
  const [row] = await db
    .select()
    .from(schema.characterSheets)
    .where(eq(schema.characterSheets.campaignId, campaignId));
  const { startingLoadout: _dropped, ...legacy } =
    row.data as MothershipCharacterSheet;
  await db
    .update(schema.characterSheets)
    .set({ data: legacy })
    .where(eq(schema.characterSheets.campaignId, campaignId));
}

describe('cloneCharacter', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });

  it('produces exactly what character creation produces, and no adventure', async () => {
    const db = getTestDb();
    const sourceId = await createSource();

    const result = await cloneCharacter(db, {
      sourceCampaignId: sourceId,
      nameOverride: 'Clone',
    });

    expect(result.warnings).toEqual([]);
    expect(result.ownerId).toBe(USER_ID);
    expect(result.entityId).toBe('vasquez');

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, result.campaignId));
    expect(campaign.name).toBe('Clone');
    expect(campaign.diceMode).toBe('commitment');

    const [sheet] = await db
      .select()
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, result.campaignId));
    expect(sheet.data).toEqual({
      ...vasquezSheet,
      startingLoadout: {
        skills: STARTING.startingSkills,
        equipment: STARTING.startingEquipment,
        wornArmor: STARTING.wornArmor,
      },
    });

    const state = await new CampaignRepository(db).getStateData(
      result.campaignId,
    );
    expect(state?.resourcePools).toEqual(
      deriveMothershipCharacterResourcePools(vasquezSheet),
    );
    expect(state?.characterState).toEqual({
      vasquez: {
        ...emptyMothershipCharacterState(),
        skills: STARTING.startingSkills,
        equipment: STARTING.startingEquipment,
        wornArmor: STARTING.wornArmor,
      },
    });

    const adventures = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.campaignId, result.campaignId));
    expect(adventures).toEqual([]);
  });

  it('starts the character fresh and leaves the adventure behind', async () => {
    const db = getTestDb();
    const sourceId = await createSource();
    await play(sourceId);

    const result = await cloneCharacter(db, { sourceCampaignId: sourceId });

    const state = (await new CampaignRepository(db).getStateData(
      result.campaignId,
    )) as MothershipCampaignState;
    expect(state.resourcePools).toEqual(
      deriveMothershipCharacterResourcePools(vasquezSheet),
    );
    expect(state.entities).toEqual({});
    expect(result.campaignName).toMatch(/^Source \(clone \d{8}-\d{6}\)$/);
  });

  it('takes the loadout from the sheet, not from what play left', async () => {
    const db = getTestDb();
    const sourceId = await createSource();
    await snapshotCreationState(sourceId);
    await play(sourceId);

    const result = await cloneCharacter(db, { sourceCampaignId: sourceId });

    expect(result.warnings).toEqual([]);
    const state = (await new CampaignRepository(db).getStateData(
      result.campaignId,
    )) as MothershipCampaignState;
    expect(state.characterState.vasquez.equipment).toEqual(
      STARTING.startingEquipment,
    );
  });

  it('without a sheet loadout, copies equipment as play left it and warns', async () => {
    const db = getTestDb();
    const sourceId = await createSource();
    await dropStartingLoadout(sourceId);
    await snapshotCreationState(sourceId);
    await play(sourceId);

    const result = await cloneCharacter(db, { sourceCampaignId: sourceId });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/changed in play/);
    const state = (await new CampaignRepository(db).getStateData(
      result.campaignId,
    )) as MothershipCampaignState;
    expect(state.characterState.vasquez.equipment).toEqual([
      { item: 'Revolver', charges: 4 },
    ]);
  });

  it('without a sheet loadout, does not warn when the first synthesis matches', async () => {
    const db = getTestDb();
    const sourceId = await createSource();
    await dropStartingLoadout(sourceId);
    await snapshotCreationState(sourceId);

    const result = await cloneCharacter(db, { sourceCampaignId: sourceId });

    expect(result.warnings).toEqual([]);
  });

  it('without a sheet loadout, warns and starts empty when the source lost its characterState', async () => {
    const db = getTestDb();
    const sourceId = await createSource();
    await dropStartingLoadout(sourceId);
    const repo = new CampaignRepository(db);
    const data = (await repo.getStateData(sourceId)) as MothershipCampaignState;
    const { characterState: _dropped, ...withoutCharacterState } = data;
    await db
      .update(schema.campaignStates)
      .set({ data: withoutCharacterState })
      .where(eq(schema.campaignStates.campaignId, sourceId));

    const result = await cloneCharacter(db, { sourceCampaignId: sourceId });

    expect(result.warnings[0]).toMatch(/no characterState for vasquez/);
    const state = (await repo.getStateData(
      result.campaignId,
    )) as MothershipCampaignState;
    expect(state.characterState.vasquez.skills).toEqual([]);
  });

  it('refuses a campaign that does not exist', async () => {
    await expect(
      cloneCharacter(getTestDb(), {
        sourceCampaignId: '00000000-0000-0000-0000-000000000399',
      }),
    ).rejects.toBeInstanceOf(CloneCharacterError);
  });

  it('refuses a campaign with no character, and creates nothing', async () => {
    const db = getTestDb();
    const campaign = await new CampaignService(
      new CampaignRepository(db),
    ).create(
      { name: 'Empty', visibility: 'private', diceMode: 'soft_accountability' },
      USER_ID,
    );

    await expect(
      cloneCharacter(db, { sourceCampaignId: campaign.id }),
    ).rejects.toThrow(/no character sheet/);
    const campaigns = await db.select().from(schema.campaigns);
    expect(campaigns).toHaveLength(1);
  });
});
