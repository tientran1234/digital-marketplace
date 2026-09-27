/**
 * Sellers upload a document, not cover art, so the grid derives a cover from
 * what a product already has: a gradient off the slug and the title's
 * initials. Derived rather than stored means the same product draws the same
 * cover on every render and every machine — a card cannot flicker into
 * another colour between the server's HTML and the client's.
 */

export interface Cover {
  /** The two stops, ready for `linear-gradient`. */
  from: string;
  to: string;
  initials: string;
}

/** FNV-1a: stable across platforms and spreads adjacent slugs to far hues. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The first letter of each of the first two words, so "SaaS Pricing Playbook"
 * reads as "SP". Words opening with punctuation are skipped rather than
 * printed, and a title with no letter or digit in it still gets something.
 */
export function initials(title: string): string {
  const words = title.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const first = words.slice(0, 2).map((w) => Array.from(w)[0]);
  return first.length === 0 ? "·" : first.join("").toLocaleUpperCase();
}

export function cover(product: { slug: string; title: string }): Cover {
  const hue = hash(product.slug) % 360;
  // A fifth of the wheel apart: enough shift to look lit from one side, not
  // enough to read as two colours fighting.
  return {
    from: `hsl(${hue} 58% 56%)`,
    to: `hsl(${(hue + 72) % 360} 52% 40%)`,
    initials: initials(product.title),
  };
}
