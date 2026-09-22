import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There are stray lockfiles above this folder; pin the tracing root to the app.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default withNextIntl(nextConfig);
