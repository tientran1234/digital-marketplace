# Deploying it

Next on Vercel, Postgres with pgvector on Neon, product files in an
S3-compatible bucket. Nothing here is specific to those three — the app wants a
Node runtime, a `DATABASE_URL` with the `vector` extension and a bucket — but
these are the ones the recipe is written for, and the only combination the
preview smoke test runs against.

## 1. The database (Neon)

Create a project, then the extension the RAG tables need:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Push the schema from your own machine, once per database. Vercel's build does
not do it: a build is cached and shared across deployments, so a migration run
from there happens on some deployments and not others.

```bash
DATABASE_URL="postgresql://…neon.tech/marketplace?schema=public" pnpm db:setup
```

**Use the direct connection string, not the pooled one.** Neon's pooled
endpoint is PgBouncer in transaction mode, which hands a server connection to
whoever needs it next — and the claim the first-boot seed takes (below) is an
advisory lock on a session, so a pooler can give it away and unlock someone
else's. Schema pushes want the direct endpoint too. Each instance opens at
most five raw connections (`lib/pg.ts`) alongside Prisma's own pool, which is
what the direct endpoint is sized for.

## 2. The app (Vercel)

Import the repository. The defaults are right: `pnpm install` runs
`prisma generate` through `postinstall`, and `pnpm build` runs it again before
`next build`.

Then the variables. Everything optional is listed in [`.env.example`](../.env.example); these are
the ones a deployment cannot do without:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Neon's direct connection string, with `?schema=public` |
| `SESSION_SECRET` | 32+ random bytes; rotating it signs everyone out |
| `APP_URL` | The deployment's own origin — sign-in links are built from it, so a wrong value mails links into someone else's app |

Set `APP_URL` per environment, not once: a preview that advertises the
production origin sends its testers to production.

Two things do not come from a dashboard:

- **The cron tick.** There is no resident process, so `vercel.json` schedules
  `POST /api/workflows/tick` to move due workflow runs along. Hobby allows one
  run a day, which is enough for the refund and payout flows to finish but not
  to feel prompt; point cron-job.org at the same path every few minutes for
  real use. Signals (an admin approving a refund) resume a run immediately
  without waiting for either.
- **The Stripe webhook.** Add an endpoint at
  `https://<your-app>/api/webhooks/stripe` for the order, subscription and
  payout events, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. An
  order only becomes PAID on a signed delivery, so a deployment without this
  takes money and hands over nothing.

## 3. Product files

The local disk is the default and it is also what Vercel gives you, where it is
ephemeral: the file a seller uploads is gone from under the download route
before a buyer asks for it. So a deployment wants a bucket — any S3-compatible
one, R2 being the one to reach for next to Vercel:

```
S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
S3_BUCKET="products"
S3_REGION="auto"                   # "auto" on R2; the bucket's own region on AWS
S3_ACCESS_KEY_ID="…"
S3_SECRET_ACCESS_KEY="…"
```

Set all of them or none: half of them is an error rather than a quiet fall back
to a disk that will not keep the file.

Vercel Blob is not one of these. It has no SigV4 endpoint, so
`providers/s3.ts` cannot sign for it — it would need a `FileStore` of its own
against the Blob API, which is a small adapter and not this recipe.

## 4. Seeding on first boot

A fresh deployment has a schema and no rows, which looks less like a new
marketplace than a broken one. `SEED_ON_BOOT=1` has the app seed itself from
`instrumentation.ts`, which Next awaits before serving — so the first page
anyone loads already has the two demo products on it, indexed and buyable.

What makes that safe to leave on in a preview, and why it is not for
production, is in [`src/server/bootstrap.ts`](../src/server/bootstrap.ts): it is
opt in, it writes only into an empty marketplace, and the claim is a Postgres
advisory lock because a cold start brings up as many instances as it has
traffic and they all find the same empty database. The seed always embeds with
the bag-of-words hasher, so it needs no `VOYAGE_API_KEY` and finishes inside a
cold start.

A deployment that cannot seed still serves; the marketplace comes up empty and
says so, and the reason is in the function logs under `[seed]`.

## 5. Preview deployments

Give each preview its own database — Neon's Vercel integration branches one per
pull request — and set, in the Preview environment only:

```
SEED_ON_BOOT=1
FAKE_PROVIDERS=1
```

`FAKE_PROVIDERS=1` puts the in-memory billing provider and the extractive model
in front of Stripe and Claude, so a preview is clickable without spending
anything. It refuses to stand in front of a real credential and will fail the
boot rather than guess, which matters because **Vercel applies a variable to
every environment unless you say otherwise**: scope `STRIPE_SECRET_KEY`,
`ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` to Production, or previews will not
start. `VOYAGE_API_KEY` especially — the seed indexed those documents with the
hasher, and a buyer's question embedded by a different model retrieves nothing.

[`.github/workflows/preview-e2e.yml`](../.github/workflows/preview-e2e.yml)
then runs `e2e/preview.spec.ts` against each preview Vercel reports, which is
the part CI cannot do: whether the thing that deployed works, rather than
whether it built. It asks what a buyer could — the seed is on the marketplace,
the locale prefix routes, the file is shut to a stranger, an unsigned delivery
is refused — and needs no database or secret of its own, only the URL.

## Self-hosting it instead

A customer running this on their own infrastructure, unlocked by a signed
license file rather than a hosted account: [`self-hosted.md`](self-hosted.md).
The database, bucket and first-boot seed work the same way there.
