/**
 * `task leaks:corpus` — runs `recoverLeakedPayload` over every leaked
 * `submit_gm_response` in the archive and reports how many it recovers
 * (spec 026).
 *
 * The unit tests say what the function does with each known shape. This
 * answers the two things they cannot: what share of real leaks is
 * recovered, and whether a run or playtest produced a shape nobody has
 * written a case for. Each refusal it lists is a candidate for a new case in
 * `src/session/session.tool-syntax-recovery.cases.ts`.
 *
 * The corpus is every object, in any `.json` file under `$ZOLTAR_EVAL_ROOT`,
 * whose `playerText` trips the leak detector. That covers old eval runs'
 * `warden-output.json`, the `toolSyntaxLeaks` saved by `ev2:run`, and the
 * `-tool-leaks.json` files `playtest:review` writes.
 *
 * Reads files only: no database, no Anthropic, no Voyage, no cost.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findToolCallSyntax } from '../src/session/session.tool-syntax';
import { recoverLeakedPayload } from '../src/session/session.tool-syntax-recovery';

type Payload = Record<string, unknown> & { playerText: string };

function jsonFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsonFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

/** Every leaked payload anywhere inside a parsed JSON document. */
function leakedPayloadsIn(value: unknown, found: Payload[] = []): Payload[] {
  if (Array.isArray(value)) {
    for (const item of value) leakedPayloadsIn(item, found);
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.playerText === 'string' &&
      findToolCallSyntax(record.playerText)
    ) {
      found.push(record as Payload);
    }
    for (const child of Object.values(record)) leakedPayloadsIn(child, found);
  }
  return found;
}

/**
 * Some archived copies are stored event payloads, not raw tool inputs, and
 * carry `null` for each field the model did not send. A raw input simply
 * omits them, so drop them to get back what the function would have seen.
 */
function withoutNullFields(payload: Payload): Payload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null),
  ) as Payload;
}

function main(): void {
  const root = process.env.ZOLTAR_EVAL_ROOT;
  if (!root) throw new Error('ZOLTAR_EVAL_ROOT is not set.');

  // Distinct by `playerText`: the same leak is replayed as history in many
  // later fixtures, and counting each copy would weight the rate by how
  // often a turn was captured.
  const corpus = new Map<string, { payload: Payload; file: string }>();
  let unreadable = 0;
  for (const file of jsonFilesUnder(root)) {
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      unreadable++;
      continue;
    }
    for (const payload of leakedPayloadsIn(document)) {
      if (!corpus.has(payload.playerText)) {
        corpus.set(payload.playerText, { payload, file: relative(root, file) });
      }
    }
  }

  const refusals: Array<{ reason: string; file: string }> = [];
  for (const { payload, file } of corpus.values()) {
    const result = recoverLeakedPayload(withoutNullFields(payload));
    if (!result.ok) refusals.push({ reason: result.reason, file });
  }

  const total = corpus.size;
  const recovered = total - refusals.length;
  const share = total === 0 ? 0 : (100 * recovered) / total;
  console.log(`recovered ${recovered} of ${total} (${share.toFixed(1)}%)`);
  if (unreadable > 0) {
    console.log(`skipped ${unreadable} file(s) that are not valid JSON`);
  }
  if (refusals.length > 0) {
    console.log('\nrefused:');
    refusals.sort((a, b) => a.reason.localeCompare(b.reason));
    for (const { reason, file } of refusals) {
      console.log(`  ${reason.padEnd(21)}${file}`);
    }
  }
}

main();
