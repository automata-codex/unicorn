import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashPromptText, rereadPromptFile } from './prompt-paths';

describe('hashPromptText', () => {
  it('returns an 8-char hex prefix of the sha256 digest', () => {
    const h = hashPromptText('hello world');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across calls for identical input', () => {
    expect(hashPromptText('abc')).toBe(hashPromptText('abc'));
  });

  it('changes when any byte changes', () => {
    const a = hashPromptText('mothership ruleset v1');
    const b = hashPromptText('mothership ruleset v2');
    expect(a).not.toBe(b);
  });
});

describe('rereadPromptFile', () => {
  let dir: string;
  let prevOverride: string | undefined;

  beforeEach(() => {
    prevOverride = process.env.WARDENS_PROMPTS_DIR;
    dir = mkdtempSync(join(tmpdir(), 'wardens-reread-'));
    process.env.WARDENS_PROMPTS_DIR = dir;
  });

  afterEach(() => {
    if (prevOverride === undefined) delete process.env.WARDENS_PROMPTS_DIR;
    else process.env.WARDENS_PROMPTS_DIR = prevOverride;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns filename, hash, and current on-disk text', () => {
    writeFileSync(join(dir, 'mothership-test.txt'), 'first');
    const file = rereadPromptFile('mothership', 'mothership-test.txt');
    expect(file).not.toBeNull();
    expect(file!.filename).toBe('mothership-test.txt');
    expect(file!.text).toBe('first');
    expect(file!.hash).toBe(hashPromptText('first'));
  });

  it('reflects in-place edits on subsequent reads', () => {
    writeFileSync(join(dir, 'mothership-test.txt'), 'first');
    const before = rereadPromptFile('mothership', 'mothership-test.txt');
    writeFileSync(join(dir, 'mothership-test.txt'), 'second');
    const after = rereadPromptFile('mothership', 'mothership-test.txt');
    expect(before!.hash).not.toBe(after!.hash);
    expect(after!.text).toBe('second');
  });

  it('returns null for a missing file', () => {
    expect(rereadPromptFile('mothership', 'mothership-missing.txt')).toBeNull();
  });

  it('refuses filenames that do not match the system prefix', () => {
    writeFileSync(join(dir, 'other-m1.txt'), 'x');
    expect(rereadPromptFile('mothership', 'other-m1.txt')).toBeNull();
  });

  it('refuses filenames without the .txt extension', () => {
    writeFileSync(join(dir, 'mothership-m7.md'), 'x');
    expect(rereadPromptFile('mothership', 'mothership-m7.md')).toBeNull();
  });
});
