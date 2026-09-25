import { describe, expect, it } from "vitest";
import { UploadError, extractText } from "@/server/extract";

/**
 * One-page-per-entry PDFs with uncompressed Helvetica text, built here rather
 * than committed, so the fixtures stay readable in the diff. A page with no
 * lines is the shape a scanned document has: real pages, no text layer.
 */
function pdf(pages: string[][]): Uint8Array {
  const ids = pages.map((_, i) => ({ page: 4 + i * 2, contents: 5 + i * 2 }));
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${ids.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  for (const [i, lines] of pages.entries()) {
    const stream = `BT /F1 12 Tf 72 720 Td 14 TL\n${lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj T*`).join("\n")}\nET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${ids[i]!.contents} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

describe("extractText", () => {
  it("passes markdown through unchanged, accents and all", async () => {
    const source = "# Chính sách hoàn tiền\n\nHoàn tiền trong 14 ngày.\n";
    expect(await extractText("guide.md", utf8(source))).toBe(source);
    expect(await extractText("guide.markdown", utf8(source))).toBe(source);
    expect(await extractText("notes.txt", utf8(source))).toBe(source);
  });

  it("reads the text out of a PDF", async () => {
    const text = await extractText("guide.pdf", pdf([["Refunds are granted within 14 days.", "No questions asked."]]));
    expect(text).toContain("Refunds are granted within 14 days.");
    expect(text).toContain("No questions asked.");
  });

  it("keeps the pages in order and leaves no page-boundary markers in the text", async () => {
    const text = await extractText("manual.pdf", pdf([["Installing the plugin."], ["Uninstalling the plugin."]]));
    // A "-- 1 of 2 --" line between pages would survive chunking and come back
    // as a cited passage, so the extractor has to turn the marker off.
    expect(text).not.toMatch(/--\s*\d+\s*of\s*\d+\s*--/);
    expect(text.indexOf("Installing")).toBeLessThan(text.indexOf("Uninstalling"));
  });

  it("leaves the caller's bytes readable, because the route stores the file after indexing it", async () => {
    const bytes = pdf([["Refunds are granted within 14 days."]]);
    const size = bytes.length;
    await extractText("guide.pdf", bytes);
    expect(bytes.length).toBe(size);
  });

  it("rejects a PDF with no text layer instead of indexing nothing", async () => {
    await expect(extractText("scan.pdf", pdf([[], []]))).rejects.toMatchObject({ name: "UploadError", status: 422 });
  });

  it("rejects an empty text document for the same reason", async () => {
    await expect(extractText("empty.md", utf8("   \n\n"))).rejects.toMatchObject({ name: "UploadError", status: 422 });
  });

  it("rejects an extension it cannot read", async () => {
    const error = await extractText("guide.docx", utf8("anything")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(415);
  });

  it("rejects a file that claims to be a PDF but is not", async () => {
    await expect(extractText("guide.pdf", utf8("not a pdf at all"))).rejects.toMatchObject({ name: "UploadError", status: 422 });
  });
});
