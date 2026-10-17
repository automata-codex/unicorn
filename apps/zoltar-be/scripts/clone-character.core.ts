import {
  MothershipCharacterSheetSchema,
  type MothershipCharacterState,
  MothershipCharacterStateSchema,
} from '@uv/game-systems';
import { asc, eq } from 'drizzle-orm';

import { CampaignRepository } from '../src/campaign/campaign.repository';
import { CampaignService } from '../src/campaign/campaign.service';
import { CharacterRepository } from '../src/character/character.repository';
import { CharacterService } from '../src/character/character.service';
import * as schema from '../src/db/schema';

import { timestampLabel } from './load-synthesis.core';

import type { Db } from '../src/db/db.provider';

export class CloneCharacterError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CloneCharacterError';
  }
}

export interface CloneCharacterOptions {
  sourceCampaignId: string;
  /**
   * Overrides the new campaign name. If omitted, the new name is
   * `<original campaign name> (clone <yyyymmdd-hhmmss>)`.
   */
  nameOverride?: string;
}

export interface CloneCharacterResult {
  campaignId: string;
  campaignName: string;
  ownerId: string;
  entityId: string;
  campaignUrl: string;
  warnings: string[];
}

/** The part of `characterState` that character creation takes as input. */
type CreationInputs = Pick<
  MothershipCharacterState,
  'skills' | 'equipment' | 'wornArmor'
>;

function creationInputs(state: MothershipCharacterState): CreationInputs {
  return {
    skills: state.skills,
    equipment: state.equipment,
    wornArmor: state.wornArmor,
  };
}

/**
 * Clones a campaign's character into a new campaign with no adventure, ready
 * for NEW ADVENTURE. `ADR-0053` allows one adventure per campaign, so this is
 * how a synthesis or a short steered playtest gets a fresh campaign without
 * re-running character creation.
 *
 * It reads the source, then calls the app's own `CampaignService.create` and
 * `CharacterService.create`, so the clone's state is written by the same code
 * as a real character's. The character arrives **fresh**: pools are derived
 * from the sheet, so damage, Stress and Wounds from play do not carry over.
 *
 * Skills, equipment and worn armor are not on the sheet. Creation took them as
 * input and the only copy left is the source's live `characterState`, which
 * play can change. When they differ from the earliest synthesis snapshot (the
 * copy closest to creation), the clone still uses the live ones and a warning
 * says so.
 *
 * The two service calls are not one transaction. If the character write
 * fails, the campaign already exists, and the error names it for deletion.
 */
export async function cloneCharacter(
  db: Db,
  opts: CloneCharacterOptions,
): Promise<CloneCharacterResult> {
  const { sourceCampaignId, nameOverride } = opts;
  const warnings: string[] = [];

  const campaignRepo = new CampaignRepository(db);
  const characterRepo = new CharacterRepository(db);
  const campaignService = new CampaignService(campaignRepo);
  const characterService = new CharacterService(
    characterRepo,
    campaignService,
    campaignRepo,
  );

  // --- Read the source ------------------------------------------------------

  const [sourceCampaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, sourceCampaignId))
    .limit(1);
  if (!sourceCampaign) {
    throw new CloneCharacterError(`campaign ${sourceCampaignId} not found.`, 1);
  }

  const sourceSheet = await characterRepo.findByCampaignId(sourceCampaignId);
  if (!sourceSheet) {
    throw new CloneCharacterError(
      `campaign ${sourceCampaignId} has no character sheet to clone.`,
      1,
    );
  }
  const parsedSheet = MothershipCharacterSheetSchema.safeParse(
    sourceSheet.data,
  );
  if (!parsedSheet.success) {
    throw new CloneCharacterError(
      `campaign ${sourceCampaignId}'s character sheet failed validation: ${parsedSheet.error.issues[0]?.message ?? parsedSheet.error.message}`,
      1,
    );
  }
  const sheet = parsedSheet.data;

  const sourceState = await campaignRepo.getStateData(sourceCampaignId);
  const rawCharacterState = (
    sourceState?.characterState as Record<string, unknown> | undefined
  )?.[sheet.entityId];
  let inputs: CreationInputs = { skills: [], equipment: [], wornArmor: null };
  if (rawCharacterState === undefined) {
    // Campaigns synthesized before 2026-10-16 lost this key (`§ S81`).
    warnings.push(
      `the source has no characterState for ${sheet.entityId}, so the clone starts with no skills, equipment or armor.`,
    );
  } else {
    const parsedState =
      MothershipCharacterStateSchema.safeParse(rawCharacterState);
    if (!parsedState.success) {
      throw new CloneCharacterError(
        `campaign ${sourceCampaignId}'s characterState for ${sheet.entityId} failed validation: ${parsedState.error.issues[0]?.message ?? parsedState.error.message}`,
        1,
      );
    }
    inputs = creationInputs(parsedState.data);
  }

  const earliest = await earliestSnapshotInputs(
    db,
    sourceCampaignId,
    sheet.entityId,
  );
  if (
    earliest !== null &&
    JSON.stringify(earliest) !== JSON.stringify(inputs)
  ) {
    warnings.push(
      'skills, equipment or worn armor have changed in play since the first synthesis. The clone uses the current ones.',
    );
  }

  // --- Create the clone through the app's own creation path ----------------

  const campaignName =
    nameOverride && nameOverride.length > 0
      ? nameOverride
      : `${sourceCampaign.name} (clone ${timestampLabel()})`;

  const campaign = await campaignService.create(
    {
      name: campaignName,
      visibility: sourceCampaign.visibility,
      diceMode: sourceCampaign.diceMode,
    },
    sourceSheet.userId,
  );

  try {
    await characterService.create(campaign.id, sourceSheet.userId, sheet, {
      startingSkills: inputs.skills,
      startingEquipment: inputs.equipment,
      wornArmor: inputs.wornArmor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CloneCharacterError(
      `campaign ${campaign.id} was created but its character was not (${message}). Delete it from the campaign page.`,
      1,
    );
  }

  return {
    campaignId: campaign.id,
    campaignName,
    ownerId: sourceSheet.userId,
    entityId: sheet.entityId,
    campaignUrl: `/campaigns/${campaign.id}`,
    warnings,
  };
}

/**
 * The creation inputs as the source campaign's earliest synthesis snapshot
 * recorded them, or `null` when there is no snapshot or it predates
 * `characterState` surviving synthesis.
 */
async function earliestSnapshotInputs(
  db: Db,
  campaignId: string,
  entityId: string,
): Promise<CreationInputs | null> {
  const [row] = await db
    .select({ data: schema.adventureSynthesisSnapshots.campaignStateData })
    .from(schema.adventureSynthesisSnapshots)
    .innerJoin(
      schema.adventures,
      eq(schema.adventures.id, schema.adventureSynthesisSnapshots.adventureId),
    )
    .where(eq(schema.adventures.campaignId, campaignId))
    .orderBy(asc(schema.adventureSynthesisSnapshots.capturedAt))
    .limit(1);
  const raw = ((
    row?.data as { characterState?: Record<string, unknown> } | undefined
  )?.characterState ?? {})[entityId];
  if (raw === undefined) return null;
  const parsed = MothershipCharacterStateSchema.safeParse(raw);
  return parsed.success ? creationInputs(parsed.data) : null;
}
