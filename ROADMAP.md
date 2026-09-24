# Roadmap

One item per pull request, in order.

- [x] Assistant eval suite: 40 questions over the seed documents with expected passages and answers; measure retrieval recall@5 and answer correctness (FakeProvider in CI, real model behind `EVAL_MODEL=1`); report in `evals/README.md`.
- [x] Do not charge a quota message when the model call fails before producing output (refund the counter on provider error).
- [ ] PDF uploads: parse to text (`pdf-parse`) in the upload route; chunker unchanged.
- [ ] Object storage adapter: `server/storage.ts` on S3-compatible storage (works with Vercel Blob / R2), local disk stays for dev.
- [ ] UI polish: design tokens, responsive product grid with cover images, empty states, loading skeletons for the ask box. Screenshots in README.
- [ ] Seller analytics (Pro feature): views, purchases, questions asked per product; uses `canUse(ent, "seller_analytics")`.
- [ ] Auth.js magic-link sign-in replacing the dev login route; sessions table stays.
- [ ] Playwright end-to-end: buy → webhook → download; ask → cited answer (FakeProvider via env).
