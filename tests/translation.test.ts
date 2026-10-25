/**
 * What a drafted translation is held to: the instructions that keep the model
 * a translator rather than an author, and the bounds that keep a draft
 * something the seller can submit.
 */
import { describe, expect, it } from "vitest";
import { FakeProvider, reply, textOf } from "agent-runtime";
import { DraftedListing, draftInput, draftSystem, parseDraft } from "@/domain/translation";
import { untranslatedDraft } from "@/providers/fake";
import { DraftError, draftWith } from "@/server/translate";

const source = { title: "SaaS Pricing Playbook", description: "How to choose plans, price points and quotas. 120 pages." };

describe("what the model is asked for", () => {
  it("names both languages, in the language the instructions are written in", () => {
    const system = draftSystem("en", "vi");

    expect(system).toContain("from English into Vietnamese");
    expect(system).toContain("Write the Vietnamese");
  });

  /** The marketplace restating a price or a promise is the seller answering for a sentence they never wrote. */
  it("asks for the two fields alone, which is what the parse will hold it to", () => {
    expect(draftSystem("en", "vi")).toContain('{"title": "…", "description": "…"}');
  });

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

/** A model that answers once, with whatever it is given. */
const scripted = (text: string) => new FakeProvider([() => reply(text)], "scripted-translator");

describe("what comes back as a draft", () => {
  const vietnamese = { title: "Sổ tay định giá SaaS", description: "Cách chọn gói, mức giá và hạn mức. 120 trang." };

  it("reads the two fields out of the reply", () => {
    expect(parseDraft(JSON.stringify(vietnamese))).toEqual({ ok: true, value: vietnamese });
  });

  /** Every model fences a JSON answer sooner or later, and a fence around the right two fields is not a misunderstanding. */
  it("takes a fenced answer as the object inside it", () => {
    expect(parseDraft("```json\n" + JSON.stringify(vietnamese) + "\n```")).toEqual({ ok: true, value: vietnamese });
  });

  it("says why, rather than throwing, so the seller can be told", () => {
    expect(parseDraft("Sure! Here is the translation.")).toEqual({ ok: false, problem: "the model did not answer with JSON" });
    expect(parseDraft(JSON.stringify({ title: vietnamese.title }))).toMatchObject({ ok: false });
    expect(parseDraft(JSON.stringify({ ...vietnamese, title: "Sổ" }))).toMatchObject({ ok: false });
  });
});

describe("the draft the route hands back", () => {
  const vietnamese = { title: "Sổ tay định giá SaaS", description: "Cách chọn gói, mức giá và hạn mức. 120 trang." };

  it("is the model's answer, in the fields the form has", async () => {
    await expect(draftWith(scripted(JSON.stringify(vietnamese)), { source, from: "en", to: "vi" })).resolves.toEqual(vietnamese);
  });

  it("asks about the words the seller typed", async () => {
    const provider = scripted(JSON.stringify(vietnamese));

    await draftWith(provider, { source, from: "en", to: "vi" });

    expect(provider.calls[0]?.messages.map((m) => textOf(m.content as never)).join("\n")).toContain(source.title);
    expect(provider.calls[0]?.system).toContain("into Vietnamese");
  });

  /** A draft is a convenience: the seller is told it did not work and types the field they were going to type anyway. */
  it("refuses a reply that is not a usable draft", async () => {
    await expect(draftWith(scripted("Here you go: a translation."), { source, from: "en", to: "vi" })).rejects.toThrow(DraftError);
    await expect(draftWith(scripted(JSON.stringify({ title: vietnamese.title })), { source, from: "en", to: "vi" })).rejects.toThrow(/description/);
  });

  /**
   * With no key there is nothing to translate with, and the stand-in says so
   * by handing the seller their own words back: a draft they can see is
   * untranslated, where an invented one would read as a translation nobody
   * wrote.
   */
  it("hands the seller's own words back where there is no model", async () => {
    await expect(draftWith(untranslatedDraft(source), { source, from: "en", to: "vi" })).resolves.toEqual(source);
  });
});
