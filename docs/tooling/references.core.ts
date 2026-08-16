/**
 * Classifies and rewrites `§` references into the decisions log.
 *
 * The hard part is not matching titles — it is that most `§` tokens in this
 * repo are not decisions references at all. Measured across the eight living
 * docs: roughly two thirds are numeric citations (`§ 24.1` into the rulebook,
 * `§ S8` into rules-extraction-findings.md, `§ Part 4` into a plan), and the
 * remainder split between exact title matches, titles truncated by the author,
 * and section references into other documents. Classification order matters;
 * see `classifyReference`.
 */

/**
 * Documents whose references are rewritten. Historical records — everything
 * under specs/, plans/, and milestones/ — are frozen: they are dated accounts
 * of what was true when written, and editing them to cite an identifier that
 * did not exist at the time makes the record less honest, not more.
 *
 * `decisions.md` is absent on purpose. It is generated from `docs/decisions/`
 * after the split, so a rewrite applied to it is discarded by the next build.
 * The ADR source files are inventoried separately.
 */
export const IN_SCOPE_DOCS = [
  'roadmap.md',
  'rules-extraction-findings.md',
  'eval-methodology.md',
  'tools.md',
  'schema.md',
  'api.md',
  'rules-ingestion.md',
] as const;

export type ReferenceClass =
  | 'resolves'
  | 'ambiguous'
  | 'out-of-scope'
  | 'unresolved';

export interface Reference {
  /** Byte offset of the `§` in the source text. */
  index: number;
  /** The raw reference text following `§`, up to its closing delimiter. */
  text: string;
  /** Whole construct to replace, including any leading document path. */
  construct: string;
  constructIndex: number;
  classification: ReferenceClass;
  /** Set when classification is `resolves`. */
  id?: string;
  /** Candidate ids when classification is `ambiguous`. */
  candidates?: string[];
  /** Why it landed where it did. */
  reason: string;
}

export interface TitleIndex {
  id: string;
  title: string;
  normalized: string;
}

export function buildTitleIndex(
  entries: Array<{ id: string; title: string }>,
): TitleIndex[] {
  return entries.map((e) => ({ ...e, normalized: normalize(e.title) }));
}

/** Whitespace-collapsing normalizer. Newlines are whitespace: 27 references
 *  in this corpus wrap mid-title, and a line-oriented matcher marks every one
 *  of them unresolved. */
export function normalize(text: string): string {
  return (
    text
      // A reference that wraps inside a blockquote picks up the `> ` marker of
      // each continuation line. Strip those before collapsing whitespace, or
      // the marker lands in the middle of the title and nothing matches.
      .replace(/\n\s*>\s?/g, ' ')
      .replace(/[`*_"']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

/** Numeric citations: `§ 24.1`, `§ S8.3`, `§ Part 4`, `§ Step 2`, `§ S4.5`. */
const NUMERIC = /^(?:s\d|\d+(?:\.\d+)*\b|part \d|step \d|appendix)/i;

/**
 * Find the reference text that follows a `§`.
 *
 * Bounded on the closing delimiter of the enclosing code span when there is
 * one. Splitting on the *first* backtick instead is wrong: 38 entry titles
 * contain backticks and several begin with one, so the first backtick is
 * frequently part of the title rather than its terminator.
 */
export function extractReferenceText(text: string, index: number): string {
  const after = text.slice(index + 1);
  const openedInCodeSpan = isInsideCodeSpan(text, index);

  if (openedInCodeSpan) {
    // Runs to the backtick that closes the span the `§` sits inside. A title
    // may contain balanced backtick pairs, so skip those.
    let out = '';
    let i = 0;
    while (i < after.length) {
      if (after[i] === '`') {
        const nextTick = after.indexOf('`', i + 1);
        // A backtick pair whose content has no whitespace is an identifier
        // inside the title (`actingEntityId`, `roll_dice`) and is kept. Any
        // other backtick closes the code span the reference lives in — which
        // is what separates one reference from the next when two of them sit
        // in the same sentence.
        const inner = nextTick === -1 ? null : after.slice(i + 1, nextTick);
        if (inner === null || /\s/.test(inner)) break;
        out += after.slice(i, nextTick + 1);
        i = nextTick + 1;
        continue;
      }
      out += after[i];
      i += 1;
    }
    return out.trim();
  }

  // Not in a code span: run to the end of the sentence or clause.
  //
  // A single newline is not a boundary. A bare reference wraps like any other
  // prose, and stopping at the line break truncates the title mid-phrase —
  // which then reads as an author truncation ("§ Warden model upgraded to")
  // and lands in the ambiguous pile instead of resolving. A blank line does
  // end it: a reference never spans a paragraph.
  const stop = after.search(/\n\s*\n|[)]|\. |, (?=[a-z])/);
  return (stop === -1 ? after : after.slice(0, stop)).trim();
}

/**
 * Whether `index` sits inside an inline code span.
 *
 * Counting backticks from the start of the file is wrong twice over: a fenced
 * code block contributes three at a time and destroys the parity for
 * everything after it, and an unbalanced backtick anywhere leaks into every
 * later reference. `schema.md` puts a decisions reference inside a ```sql
 * fence 21 fences deep, which is exactly the case that exposed this.
 *
 * So: no inline spans inside a fenced block, and parity is counted from the
 * start of the containing paragraph rather than the file.
 */
function isInsideCodeSpan(text: string, index: number): boolean {
  const before = text.slice(0, index);

  const fences = (before.match(/^```/gm) ?? []).length;
  if (fences % 2 === 1) return false;

  const paragraphStart = before.lastIndexOf('\n\n');
  const scope = paragraphStart === -1 ? before : before.slice(paragraphStart);
  const ticks = (scope.match(/`/g) ?? []).length;
  return ticks % 2 === 1;
}

/**
 * Classify one reference. Rule order is load-bearing — the numeric rule must
 * fire first or 210 rulebook citations flood the unresolved bucket and bury
 * the handful of genuinely rotten references.
 */
export function classifyReference(
  referenceText: string,
  titles: TitleIndex[],
  precedingPath: string | null,
  ownHeadings: string[] = [],
): Pick<Reference, 'classification' | 'id' | 'candidates' | 'reason'> {
  const normalized = normalize(referenceText);

  if (NUMERIC.test(normalized)) {
    return {
      classification: 'out-of-scope',
      reason: 'numeric section citation, not a decisions reference',
    };
  }

  const exact = titles.filter((t) => normalized.startsWith(t.normalized));
  if (exact.length === 1) {
    return {
      classification: 'resolves',
      id: exact[0].id,
      reason: 'exact title match',
    };
  }
  if (exact.length > 1) {
    // Longest match wins only if it is a strict extension of the others.
    const sorted = [...exact].sort(
      (a, b) => b.normalized.length - a.normalized.length,
    );
    return {
      classification: 'ambiguous',
      candidates: sorted.map((t) => t.id),
      reason: 'matches more than one entry title',
    };
  }

  // Author-truncated reference: the reference is a prefix of a title.
  const elided = normalized.replace(/\.\.\.$|…$/, '').trim();
  if (elided.length >= 12) {
    const prefixed = titles.filter((t) => t.normalized.startsWith(elided));
    if (prefixed.length === 1) {
      return {
        classification: 'ambiguous',
        candidates: [prefixed[0].id],
        reason: 'title truncated by the author — confirm the target',
      };
    }
    if (prefixed.length > 1) {
      return {
        classification: 'ambiguous',
        candidates: prefixed.map((t) => t.id),
        reason: 'truncated title matching more than one entry',
      };
    }
  }

  if (precedingPath && !precedingPath.endsWith('decisions.md')) {
    return {
      classification: 'out-of-scope',
      reason: `section reference into ${precedingPath}`,
    };
  }

  // A reference with no path that names a heading in its own document is an
  // intra-document section reference, not a decisions reference — for example
  // eval-methodology.md's `§ Two kinds of corpus bump`, which is one of its
  // own `##` headings.
  if (!precedingPath) {
    const own = ownHeadings.map(normalize);
    if (own.some((h) => h === normalized || h.startsWith(normalized))) {
      return {
        classification: 'out-of-scope',
        reason: 'section reference within the same document',
      };
    }
  }

  return {
    classification: 'unresolved',
    reason: 'looks like a decisions reference but matches no entry title',
  };
}

/** The nearest `path.md` preceding `index` within the same construct. */
export function findPrecedingPath(
  text: string,
  index: number,
): { path: string; start: number } | null {
  const window = text.slice(Math.max(0, index - 300), index);
  const matches = [...window.matchAll(/(?:[\w./-]*\/)?([\w.-]+\.md)/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const between = window.slice(last.index + last[0].length);
  // Only counts as the same construct if nothing but whitespace, a backtick,
  // or an opening bracket separates the path from the `§`.
  if (!/^[\s`([]*$/.test(between)) return null;
  const absoluteStart = Math.max(0, index - 300) + last.index;
  return { path: last[0], start: absoluteStart };
}

/** Markdown headings in a document, for the intra-document reference rule. */
export function ownHeadings(text: string): string[] {
  return [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].trim());
}

export function findReferences(
  text: string,
  titles: TitleIndex[],
): Reference[] {
  const out: Reference[] = [];
  const headings = ownHeadings(text);
  for (const match of text.matchAll(/§/g)) {
    const index = match.index;
    const referenceText = extractReferenceText(text, index);
    const preceding = findPrecedingPath(text, index);
    const verdict = classifyReference(
      referenceText,
      titles,
      preceding?.path ?? null,
      headings,
    );

    // The construct to replace spans the path (when it belongs to this
    // reference) through the end of the reference text. The path is not kept
    // alongside the token: decisions.md is a generated index after this
    // migration, so naming it points the reader at the wrong artifact.
    const constructIndex = preceding ? preceding.start : index;
    const endOfText = text.indexOf(referenceText, index) + referenceText.length;
    out.push({
      index,
      text: referenceText,
      construct: text.slice(constructIndex, endOfText),
      constructIndex,
      ...verdict,
    });
  }
  return out;
}

/** Rewrites only the `resolves` class, leaving everything else untouched. */
export function rewriteResolved(text: string, references: Reference[]): string {
  const resolved = references
    .filter((r) => r.classification === 'resolves' && r.id)
    .sort((a, b) => b.constructIndex - a.constructIndex);

  let out = text;
  for (const ref of resolved) {
    const end = ref.constructIndex + ref.construct.length;
    out = `${out.slice(0, ref.constructIndex)}${ref.id}${out.slice(end)}`;
  }
  return out;
}
