import { submitGmResponseSchema } from './session.schema';
import { findToolCallSyntax } from './session.tool-syntax';
import { SUBMIT_GM_RESPONSE_TOOL } from './session.tools';

import type { SubmitGmResponse } from './session.schema';

/**
 * Puts a leaked `submit_gm_response` back together (`ADR-0097` Addendum 4,
 * spec 026).
 *
 * ## What a leak is
 *
 * The model closes `playerText` with the wrong tag — `</playerText>` rather
 * than `</parameter>` — so the string runs on and swallows whatever
 * parameter came next, as text. That parameter was usually correct. This
 * reads it back out and returns the payload the model meant to send.
 *
 * ## How it reads the text
 *
 * `playerText` is cut at the first leaked tag. What is before the cut is the
 * narration. What is after it is a list of fields, each opened by
 * `<parameter name="X">` or `<X>`. One rule reads a field's value, at every
 * depth, guided by what the tool's JSON schema expects there:
 *
 * 1. a string is expected: the text as written
 * 2. the text is JSON: that JSON
 * 3. an object is expected: the text is a list of fields; read each by this rule
 * 4. a number, boolean or null is expected: that literal
 * 5. otherwise: refuse
 *
 * ## All or nothing
 *
 * The result is a whole payload or a refusal. Every character after the cut
 * has to be parsed into a field (or be whitespace or a closing tag);
 * anything left over is a refusal, because `gmUpdates.notes` is
 * Warden-private and must never be left behind in the narration. Values are
 * moved to where they belong and never repaired: the merged payload has to
 * pass `submitGmResponseSchema` as it stands.
 *
 * `session.tool-syntax-recovery.cases.ts` is the record of what this does
 * with each shape of leak seen so far.
 */

/**
 * Why a leaked payload could not be put back together. Every reason leaves
 * the turn path doing what it did before recovery existed: one retry, then
 * `SessionToolSyntaxError`.
 */
export type RefusalReason =
  /** `playerText` carries no tool-call markup; there is nothing to recover. */
  | 'no_leak'
  /** The text contains a call to a different tool (`<invoke name="…">`). */
  | 'other_tool_call'
  /** A tag carries an attribute other than `name` (`<entity id="…">`). */
  | 'unexpected_attribute'
  /** A tag names a field the schema does not have at that position. */
  | 'unknown_field'
  /** An array written as tags rather than as JSON. */
  | 'array_as_tags'
  /** A value that is neither valid JSON nor a literal of the expected type. */
  | 'bad_value'
  /** Text after the narration that was not parsed into any field. */
  | 'leftover_text'
  /** A recovered field also arrived as a real parameter, or appears twice. */
  | 'collision'
  /** The merged payload fails `submitGmResponseSchema`. */
  | 'schema_invalid';

export type Recovery =
  | { ok: true; payload: SubmitGmResponse }
  | { ok: false; reason: RefusalReason };

/** The parts of a JSON Schema node this walk reads. */
interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  anyOf?: SchemaNode[];
}

type JsonType = 'string' | 'object' | 'array' | 'number' | 'boolean' | 'null';

/**
 * The same document the model is given. Generated with `$refStrategy:
 * 'none'` (`session.tools.ts`), so there are no references to resolve.
 */
const ROOT_SCHEMA = SUBMIT_GM_RESPONSE_TOOL.input_schema as SchemaNode;

/** A node is either one shape or an `anyOf` of several. */
function branches(node: SchemaNode): SchemaNode[] {
  return node.anyOf ?? [node];
}

function allows(node: SchemaNode, type: JsonType): boolean {
  return branches(node).some(
    (b) => b.type === type || (type === 'number' && b.type === 'integer'),
  );
}

/**
 * The schema for field `key` of an object node: a named property, or the
 * value schema of a record (`flags`, `entities`, `worldFacts`, …), where any
 * key is allowed. `undefined` means the object has no such field.
 */
function childSchema(node: SchemaNode, key: string): SchemaNode | undefined {
  for (const b of branches(node)) {
    const named = b.properties?.[key];
    if (named) return named;
  }
  for (const b of branches(node)) {
    if (typeof b.additionalProperties === 'object') {
      return b.additionalProperties;
    }
  }
  return undefined;
}

/** Thrown inside the parser to abandon the whole recovery. */
class Refusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

const PARAMETER_OPENER = /^<parameter\s+name="([^"]*)"\s*>/;
const BARE_OPENER = /^<([A-Za-z_][A-Za-z0-9_]*)>/;
const OPENER_WITH_ATTRIBUTE = /^<[A-Za-z_][A-Za-z0-9_]*\s[^>]*>/;

/**
 * Closing tags that carry no content and may appear between or after
 * top-level fields: the wrong tag that started the leak, and the end of the
 * call the model went on to write out.
 */
const IGNORABLE_CLOSER =
  /^<\/(?:playerText|parameter|invoke|submit_gm_response|function_calls)>/;

/** Any closing tag. A text value should never contain one. */
const CLOSING_TAG = /<\/[A-Za-z_][A-Za-z0-9_]*>/;

interface Opener {
  key: string;
  /** The tag that closes this field. May be missing from the text. */
  closer: string;
  length: number;
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  /** The whole tail, as top-level `submit_gm_response` fields. */
  parseTop(): Record<string, unknown> {
    return this.parseFields(ROOT_SCHEMA, null);
  }

  /**
   * Reads fields until the container ends. `ownCloser` is `null` at the top
   * level, where the input has to be used up entirely.
   *
   * A nested container stops, without consuming anything, at whatever it
   * does not recognise. Its closing tag is often missing, so the next thing
   * may belong to its parent. The top level has no parent to hand off to,
   * and refuses.
   */
  private parseFields(
    node: SchemaNode,
    ownCloser: string | null,
  ): Record<string, unknown> {
    const top = ownCloser === null;
    const fields: Record<string, unknown> = {};

    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.text.length) return fields;

      if (ownCloser !== null && this.text.startsWith(ownCloser, this.pos)) {
        this.pos += ownCloser.length;
        return fields;
      }
      if (top) {
        const ignorable = IGNORABLE_CLOSER.exec(this.rest());
        if (ignorable) {
          this.pos += ignorable[0].length;
          continue;
        }
      }

      const opener = this.readOpener();
      if (!opener) {
        if (top) throw new Refusal('leftover_text');
        return fields;
      }
      const child = childSchema(node, opener.key);
      if (!child) {
        if (top) throw new Refusal('unknown_field');
        return fields;
      }
      if (opener.key in fields) throw new Refusal('collision');

      this.pos += opener.length;
      fields[opener.key] = this.parseValue(child, opener.closer);
    }
  }

  private parseValue(node: SchemaNode, closer: string): unknown {
    // 1. A string is expected: the text as written.
    if (allows(node, 'string')) {
      const end = this.text.indexOf(closer, this.pos);
      const raw =
        end === -1 ? this.text.slice(this.pos) : this.text.slice(this.pos, end);
      // With its own closing tag missing, a text value runs to the next one
      // of the same name, or to the end, and could take other fields with
      // it. Markup inside a text value means that happened.
      if (CLOSING_TAG.test(raw) || findToolCallSyntax(raw)) {
        throw new Refusal('leftover_text');
      }
      this.pos = end === -1 ? this.text.length : end + closer.length;
      const value = raw.trim();
      return value === 'null' && allows(node, 'null') ? null : value;
    }

    this.skipWhitespace();
    const first = this.text[this.pos];

    // 2. The text is JSON: that JSON.
    if (first === '{' || first === '[') {
      const end = this.endOfJson();
      const value = parseJson(this.text.slice(this.pos, end));
      this.pos = end;
      this.consume(closer);
      return value;
    }

    // 3. An object is expected: the text is a list of fields.
    if (first === '<' || first === undefined) {
      if (allows(node, 'object')) return this.parseFields(node, closer);
      if (allows(node, 'array')) throw new Refusal('array_as_tags');
      throw new Refusal('bad_value');
    }

    // 4. A number, boolean or null is expected: that literal.
    const next = this.text.indexOf('<', this.pos);
    const end = next === -1 ? this.text.length : next;
    const value = parseJson(this.text.slice(this.pos, end).trim());
    const expected =
      (typeof value === 'number' && allows(node, 'number')) ||
      (typeof value === 'boolean' && allows(node, 'boolean')) ||
      (value === null && allows(node, 'null'));
    if (!expected) throw new Refusal('bad_value');
    this.pos = end;
    this.consume(closer);
    return value;
  }

  private readOpener(): Opener | null {
    const rest = this.rest();
    const parameter = PARAMETER_OPENER.exec(rest);
    if (parameter) {
      return {
        key: parameter[1],
        closer: '</parameter>',
        length: parameter[0].length,
      };
    }
    const bare = BARE_OPENER.exec(rest);
    if (bare) {
      return { key: bare[1], closer: `</${bare[1]}>`, length: bare[0].length };
    }
    if (OPENER_WITH_ATTRIBUTE.test(rest)) {
      throw new Refusal('unexpected_attribute');
    }
    return null;
  }

  /**
   * Index just past the JSON object or array starting at `pos`, found by
   * matching brackets outside string literals.
   */
  private endOfJson(): number {
    let depth = 0;
    let inString = false;
    for (let i = this.pos; i < this.text.length; i++) {
      const ch = this.text[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    throw new Refusal('bad_value');
  }

  /** Steps over `closer` if it is next. It is often missing. */
  private consume(closer: string): void {
    this.skipWhitespace();
    if (this.text.startsWith(closer, this.pos)) this.pos += closer.length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  private rest(): string {
    return this.text.slice(this.pos);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal('bad_value');
  }
}

/**
 * Recovers the payload from a `submit_gm_response` input whose `playerText`
 * carries leaked tool-call markup. `rawInput` is the `tool_use` block's
 * input as the API returned it, and is not modified.
 */
export function recoverLeakedPayload(rawInput: unknown): Recovery {
  if (typeof rawInput !== 'object' || rawInput === null) {
    return { ok: false, reason: 'no_leak' };
  }
  const input = rawInput as Record<string, unknown>;
  const text = input.playerText;
  const found = typeof text === 'string' ? findToolCallSyntax(text) : null;
  if (typeof text !== 'string' || !found) {
    return { ok: false, reason: 'no_leak' };
  }

  // Cutting at the first leaked tag is what keeps markup out of the
  // narration: nothing before it trips the detector, by definition.
  const narration = text.slice(0, found.index).trimEnd();
  const tail = text.slice(found.index);
  if (/<invoke\b/.test(tail)) return { ok: false, reason: 'other_tool_call' };

  let recovered: Record<string, unknown>;
  try {
    recovered = new Parser(tail).parseTop();
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.reason };
    throw err;
  }

  for (const key of Object.keys(recovered)) {
    if (input[key] !== undefined) return { ok: false, reason: 'collision' };
  }

  const parsed = submitGmResponseSchema.safeParse({
    ...input,
    ...recovered,
    playerText: narration,
  });
  if (!parsed.success) return { ok: false, reason: 'schema_invalid' };
  return { ok: true, payload: parsed.data };
}
