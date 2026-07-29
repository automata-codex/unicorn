import { describe, expect, it, vi } from 'vitest';

import { AnthropicService } from '../../src/anthropic/anthropic.service';
import {
  fakeDiceRoll,
  fakeFixture,
  fakeTurnExecutionResult,
} from './structural/test-helpers';
import { structuralCheckers } from './structural/registry';

import { evalChecks } from './registry';
import { runCheck } from './run-check';

import type Anthropic from '@anthropic-ai/sdk';
import type { EvalCheck } from './registry';

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return {
    content: [
      { type: 'tool_use', id: 'toolu_fake', name, input } as unknown as Anthropic.ToolUseBlock,
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

const NO_ANTHROPIC_CALLS_EXPECTED = fakeAnthropic(vi.fn());

describe('runCheck — structural verdict mapping', () => {
  const check = evalChecks['system-rolled-player-action'];
  const playerPool = { resourcePools: { alvarez_hp: { current: 10, max: 10 } } };

  it('maps NOT_APPLICABLE when the checker finds nothing to evaluate', async () => {
    const fixture = fakeFixture({ tag: 'SYSTEM-ROLLED-PLAYER-ACTION' });
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const observation = await runCheck(
      check,
      fixture,
      result,
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('not_applicable');
    expect(observation.notApplicableReason).toMatch(/no dice_roll events/);
  });

  it('maps PASSED to pass', async () => {
    const fixture = fakeFixture({ tag: 'SYSTEM-ROLLED-PLAYER-ACTION' });
    const result = fakeTurnExecutionResult({
      campaignState: playerPool,
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'guard damage if hits' }),
      ],
    });

    const observation = await runCheck(
      check,
      fixture,
      result,
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('pass');
  });

  it('maps FAILED to fail', async () => {
    const fixture = fakeFixture({ tag: 'SYSTEM-ROLLED-PLAYER-ACTION' });
    const result = fakeTurnExecutionResult({
      campaignState: playerPool,
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'alvarez damage if hits' }),
      ],
    });

    const observation = await runCheck(
      check,
      fixture,
      result,
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('fail');
    expect(observation.detail).toMatch(/alvarez damage if hits/);
  });
});

describe('runCheck — fixture-schema gate', () => {
  it('returns not_applicable and never invokes the checker when the fixture is below requiresFixtureSchema', async () => {
    const spy = vi.spyOn(structuralCheckers, 'SYSTEM-ROLLED-PLAYER-ACTION');
    const gatedCheck: EvalCheck = {
      id: 'system-rolled-player-action',
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      mode: 'structural',
      requiresFixtureSchema: 2,
    };
    const fixture = fakeFixture({ tag: 'SYSTEM-ROLLED-PLAYER-ACTION' });
    expect(fixture.fixtureSchemaVersion).toBe(1);

    const observation = await runCheck(
      gatedCheck,
      fixture,
      fakeTurnExecutionResult(),
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('not_applicable');
    expect(observation.notApplicableReason).toMatch(/requires fixtureSchemaVersion >= 2/);
    expect(observation.notApplicableReason).toMatch(/has 1/);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('runCheck — structural checker throws', () => {
  it('yields error with the thrown message, never fail', async () => {
    const check = evalChecks['missing-canon-capture'];
    // A judged-shaped assertion on a structural-tag fixture makes
    // checkMissingCanonCapture's own internal mode guard throw.
    const fixture = fakeFixture({
      tag: 'MISSING-CANON-CAPTURE',
      assertion: { mode: 'judged', rubric: 'x', facts: {} },
    });

    const observation = await runCheck(
      check,
      fixture,
      fakeTurnExecutionResult(),
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('error');
    expect(observation.errorMessage).toMatch(/non-structural fixture/);
  });
});

describe('runCheck — judged checks', () => {
  const check = evalChecks['hidden-info-leak'];
  const fixture = fakeFixture({
    tag: 'HIDDEN-INFO-LEAK',
    assertion: {
      mode: 'judged',
      rubric: 'HIDDEN-INFO-LEAK',
      facts: { perceptionBoundary: 'airlock only' },
    },
  });

  it('maps a passed:true verdict to pass and includes rubricHash', async () => {
    const anthropic = fakeAnthropic(
      vi.fn().mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: true, rationale: 'fine' }),
      ),
    );

    const observation = await runCheck(
      check,
      fixture,
      fakeTurnExecutionResult(),
      anthropic,
    );

    expect(observation.verdict).toBe('pass');
    expect(observation.detail).toBe('fine');
    expect(observation.rubricHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('maps a passed:false verdict to fail', async () => {
    const anthropic = fakeAnthropic(
      vi.fn().mockResolvedValue(
        toolUseMessage('judge_verdict', { passed: false, rationale: 'nope' }),
      ),
    );

    const observation = await runCheck(
      check,
      fixture,
      fakeTurnExecutionResult(),
      anthropic,
    );

    expect(observation.verdict).toBe('fail');
    expect(observation.detail).toBe('nope');
  });

  it('yields error, not fail, when the judge call throws JudgeOutputError', async () => {
    const anthropic = fakeAnthropic(
      vi.fn().mockResolvedValue(textMessage('no tool call here')),
    );

    const observation = await runCheck(
      check,
      fixture,
      fakeTurnExecutionResult(),
      anthropic,
    );

    expect(observation.verdict).toBe('error');
    expect(observation.errorMessage).toMatch(/did not call judge_verdict/);
  });
});
