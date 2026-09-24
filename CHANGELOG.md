# Changelog

## 2026-09-24

- Do not charge a quota message when the model call fails before producing output: the monthly counter is refunded on a provider error that delivered no token, while a failure mid-answer still counts, so an outage no longer eats the buyer's messages.

## 2026-09-23

- Assistant eval suite: 40 questions over the seed documents with expected passages and answers, measuring retrieval recall@5 and answer correctness (extractive baseline on the FakeProvider in CI, real model behind `EVAL_MODEL=1`), reported in `evals/README.md` — so a change to chunking, embedding or re-ranking shows up as a number instead of as a worse answer nobody noticed.
