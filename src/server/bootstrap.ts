/**
 * Seeding a deployment the first time it boots.
 *
 * Nothing runs between `vercel deploy` and the first request: there is no
 * release step to hang `pnpm db:seed` off, and the build cannot do it either —
 * a build is cached and reused across deployments while a database is not.
 * So the app seeds itself, which is what gives a preview deployment something
 * to browse and a fresh self-hosted install something other than an empty
 * marketplace.
 *
 * Three things make that safe to leave switched on:
 *
 *   - It is opt in. Demo products appearing in a real seller's marketplace is
 *     worse than an empty one, so a deployment has to ask.
 *   - It only ever writes into an empty marketplace, so it cannot overwrite or
 *     duplicate what a deployment has been accumulating.
 *   - Only one instance seeds. A serverless deployment boots as many instances
 *     as it has traffic and they all come up against the same empty database
 *     at once.
 */

/** The settings that decide whether a boot seeds. Kept narrow so the choice can be exercised without a whole environment. */
export type BootstrapEnv = Partial<Record<"SEED_ON_BOOT", string>>;

/** `1` and nothing else, the same spelling as `FAKE_PROVIDERS`: a flag that is on for `"false"` is a flag nobody can turn off. */
export function seedOnBootRequested(e: BootstrapEnv): boolean {
  return e.SEED_ON_BOOT === "1";
}

export type SeedOutcome = "seeded" | "already-seeded" | "seeding-elsewhere";

/**
 * What a first boot needs from the database, as four narrow calls so the order
 * they happen in can be exercised without one.
 */
export interface SeedGate {
  /**
   * True when this caller, and no other, may seed. It does not wait: another
   * instance holding the claim means the work is already being done, and a
   * boot that blocks on it is a request nobody is serving.
   */
  claim(): Promise<boolean>;
  release(): Promise<void>;
  /** True when the marketplace holds no products — the only state a seed may write into. */
  isEmpty(): Promise<boolean>;
  seed(): Promise<void>;
}

/**
 * Emptiness is checked inside the claim, not before it: two instances that
 * both read "empty" and then both seed produce two of everything, which is the
 * failure the claim exists to prevent.
 *
 * Nothing is recorded as done. The question "is this marketplace empty" is one
 * every instance answers the same way without having to agree on a marker,
 * and a seed that dies half way through is retried by the next boot rather
 * than locked out by a row it already wrote.
 */
export async function seedOnFirstBoot(gate: SeedGate): Promise<SeedOutcome> {
  if (!(await gate.claim())) return "seeding-elsewhere";
  try {
    if (!(await gate.isEmpty())) return "already-seeded";
    await gate.seed();
    return "seeded";
  } finally {
    await gate.release();
  }
}
