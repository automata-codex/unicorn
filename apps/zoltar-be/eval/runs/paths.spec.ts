import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fixtureArtifactDir,
  judgeArtifactPath,
  listRepDirsOnDisk,
  manifestPath,
  promptTextPath,
  repDir,
  repDirName,
  resolveEvalRoot,
  resolveRunDirArg,
  rubricPath,
  runDirName,
  runDirPath,
  scoresPath,
  wardenOutputPath,
  wardenRequestPath,
} from './paths';

describe('resolveEvalRoot', () => {
  const originalValue = process.env.ZOLTAR_EVAL_ROOT;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-root-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalValue === undefined) {
      delete process.env.ZOLTAR_EVAL_ROOT;
    } else {
      process.env.ZOLTAR_EVAL_ROOT = originalValue;
    }
  });

  it('throws when unset', () => {
    delete process.env.ZOLTAR_EVAL_ROOT;
    expect(() => resolveEvalRoot()).toThrow(/ZOLTAR_EVAL_ROOT is not set/);
  });

  it('throws when relative', () => {
    process.env.ZOLTAR_EVAL_ROOT = 'relative/path';
    expect(() => resolveEvalRoot()).toThrow(/must be an absolute path/);
  });

  it('throws when the path does not exist', () => {
    process.env.ZOLTAR_EVAL_ROOT = join(dir, 'does-not-exist');
    expect(() => resolveEvalRoot()).toThrow(/does not point at an existing directory/);
  });

  it('succeeds on an existing absolute directory', () => {
    process.env.ZOLTAR_EVAL_ROOT = dir;
    expect(resolveEvalRoot()).toBe(dir);
  });
});

describe('path builders', () => {
  const createdAt = new Date('2026-07-26T14:32:10.123Z');

  it('runDirName formats the createdAt component filename-safe', () => {
    expect(runDirName('claude-sonnet-4-6', 'ab12cd34', createdAt)).toBe(
      'claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
    );
  });

  it('produces the spec layout for a known input', () => {
    const root = '/evalroot';
    const dirName = runDirName('claude-sonnet-4-6', 'ab12cd34', createdAt);
    const runDir = runDirPath(root, dirName);

    expect(runDir).toBe(
      '/evalroot/eval-runs/claude-sonnet-4-6__ab12cd34__2026-07-26T14-32-10Z',
    );
    expect(manifestPath(runDir)).toBe(join(runDir, 'manifest.json'));
    expect(promptTextPath(runDir)).toBe(join(runDir, 'prompt.txt'));
    expect(rubricPath(runDir, 'deadbeef')).toBe(
      join(runDir, 'rubrics', 'deadbeef.txt'),
    );
    expect(repDirName(1)).toBe('001');
    expect(repDirName(23)).toBe('023');
    expect(repDir(runDir, 1)).toBe(join(runDir, 'reps', '001'));
    expect(scoresPath(runDir, 1)).toBe(
      join(runDir, 'reps', '001', 'scores.jsonl'),
    );
    expect(fixtureArtifactDir(runDir, 1, 'turn19-out-of-order-resolution')).toBe(
      join(runDir, 'reps', '001', 'turn19-out-of-order-resolution'),
    );
    expect(
      judgeArtifactPath(
        runDir,
        1,
        'turn24-hidden-info-leak',
        'hidden-info-leak',
      ),
    ).toBe(
      join(
        runDir,
        'reps',
        '001',
        'turn24-hidden-info-leak',
        'judge-hidden-info-leak.json',
      ),
    );
    expect(wardenRequestPath(runDir, 1, 'turn19-out-of-order-resolution')).toBe(
      join(
        runDir,
        'reps',
        '001',
        'turn19-out-of-order-resolution',
        'warden-request.json',
      ),
    );
    expect(wardenOutputPath(runDir, 1, 'turn19-out-of-order-resolution')).toBe(
      join(
        runDir,
        'reps',
        '001',
        'turn19-out-of-order-resolution',
        'warden-output.json',
      ),
    );
  });
});

describe('resolveRunDirArg', () => {
  it('uses an absolute path as given', () => {
    expect(resolveRunDirArg('/evalroot', '/elsewhere/some-run')).toBe(
      '/elsewhere/some-run',
    );
  });

  it('resolves a bare name against $ZOLTAR_EVAL_ROOT/eval-runs/', () => {
    expect(resolveRunDirArg('/evalroot', 'claude-sonnet-4-6__ab12cd34__x')).toBe(
      join('/evalroot', 'eval-runs', 'claude-sonnet-4-6__ab12cd34__x'),
    );
  });
});

describe('listRepDirsOnDisk', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-run-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty array when reps/ does not exist', () => {
    expect(listRepDirsOnDisk(root)).toEqual([]);
  });

  it('returns numbered rep directories, sorted, ignoring non-matching entries', () => {
    mkdirSync(join(root, 'reps', '002'), { recursive: true });
    mkdirSync(join(root, 'reps', '001'), { recursive: true });
    mkdirSync(join(root, 'reps', 'not-a-rep'), { recursive: true });
    writeFileSync(join(root, 'reps', 'stray-file.txt'), 'hello');

    expect(listRepDirsOnDisk(root)).toEqual([1, 2]);
  });
});
