/**
 * Filesystem access for the ADR corpus. Kept apart from `adr.core.ts` so the
 * core stays pure and testable without fixtures on disk.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';

import { type AdrFile, idToNumber, parseAdrFile } from './adr.core';

export const REPO_ROOT = join(import.meta.dirname, '..', '..');
export const DOCS_DIR = join(REPO_ROOT, 'docs');
export const ADR_DIR = join(DOCS_DIR, 'decisions');
export const INDEX_PATH = join(DOCS_DIR, 'decisions.md');
/** The same corpus rendered through each entry's `summary`, where one exists. */
export const SUMMARY_INDEX_PATH = join(DOCS_DIR, 'decisions-summary.md');
export const INDEX_HEADER_PATH = join(ADR_DIR, '_index-header.md');

/** Zod's default message is a JSON dump; reduce it to the failing keys. */
function describe(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

export interface LoadedAdr extends AdrFile {
  filename: string;
}

/** Every ADR file, sorted by id. Files beginning with `_` are not entries. */
export function loadCorpus(): LoadedAdr[] {
  const filenames = readdirSync(ADR_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .filter((f) => f !== 'README.md')
    .sort();

  const loaded = filenames.map((filename) => {
    const text = readFileSync(join(ADR_DIR, filename), 'utf8');
    try {
      return { filename, ...parseAdrFile(text) };
    } catch (error) {
      throw new Error(`${filename}: ${describe(error)}`);
    }
  });

  return loaded.sort(
    (a, b) => idToNumber(a.frontMatter.id) - idToNumber(b.frontMatter.id),
  );
}

/** Every markdown file under `docs/`, recursively. */
export function allDocsMarkdown(dir = DOCS_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...allDocsMarkdown(path));
    } else if (name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out.sort();
}
