import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnthropicService } from '../anthropic/anthropic.service';

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

function makeService(callMessages: ReturnType<typeof vi.fn>) {
  const anthropic = { callMessages } as unknown as AnthropicService;
  return new SynthesisService(anthropic);
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
        conflicts: [
          { ...rerollReport.conflicts[0], category: 'secret' },
        ],
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
    const callMessages = vi
      .fn()
      .mockResolvedValue(textMessage('no tool here'));
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
