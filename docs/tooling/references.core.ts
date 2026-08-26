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
 * `decisions.md` and `decisions-summary.md` are absent on purpose. Both are
 * generated from `docs/decisions/`, so a rewrite applied to either is discarded
 * by the next build. The ADR source files are inventoried separately.
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
 * The generous span of text following a `§`, used for matching.
 *
 * Deliberately not bounded at a comma or a sentence end. Forty-five of the 93
 * entry titles contain a comma followed by a lowercase word ("A rate that
 * never moves is a harness suspect, not a finding"), so a comma bound cuts
 * titles in half — the reference then looks author-truncated, and rewriting it
 * leaves the tail of the title stranded as prose. Match against the full
 * window instead and replace only the span the matched title actually covers.
 */
export function extractReferenceWindow(text: string, index: number): string {
  const after = text.slice(index + 1);

  if (isInsideCodeSpan(text, index)) {
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
    return out;
  }

  // A single newline is not a boundary — a bare reference wraps like any other
  // prose. A blank line is: a reference never spans a paragraph.
  const stop = after.search(/\n\s*\n|[)]/);
  return stop === -1 ? after : after.slice(0, stop);
}

/**
 * Tighten a window to one clause, for references that match no title. Only
 * used to decide truncation and to report unresolved text — never to size a
 * replacement of a matched title.
 */
export function tightenWindow(window: string): string {
  const stop = window.search(/[)]|\. |, (?=[a-z])/);
  return (stop === -1 ? window : window.slice(0, stop)).trim();
}

/** Back-compat shim: the tightened form is what the old extractor returned. */
export function extractReferenceText(text: string, index: number): string {
  const window = extractReferenceWindow(text, index);
  const match = longestTitlePrefix(window, CURRENT_TITLES);
  return match
    ? window.slice(0, match.rawLength).trim()
    : tightenWindow(window);
}

/**
 * The number of raw characters of `raw` whose normalized form equals
 * `target` — i.e. exactly how much text the matched title covers, so a
 * rewrite replaces the title and nothing after it.
 */
export function rawPrefixLength(raw: string, target: string): number | null {
  for (let i = 1; i <= raw.length; i += 1) {
    if (normalize(raw.slice(0, i)) !== target) continue;
    // Extend over trailing characters that normalize away — the closing
    // backtick of a title that ends in a code span, for instance. Without
    // this, `§ Warden model upgraded to \`claude-sonnet-5\`` matches up to
    // the final backtick and leaves it stranded after the identifier.
    // Whitespace is deliberately not consumed: eating a trailing space would
    // weld the identifier onto the next word.
    let end = i;
    while (end < raw.length && /[`*_"']/.test(raw[end])) end += 1;
    return end;
  }
  return null;
}

export interface TitleMatch {
  id: string;
  title: string;
  rawLength: number;
}

/** The longest entry title that `window` begins with, if any. */
export function longestTitlePrefix(
  window: string,
  titles: TitleIndex[],
): TitleMatch | null {
  const normalized = normalize(window);
  const candidates = titles
    .filter((t) => normalized.startsWith(t.normalized))
    .sort((a, b) => b.normalized.length - a.normalized.length);

  for (const candidate of candidates) {
    const rawLength = rawPrefixLength(window, candidate.normalized);
    if (rawLength !== null) {
      return { id: candidate.id, title: candidate.title, rawLength };
    }
  }
  return null;
}

/**
 * Titles used by the back-compat `extractReferenceText` shim. Set by
 * `findReferences`; empty otherwise, in which case the shim just tightens.
 */
let CURRENT_TITLES: TitleIndex[] = [];

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
  CURRENT_TITLES = titles;
  const out: Reference[] = [];
  const headings = ownHeadings(text);

  for (const match of text.matchAll(/§/g)) {
    const index = match.index;
    const window = extractReferenceWindow(text, index);
    const preceding = findPrecedingPath(text, index);

    // A numeric citation is never a title match. Check it before matching so
    // `§ 24.1` cannot be pulled into a title by a coincidental prefix.
    const numeric = NUMERIC.test(normalize(window));
    const hit = numeric ? null : longestTitlePrefix(window, titles);

    // How much text the replacement covers: exactly the matched title when
    // there is one, otherwise the tightened clause. Getting this wrong is what
    // strands the tail of a title as prose after a rewrite — 45 of the 93
    // titles carry a comma followed by a lowercase word.
    const spanLength = hit
      ? hit.rawLength
      : window.indexOf(tightenWindow(window)) + tightenWindow(window).length;

    const verdict = hit
      ? {
          classification: 'resolves' as const,
          id: hit.id,
          reason: 'exact title match',
        }
      : classifyReference(
          tightenWindow(window),
          titles,
          preceding?.path ?? null,
          headings,
        );

    // The construct spans the document path — when it belongs to this
    // reference — through the end of the matched span. The path is not kept
    // alongside the token: decisions.md is a generated index after this
    // migration, so naming it points the reader at the wrong artifact.
    const constructIndex = preceding ? preceding.start : index;
    const spanEnd = index + 1 + spanLength;

    out.push({
      index,
      text: window.slice(0, spanLength).trim(),
      construct: text.slice(constructIndex, spanEnd),
      constructIndex,
      ...verdict,
    });
  }
  return out;
}

export interface RewriteOptions {
  /**
   * Also rewrite author-truncated references whose prefix matches exactly one
   * entry title. The target is determined rather than guessed, but it is a
   * judgement that the truncation was sloppiness rather than deliberate
   * narrowing, so it is opt-in.
   */
  includeUniqueAmbiguous?: boolean;
}

/**
 * Replace reference constructs with bare identifiers, right to left so that
 * rewriting one does not shift the offsets of the next.
 */
export function rewriteReferences(
  text: string,
  references: Reference[],
  options: RewriteOptions = {},
): string {
  const targets = references
    .map((r) => {
      if (r.classification === 'resolves' && r.id) return { ref: r, id: r.id };
      if (
        options.includeUniqueAmbiguous &&
        r.classification === 'ambiguous' &&
        r.candidates?.length === 1
      ) {
        return { ref: r, id: r.candidates[0] };
      }
      return null;
    })
    .filter((t): t is { ref: Reference; id: string } => t !== null)
    .sort((a, b) => b.ref.constructIndex - a.ref.constructIndex);

  let out = text;
  for (const { ref, id } of targets) {
    const end = ref.constructIndex + ref.construct.length;
    out = `${out.slice(0, ref.constructIndex)}${id}${out.slice(end)}`;
  }
  return out;
}

/** Rewrites only the `resolves` class, leaving everything else untouched. */
export function rewriteResolved(text: string, references: Reference[]): string {
  return rewriteReferences(text, references);
}
