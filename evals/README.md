# Assistant evals

Forty questions over the two seed documents, each one carrying the heading of
the passage that answers it and the fact the answer has to contain. Thirty-four
are answerable; six are not, and are there to see whether the assistant says so.
A second section scores the marketplace's search over the same two documents:
twenty queries, the listing each one should find, and the arm that found it.

```bash
pnpm eval                 # extractive baseline + hash embedder — no keys, no database
EVAL_MODEL=1 pnpm eval    # the real assistant (needs ANTHROPIC_API_KEY)
VOYAGE_API_KEY=… pnpm eval  # real embeddings, either model
DATABASE_URL=… pnpm eval  # adds the search-relevance section
```

`pnpm test` runs the same suite and fails if the numbers drop below the floors
at the bottom of this file.

## What is measured

**recall@5** — the share of answerable questions whose expected passage is in
the five the retriever returns for the question as typed. This is the number
that says whether the RAG pipeline works: chunking, embedding, pgvector's
neighbours, MMR's re-ranking.

**answer correctness** — the share of answerable questions whose answer
contains the expected fact. Retrieval can put the passage at rank 5 and the
answer still miss it, so this is always the lower number, and the gap between
the two is the part worth reading.

**groundedness / refusal** — on the six unanswerable questions, whether the
answer invented something, and whether it said outright that the documents do
not cover it.

**search relevance** — the marketplace's own search rather than the
assistant's: twenty queries in `search.ts`, each naming the listing that
should come first and, for seventeen of them, the passage the top hit should
point at. Scored three times — the lexical arm alone, the vector arm alone,
and the two fused — as precision@1, mean reciprocal rank, whether the top hit
landed on the expected passage, and precision@1 over the queries the listing's
own title and description cannot answer. That last column is the one that goes
to zero if search stops reading the documents and starts reading only the
shop window.

## How the search section runs, and why it needs a database

Postgres *is* the lexical arm: `websearch_to_tsquery`, the english stemmer,
its stop words, `ts_rank`. A stand-in the way `memoryIndex` stands in for
pgvector would be measuring a tokeniser nothing ships — cosine similarity is
the same arithmetic wherever it runs, and a hand-rolled stemmer is not. So the
section runs when `DATABASE_URL` is set and is printed as skipped when it is
not, and `pnpm test` holds it to its floors on the same database the flow
tests use. It upserts the two seed listings rather than inventing its own, so
a dev database is left looking like `pnpm db:seed` left it.

Two documents also bound what the section can show. Fusion can only ever equal
the better arm here: a listing both arms rank second stays second when there
is nothing else to rank. What the numbers catch is an arm going dark — a
lexical arm that stopped indexing chunks, an embedder that stopped
discriminating — not how good the search is.

## How the rest of it runs without a database

Everything except the model is the shipping pipeline: the same `chunkDocument`,
the same embedder, the same MMR, the same prompt and tools from
`assistantAgent`. Only the candidate source is swapped — `retrieve` takes a
`search` parameter, and the harness serves chunks from an array instead of
pgvector. The SQL itself is covered by the integration test, which does need
`DATABASE_URL`.

The model in CI is an **extractive baseline**: one `search_docs` call, then the
three best passages quoted back. It cannot reason, which is why correctness
trails recall, and it cannot invent, which is why every point it loses is a
point the pipeline lost. That is what makes the number a regression detector
rather than a measurement of a model's mood.

It never refuses, either. Under the bag-of-words embedder an unanswerable
question sits at the same similarity to its nearest chunk as an answerable one
— "Does the template include a Gantt chart view?" scores 0.337 where half the
answerable questions score less — so there is no threshold to refuse on and no
honest way to fake the judgement. The refusal row is what `EVAL_MODEL=1` is
for; in CI the six unanswerable questions only check that nothing was invented,
which the baseline passes by construction.

## Last run

Extractive baseline, hash embedder, 21 chunks over two documents:

| | score | |
|---|---|---|
| recall@5 | 97.1% | 33/34 |
| answer correctness | 94.1% | 32/34 |
| invented nothing | 100% | 6/6 |
| refused outright | 0% | 6 unanswerable, see above |

Search relevance, same corpus and embedder, 20 queries:

| arm | recall | p@1 | mrr | passage@1 | body-only p@1 |
|---|---|---|---|---|---|
| full-text | 90.0% | 90.0% | 0.900 | 82.4% | 88.2% |
| pgvector | 100% | 95.0% | 0.975 | 88.2% | 94.1% |
| fused | 100% | 95.0% | 0.975 | 88.2% | 94.1% |

The lexical arm requires every word, stemmed, to appear somewhere, so it
returns nothing for two of the twenty — and nothing for all three queries no
document contains a word of, which is the one thing the vector arm cannot do.
The vector arm answers all twenty and is wrong once: *"how do I stop customers
leaving"* shares no word with "Churn and downgrades" and the bag-of-words
embedder puts the Notion template's "Capture" first. The fusion keeps the
better of the two everywhere, which on two documents is all it can do.

Both assistant failures are the embedder, not the retriever:

- `pricing-03` *"Is it a good idea to charge per seat?"* — the only recall
  miss, and a one-character one. "Choosing quotas" answers it and says "seats";
  the question says "seat", and a bag-of-words embedder has no idea those are
  the same word. Nothing else in the question is rare, so the five that come
  back are whatever shared the most common words.
- `pricing-20` *"What should happen when a customer wants to downgrade?"* —
  "Churn and downgrades" is retrieved, but fifth, so it falls outside the three
  passages the baseline quotes. The answer is in the context and not in the
  reply: exactly the gap the two numbers exist to show.

Neither is a bug in the retriever, and both are the kind of thing a real
embedder is there to handle — run the suite with `VOYAGE_API_KEY` to find out
by how much. The hash embedder is the floor, not the target.

## Floors

`tests/evals.test.ts` asserts recall@5 ≥ 0.90 and answer correctness ≥ 0.85,
which leaves room for one more miss and none for a pipeline that stopped
retrieving. `tests/search.test.ts` asserts, with a database, fused
precision@1 ≥ 0.90 and body-only precision@1 ≥ 0.88, every noise query
rejected by the lexical arm, and each arm scored on its own so a fused number
cannot cover for one of them. Raise them when the numbers rise — a floor
nobody has moved in a year is not measuring anything.
