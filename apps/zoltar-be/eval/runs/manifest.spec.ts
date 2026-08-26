import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendCompletedRep,
  assertManifestMatches,
  createRunDirectory,
  manifestSchema,
  nextRepIndex,
  readManifest,
} from './manifest';
import { manifestPath } from './paths';

import type { CompletedRep, Manifest } from './manifest';

const CREATED_AT = new Date('2026-07-26T14:32:10.000Z');

function baseOptions(root: string) {
  return {
    root,
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    promptText: 'You are the Warden...',
    temperature: 1.0,
    corpusVersion: 'deadbeef'.repeat(8),
    assemblyHash: 'a55e3b19',
    plannedReps: 3,
    createdAt: CREATED_AT,
  };
}

function completedRep(overrides: Partial<CompletedRep> = {}): CompletedRep {
  return {
    index: 1,
    harnessVersion: 'abc1234',
    rubricHashes: {},
    fixtureIds: ['turn19-out-of-order-resolution'],
    startedAt: '2026-07-26T14:33:00.000Z',
    completedAt: '2026-07-26T14:35:00.000Z',
    ...overrides,
  };
}

describe('createRunDirectory / readManifest round-trip', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-manifest-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates manifest.json and prompt.txt and round-trips', () => {
    const opts = baseOptions(root);
    const runDir = createRunDirectory(opts);

    expect(existsSync(manifestPath(runDir))).toBe(true);
    expect(readFileSync(join(runDir, 'prompt.txt'), 'utf-8')).toBe(
      opts.promptText,
    );

    const manifest = readManifest(runDir);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.model).toBe(opts.model);
    expect(manifest.promptHash).toBe(opts.promptHash);
    expect(manifest.temperature).toBe(opts.temperature);
    expect(manifest.corpusVersion).toBe(opts.corpusVersion);
    expect(manifest.plannedReps).toBe(3);
    expect(manifest.completedReps).toEqual([]);
    expect(manifest.createdAt).toBe(CREATED_AT.toISOString());
  });

  it('carries decisionRule when given and omits it when not', () => {
    const withRuleRoot = mkdtempSync(join(tmpdir(), 'eval-manifest-rule-'));
    const withRule = createRunDirectory({
      ...baseOptions(withRuleRoot),
      decisionRule: 'ship if no fixture drops >0.2',
    });
    expect(readManifest(withRule).decisionRule).toBe(
      'ship if no fixture drops >0.2',
    );
    rmSync(withRuleRoot, { recursive: true, force: true });

    const withoutRule = createRunDirectory(baseOptions(root));
    expect(readManifest(withoutRule).decisionRule).toBeUndefined();
  });

  it('refuses to clobber an existing run directory', () => {
    const opts = baseOptions(root);
    createRunDirectory(opts);
    expect(() => createRunDirectory(opts)).toThrow(/already exists/);
  });

  it('rejects a manifest missing required fields', () => {
    expect(() => manifestSchema.parse({ schemaVersion: 1 })).toThrow();
  });
});

describe('assertManifestMatches', () => {
  const manifest: Manifest = {
    schemaVersion: 1,
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    assemblyHash: 'a55e3b19',
    createdAt: CREATED_AT.toISOString(),
    plannedReps: 3,
    completedReps: [],
  };

  it('passes when model, promptHash, temperature and assemblyHash all match', () => {
    expect(() =>
      assertManifestMatches(manifest, {
        model: 'claude-sonnet-4-6',
        promptHash: 'ab12cd34',
        temperature: 1.0,
        assemblyHash: 'a55e3b19',
      }),
    ).not.toThrow();
  });

  it('rejects a changed model', () => {
    expect(() =>
      assertManifestMatches(manifest, {
        model: 'claude-opus-5',
        promptHash: 'ab12cd34',
        temperature: 1.0,
        assemblyHash: 'a55e3b19',
      }),
    ).toThrow(/model:/);
  });

  it('rejects a changed promptHash', () => {
    expect(() =>
      assertManifestMatches(manifest, {
        model: 'claude-sonnet-4-6',
        promptHash: 'zzzzzzzz',
        temperature: 1.0,
        assemblyHash: 'a55e3b19',
      }),
    ).toThrow(/promptHash:/);
  });

  it('rejects a changed temperature', () => {
    expect(() =>
      assertManifestMatches(manifest, {
        model: 'claude-sonnet-4-6',
        promptHash: 'ab12cd34',
        temperature: 0.5,
        assemblyHash: 'a55e3b19',
      }),
    ).toThrow(/temperature:/);
  });

  it('rejects a changed assemblyHash', () => {
    // Appending reps after the tool schema or a formatter changed would
    // put two different prompts under one run id.
    expect(() =>
      assertManifestMatches(
        { ...manifest, assemblyHash: 'a55e3b19' },
        {
          model: 'claude-sonnet-4-6',
          promptHash: 'ab12cd34',
          temperature: 1.0,
          assemblyHash: '0bb41002',
        },
      ),
    ).toThrow(/assemblyHash:/);
  });

  it('accepts a manifest predating assemblyHash rather than blocking on it', () => {
    // Absent means "unknown", not "unchanged" — refusing to append would be
    // asserting a mismatch that cannot be observed.
    const { assemblyHash: _omitted, ...withoutHash } = {
      ...manifest,
      assemblyHash: 'a55e3b19',
    };
    expect(() =>
      assertManifestMatches(withoutHash, {
        model: 'claude-sonnet-4-6',
        promptHash: 'ab12cd34',
        temperature: 1.0,
        assemblyHash: '0bb41002',
      }),
    ).not.toThrow();
  });

  it('reports every mismatch at once', () => {
    try {
      assertManifestMatches(
        { ...manifest, assemblyHash: 'a55e3b19' },
        {
          model: 'claude-opus-5',
          promptHash: 'zzzzzzzz',
          temperature: 0.5,
          assemblyHash: '0bb41002',
        },
      );
      throw new Error('expected assertManifestMatches to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/model:/);
      expect(message).toMatch(/promptHash:/);
      expect(message).toMatch(/temperature:/);
    }
  });
});

describe('judgeContractHash on a completed rep', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-contract-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips when recorded', () => {
    const runDir = createRunDirectory(baseOptions(root));
    appendCompletedRep(
      runDir,
      completedRep({ index: 1, judgeContractHash: 'fbbd8e46' }),
    );
    expect(readManifest(runDir).completedReps[0].judgeContractHash).toBe(
      'fbbd8e46',
    );
  });

  it('parses a rep that predates the field rather than rejecting it', () => {
    // Every rep on disk today was written before this existed. An absent
    // value means the contract is unknown, never that it was unchanged.
    const runDir = createRunDirectory(baseOptions(root));
    appendCompletedRep(runDir, completedRep({ index: 1 }));
    expect(
      readManifest(runDir).completedReps[0].judgeContractHash,
    ).toBeUndefined();
  });
});

describe('appendCompletedRep', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-append-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is atomic: appends twice, both entries present and JSON valid throughout', () => {
    const runDir = createRunDirectory(baseOptions(root));

    const warning1 = appendCompletedRep(runDir, completedRep({ index: 1 }));
    expect(warning1).toBeNull();
    expect(readManifest(runDir).completedReps.map((r) => r.index)).toEqual([1]);
    expect(() =>
      JSON.parse(readFileSync(manifestPath(runDir), 'utf-8')),
    ).not.toThrow();

    const warning2 = appendCompletedRep(runDir, completedRep({ index: 2 }));
    expect(warning2).toBeNull();
    expect(readManifest(runDir).completedReps.map((r) => r.index)).toEqual([
      1, 2,
    ]);
    expect(() =>
      JSON.parse(readFileSync(manifestPath(runDir), 'utf-8')),
    ).not.toThrow();
  });

  it('warns, but does not throw, when completedReps exceeds plannedReps', () => {
    const runDir = createRunDirectory({
      ...baseOptions(root),
      plannedReps: 1,
    });

    const warning1 = appendCompletedRep(runDir, completedRep({ index: 1 }));
    expect(warning1).toBeNull();

    const warning2 = appendCompletedRep(runDir, completedRep({ index: 2 }));
    expect(warning2).toMatch(/exceeds plannedReps/);
    expect(readManifest(runDir).plannedReps).toBe(1);
  });
});

describe('nextRepIndex', () => {
  const manifest = (completedReps: CompletedRep[]): Manifest => ({
    schemaVersion: 1,
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    assemblyHash: 'a55e3b19',
    createdAt: CREATED_AT.toISOString(),
    plannedReps: 5,
    completedReps,
  });

  it('returns 1 when empty', () => {
    expect(nextRepIndex(manifest([]))).toBe(1);
  });

  it('returns max + 1 for contiguous entries', () => {
    expect(
      nextRepIndex(
        manifest([completedRep({ index: 1 }), completedRep({ index: 2 })]),
      ),
    ).toBe(3);
  });

  it('returns max + 1 for gapped entries', () => {
    expect(
      nextRepIndex(
        manifest([completedRep({ index: 1 }), completedRep({ index: 5 })]),
      ),
    ).toBe(6);
  });
});
