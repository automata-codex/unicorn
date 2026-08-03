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
  const applicableFixture = fakeFixture({
    tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    applicability: {
      'system-rolled-player-action': {
        applies: true,
        playerEntity: 'alvarez',
        situation: 'test fixture',
      },
    },
  });

  it('maps NOT_APPLICABLE when the checker finds nothing to evaluate', async () => {
    const fixture = fakeFixture({
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      applicability: {
        'system-rolled-player-action': {
          applies: false,
          situation: 'no player action this turn',
        },
      },
    });
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const observation = await runCheck(
      check,
      fixture,
      result,
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('not_applicable');
    expect(observation.notApplicableReason).toMatch(/no player action this turn/);
  });

  it('maps PASSED to pass', async () => {
    // A turn with nothing rolled and nothing pending — the one shape that
    // reaches PASSED on purely structural grounds. An NPC-flavoured roll
    // with no dice_request alongside it now reports undecided instead (see
    // `attribution.ts`), so it no longer serves as a PASSED example.
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const observation = await runCheck(
      check,
      applicableFixture,
      result,
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.verdict).toBe('pass');
  });

  it('maps FAILED to fail', async () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'alvarez damage if hits' }),
      ],
    });

    const observation = await runCheck(
      check,
      applicableFixture,
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
      applicabilitySource: 'fixture',
      requiresFixtureSchema: 2,
    };
    const fixture = fakeFixture({
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      fixtureSchemaVersion: 1,
    });
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

describe('runCheck — judgeGate (structural pre-filter on a judged check)', () => {
  const judgedCheck = evalChecks['scene-jump'];
  const fixture = fakeFixture({
    tag: 'SCENE-JUMP',
    assertion: {
      mode: 'judged',
      rubric: 'SCENE-JUMP',
      facts: { expectedScope: 'the airlock, this moment' },
    },
  });
  const result = fakeTurnExecutionResult();

  it('settles the rep without a judge call when the gate returns a verdict', async () => {
    const anthropic = fakeAnthropic(vi.fn());
    const gated: EvalCheck = {
      ...judgedCheck,
      judgeGate: () => ({
        outcome: 'NOT_APPLICABLE',
        actual: 'no narration to grade this turn',
        actualCode: 'no narration',
      }),
    };

    const observation = await runCheck(gated, fixture, result, anthropic);

    expect(observation.verdict).toBe('not_applicable');
    expect(observation.judgeInvoked).toBe(false);
    // No rubric graded this rep, so stamping one on it would imply
    // otherwise — and `eval:judge-variance` reads exactly this to decide
    // what belongs in a flip-rate denominator.
    expect(observation.rubricHash).toBeUndefined();
    expect(observation.notApplicableReasonCode).toBe('no narration');
    expect(anthropic.callMessages).not.toHaveBeenCalled();
  });

  it('falls through to the judge when the gate returns null', async () => {
    const anthropic = fakeAnthropic(
      vi.fn().mockResolvedValue(
        toolUseMessage('judge_verdict', {
          passed: true,
          rationale: 'stayed in scope',
        }),
      ),
    );
    const gated: EvalCheck = { ...judgedCheck, judgeGate: () => null };

    const observation = await runCheck(gated, fixture, result, anthropic);

    expect(observation.verdict).toBe('pass');
    expect(observation.judgeInvoked).toBe(true);
    expect(observation.rubricHash).toBeDefined();
    expect(anthropic.callMessages).toHaveBeenCalledTimes(1);
  });

  it('reports judgeInvoked false for a plain structural check', async () => {
    const observation = await runCheck(
      evalChecks['system-rolled-player-action'],
      fakeFixture({
        tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
        applicability: {
          'system-rolled-player-action': {
            applies: true,
            playerEntity: 'Alvarez',
            situation: 'Alvarez declares an attack.',
          },
        },
      }),
      fakeTurnExecutionResult(),
      NO_ANTHROPIC_CALLS_EXPECTED,
    );

    expect(observation.judgeInvoked).toBe(false);
  });
});
