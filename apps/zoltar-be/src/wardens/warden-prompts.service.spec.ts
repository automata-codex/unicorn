import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WardenPromptsService } from './warden-prompts.service';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

function mkService(config: ConfigService): WardenPromptsService {
  const svc = new WardenPromptsService(config);
  svc.onModuleInit();
  return svc;
}

describe('WardenPromptsService', () => {
  let dir: string;
  let prevOverride: string | undefined;

  beforeEach(() => {
    prevOverride = process.env.WARDENS_PROMPTS_DIR;
    dir = mkdtempSync(join(tmpdir(), 'wardens-service-'));
    process.env.WARDENS_PROMPTS_DIR = dir;
  });

  afterEach(() => {
    if (prevOverride === undefined) delete process.env.WARDENS_PROMPTS_DIR;
    else process.env.WARDENS_PROMPTS_DIR = prevOverride;
    rmSync(dir, { recursive: true, force: true });
  });

  it('discovers every mothership-*.txt prompt and hashes each', () => {
    writeFileSync(join(dir, 'mothership-m6.txt'), 'older');
    writeFileSync(join(dir, 'mothership-m7.txt'), 'current');
    const svc = mkService(makeConfig({}));
    const all = svc.getAll('mothership');
    const names = all.map((p) => p.filename).sort();
    expect(names).toEqual(['mothership-m6.txt', 'mothership-m7.txt']);
    const m7 = all.find((p) => p.filename === 'mothership-m7.txt')!;
    expect(m7.text).toBe('current');
    expect(m7.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ignores non-.txt files and files with unknown system prefixes', () => {
    writeFileSync(join(dir, 'mothership-m7.txt'), 'ok');
    writeFileSync(join(dir, 'mothership-m7.bak'), 'skip');
    writeFileSync(join(dir, 'uvg-m1.txt'), 'skip');
    writeFileSync(join(dir, 'README.md'), 'skip');
    const svc = mkService(makeConfig({}));
    const names = svc.getAll('mothership').map((p) => p.filename);
    expect(names).toEqual(['mothership-m7.txt']);
  });

  it('produces identical hashes for identical text, distinct hashes for one-byte changes', () => {
    writeFileSync(join(dir, 'mothership-m1.txt'), 'same bytes');
    writeFileSync(join(dir, 'mothership-m2.txt'), 'same bytes');
    writeFileSync(join(dir, 'mothership-m3.txt'), 'same bytex');
    const svc = mkService(makeConfig({}));
    const byName = new Map(
      svc.getAll('mothership').map((p) => [p.filename, p]),
    );
    expect(byName.get('mothership-m1.txt')!.hash).toBe(
      byName.get('mothership-m2.txt')!.hash,
    );
    expect(byName.get('mothership-m1.txt')!.hash).not.toBe(
      byName.get('mothership-m3.txt')!.hash,
    );
  });

  it('selects the highest-versioned prompt by default', () => {
    writeFileSync(join(dir, 'mothership-m6.txt'), 'm6');
    writeFileSync(join(dir, 'mothership-m7.txt'), 'm7');
    writeFileSync(join(dir, 'mothership-m7a.txt'), 'm7a');
    writeFileSync(join(dir, 'mothership-m7b.txt'), 'm7b');
    const svc = mkService(makeConfig({}));
    expect(svc.getSelected('mothership').filename).toBe('mothership-m7b.txt');
  });

  it('sorts versions numerically, so m10 beats m9', () => {
    writeFileSync(join(dir, 'mothership-m9.txt'), 'm9');
    writeFileSync(join(dir, 'mothership-m10.txt'), 'm10');
    const svc = mkService(makeConfig({}));
    expect(svc.getSelected('mothership').filename).toBe('mothership-m10.txt');
  });

  it('honors WARDEN_PROMPT_OVERRIDE_MOTHERSHIP when it names an existing file', () => {
    writeFileSync(join(dir, 'mothership-m7.txt'), 'm7');
    writeFileSync(join(dir, 'mothership-m7a.txt'), 'm7a');
    const svc = mkService(
      makeConfig({ WARDEN_PROMPT_OVERRIDE_MOTHERSHIP: 'mothership-m7.txt' }),
    );
    expect(svc.getSelected('mothership').filename).toBe('mothership-m7.txt');
  });

  it('throws at init when the override names a missing file', () => {
    writeFileSync(join(dir, 'mothership-m7.txt'), 'm7');
    const svc = new WardenPromptsService(
      makeConfig({ WARDEN_PROMPT_OVERRIDE_MOTHERSHIP: 'mothership-ghost.txt' }),
    );
    expect(() => svc.onModuleInit()).toThrow(
      /WARDEN_PROMPT_OVERRIDE_MOTHERSHIP=mothership-ghost\.txt/,
    );
  });

  it('throws on getSelected when no prompts exist for the requested system', () => {
    const svc = mkService(makeConfig({}));
    expect(() => svc.getSelected('mothership')).toThrow(
      /No Warden prompt available for system 'mothership'/,
    );
  });

  it('getByFilename finds a known prompt and returns null for unknowns', () => {
    writeFileSync(join(dir, 'mothership-m7.txt'), 'm7');
    const svc = mkService(makeConfig({}));
    expect(svc.getByFilename('mothership', 'mothership-m7.txt')?.text).toBe(
      'm7',
    );
    expect(svc.getByFilename('mothership', 'mothership-ghost.txt')).toBeNull();
  });
});
