#!/usr/bin/env tsx
/** Regenerates `docs/decisions.md` from `docs/decisions/`. */

import { readFileSync, writeFileSync } from 'node:fs';

import { INDEX_HEADER_PATH, INDEX_PATH, loadCorpus } from './corpus';
import { renderIndex } from './render-index';

const header = readFileSync(INDEX_HEADER_PATH, 'utf8');
const corpus = loadCorpus();
writeFileSync(INDEX_PATH, renderIndex(header, corpus));
console.log(`Wrote docs/decisions.md from ${corpus.length} entries.`);
