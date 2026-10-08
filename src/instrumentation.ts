import { seedOnBootRequested } from "@/server/bootstrap";

/**
 * Next calls this once per server instance and waits for it before serving a
 * request, which is exactly the window a first-boot seed needs: the first page
 * anyone loads already has the products on it.
 *
 * The work is behind a dynamic import because this file is compiled for the
 * edge runtime too, where there is no Postgres driver — and because a
 * deployment that has not asked to be seeded should not be loading the demo
 * corpus into every instance it boots. The build evaluates this file as well,
 * and with the flag unset there is nothing here to do.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Read off `process.env` rather than `lib/env`: a boot that was not asked
  // to seed should not be the first thing to fail over a missing secret.
  if (!seedOnBootRequested({ SEED_ON_BOOT: process.env.SEED_ON_BOOT })) return;
  await (await import("@/server/bootstrap-postgres")).seedThisDeployment();
}
