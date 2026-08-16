#!/usr/bin/env tsx

/** Lists entries with no summary, longest body first. The authoring queue. */

import { loadCorpus } from './corpus';

const missing = loadCorpus()
  .filter((a) => a.frontMatter.summary === null)
  .map((a) => ({
    id: a.frontMatter.id,
    title: a.frontMatter.title,
    words: a.body.split(/\s+/).filter(Boolean).length,
  }))
  .sort((a, b) => b.words - a.words);

for (const entry of missing) {
  const words = String(entry.words).padStart(5);
  console.log(`${words}w  ${entry.id}  ${entry.title}`);
}
console.log(`\n${missing.length} entries without a summary.`);
