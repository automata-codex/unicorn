#!/usr/bin/env tsx
/**
 * Validates the ADR corpus. Fails the build on a dangling identifier, a
 * duplicate, a filename that disagrees with its front matter, or a stale
 * generated index.
 *
 * It deliberately does not validate bare `§` references. Two thirds of the
 * `§` tokens in this repo are numeric citations into the Mothership rulebook
 * or into `rules-extraction-findings.md`, and none of them address this log.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { ADR_TOKEN_PATTERN, idToNumber } from './adr.core';
import {
  allDocsMarkdown,
  INDEX_HEADER_PATH,
  INDEX_PATH,
  loadCorpus,
  REPO_ROOT,
} from './corpus';
import { renderIndex } from './render-index';

const errors: string[] = [];
const fail = (message: string) => errors.push(message);

// A malformed file throws during load — an invalid area, a missing key, an
// unterminated front matter block. Report it as a check failure rather than
// letting a Zod stack trace reach the contributor who typo'd the area.
let corpus: ReturnType<typeof loadCorpus>;
try {
  corpus = loadCorpus();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error('ADR corpus check failed — a file could not be read:\n');
  console.error(`  - ${detail.replace(/\n/g, '\n    ')}`);
  process.exit(1);
}

const knownIds = new Set(corpus.map((a) => a.frontMatter.id));

// Duplicate identifiers.
const seen = new Map<string, string>();
for (const adr of corpus) {
  const previous = seen.get(adr.frontMatter.id);
  if (previous) {
    fail(`duplicate id ${adr.frontMatter.id}: ${previous} and ${adr.filename}`);
  }
  seen.set(adr.frontMatter.id, adr.filename);
}

// Filename number must agree with front matter.
for (const adr of corpus) {
  const prefix = adr.filename.slice(0, 4);
  if (!/^\d{4}$/.test(prefix)) {
    fail(`${adr.filename}: filename must begin with a four-digit number`);
    continue;
  }
  if (Number.parseInt(prefix, 10) !== idToNumber(adr.frontMatter.id)) {
    fail(
      `${adr.filename}: filename number disagrees with ${adr.frontMatter.id}`,
    );
  }
}

// A superseded entry needs a target that exists.
for (const adr of corpus) {
  const target = adr.frontMatter.superseded_by;
  if (target !== null && !knownIds.has(target)) {
    fail(`${adr.filename}: superseded_by ${target} does not resolve`);
  }
}

// Unsettled entries are reported, not constrained. This was once an assertion
// that exactly one entry carried `status: open` — a guard against a mechanical
// mis-classification during the spec 017 split, when exactly one entry in the
// legacy log was open. That migration is done, and the count was never a policy
// about how many questions may be open at a time. Listing them keeps them
// visible without inventing a limit nobody chose.
const unsettled = corpus.filter(
  (a) =>
    a.frontMatter.status === 'open' || a.frontMatter.status === 'provisional',
);

// Every ADR token anywhere under docs/ must resolve.
for (const path of allDocsMarkdown()) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(ADR_TOKEN_PATTERN)) {
    if (!knownIds.has(match[0])) {
      fail(`${relative(REPO_ROOT, path)}: ${match[0]} does not resolve`);
    }
  }
}

// The committed index must match what the compiler produces.
const expected = renderIndex(readFileSync(INDEX_HEADER_PATH, 'utf8'), corpus);
if (readFileSync(INDEX_PATH, 'utf8') !== expected) {
  fail('docs/decisions.md is stale — run `task docs:decisions:build`');
}

if (errors.length > 0) {
  console.error(`ADR corpus check failed with ${errors.length} problem(s):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`ADR corpus OK — ${corpus.length} entries, index up to date.`);
for (const adr of unsettled) {
  console.log(
    `  ${adr.frontMatter.status}: ${adr.frontMatter.id} — ${adr.frontMatter.title}`,
  );
}
