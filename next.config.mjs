import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There are stray lockfiles above this folder; pin the tracing root to the app.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  webpack: (config, { nextRuntime, webpack }) => {
    // `instrumentation.ts` is compiled for the edge runtime as well, and
    // webpack follows the first-boot seed's import even though `NEXT_RUNTIME`
    // keeps the edge bundle out of that branch — dragging Prisma, `pg` and
    // `node:fs` into a runtime that has none of them. Dropping the module from
    // that one bundle makes the guard true at build time too.
    if (nextRuntime === "edge") config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /bootstrap-postgres$/ }));
    return config;
  },
};

export default withNextIntl(nextConfig);
