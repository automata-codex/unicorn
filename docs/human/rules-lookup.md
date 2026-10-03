# Rules Lookup

The Warden prompt says when to call `rules_lookup` and what to do when nothing useful comes back. The Warden prompt also includes a rules primer because the LLM is heavily biased towards running D&D 5e by its training data.

The Warden makes a `rules_lookup` tool call, which triggers `handleRulesLookup` (`session.service.ts:1120`). It checks the input against the schema first: a query and a limit from 1 to 5, default 3. A bad input gets an error `tool_result`, and the loop continues. Every lookup is scoped to the campaign's game system (`systemId`), so Mothership queries only search Mothership chunks.

Preprocessing always runs on the Warden's path, and the retrieval eval harness can switch it off to measure its effect. Preprocessing removes words that appear in a large share of the chunks. The words to drop are based on lexemes, but the query keeps the Warden's original words. If preprocessing fails, the tool continues with the original query.

On the Mothership corpus it currently drops nothing. The threshold for dropping words is 0.75, and it was chosen deliberately to be above every word frequency measured in this corpus (`query-preprocess.ts`, the comment on `DEFAULT_DF_THRESHOLD`). The eval showed that every setting low enough to drop anything made retrieval worse. So the mechanism stays for future, larger corpora, but today the query is embedded as written. Every lookup is recorded in telemetry, including the query, the result count, the top similarity score, and the sources.

The query is converted to an embedding using the same Voyage model that was used to ingest the rules text (currently `voyage-4-lite`). The vectors of the rules corpus are searched using cosine similarity. There is no minimum similarity score. The search returns the top N chunks along with their scores, and Claude has to judge the scores for itself. 

The results, and only the results, are sent to the Warden as a JSON string in the `tool_result`: text, source and similarity for each. The chunk and the source are the ingestion pipeline's output, which will be detailed in a future "Rules Ingestion" article. The preprocessed query is deliberately kept out, because adding it would change what the Warden sees. 

