import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cover, initials } from "@/lib/cover";
import en from "@/i18n/messages/en.json";
import vi from "@/i18n/messages/vi.json";

const repo = fileURLToPath(new URL("..", import.meta.url));
const css = await readFile(join(repo, "src/app/[locale]/globals.css"), "utf8");

/** The text between the braces of the first rule whose selector matches. */
function block(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `${selector} is not in globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`${selector} is not closed`);
}

const names = (source: string, pattern: RegExp) => new Set(Array.from(source.matchAll(pattern), (m) => m[1]));

describe("design tokens", () => {
  /**
   * A `var(--gone)` does not fail a build, it just renders the fallback —
   * usually nothing. This is the check that a renamed token takes its uses
   * with it.
   */
  it("declares every token the stylesheet uses", () => {
    const declared = names(block(":root"), /--([a-z0-9-]+)\s*:/g);
    const used = names(css, /var\(--([a-z0-9-]+)/g);
    expect([...used].filter((t) => !declared.has(t))).toEqual([]);
  });

  /** A surface token defined only in light mode is how dark mode breaks. */
  it("redefines every surface token for dark mode", () => {
    const dark = block("@media (prefers-color-scheme: dark)");
    const declared = names(dark, /--([a-z0-9-]+)\s*:/g);
    for (const token of ["bg", "surface", "fg", "muted", "line", "accent", "skeleton", "shadow-1"]) {
      expect(declared, `--${token} keeps its light value in dark mode`).toContain(token);
    }
  });

  it("uses tokens for spacing and radius rather than raw pixels", () => {
    const declared = names(block(":root"), /--([a-z0-9-]+)\s*:/g);
    for (const token of ["space-1", "space-2", "space-3", "space-4", "space-5", "radius-1", "radius-2", "radius-3"]) {
      expect(declared).toContain(token);
    }
  });
});

describe("product grid", () => {
  it("lays covers out on their own aspect ratio, so cards stay the same height", () => {
    expect(block(".cover")).toMatch(/aspect-ratio/);
  });

  it("drops to one column on a phone", () => {
    expect(css).toMatch(/@media \(max-width: *640px\)/);
    expect(block("@media (max-width: 640px)")).toMatch(/\.grid/);
  });
});

describe("loading skeletons", () => {
  it("shimmers", () => {
    expect(block(".skeleton")).toMatch(/animation: *skeleton/);
    expect(css).toMatch(/@keyframes skeleton/);
  });

  /** A shimmer that ignores the setting is exactly what the setting is for. */
  it("holds still for prefers-reduced-motion", () => {
    expect(block("@media (prefers-reduced-motion: reduce)")).toMatch(/animation: *none/);
  });
});

describe("covers", () => {
  const product = { slug: "saas-pricing-playbook", title: "SaaS Pricing Playbook" };

  it("is the same cover every time, so server and client agree", () => {
    expect(cover(product)).toEqual(cover({ ...product }));
  });

  it("keeps both hues on the wheel", () => {
    for (const slug of ["a", "saas-pricing-playbook", "x".repeat(200), "", "tài-liệu"]) {
      for (const stop of [cover({ slug, title: "T" }).from, cover({ slug, title: "T" }).to]) {
        const hue = Number(/^hsl\((\d+) /.exec(stop)?.[1]);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(360);
      }
    }
  });

  it("gives neighbouring slugs different hues", () => {
    const hues = new Set(["product-1", "product-2", "product-3", "product-4"].map((slug) => cover({ slug, title: "T" }).from));
    expect(hues.size).toBe(4);
  });

  it("initials the first two words", () => {
    expect(initials("SaaS Pricing Playbook")).toBe("SP");
    expect(initials("Notion")).toBe("N");
    expect(initials("Sản phẩm số")).toBe("SP");
    expect(initials("  spaced   out  ")).toBe("SO");
    expect(initials("3 ways to price")).toBe("3W");
  });

  it("has something to draw for a title with no letters", () => {
    expect(initials("")).toBe("·");
    expect(initials("— ???")).toBe("·");
  });
});

describe("copy", () => {
  const paths = (value: unknown, prefix = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];

  /** Half-translated copy is worse than none: the page reads as broken. */
  it("says everything in both locales", () => {
    expect(paths(vi).sort()).toEqual(paths(en).sort());
  });

  it("has a title and a hint for every empty state", () => {
    const at = (messages: unknown, path: string) =>
      path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
    for (const key of ["home.empty", "home.emptyHint", "account.noOrders", "account.noOrdersHint", "sell.noProducts", "sell.noProductsHint", "admin.noPending", "admin.noPendingHint"]) {
      expect(at(en, key), key).toBeTruthy();
    }
  });
});
