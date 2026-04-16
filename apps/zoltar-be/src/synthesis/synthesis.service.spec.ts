import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  baseActivePools,
  baseSelections,
  vasquezSheet,
} from './synthesis.fixtures';
import {
  CoherenceConflictError,
  SynthesisOutputError,
  SynthesisService,
} from './synthesis.service';
import { SynthesisWriteValidationError } from './synthesis.write';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { SynthesisRepository } from './synthesis.repository';

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name,
        input,
        // caller is on the live SDK type but our parser never reads it — cast.
      } as unknown as Anthropic.ToolUseBlock,
    ],
  } as unknown as Anthropic.Message;
}

function textMessage(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text } as unknown as Anthropic.ContentBlock],
  } as unknown as Anthropic.Message;
}

interface MockRepoOverrides {
  getCampaignStateData?: ReturnType<typeof vi.fn>;
  writeGmContextAtomic?: ReturnType<typeof vi.fn>;
  setAdventureFailed?: ReturnType<typeof vi.fn>;
  autoPromoteCanon?: ReturnType<typeof vi.fn>;
}

function makeRepo(overrides: MockRepoOverrides = {}): SynthesisRepository {
  return {
    getCampaignStateData:
      overrides.getCampaignStateData ?? vi.fn().mockResolvedValue(null),
    writeGmContextAtomic:
      overrides.writeGmContextAtomic ?? vi.fn().mockResolvedValue(undefined),
    setAdventureFailed:
      overrides.setAdventureFailed ?? vi.fn().mockResolvedValue(undefined),
    autoPromoteCanon:
      overrides.autoPromoteCanon ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as SynthesisRepository;
}

function makeService(
  callMessages: ReturnType<typeof vi.fn>,
  repo: SynthesisRepository = makeRepo(),
) {
  const anthropic = { callMessages } as unknown as AnthropicService;
  return new SynthesisService(anthropic, repo);
}

const proceedReport = {
  conflicts: [],
  resolution: 'proceed' as const,
};

const surfaceReport = {
  conflicts: [
    {
      category: 'threat',
      description: 'survivor already killed the threat',
      rerollable: false,
    },
  ],
  resolution: 'surface' as const,
};

const rerollReport = {
  conflicts: [
    {
      category: 'survivor',
      description: 'survivor is the same person as the threat',
      rerollable: true,
    },
  ],
  resolution: 'reroll' as const,
  rerollCategory: 'survivor',
};

describe('SynthesisService.checkCoherence', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('proceed: returns the original selections untouched', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage('report_coherence', proceedReport));
    const service = makeService(callMessages);

    const result = await service.checkCoherence({
      selections: baseSelections,
      activePools: baseActivePools,
    });

    expect(result.rerolled).toBe(false);
    expect(result.selections).toBe(baseSelections);
    expect(callMessages).toHaveBeenCalledOnce();
  });

  it('surface: throws CoherenceConflictError with the reported conflicts', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage('report_coherence', surfaceReport));
    const service = makeService(callMessages);

    await expect(
      service.checkCoherence({
        selections: baseSelections,
        activePools: baseActivePools,
      }),
    ).rejects.toMatchObject({
      name: 'CoherenceConflictError',
      conflicts: surfaceReport.conflicts,
    });
  });

  it('reroll: substitutes a different entry from the active pool', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage('report_coherence', rerollReport));
    const service = makeService(callMessages);

    const result = await service.checkCoherence({
      selections: baseSelections,
      activePools: baseActivePools,
    });

    expect(result.rerolled).toBe(true);
    expect(result.selections.survivor.id).toBe('survivor_2');
    // Other categories untouched.
    expect(result.selections.threat).toBe(baseSelections.threat);
  });

  it('reroll: escalates to surface when the pool has no alternative', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('report_coherence', {
        ...rerollReport,
        rerollCategory: 'secret',
        conflicts: [{ ...rerollReport.conflicts[0], category: 'secret' }],
      }),
    );
    const service = makeService(callMessages);

    // baseActivePools.secret has only one entry (secret_1), which is the current
    // selection — no substitute available.
    await expect(
      service.checkCoherence({
        selections: baseSelections,
        activePools: baseActivePools,
      }),
    ).rejects.toBeInstanceOf(CoherenceConflictError);
  });

  it('reroll with invalid category is treated as a surface', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('report_coherence', {
        conflicts: [
          { category: 'survivor', description: 'x', rerollable: true },
        ],
        resolution: 'reroll',
        rerollCategory: 'not_a_category',
      }),
    );
    const service = makeService(callMessages);

    await expect(
      service.checkCoherence({
        selections: baseSelections,
        activePools: baseActivePools,
      }),
    ).rejects.toBeInstanceOf(CoherenceConflictError);
  });

  it('throws SynthesisOutputError when Claude does not call the tool', async () => {
    const callMessages = vi.fn().mockResolvedValue(textMessage('no tool here'));
    const service = makeService(callMessages);

    await expect(
      service.checkCoherence({
        selections: baseSelections,
        activePools: baseActivePools,
      }),
    ).rejects.toBeInstanceOf(SynthesisOutputError);
  });

  it('throws SynthesisOutputError when the tool input is malformed', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('report_coherence', {
        conflicts: [],
        resolution: 'wat',
      }),
    );
    const service = makeService(callMessages);

    await expect(
      service.checkCoherence({
        selections: baseSelections,
        activePools: baseActivePools,
      }),
    ).rejects.toBeInstanceOf(SynthesisOutputError);
  });
});

describe('SynthesisService.runSynthesis', () => {
  const validGmContext = {
    openingNarration: 'Amber lights pulse overhead.',
    narrative: {
      location: 'Derelict hauler',
      atmosphere: 'Cold, humming, wrong',
      npcAgendas: { dr_chen: 'Hide the manifest.' },
      hiddenTruth: 'The cargo is alive.',
      oracleConnections: 'Survivor sealed the bay.',
    },
    structured: {
      entities: [
        {
          id: 'dr_chen',
          type: 'npc',
          visible: true,
          tags: ['corporate'],
          startingPosition: { x: 1, y: 1, z: 0 },
        },
      ],
      flags: {
        adventure_complete: {
          value: false,
          trigger: 'Escape with the manifest.',
        },
      },
      initialState: { dr_chen_hp: { current: 10, max: 10 } },
    },
  };

  it('returns the parsed tool input on the happy path', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage('submit_gm_context', validGmContext));
    const service = makeService(callMessages);

    const result = await service.runSynthesis({
      characterSheet: vasquezSheet,
      selections: baseSelections,
    });

    expect(result.openingNarration).toBe('Amber lights pulse overhead.');
    expect(result.structured.flags.adventure_complete.value).toBe(false);
  });

  it('forwards the addendum into the prompt', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage('submit_gm_context', validGmContext));
    const service = makeService(callMessages);

    await service.runSynthesis({
      characterSheet: vasquezSheet,
      selections: baseSelections,
      addendum: 'lean into dread',
    });

    const [call] = callMessages.mock.calls;
    const userContent = call[0].messages[0].content as string;
    expect(userContent).toContain('ADDITIONAL DIRECTION:\nlean into dread');
  });

  it('throws SynthesisOutputError when the tool input fails schema validation', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('submit_gm_context', {
        ...validGmContext,
        structured: {
          ...validGmContext.structured,
          flags: { adventure_complete: { value: 'false' } },
        },
      }),
    );
    const service = makeService(callMessages);

    await expect(
      service.runSynthesis({
        characterSheet: vasquezSheet,
        selections: baseSelections,
      }),
    ).rejects.toBeInstanceOf(SynthesisOutputError);
  });

  it('throws SynthesisOutputError when Claude skips the tool call', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(textMessage('here is your adventure'));
    const service = makeService(callMessages);

    await expect(
      service.runSynthesis({
        characterSheet: vasquezSheet,
        selections: baseSelections,
      }),
    ).rejects.toBeInstanceOf(SynthesisOutputError);
  });
});

describe('SynthesisService.commitGmContext', () => {
  const adventureId = '00000000-0000-0000-0000-000000000001';
  const campaignId = '00000000-0000-0000-0000-000000000002';

  const validInput = {
    openingNarration: 'Amber lights pulse overhead.',
    narrative: {
      location: 'Derelict hauler',
      atmosphere: 'Cold, humming, wrong',
      npcAgendas: { dr_chen: 'Hide the manifest.' },
      hiddenTruth: 'The cargo is alive.',
      oracleConnections: 'Survivor sealed the bay.',
    },
    structured: {
      entities: [
        {
          id: 'dr_chen',
          type: 'npc' as const,
          visible: true,
          tags: ['corporate'],
          startingPosition: { x: 1, y: 2, z: 0 },
        },
        {
          id: 'invisible_threat',
          type: 'threat' as const,
          visible: false,
          tags: [],
          // No startingPosition — should be skipped by buildGridEntityRows.
        },
      ],
      flags: {
        adventure_complete: {
          value: false,
          trigger: 'Escape with the manifest.',
        },
      },
      initialState: {
        dr_chen_hp: { current: 10, max: 10 },
      },
    },
  };

  it('runs the atomic write with merged campaign state data', async () => {
    const writeGmContextAtomic = vi.fn().mockResolvedValue(undefined);
    const getCampaignStateData = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      resourcePools: {
        // Pre-seeded player pool — must not be clobbered.
        vasquez_hp: { current: 15, max: 15 },
      },
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    });
    const repo = makeRepo({ writeGmContextAtomic, getCampaignStateData });
    const service = makeService(vi.fn(), repo);

    await service.commitGmContext({
      adventureId,
      campaignId,
      input: validInput,
    });

    expect(writeGmContextAtomic).toHaveBeenCalledOnce();
    const [args] = writeGmContextAtomic.mock.calls[0];
    expect(args.adventureId).toBe(adventureId);
    expect(args.campaignId).toBe(campaignId);
    expect(args.campaignStateData.resourcePools).toEqual({
      vasquez_hp: { current: 15, max: 15 },
      dr_chen_hp: { current: 10, max: 10 },
    });
    expect(args.campaignStateData.flags.adventure_complete.trigger).toBe(
      'Escape with the manifest.',
    );
    expect(args.campaignStateData.entities.dr_chen).toEqual({
      visible: true,
      status: 'unknown',
    });
    expect(args.gridEntities).toHaveLength(1);
    expect(args.gridEntities[0].entityRef).toBe('dr_chen');
    expect(args.gmContextBlob).toMatchObject({
      openingNarration: 'Amber lights pulse overhead.',
      narrative: validInput.narrative,
    });
  });

  it('fills resource pools when campaign_state has no existing row', async () => {
    const writeGmContextAtomic = vi.fn().mockResolvedValue(undefined);
    const repo = makeRepo({
      getCampaignStateData: vi.fn().mockResolvedValue(null),
      writeGmContextAtomic,
    });
    const service = makeService(vi.fn(), repo);

    await service.commitGmContext({
      adventureId,
      campaignId,
      input: validInput,
    });

    const [args] = writeGmContextAtomic.mock.calls[0];
    expect(args.campaignStateData.resourcePools).toEqual({
      dr_chen_hp: { current: 10, max: 10 },
    });
  });

  it('rejects missing adventure_complete and sets the adventure failed', async () => {
    const setAdventureFailed = vi.fn().mockResolvedValue(undefined);
    const writeGmContextAtomic = vi.fn();
    const repo = makeRepo({ setAdventureFailed, writeGmContextAtomic });
    const service = makeService(vi.fn(), repo);

    const bad = structuredClone(validInput);
    bad.structured.flags = {} as typeof validInput.structured.flags;

    await expect(
      service.commitGmContext({ adventureId, campaignId, input: bad }),
    ).rejects.toBeInstanceOf(SynthesisWriteValidationError);

    expect(writeGmContextAtomic).not.toHaveBeenCalled();
    expect(setAdventureFailed).toHaveBeenCalledWith(
      adventureId,
      expect.stringContaining('adventure_complete'),
    );
  });

  it('rejects adventure_complete starting as true', async () => {
    const repo = makeRepo();
    const service = makeService(vi.fn(), repo);

    const bad = structuredClone(validInput);
    bad.structured.flags.adventure_complete.value = true;

    await expect(
      service.commitGmContext({ adventureId, campaignId, input: bad }),
    ).rejects.toBeInstanceOf(SynthesisWriteValidationError);
  });

  it('rejects duplicate entity ids', async () => {
    const repo = makeRepo();
    const service = makeService(vi.fn(), repo);

    const bad = structuredClone(validInput);
    (
      bad.structured.entities as Array<
        | (typeof validInput.structured.entities)[number]
        | { id: string; type: 'feature'; visible: boolean; tags: string[] }
      >
    ).push({
      id: 'dr_chen',
      type: 'feature',
      visible: true,
      tags: [],
    });

    await expect(
      service.commitGmContext({
        adventureId,
        campaignId,
        input: bad,
      }),
    ).rejects.toBeInstanceOf(SynthesisWriteValidationError);
  });

  it('silently skips non-pool initialState entries and writes pools that are valid', async () => {
    const writeGmContextAtomic = vi.fn().mockResolvedValue(undefined);
    const repo = makeRepo({ writeGmContextAtomic });
    const service = makeService(vi.fn(), repo);

    const input = structuredClone(validInput);
    (input.structured.initialState as Record<string, unknown>) = {
      dr_chen_hp: { current: 10, max: 10 },
      current_deck: 'derelict_lower',
    };

    await service.commitGmContext({ adventureId, campaignId, input });

    const [args] = writeGmContextAtomic.mock.calls[0];
    expect(args.campaignStateData.resourcePools.dr_chen_hp).toEqual({
      current: 10,
      max: 10,
    });
    expect(args.campaignStateData.resourcePools).not.toHaveProperty(
      'current_deck',
    );
  });

  it('flips adventure to failed when the atomic write throws', async () => {
    const setAdventureFailed = vi.fn().mockResolvedValue(undefined);
    const writeGmContextAtomic = vi
      .fn()
      .mockRejectedValue(new Error('deadlock'));
    const repo = makeRepo({ setAdventureFailed, writeGmContextAtomic });
    const service = makeService(vi.fn(), repo);

    await expect(
      service.commitGmContext({
        adventureId,
        campaignId,
        input: validInput,
      }),
    ).rejects.toThrow('deadlock');

    expect(setAdventureFailed).toHaveBeenCalledWith(
      adventureId,
      expect.stringContaining('deadlock'),
    );
  });
});

describe('SynthesisService.autoPromoteCanon', () => {
  it('delegates to the repository', async () => {
    const autoPromoteCanon = vi.fn().mockResolvedValue(undefined);
    const repo = makeRepo({ autoPromoteCanon });
    const service = makeService(vi.fn(), repo);

    await service.autoPromoteCanon('adv-1');

    expect(autoPromoteCanon).toHaveBeenCalledWith('adv-1');
  });
});
