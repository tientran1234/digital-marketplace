# Changelog

## 2026-10-01

- Playwright end-to-end: buy → webhook → download and ask → cited answer in a real browser against a real build, with Stripe and the model served by the existing doubles through a new `FAKE_PROVIDERS=1` (a browser cannot reach in with `setBillingProviderForTests`, and a real key alongside the flag is an error rather than a silent preference) — so the seams the flow tests reach past are covered too: the checkout redirect, the webhook as raw signed bytes over HTTP, the file landing on disk, and the agent's citations arriving over SSE out of the product's own chunks.

## 2026-09-29

- Magic-link sign-in replacing the dev login route; the sessions table stays exactly as it was — an emailed link that works once and for fifteen minutes is now the only way in, the account is created when the link is clicked rather than when the address is typed, and a link can no longer hand out a role, so the shortcut that signed anyone in as an admin is gone rather than hidden behind an environment variable.

## 2026-09-28

- Seller analytics (Pro feature): views, purchases and questions asked per product on the sell page, gated by `canUse(ent, "seller_analytics")` — views counted in a new per-day `ProductView` row that skips the seller's own reloads, purchases counted only while the money has stayed, and questions read from the traces the ask box already writes, so a seller can see which listing is worth another document instead of guessing.

## 2026-09-27

- UI polish: design tokens for colour, space, radius and type (dark mode now redefines the whole surface), a responsive product grid with cover images derived from the slug rather than uploaded, empty states that say what will fill them, and loading skeletons for the ask box while retrieval runs — with screenshots in the README, so the app looks finished to the buyer who lands on it cold.

## 2026-09-26

- Object storage adapter: `server/storage.ts` now picks an S3-compatible bucket (works with R2, MinIO and AWS S3, SigV4-signed with no SDK) when the `S3_*` variables are set and keeps local disk for dev, so product files survive a deploy on a host whose filesystem is ephemeral instead of vanishing from under the download route.

## 2026-09-25

- PDF uploads: the upload route parses them to text with `pdf-parse` (page-boundary markers off, and a scan with no text layer is refused rather than indexed as nothing) while the chunker is unchanged, so a seller can attach the manual they already have instead of rewriting it as Markdown.

## 2026-09-24

- Do not charge a quota message when the model call fails before producing output: the monthly counter is refunded on a provider error that delivered no token, while a failure mid-answer still counts, so an outage no longer eats the buyer's messages.

## 2026-09-23

- Assistant eval suite: 40 questions over the seed documents with expected passages and answers, measuring retrieval recall@5 and answer correctness (extractive baseline on the FakeProvider in CI, real model behind `EVAL_MODEL=1`), reported in `evals/README.md` — so a change to chunking, embedding or re-ranking shows up as a number instead of as a worse answer nobody noticed.
