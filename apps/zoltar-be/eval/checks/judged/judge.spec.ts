import { describe, expect, it, vi } from 'vitest';

import { AnthropicService } from '../../../src/anthropic/anthropic.service';
import {
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from '../structural/test-helpers';

import { JUDGE_MODEL, JudgeOutputError, runJudgeCall } from './judge';

import type Anthropic from '@anthropic-ai/sdk';
import type { ConfigService } from '@nestjs/config';

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name,
        input,
      } as unknown as Anthropic.ToolUseBlock,
    ],
  } as unknown as Anthropic.Message;
}

function textMessage(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text } as unknown as Anthropic.ContentBlock],
  } as unknown as Anthropic.Message;
}

function fakeAnthropic(
  callMessages: ReturnType<typeof vi.fn>,
): AnthropicService {
  return { callMessages } as unknown as AnthropicService;
}

const HIDDEN_INFO_FIXTURE = fakeFixture({
  id: 'turn24-hidden-info-leak',
  tag: 'HIDDEN-INFO-LEAK',
  assertion: {
    mode: 'judged',
    rubric: 'HIDDEN-INFO-LEAK',
    facts: { perceptionBoundary: 'the player can only see the airlock.' },
  },
});

const OVER_RESOLUTION_FIXTURE = fakeFixture({
  id: 'turn24-over-resolution',
  tag: 'OVER-RESOLUTION',
  assertion: {
    mode: 'judged',
    rubric: 'OVER-RESOLUTION',
    facts: { resolutionLevel: 'off-screen, summarized' },
  },
});

const RESULT = fakeTurnExecutionResult({
  gameEvents: [
    fakeGameEvent({
      sequenceNumber: 3,
      eventType: 'gm_response',
      payload: { playerText: 'The airlock cycles shut.' },
    }),
  ],
});

describe('runJudgeCall', () => {
  it('calls callMessages with the JUDGE_MODEL and forces the judge_verdict tool', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: true, rationale: 'fine' }),
      );

    await runJudgeCall(
      fakeAnthropic(callMessages),
      HIDDEN_INFO_FIXTURE,
      RESULT,
    );

    expect(callMessages).toHaveBeenCalledOnce();
    const call = callMessages.mock.calls[0][0];
    expect(call.model).toBe(JUDGE_MODEL);
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe('judge_verdict');
    expect(call.toolChoice).toEqual({ type: 'any' });
  });

  it('interpolates the fixture facts into the rubric prompt', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: true, rationale: 'fine' }),
      );

    await runJudgeCall(
      fakeAnthropic(callMessages),
      HIDDEN_INFO_FIXTURE,
      RESULT,
    );

    const prompt = callMessages.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('the player can only see the airlock.');
    expect(prompt).not.toContain('{{perceptionBoundary}}');
  });

  it("includes the turn's playerText and tool-call sequence in the prompt", async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: true, rationale: 'fine' }),
      );

    await runJudgeCall(
      fakeAnthropic(callMessages),
      HIDDEN_INFO_FIXTURE,
      RESULT,
    );

    const prompt = callMessages.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('The airlock cycles shut.');
    expect(prompt).toContain('gm_response');
  });

  it('parses a passed:true verdict', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('judge_verdict', {
        passed: true,
        rationale: 'stays within the perception boundary',
      }),
    );

    const verdict = await runJudgeCall(
      fakeAnthropic(callMessages),
      HIDDEN_INFO_FIXTURE,
      RESULT,
    );

    expect(verdict).toEqual({
      passed: true,
      rationale: 'stays within the perception boundary',
    });
  });

  it('parses a passed:false verdict', async () => {
    const callMessages = vi.fn().mockResolvedValue(
      toolUseMessage('judge_verdict', {
        passed: false,
        rationale: 'reveals a roll value the player could not know',
      }),
    );

    const verdict = await runJudgeCall(
      fakeAnthropic(callMessages),
      HIDDEN_INFO_FIXTURE,
      RESULT,
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.rationale).toMatch(/roll value/);
  });

  it('works for the OVER-RESOLUTION rubric too', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: true, rationale: 'fine' }),
      );

    await runJudgeCall(
      fakeAnthropic(callMessages),
      OVER_RESOLUTION_FIXTURE,
      RESULT,
    );

    const prompt = callMessages.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('off-screen, summarized');
  });

  it('throws when the fixture is not judged-mode', async () => {
    const structuralFixture = fakeFixture({
      assertion: { mode: 'structural', check: 'x' },
    });

    await expect(
      runJudgeCall(fakeAnthropic(vi.fn()), structuralFixture, RESULT),
    ).rejects.toThrow(/non-judged fixture/);
  });

  it('throws when no rubric is registered for assertion.rubric', async () => {
    const badFixture = fakeFixture({
      tag: 'HIDDEN-INFO-LEAK',
      assertion: {
        mode: 'judged',
        rubric: 'NOT-A-REAL-RUBRIC',
        facts: {},
      },
    });

    await expect(
      runJudgeCall(fakeAnthropic(vi.fn()), badFixture, RESULT),
    ).rejects.toThrow(/no judge rubric registered/);
  });

  it('throws when a required fact is missing', async () => {
    const missingFactFixture = fakeFixture({
      tag: 'HIDDEN-INFO-LEAK',
      assertion: { mode: 'judged', rubric: 'HIDDEN-INFO-LEAK', facts: {} },
    });

    await expect(
      runJudgeCall(fakeAnthropic(vi.fn()), missingFactFixture, RESULT),
    ).rejects.toThrow(/missing required fact "perceptionBoundary"/);
  });

  it('throws JudgeOutputError when the model never calls judge_verdict', async () => {
    const callMessages = vi.fn().mockResolvedValue(textMessage('no tool here'));

    await expect(
      runJudgeCall(fakeAnthropic(callMessages), HIDDEN_INFO_FIXTURE, RESULT),
    ).rejects.toThrow(JudgeOutputError);
  });

  it('throws JudgeOutputError when judge_verdict input fails schema validation', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: 'yes', rationale: 123 }),
      );

    await expect(
      runJudgeCall(fakeAnthropic(callMessages), HIDDEN_INFO_FIXTURE, RESULT),
    ).rejects.toThrow(JudgeOutputError);
  });
});

const RUN_LIVE = process.env.RUN_LIVE_EVAL_TESTS === '1';

try {
  process.loadEnvFile();
} catch {
  // No .env file found — rely on whatever's already in process.env.
}

/** Minimal fake `ConfigService` — `AnthropicService`'s constructor only
 * calls `getOrThrow('ANTHROPIC_API_KEY')`; no need for the full DI graph
 * Part 3's `createHarnessSession` bootstraps, since this test needs
 * nothing else Nest-provided (no DB, no SessionService). */
function realAnthropicService(): AnthropicService {
  const fakeConfig = {
    getOrThrow: () => process.env.ANTHROPIC_API_KEY,
  } as unknown as ConfigService;
  return new AnthropicService(fakeConfig);
}

describe.skipIf(!RUN_LIVE)(
  'runJudgeCall — LIVE Sonnet 5 calls (gated by RUN_LIVE_EVAL_TESTS=1)',
  () => {
    it('HIDDEN-INFO-LEAK: passes a clean turn that stays within the perception boundary', async () => {
      const fixture = fakeFixture({
        tag: 'HIDDEN-INFO-LEAK',
        assertion: {
          mode: 'judged',
          rubric: 'HIDDEN-INFO-LEAK',
          facts: {
            perceptionBoundary:
              'the player is standing in the airlock and cannot see or hear anything beyond the sealed inner door.',
          },
        },
      });
      const result = fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 3,
            eventType: 'gm_response',
            payload: {
              playerText:
                'You hear a faint clang from somewhere deeper in the ship.',
            },
          }),
        ],
      });

      const verdict = await runJudgeCall(
        realAnthropicService(),
        fixture,
        result,
      );
      expect(verdict.passed).toBe(true);
    }, 60_000);

    it('HIDDEN-INFO-LEAK: fails a turn that leaks a specific mechanical fact beyond the boundary', async () => {
      const fixture = fakeFixture({
        tag: 'HIDDEN-INFO-LEAK',
        assertion: {
          mode: 'judged',
          rubric: 'HIDDEN-INFO-LEAK',
          facts: {
            perceptionBoundary:
              'the player is standing in the airlock and cannot see or hear anything beyond the sealed inner door.',
          },
        },
      });
      const result = fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 3,
            eventType: 'gm_response',
            payload: {
              playerText:
                'Through the sealed door, you clearly see the corporate spy has exactly 3 HP left and is reloading a pistol with 2 rounds remaining.',
            },
          }),
        ],
      });

      const verdict = await runJudgeCall(
        realAnthropicService(),
        fixture,
        result,
      );
      expect(verdict.passed).toBe(false);
    }, 60_000);

    it('OVER-RESOLUTION: passes a turn matching a summarized off-screen expectation', async () => {
      const fixture = fakeFixture({
        tag: 'OVER-RESOLUTION',
        assertion: {
          mode: 'judged',
          rubric: 'OVER-RESOLUTION',
          facts: {
            resolutionLevel:
              'off-screen and summarized — this is a background skirmish the player character is not directly involved in.',
          },
        },
      });
      const result = fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 3,
            eventType: 'gm_response',
            payload: {
              playerText:
                'Distant gunfire echoes down the corridor, then falls silent. The skirmish is over.',
            },
          }),
        ],
      });

      const verdict = await runJudgeCall(
        realAnthropicService(),
        fixture,
        result,
      );
      expect(verdict.passed).toBe(true);
    }, 60_000);

    it('OVER-RESOLUTION: fails a turn that over-simulates off-screen content with excessive rolls', async () => {
      const fixture = fakeFixture({
        tag: 'OVER-RESOLUTION',
        assertion: {
          mode: 'judged',
          rubric: 'OVER-RESOLUTION',
          facts: {
            resolutionLevel:
              'off-screen and summarized — this is a background skirmish the player character is not directly involved in.',
          },
        },
      });
      const result = fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 3,
            eventType: 'dice_roll',
            payload: {
              notation: '1d10',
              purpose: 'NPC guard #1 to-hit vs NPC guard #4',
              results: [7],
              modifier: 0,
              total: 7,
            },
          }),
          fakeGameEvent({
            sequenceNumber: 4,
            eventType: 'dice_roll',
            payload: {
              notation: '1d10',
              purpose: 'NPC guard #1 damage vs NPC guard #4',
              results: [4],
              modifier: 0,
              total: 4,
            },
          }),
          fakeGameEvent({
            sequenceNumber: 5,
            eventType: 'dice_roll',
            payload: {
              notation: '1d10',
              purpose: 'NPC guard #4 to-hit vs NPC guard #1',
              results: [2],
              modifier: 0,
              total: 2,
            },
          }),
          fakeGameEvent({
            sequenceNumber: 6,
            eventType: 'gm_response',
            payload: {
              playerText:
                'You watch every exchange of the distant firefight play out blow-by-blow: guard #1 lands a solid hit for 4 damage, guard #4 barely misses their counterattack, and the two exchange fire for several more rounds before guard #4 finally falls.',
            },
          }),
        ],
      });

      const verdict = await runJudgeCall(
        realAnthropicService(),
        fixture,
        result,
      );
      expect(verdict.passed).toBe(false);
    }, 60_000);
  },
);
