# Roadmap

One item per pull request, in order.

- [x] Assistant eval suite: 40 questions over the seed documents with expected passages and answers; measure retrieval recall@5 and answer correctness (FakeProvider in CI, real model behind `EVAL_MODEL=1`); report in `evals/README.md`.
- [x] Do not charge a quota message when the model call fails before producing output (refund the counter on provider error).
- [x] PDF uploads: parse to text (`pdf-parse`) in the upload route; chunker unchanged.
- [x] Object storage adapter: `server/storage.ts` on S3-compatible storage (works with Vercel Blob / R2), local disk stays for dev.
- [x] UI polish: design tokens, responsive product grid with cover images, empty states, loading skeletons for the ask box. Screenshots in README.
- [x] Seller analytics (Pro feature): views, purchases, questions asked per product; uses `canUse(ent, "seller_analytics")`.
- [x] Magic-link sign-in replacing the dev login route; sessions table stays.
- [x] Playwright end-to-end: buy → webhook → download; ask → cited answer (FakeProvider via env).

## Batch 2 — set by the owner, 30 Sep 2026

Same rule: one item per change, in order.

- [x] Seller payouts with Stripe Connect Express: onboarding link, a transfer per PAID order minus the platform fee, payout status on the seller page; a refund reverses the transfer — every money movement inside a durable workflow.
- [x] Reviews and ratings: only buyers with a PAID order may review, one review per purchase, a moderation queue in admin; average rating on the product card.
- [x] Hybrid search: Postgres full-text plus pgvector fused with reciprocal rank fusion over title, description and chunks; the eval suite gains a search-relevance section.
- [x] Conversation memory: persist each buyer–product thread, show history on the product page, feed it through agent-runtime's memory with summarisation when it grows past the budget.
- [x] Localised listings: title and description per locale (vi/en) with fallback; sellers edit both; the assistant answers in the buyer's locale using the matching text.
- [x] Deploy recipe: Vercel + Neon + Blob documented in `docs/deploy.md`, seed on first boot, and a GitHub Action running the Playwright suite against a preview deployment.
