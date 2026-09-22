import { LicenseGuard, defaultFingerprint } from "offline-license";
import { env } from "@/lib/env";

export type Edition =
  | { edition: "cloud" }
  | { edition: "self-hosted"; valid: true; licensee: string; features: readonly string[]; expiresAt: number | null }
  | { edition: "self-hosted"; valid: false; reason: string };

/**
 * Two ways to run this: hosted by us (no license), or self-hosted by a customer
 * with a signed license file. Self-hosted installs check the license locally —
 * no phone-home — and the admin area needs the "admin" feature.
 */
export function edition(): Edition {
  const { LICENSE_TOKEN, LICENSE_PUBLIC_KEY } = env();
  if (!LICENSE_TOKEN || !LICENSE_PUBLIC_KEY) return { edition: "cloud" };
  const guard = new LicenseGuard({ publicKey: LICENSE_PUBLIC_KEY, token: LICENSE_TOKEN, machineFingerprint: defaultFingerprint() });
  const result = guard.check();
  if (!result.ok) return { edition: "self-hosted", valid: false, reason: result.reason };
  return { edition: "self-hosted", valid: true, licensee: result.claims.licensee, features: result.claims.features, expiresAt: result.claims.expiresAt ?? null };
}

export function adminAllowed(): boolean {
  const e = edition();
  return e.edition === "cloud" || (e.valid && e.features.includes("admin"));
}
