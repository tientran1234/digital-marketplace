# Assistant evals

Forty questions over the two seed documents, each one carrying the heading of
the passage that answers it and the fact the answer has to contain. Thirty-four
are answerable; six are not, and are there to see whether the assistant says so.

```bash
pnpm eval                 # extractive baseline + hash embedder — no keys, no database
EVAL_MODEL=1 pnpm eval    # the real assistant (needs ANTHROPIC_API_KEY)
VOYAGE_API_KEY=… pnpm eval  # real embeddings, either model
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

## How it runs without a database

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

Both failures are the embedder, not the retriever:

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
retrieving. Raise them when the numbers rise — a floor nobody has moved in a
year is not measuring anything.
