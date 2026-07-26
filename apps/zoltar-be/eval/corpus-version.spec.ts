import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeCorpusVersion, shortCorpusVersion } from './corpus-version';

describe('computeCorpusVersion', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-corpus-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(filename: string, id: string, extra = ''): void {
    writeFileSync(
      join(dir, filename),
      JSON.stringify({ id, tag: 'OUT-OF-ORDER-RESOLUTION', extra }),
    );
  }

  it('is stable across two calls with no changes', async () => {
    write('a.json', 'fixture-a');
    write('b.json', 'fixture-b');

    const first = await computeCorpusVersion(dir);
    const second = await computeCorpusVersion(dir);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unchanged when a file is renamed but id and content are the same', async () => {
    write('a.json', 'fixture-a');
    write('b.json', 'fixture-b');
    const before = await computeCorpusVersion(dir);

    renameSync(join(dir, 'a.json'), join(dir, 'renamed-a.json'));
    const after = await computeCorpusVersion(dir);

    expect(after).toBe(before);
  });

  it('changes when a file is edited by one byte', async () => {
    write('a.json', 'fixture-a', 'x');
    const before = await computeCorpusVersion(dir);

    write('a.json', 'fixture-a', 'y');
    const after = await computeCorpusVersion(dir);

    expect(after).not.toBe(before);
  });

  it('changes when a fixture is added', async () => {
    write('a.json', 'fixture-a');
    const before = await computeCorpusVersion(dir);

    write('b.json', 'fixture-b');
    const after = await computeCorpusVersion(dir);

    expect(after).not.toBe(before);
  });

  it('changes when a fixture is removed', async () => {
    write('a.json', 'fixture-a');
    write('b.json', 'fixture-b');
    const before = await computeCorpusVersion(dir);

    rmSync(join(dir, 'b.json'));
    const after = await computeCorpusVersion(dir);

    expect(after).not.toBe(before);
  });

  it('is unaffected by the order files happen to be written in', async () => {
    write('z.json', 'fixture-z');
    write('a.json', 'fixture-a');
    const orderOne = await computeCorpusVersion(dir);

    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'eval-corpus-'));
    write('a.json', 'fixture-a');
    write('z.json', 'fixture-z');
    const orderTwo = await computeCorpusVersion(dir);

    expect(orderOne).toBe(orderTwo);
  });

  it('throws a hard error on a fixture file that fails to parse', async () => {
    write('a.json', 'fixture-a');
    writeFileSync(join(dir, 'broken.json'), '{ not valid json');

    await expect(computeCorpusVersion(dir)).rejects.toThrow(/not valid JSON/);
  });

  it('throws a hard error on a fixture file missing a string id', async () => {
    writeFileSync(join(dir, 'no-id.json'), JSON.stringify({ tag: 'x' }));

    await expect(computeCorpusVersion(dir)).rejects.toThrow(/no string "id"/);
  });
});

describe('shortCorpusVersion', () => {
  it('returns the first 12 hex chars', () => {
    const full = 'a'.repeat(64);
    expect(shortCorpusVersion(full)).toBe('a'.repeat(12));
    expect(shortCorpusVersion(full)).toHaveLength(12);
  });
});
