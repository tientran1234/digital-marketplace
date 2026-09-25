# digital-marketplace

A marketplace for digital products where every listing comes with an
assistant that has actually read it. Sellers upload a document, buyers purchase
it once or subscribe, and questions get answered from the document itself —
with citations. Reviews and refunds are durable workflows that wait for a
human. English and Vietnamese.

Built on four libraries extracted from it:

| Library | What it owns here |
|---|---|
| [agent-runtime](https://github.com/tientran1234/agent-runtime) | the "ask about this product" agent: tools, quota gate, streaming, tracing with cost |
| [durable-workflow](https://github.com/tientran1234/durable-workflow) | product review (waits up to 7 days for an admin) and refunds (waits for a decision, then calls the provider with retries) |
| [subscription-billing](https://github.com/tientran1234/subscription-billing) | the billing design: idempotent webhooks, forward-only state machines, entitlements derived on read |
| [offline-license](https://github.com/tientran1234/offline-license) | the self-hosted edition: admin area gated by a signed license, no phone-home |

The RAG pipeline (structure-aware chunking → embeddings → pgvector → MMR
re-ranking) lives in `src/rag/` and runs on Postgres alone — no vector service.
Uploads are `.md`, `.txt` or `.pdf`; `server/extract.ts` flattens a PDF to text
before the chunker sees it, and refuses a scan with no text layer rather than
indexing an empty document.

## Flows

**Buy.** `POST /api/checkout/order` persists a `PENDING` order *before*
calling Stripe, so a webhook that beats the response still finds it. Stripe's
`checkout.session.completed` arrives at `POST /api/webhooks/stripe`: raw body
→ signature → event id claimed in `WebhookEvent` (the insert is the lock) →
`UPDATE … WHERE status IN (PENDING)`. A replayed delivery is a `duplicate`;
two racing deliveries produce one winner. Download access is one pure function
(`domain/access.ts`) used by both the button and the file route, so they can
never disagree.

**Ask.** `POST /api/products/:id/ask` streams SSE. Before the model is called:
plan check (`ask_ai`), then monthly quota incremented in the database — and
refunded if the provider fails before a single token reaches the buyer, though
a run that dies half way through an answer still costs the message. The agent
has two tools — `search_docs` (retrieve + MMR over the product's chunks) and
`product_facts` — a hard cap of six iterations, and a tracer that writes every
run's spans, tokens and cost to `AgentTrace` for the admin page.

**Review.** Submitting a product starts the `product-review` workflow: mark
pending, wait for the `review` signal (7-day timeout → rejected), publish or
reject. The run lives in `workflow_runs`; a deploy in between changes nothing.

**Refund.** The buyer's request starts `refund-request`: wait for an admin
`decision` (3 days → denied); on approval, `issue-refund` calls the provider
inside a retried step. The order's status is *not* changed by the workflow —
it changes when `charge.refunded` arrives, through the same webhook path as
every other status change. One place changes money state.

**Serverless worker.** There is no resident process on Vercel, so
`POST /api/workflows/tick` processes due runs and `vercel.json` schedules it
(daily on Hobby — point cron-job.org at it every few minutes for real use). Signals (`admin approves`) resume runs immediately without
waiting for the tick.

## Run it

```bash
pnpm install
cp .env.example .env            # DATABASE_URL needs pgvector; Neon has it, so does `pnpm db:up`
pnpm db:setup                   # Prisma schema + vector extension + workflow table
pnpm db:seed                    # three users, two indexed products — no API keys needed
pnpm dev                        # http://localhost:3000/en  (sign in as buyer/seller/admin@example.test)
```

With keys: `ANTHROPIC_API_KEY` turns on the real assistant (Claude via
agent-runtime), `VOYAGE_API_KEY` turns on real embeddings (without it, a
bag-of-words hasher stands in — fine for a demo, useless for real search),
`STRIPE_*` turns on real checkout (`pnpm stripe:listen` for the webhook).

```bash
pnpm test                       # 24 unit tests anywhere; 5 flow tests need DATABASE_URL
pnpm eval                       # 40 questions over the seed docs — recall@5 and answer correctness
pnpm typecheck && pnpm build
```

**Evals.** `evals/` asks forty questions of the two seed documents, each one
naming the passage that answers it and the fact the answer must carry. It runs
the real chunker, embedder, MMR and agent prompt against an in-memory index, so
it needs no database and no key; `EVAL_MODEL=1` swaps the extractive baseline
for the real model. Numbers and what they mean: [`evals/README.md`](evals/README.md).

## Layout

```
src/
  domain/        pure: billing events, order + subscription state machines, plans, download access
  providers/     stripe.ts (the only file importing stripe) · fake.ts
  rag/           chunk · embed (Voyage, hash) · mmr · store (pgvector, raw SQL) · retrieve
  server/        billing · workflows · assistant · auth (opaque sessions) · usage · license · storage · extract
  app/api/       checkout, webhooks, products (upload/submit/ask/download), orders/refund, admin, workflows/tick
  app/[locale]/  marketplace, product, account, sell, admin, login — en + vi
  components/    the client bits: SSE reader, checkout buttons, forms
tests/           domain, rag, upload extraction, stripe mapping, evals, and the five end-to-end flows on real Postgres
evals/           the assistant eval suite: questions · harness · report
scripts/         setup-db, seed, seed-docs (the corpus the evals ask about)
```

## What is deliberately not here

- **Real sign-in.** Sessions are real (opaque id, server-side row, httpOnly);
  the login route is a dev shortcut. Swap it for Auth.js / magic links; nothing
  that reads sessions changes.
- **Object storage.** Files land on local disk. On Vercel that is ephemeral —
  `server/storage.ts` is two functions to reimplement on S3 or Vercel Blob.
- **Seller payouts.** Stripe Connect is a project of its own.
