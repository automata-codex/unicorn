#!/usr/bin/env tsx
/** Regenerates both generated views from `docs/decisions/`. */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  INDEX_HEADER_PATH,
  INDEX_PATH,
  loadCorpus,
  SUMMARY_INDEX_PATH,
} from './corpus';
import { renderIndex } from './render-index';

const header = readFileSync(INDEX_HEADER_PATH, 'utf8');
const corpus = loadCorpus();

writeFileSync(INDEX_PATH, renderIndex(header, corpus, 'full'));
writeFileSync(SUMMARY_INDEX_PATH, renderIndex(header, corpus, 'summary'));

const summarized = corpus.filter((a) => a.frontMatter.summary !== null).length;
console.log(
  `Wrote docs/decisions.md and docs/decisions-summary.md from ${corpus.length} entries ` +
    `(${summarized} summarized, ${corpus.length - summarized} falling back to full text).`,
);
