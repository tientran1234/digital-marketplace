import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";
import { seedOnBootRequested, seedOnFirstBoot, type SeedGate } from "@/server/bootstrap";
import { postgresSeedGate } from "@/server/bootstrap-postgres";

const hasDb = Boolean(process.env.DATABASE_URL);

/**
 * One database with as many instances in front of it as a deployment happened
 * to boot. The claim is shared because the advisory lock behind it is: what
 * these tests are about is what two instances do to each other, which a gate
 * per test cannot show.
 */
function fakeDeployment(options: { products?: number; seed?: () => Promise<void> } = {}) {
  const state = { products: options.products ?? 0, claimed: false };
  const calls: string[] = [];

  function instance(): SeedGate {
    let holds = false;
    return {
      async claim() {
        calls.push("claim");
        if (state.claimed) return false;
        state.claimed = holds = true;
        return true;
      },
      async release() {
        calls.push("release");
        if (!holds) return;
        state.claimed = holds = false;
      },
      async isEmpty() {
        calls.push("isEmpty");
        return state.products === 0;
      },
      async seed() {
        calls.push("seed");
        await options.seed?.();
        state.products = 2;
      },
    };
  }

  return { instance, state, calls };
}

describe("seedOnBootRequested", () => {
  it("is off unless a deployment asked in so many words", () => {
    for (const SEED_ON_BOOT of [undefined, "", "0", "true", "yes", "on"]) {
      expect(seedOnBootRequested({ SEED_ON_BOOT })).toBe(false);
    }
    expect(seedOnBootRequested({ SEED_ON_BOOT: "1" })).toBe(true);
  });
});

describe("seedOnFirstBoot", () => {
  it("seeds an empty marketplace and lets go of the claim afterwards", async () => {
    const deployment = fakeDeployment();

    expect(await seedOnFirstBoot(deployment.instance())).toBe("seeded");
    expect(deployment.state.products).toBe(2);
    expect(deployment.state.claimed).toBe(false);
  });

  it("leaves a marketplace that already has products alone", async () => {
    const deployment = fakeDeployment({ products: 7 });

    expect(await seedOnFirstBoot(deployment.instance())).toBe("already-seeded");
    expect(deployment.calls).toEqual(["claim", "isEmpty", "release"]);
    expect(deployment.state.products).toBe(7);
  });

  it("asks whether the marketplace is empty only while holding the claim", async () => {
    // The order is the guarantee: read emptiness before the claim and two
    // instances both see an empty marketplace and both fill it.
    const deployment = fakeDeployment();
    await seedOnFirstBoot(deployment.instance());

    expect(deployment.calls.indexOf("claim")).toBeLessThan(deployment.calls.indexOf("isEmpty"));
    expect(deployment.calls.indexOf("isEmpty")).toBeLessThan(deployment.calls.indexOf("seed"));
  });

  it("seeds once between every instance that boots at the same moment", async () => {
    // Held open until all five have had their turn at the claim, which is what
    // a deployment's cold start actually looks like.
    let release = () => {};
    const seeding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deployment = fakeDeployment({ seed: () => seeding });

    const boots = Array.from({ length: 5 }, () => seedOnFirstBoot(deployment.instance()));
    release();
    const outcomes = await Promise.all(boots);

    expect(outcomes.filter((o) => o === "seeded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "seeding-elsewhere")).toHaveLength(4);
    expect(deployment.calls.filter((c) => c === "seed")).toHaveLength(1);
  });

  it("does not read or write the marketplace when another instance holds the claim", async () => {
    const deployment = fakeDeployment();
    const held = deployment.instance();
    expect(await held.claim()).toBe(true);

    expect(await seedOnFirstBoot(deployment.instance())).toBe("seeding-elsewhere");
    expect(deployment.calls).toEqual(["claim", "claim"]);
  });

  it("gives the claim back when the seed throws, so the next boot retries it", async () => {
    let attempts = 0;
    const deployment = fakeDeployment({
      seed: async () => {
        if (++attempts === 1) throw new Error("neon said no");
      },
    });

    await expect(seedOnFirstBoot(deployment.instance())).rejects.toThrow("neon said no");
    // A marker row would have been written by now and nothing would ever try
    // again; the claim is a lock and the empty marketplace is the question.
    expect(deployment.state.claimed).toBe(false);

    expect(await seedOnFirstBoot(deployment.instance())).toBe("seeded");
    expect(deployment.state.products).toBe(2);
  });
});

/**
 * The claim against the lock it is actually made of. What the fake above
 * cannot answer is whether `pg_try_advisory_lock` refuses the second caller
 * and whether the unlock hands the connection back to the pool.
 *
 *   DATABASE_URL=… pnpm test
 */
describe.skipIf(!hasDb)("the first-boot claim on real Postgres", () => {
  beforeEach(async () => {
    await db.user.deleteMany();
  });
  afterAll(async () => {
    await db.user.deleteMany();
    await db.$disconnect();
    await pool().end();
  });

  it("is held by one instance at a time, and handed on once released", async () => {
    const first = postgresSeedGate(pool(), db);
    const second = postgresSeedGate(pool(), db);

    expect(await first.claim()).toBe(true);
    expect(await second.claim()).toBe(false);

    await first.release();
    expect(await second.claim()).toBe(true);
    await second.release();
  });

  it("gives back the connection it claimed on, so booting cannot drain the pool", async () => {
    // The pool is `max: 5`; a claim that kept its client would run out here.
    for (let i = 0; i < 12; i++) {
      const gate = postgresSeedGate(pool(), db);
      expect(await gate.claim()).toBe(true);
      await gate.release();
    }
  });

  it("calls an empty marketplace empty, and a stocked one not", async () => {
    const gate = postgresSeedGate(pool(), db);
    expect(await gate.isEmpty()).toBe(true);

    const seller = await db.user.create({ data: { email: "boot@example.test", name: "Seller", role: "SELLER" } });
    await db.product.create({ data: { sellerId: seller.id, slug: "boot-check", title: "Boot check", description: "d", priceMinor: 0, status: "PUBLISHED" } });
    expect(await gate.isEmpty()).toBe(false);
  });
});
