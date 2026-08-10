/**
 * Audits the Warden primer's factual claims against the book.
 *
 * **Why this is a script and not a checklist.** Six primer errors were found
 * across five revisions in three days, and they got harder to find each time:
 * `Sensors` fell to a term count, the Panic and Critical mistakes to reading
 * one page, Cover to reading the page a claim was *about*, and the last five
 * only to a systematic pass over every claim
 * (`docs/rules-extraction-findings.md § S24`, `§ S25.6`, `§ S26`). Three of
 * those five sat in text that read perfectly well. A step that only runs when
 * something looks wrong will not catch that class.
 *
 * **What it can and cannot decide.** It checks *invariants* — structural
 * properties that must hold if the primer is coherent — not whether a
 * sentence describes a mechanic correctly. No script settles whether "AP is a
 * threshold, not a pool" is a fair reading of p.28. What a script can do is
 * notice that the primer maps a term the book uses verbatim, or declares a
 * mechanic absent that the table of contents names. Those are exactly the
 * errors that slipped through human review.
 *
 * **The headings are the load-bearing input.** `CONTENT_BLOCK_TYPES` excludes
 * `SectionHeader` blocks, so no query against `rules_chunk` can see them — and
 * a heading is where a rulebook names a mechanic most compactly. Judging
 * "the book has no rule for X" from the corpus alone already produced one
 * wrong conclusion (`§ S9.1`'s `surprise`). Supply them via
 * `ingest.py --dump-headings`; without them the absence invariants still run
 * against the corpus but are reported as **weak**.
 */

/** A `term -> replacement` row in the primer's vocabulary table. */
export interface VocabularyMapping {
  from: string;
  to: string;
  line: number;
}

export interface ParsedPrimer {
  mappings: VocabularyMapping[];
  /** Terms the primer declares are absent mechanics, not wrong words. */
  absentMechanics: string[];
  absentMechanicsLine: number;
}

const MAPPING_RE = /^\s{2,}(.+?)\s+->\s+(.+?)\s*$/;
const ABSENT_MARKER = 'not wrong words but absent mechanics';

/**
 * Pull the machine-checkable declarations out of the primer text.
 *
 * Deliberately tolerant: a primer that has been reworded should still parse,
 * and a primer that has been restructured beyond recognition should return
 * empty rather than throw — the caller reports "nothing found to check",
 * which is a louder signal than a stack trace in a QA tool.
 */
export function parsePrimer(text: string): ParsedPrimer {
  const lines = text.split('\n');
  const mappings: VocabularyMapping[] = [];
  let absentMechanics: string[] = [];
  let absentMechanicsLine = 0;

  lines.forEach((line, index) => {
    const m = MAPPING_RE.exec(line);
    // `->` inside prose would false-positive; the two-space indent is what
    // distinguishes a table row from a sentence that happens to contain it.
    if (m && !line.trim().startsWith('-')) {
      mappings.push({ from: m[1].trim(), to: m[2].trim(), line: index + 1 });
    }
  });

  const markerIndex = lines.findIndex((l) => l.includes(ABSENT_MARKER));
  if (markerIndex !== -1) {
    absentMechanicsLine = markerIndex + 1;
    // The list runs from the marker to the next blank line, and is written as
    // prose with a colon — "…what to do instead: perception, awareness, …".
    const collected: string[] = [];
    for (let i = markerIndex; i < lines.length; i += 1) {
      if (i > markerIndex && lines[i].trim() === '') break;
      collected.push(lines[i]);
    }
    const joined = collected.join(' ');
    const afterColon = joined.slice(joined.lastIndexOf(':') + 1);
    absentMechanics = afterColon
      .split(/,| or /)
      .map((t) => t.replace(/[.\s]+$/, '').trim())
      .filter((t) => t.length > 1);
  }

  return { mappings, absentMechanics, absentMechanicsLine };
}

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  line: number;
  invariant: string;
  detail: string;
}

/** Where a term was found, if anywhere. */
export interface TermPresence {
  inCorpus: boolean;
  /** `null` when no heading list was supplied. */
  inHeadings: boolean | null;
  headingHits: string[];
}

export type PresenceLookup = (term: string) => TermPresence;

/**
 * Run the invariants.
 *
 * Each one is chosen because it would have caught a real error, and they are
 * named in the output so a failure points at its own rationale rather than
 * just a line number.
 */
export function auditPrimer(
  primer: ParsedPrimer,
  presenceOf: PresenceLookup,
): Finding[] {
  const findings: Finding[] = [];

  for (const mapping of primer.mappings) {
    // A mapping exists to redirect a word the book does NOT use toward one it
    // does. If the source term is in the book, the mapping is at best noise
    // and at worst a redirect away from the right word — which is exactly how
    // `damage reduction -> Armor Points` shipped while the book prints
    // "Damage Reduction (DR)" verbatim as a different mechanic (`§ S26.1`).
    const from = presenceOf(mapping.from);
    if (from.inCorpus || from.inHeadings) {
      findings.push({
        severity: 'error',
        line: mapping.line,
        invariant: 'mapping-source-is-in-the-book',
        detail:
          `"${mapping.from}" is mapped to "${mapping.to}", but the book uses ` +
          `"${mapping.from}" itself${
            from.headingHits.length
              ? ` (heading: ${from.headingHits[0]})`
              : ' (in the corpus)'
          }. A mapping should redirect a word the book does not use.`,
      });
    }

    // The other half: a mapping is useless if its target is not in the book.
    const to = presenceOf(mapping.to);
    if (!to.inCorpus && !to.inHeadings) {
      findings.push({
        severity: 'error',
        line: mapping.line,
        invariant: 'mapping-target-is-absent',
        detail:
          `"${mapping.from}" is mapped to "${mapping.to}", which appears ` +
          'nowhere in the book. The Warden would be sent to search for a term ' +
          'that cannot match.',
      });
    }

    // Declaring a term both translatable and absent is a contradiction the
    // Warden cannot act on. `perception -> Intellect Check` and
    // `stealth -> sneak` both shipped alongside later lines saying those
    // checks do not exist (`§ S26.1`).
    if (
      primer.absentMechanics.some(
        (t) => t.toLowerCase() === mapping.from.toLowerCase(),
      )
    ) {
      findings.push({
        severity: 'error',
        line: mapping.line,
        invariant: 'term-both-mapped-and-declared-absent',
        detail:
          `"${mapping.from}" is in the vocabulary table AND in the ` +
          'absent-mechanics list. The primer tells the Warden both to ' +
          'translate it and that it does not exist.',
      });
    }
  }

  for (const term of primer.absentMechanics) {
    const presence = presenceOf(term);
    // A heading naming the mechanic is decisive: the book has a section for
    // it. This is the check that could not be run at all before
    // `--dump-headings`, and the one that would have caught `26.2 SURPRISE`.
    if (presence.inHeadings) {
      findings.push({
        severity: 'error',
        line: primer.absentMechanicsLine,
        invariant: 'declared-absent-but-a-heading-names-it',
        detail:
          `"${term}" is declared an absent mechanic, but the book has a ` +
          `section heading for it: "${presence.headingHits[0]}".`,
      });
    } else if (presence.inCorpus) {
      // Weaker: the word appears in body text. That can be innocent — "cover"
      // appears in prose that is not about a cover bonus — so this is a
      // prompt to look, not a verdict.
      findings.push({
        severity: 'warning',
        line: primer.absentMechanicsLine,
        invariant: 'declared-absent-but-present-in-corpus',
        detail:
          `"${term}" is declared an absent mechanic, but the word appears in ` +
          'the corpus. It may be innocent prose — check the page before ' +
          'trusting the claim.',
      });
    }
  }

  return findings;
}

/**
 * Headings whose subject the primer never mentions.
 *
 * Not an invariant and never an error — the primer is deliberately short and
 * most of the book is retrievable, so silence is usually correct. It exists
 * because the two *incompleteness* problems in `§ S26` were exactly this
 * shape: `26.1 TURN ORDER` carried an optional initiative rule the primer
 * never mentioned, and `26.2 SURPRISE` an ambush rule it needed. A reviewer
 * scanning this list would have found both.
 */
/**
 * Does `haystack` use `term` as a word?
 *
 * **A leading word boundary only, and both halves matter.** Plain substring
 * matching lets `handcuffs` satisfy `DC` and `research` satisfy `search` —
 * both were real false positives on the first run of this audit. Boundaries at
 * both ends fixes that and breaks plurals instead: `\bcheck\b` does not match
 * `checks`, so a primer discussing panic checks would report the panic-check
 * section as uncovered. A leading boundary alone handles both.
 *
 * Exported and shared so the heading scan and the corpus check cannot drift —
 * they did, briefly, and the corpus half kept the bug the heading half had
 * already fixed.
 */
export function usesTerm(haystack: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`).test(haystack.toLowerCase());
}

const HEADING_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'do',
  'does',
  'for',
  'how',
  'i',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'why',
  'you',
  'your',
  'example',
  'step',
]);

/**
 * A heading counts as *mentioned* when the primer contains every one of its
 * content words.
 *
 * Whole-string matching does not work: `21.1 WHAT IS A PANIC CHECK?` will
 * never appear verbatim in a primer that plainly discusses panic checks, so
 * every question-shaped heading would report as a gap and the list would be
 * noise. Requiring all content words is strict enough that a genuinely
 * uncovered section still surfaces, and loose enough that phrasing does not
 * matter.
 *
 * Over-inclusion is the safe direction here — this is a review prompt, and a
 * false positive costs a glance while a false negative hides a real gap.
 */
function headingWords(text: string): string[] {
  return text
    .replace(/^[\d.]+\s*/, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !HEADING_STOPWORDS.has(w));
}

export function unmentionedHeadings(
  primerText: string,
  headings: Array<{ physicalPage: number; text: string }>,
): Array<{ page: number; text: string }> {
  const primer = primerText.toLowerCase();
  const seen = new Set<string>();
  const out: Array<{ page: number; text: string }> = [];

  for (const heading of headings) {
    const words = headingWords(heading.text);
    // Nothing distinctive left — "Sex", "AP", a bare number. Matching on
    // those would flag or clear headings at random.
    if (words.length === 0) continue;

    const key = words.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);

    if (!words.every((w) => usesTerm(primer, w))) {
      out.push({ page: heading.physicalPage, text: heading.text });
    }
  }
  return out;
}

export function renderAuditReport(args: {
  primerPath: string;
  primerHash: string;
  findings: Finding[];
  unmentioned: Array<{ page: number; text: string }>;
  headingCount: number | null;
  mappingCount: number;
  absentCount: number;
}): string {
  const errors = args.findings.filter((f) => f.severity === 'error');
  const warnings = args.findings.filter((f) => f.severity === 'warning');
  const lines: string[] = [];

  lines.push(`# Primer audit — \`${args.primerHash}\``);
  lines.push('');
  lines.push(`- Primer: ${args.primerPath}`);
  lines.push(
    `- Checked: ${args.mappingCount} vocabulary mappings, ${args.absentCount} declared-absent mechanics`,
  );
  lines.push(
    args.headingCount === null
      ? '- **No heading list supplied — absence checks are WEAK.** They ran against the corpus alone, which cannot see `SectionHeader` blocks. Run `task ingest -- --system <s> --pdf <p> --dump-headings <path>` and pass `--headings <path>`.'
      : `- Headings: ${args.headingCount} (absence checks are strong)`,
  );
  lines.push('');
  lines.push(
    errors.length === 0
      ? `**No invariant violations.** ${warnings.length} warning(s).`
      : `**${errors.length} invariant violation(s)** and ${warnings.length} warning(s).`,
  );
  lines.push('');

  for (const group of [
    { title: '## Errors', items: errors },
    { title: '## Warnings', items: warnings },
  ]) {
    if (group.items.length === 0) continue;
    lines.push(group.title);
    lines.push('');
    for (const f of group.items) {
      lines.push(`- **line ${f.line}** · \`${f.invariant}\``);
      lines.push(`  ${f.detail}`);
    }
    lines.push('');
  }

  lines.push('## Book sections the primer never mentions');
  lines.push('');
  lines.push(
    'Not a defect list. The primer is deliberately short and most of the book',
  );
  lines.push(
    'is retrievable, so silence is usually right. Scan it for a mechanic the',
  );
  lines.push(
    'Warden would guess wrong — that is how `26.1 TURN ORDER` and `26.2',
  );
  lines.push('SURPRISE` were found missing (`§ S26`).');
  lines.push('');
  if (args.unmentioned.length === 0) {
    lines.push('_None._');
  } else {
    for (const h of args.unmentioned) {
      lines.push(`- p${h.page + 1} — ${h.text}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
