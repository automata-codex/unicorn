import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeJudgeContractHash,
  findJudgeContractGoldenMismatch,
  findRationaleToolSyntax,
  JUDGE_CLOSING_INSTRUCTION,
  JUDGE_CONTRACT_GOLDEN_PATH,
  JUDGE_MODEL,
  JUDGE_SYSTEM_PROMPT,
  serializeJudgeContract,
} from './judge';

/**
 * Set `UPDATE_JUDGE_CONTRACT_GOLDEN=1` to rewrite the golden from the current
 * render:
 *
 *     UPDATE_JUDGE_CONTRACT_GOLDEN=1 npx vitest run \
 *       eval/checks/judged/judge-contract.spec.ts
 *
 * Deliberately an env var rather than something the suite does for itself,
 * matching `session.assembly.spec.ts`. A golden that self-heals asserts
 * nothing — the point is that changing how the judge is asked costs one
 * explicit step and lands in review as a diff of the text it receives.
 */
const UPDATE = process.env.UPDATE_JUDGE_CONTRACT_GOLDEN === '1';

describe('the judge contract golden', () => {
  it('matches what the code renders today', () => {
    if (UPDATE) {
      writeFileSync(JUDGE_CONTRACT_GOLDEN_PATH, serializeJudgeContract());
      return;
    }
    expect(findJudgeContractGoldenMismatch()).toBeNull();
  });

  it('reports a drifted golden as differing', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'judge-contract-')),
      'golden.txt',
    );
    writeFileSync(path, `${serializeJudgeContract()}an uncommitted edit\n`);
    expect(findJudgeContractGoldenMismatch(path)).toBe('differs');
  });

  it('reports an absent golden as missing rather than throwing', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'judge-contract-')),
      'nothing-here.txt',
    );
    expect(findJudgeContractGoldenMismatch(path)).toBe('missing');
  });
});

describe('serializeJudgeContract', () => {
  // Each of these is a surface that governs a verdict and sat outside every
  // recorded identity before this. A section dropped from the serialization is
  // a surface the hash stops seeing, so these assertions are load-bearing
  // rather than decorative.
  it.each([
    ['# model'],
    ['# system'],
    ['# closingInstruction'],
    ['# tool'],
  ])('renders %s', (label) => {
    expect(serializeJudgeContract()).toContain(label);
  });

  it('carries the model, both prompt fragments and the tool schema verbatim', () => {
    const rendered = serializeJudgeContract();
    expect(rendered).toContain(JUDGE_MODEL);
    expect(rendered).toContain(JUDGE_SYSTEM_PROMPT);
    expect(rendered).toContain(JUDGE_CLOSING_INSTRUCTION);
    expect(rendered).toContain('"name": "judge_verdict"');
  });

  it('renders rationale before passed, which is the contract not a detail', () => {
    // Not incidental, and this assertion has already earned its place: it is
    // the test that failed when the swap landed. The forced tool call makes a
    // model emit fields in schema order, so this ordering is what makes the
    // verdict conditional on completed reasoning rather than narration of a
    // verdict already spent. A serialization that normalized key order would
    // hide the one thing this hash exists to see.
    const rendered = serializeJudgeContract();
    expect(rendered.indexOf('"rationale"')).toBeLessThan(
      rendered.indexOf('"passed"'),
    );
    expect(rendered).toContain(
      '"required": [\n      "rationale",\n      "passed"\n    ]',
    );
  });

  it('labels its sections, so moving text between two of them moves the hash', () => {
    // Same argument as `serializeAssemblySurfaces`: without labels, text
    // migrating from the system prompt into the closing instruction would
    // cancel out and the hash would call two different contracts identical.
    expect(serializeJudgeContract()).toMatch(
      /# system\n[\s\S]*\n\n# closingInstruction\n/,
    );
  });
});

describe('computeJudgeContractHash', () => {
  it('is stable across calls', () => {
    expect(computeJudgeContractHash()).toBe(computeJudgeContractHash());
  });

  it('is 8 hex chars, matching promptHash and assemblyHash', () => {
    expect(computeJudgeContractHash()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('findRationaleToolSyntax', () => {
  // 7 of 1,341 rationales on disk carry leaked markup, one of them in the
  // spec 019 run. ADR-0097 scoped tool-syntax detection to the Warden and
  // nothing guarded judge_verdict.
  it('catches a leaked judge_verdict property tag', () => {
    // The case the default key set misses: `rationale` is a judge_verdict
    // property, not a submit_gm_response one, so pointing the unmodified
    // detector at this string would find nothing.
    expect(
      findRationaleToolSyntax('The turn is fine.</rationale>'),
    ).toContain('rationale');
  });

  it('catches a canonical tool-call element', () => {
    expect(
      findRationaleToolSyntax('No leak here.</invoke>'),
    ).toBeDefined();
  });

  it('returns undefined for an ordinary rationale', () => {
    expect(
      findRationaleToolSyntax(
        'The narration stops before the roll resolves, which the rubric asks for.',
      ),
    ).toBeUndefined();
  });

  it('does not fire on prose that merely mentions a field name', () => {
    // Structural matching, not semantic: only whole tags count, so a
    // rationale discussing the schema in words stays clean. Rationales talk
    // about `passed` and `rationale` constantly, so this is the common case
    // rather than an edge one.
    expect(
      findRationaleToolSyntax(
        'The judge passed this because the rationale explains the gap.',
      ),
    ).toBeUndefined();
  });
});
