#!/usr/bin/env tsx
/**
 * Emits stub retrieval fixtures from the `rules_lookup` queries the Warden
 * actually produced, for a human to label.
 *
 * 596 distinct query strings across 5,139 invocations are recorded in the
 * `unicorn-artifacts` repository (`docs/rules-extraction-findings.md § S8`).
 * They are the only large sample of real Warden query *formation* that
 * exists, and they are the reason the fixture set can reflect the query
 * distribution the Warden generates rather than tidy questions someone
 * invented.
 *
 * **Caps at N per source tag rather than sampling by frequency.** The
 * recorded invocations are dominated by fixture design, not by play — one
 * query string appears 181 times because it sits in a fixture that ran across
 * reps and models (`§ S8.1`). Sampling proportionally would fill the set with
 * combat queries and call it a distribution. Read distinct queries, cap per
 * tag, and the skew goes away.
 *
 * **Stubs are unlabeled and fail closed.** `expectedPages` and `answerable`
 * are emitted as `null`, which the fixture schema rejects outright, so an
 * unedited stub cannot silently score as answerable. A human labels each one
 * against the PSG — not the harness, and not an LLM in the scoring loop:
 * labels generated from the chunks would measure whether the index retrieves
 * what the index contains.
 *
 * Usage:
 *   npx tsx scripts/sample-retrieval-fixtures.ts \
 *     --artifacts ~/projects/unicorn-artifacts [--per-tag 5] [--output <path>]
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { Dirent } from 'node:fs';

interface SampledQuery {
  query: string;
  sourceTag: string;
  invocations: number;
}

/** Recursively collect JSON/JSONL files under a directory. */
async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(path);
      } else if (entry.isFile() && /\.jsonl?$/.test(entry.name)) {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Pull every `rules_lookup` tool_use query out of an arbitrary JSON blob.
 *
 * Tool *definitions* are excluded: a block carrying an `input_schema` is the
 * schema, not an invocation, and counting it would add a phantom query.
 */
export function extractQueries(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) extractQueries(child, into);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const isToolUse =
    record.name === 'rules_lookup' &&
    record.input !== null &&
    typeof record.input === 'object' &&
    record.input_schema === undefined;
  if (isToolUse) {
    const query = (record.input as Record<string, unknown>).query;
    if (typeof query === 'string' && query.trim() !== '')
      into.add(query.trim());
  }

  for (const value of Object.values(record)) extractQueries(value, into);
}

/** `.../<fixtureId>/...` in an eval-run path is the tag we can attribute to. */
function tagFromPath(path: string): string {
  const match = /turn\d+-([a-z-]+)/i.exec(path);
  return match ? match[1].toUpperCase() : 'UNTAGGED';
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      artifacts: { type: 'string' },
      'per-tag': { type: 'string' },
      system: { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (!values.artifacts) {
    process.stderr.write(
      'usage: sample-retrieval-fixtures.ts --artifacts <path-to-unicorn-artifacts> ' +
        '[--per-tag 5] [--system mothership] [--output <path>]\n',
    );
    return 2;
  }
  try {
    await stat(values.artifacts);
  } catch {
    process.stderr.write(`not a directory: ${values.artifacts}\n`);
    return 2;
  }

  const perTag =
    values['per-tag'] === undefined ? 5 : Number(values['per-tag']);
  const system = values.system ?? 'mothership';

  const files = await collectFiles(values.artifacts);
  process.stderr.write(`scanning ${files.length} files\n`);

  const byTag = new Map<string, Set<string>>();
  let totalQueries = 0;
  for (const file of files) {
    const found = new Set<string>();
    try {
      const text = await readFile(file, 'utf8');
      if (file.endsWith('.jsonl')) {
        for (const line of text.split('\n')) {
          if (line.trim() === '') continue;
          try {
            extractQueries(JSON.parse(line), found);
          } catch {
            /* a malformed line is not worth failing the sweep over */
          }
        }
      } else {
        extractQueries(JSON.parse(text), found);
      }
    } catch {
      continue;
    }
    if (found.size === 0) continue;
    totalQueries += found.size;
    const tag = tagFromPath(file);
    const bucket = byTag.get(tag) ?? new Set<string>();
    for (const query of found) bucket.add(query);
    byTag.set(tag, bucket);
  }

  const sampled: SampledQuery[] = [];
  for (const [tag, queries] of [...byTag.entries()].sort()) {
    // Deterministic: sorted, then capped. No RNG, so re-running produces the
    // same stubs and a half-labeled set can be regenerated without churn.
    for (const query of [...queries].sort().slice(0, perTag)) {
      sampled.push({ query, sourceTag: tag, invocations: 0 });
    }
  }

  const lines = sampled.map((entry, index) =>
    JSON.stringify({
      id: `rq-${String(index + 1).padStart(3, '0')}`,
      system,
      query: entry.query,
      queryStyle: 'warden-observed',
      expectedPages: null,
      answerable: null,
      sourceTag: entry.sourceTag,
      source: `sampled from ${entry.sourceTag} eval runs`,
      notes: 'TODO label expectedPages and answerable against the book',
    }),
  );

  const out = `${lines.join('\n')}\n`;
  if (values.output) {
    await writeFile(values.output, out, 'utf8');
    process.stderr.write(`wrote ${lines.length} stubs to ${values.output}\n`);
  } else {
    process.stdout.write(out);
  }

  process.stderr.write(
    `\n${totalQueries} query occurrences across ${byTag.size} tags; ` +
      `${lines.length} stubs emitted (cap ${perTag}/tag).\n` +
      'Every stub has expectedPages: null and answerable: null and will fail to\n' +
      'load until a human labels it against the PSG.\n',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
