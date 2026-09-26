# Changelog

## 2026-09-26

- Object storage adapter: `server/storage.ts` now picks an S3-compatible bucket (works with R2, MinIO and AWS S3, SigV4-signed with no SDK) when the `S3_*` variables are set and keeps local disk for dev, so product files survive a deploy on a host whose filesystem is ephemeral instead of vanishing from under the download route.

## 2026-09-25

- PDF uploads: the upload route parses them to text with `pdf-parse` (page-boundary markers off, and a scan with no text layer is refused rather than indexed as nothing) while the chunker is unchanged, so a seller can attach the manual they already have instead of rewriting it as Markdown.

## 2026-09-24

- Do not charge a quota message when the model call fails before producing output: the monthly counter is refunded on a provider error that delivered no token, while a failure mid-answer still counts, so an outage no longer eats the buyer's messages.

## 2026-09-23

- Assistant eval suite: 40 questions over the seed documents with expected passages and answers, measuring retrieval recall@5 and answer correctness (extractive baseline on the FakeProvider in CI, real model behind `EVAL_MODEL=1`), reported in `evals/README.md` — so a change to chunking, embedding or re-ranking shows up as a number instead of as a worse answer nobody noticed.
