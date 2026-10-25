/**
 * What a drafted translation is held to: the instructions that keep the model
 * a translator rather than an author, and the bounds that keep a draft
 * something the seller can submit.
 */
import { describe, expect, it } from "vitest";
import { DraftedListing, draftInput, draftSystem } from "@/domain/translation";

const source = { title: "SaaS Pricing Playbook", description: "How to choose plans, price points and quotas. 120 pages." };

describe("what the model is asked for", () => {
  it("names both languages, in the language the instructions are written in", () => {
    const system = draftSystem("en", "vi");

    expect(system).toContain("from English into Vietnamese");
    expect(system).toContain("Write the Vietnamese");
  });

  /** The marketplace restating a price or a promise is the seller answering for a sentence they never wrote. */
  it("tells the model to carry the listing across and author nothing", () => {
    const system = draftSystem("vi", "en");

    expect(system).toContain("add no claim it does not make");
    expect(system).toContain("Keep every figure, price, version, file format, product name and personal name exactly as it is written.");
    expect(system).toContain("draft the seller will read and correct");
  });

  it("hands over the seller's words as the shape the answer comes back in", () => {
    expect(JSON.parse(draftInput(source))).toEqual(source);
  });
});

describe("what comes back", () => {
  it("takes a draft of both fields", () => {
    expect(DraftedListing.parse({ title: "Sổ tay định giá SaaS", description: "Cách chọn gói, mức giá và hạn mức. 120 trang." })).toEqual({
      title: "Sổ tay định giá SaaS",
      description: "Cách chọn gói, mức giá và hạn mức. 120 trang.",
    });
  });

  it("trims a padded draft rather than refusing it for its padding", () => {
    expect(DraftedListing.parse({ title: "  Sổ tay định giá SaaS\n", description: "  Cách chọn gói, mức giá và hạn mức.  " })).toEqual({
      title: "Sổ tay định giá SaaS",
      description: "Cách chọn gói, mức giá và hạn mức.",
    });
  });

  /**
   * The form these land in posts to `POST /api/products`, which refuses the
   * same shapes. A draft outside the bounds would be text the seller is left
   * to cut down before they can submit.
   */
  it("refuses a draft the submit route would refuse", () => {
    for (const bad of [
      { title: "", description: "Cách chọn gói, mức giá và hạn mức." },
      { title: "Sổ", description: "Cách chọn gói, mức giá và hạn mức." },
      { title: "Sổ tay định giá SaaS", description: "Ngắn" },
      { title: "x".repeat(121), description: "Cách chọn gói, mức giá và hạn mức." },
      { title: "Sổ tay định giá SaaS", description: "x".repeat(2001) },
      { title: "Sổ tay định giá SaaS" },
      { description: "Cách chọn gói, mức giá và hạn mức." },
    ]) {
      expect(DraftedListing.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});
