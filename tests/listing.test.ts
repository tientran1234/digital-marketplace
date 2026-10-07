/**
 * Which words a listing shows the reader in front of it: the locale they asked
 * for when the seller wrote it, the one it was written in when they did not.
 */
import { describe, expect, it } from "vitest";
import { localiseListing, writableTranslations, type TranslatableListing } from "@/domain/listing";

const guide: TranslatableListing = {
  title: "SaaS Pricing Playbook",
  description: "How to choose plans, price points and quotas.",
  locale: "en",
  translations: [{ locale: "vi", title: "Sổ tay định giá SaaS", description: "Cách chọn gói, mức giá và hạn mức." }],
};

describe("localised listings", () => {
  it("reads the listing in the locale the seller wrote it in", () => {
    expect(localiseListing(guide, "vi")).toEqual({
      title: "Sổ tay định giá SaaS",
      description: "Cách chọn gói, mức giá và hạn mức.",
      locale: "vi",
      fallback: false,
    });
  });

  it("is not a fallback when the reader is already in the listing's own language", () => {
    expect(localiseListing(guide, "en")).toMatchObject({ title: "SaaS Pricing Playbook", locale: "en", fallback: false });
  });

  it("falls back to the listing's own text, and says which language that is", () => {
    const written = { ...guide, translations: [] };

    expect(localiseListing(written, "vi")).toEqual({
      title: "SaaS Pricing Playbook",
      description: "How to choose plans, price points and quotas.",
      locale: "en",
      fallback: true,
    });
  });

  it("falls back for a listing loaded without its translations at all", () => {
    const { translations: _translations, ...bare } = guide;

    expect(localiseListing(bare, "vi")).toMatchObject({ title: "SaaS Pricing Playbook", fallback: true });
  });

  /** Half a translation is a broken page, not a partly translated one. */
  it("ignores a translation that is missing either field", () => {
    for (const half of [
      { locale: "vi", title: "Sổ tay định giá SaaS", description: "" },
      { locale: "vi", title: "", description: "Cách chọn gói." },
      { locale: "vi", title: "   ", description: "   " },
    ]) {
      expect(localiseListing({ ...guide, translations: [half] }, "vi")).toMatchObject({
        title: "SaaS Pricing Playbook",
        fallback: true,
      });
    }
  });

  it("takes no notice of a translation into some other language", () => {
    expect(localiseListing(guide, "fr")).toMatchObject({ locale: "en", fallback: true });
  });
});

describe("what a submitted listing writes", () => {
  const submitted = [
    { locale: "en", title: "SaaS Pricing Playbook", description: "How to choose plans." },
    { locale: "vi", title: "  Sổ tay định giá SaaS  ", description: "  Cách chọn gói.  " },
  ];

  it("writes a row for every language but the one in the product's own columns", () => {
    expect(writableTranslations(submitted, "en")).toEqual([
      { locale: "vi", title: "Sổ tay định giá SaaS", description: "Cách chọn gói." },
    ]);
    expect(writableTranslations(submitted, "vi")).toEqual([
      { locale: "en", title: "SaaS Pricing Playbook", description: "How to choose plans." },
    ]);
  });

  /** A language the seller had nothing to say in falls back; it does not go blank. */
  it("writes no row for a language left empty", () => {
    expect(writableTranslations([{ locale: "vi", title: "", description: "" }], "en")).toEqual([]);
    expect(writableTranslations([{ locale: "vi", title: " ", description: "\n" }], "en")).toEqual([]);
  });
});
