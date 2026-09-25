import { PDFParse } from "pdf-parse";

/**
 * Turn an uploaded product document into the plain text the indexer chunks.
 *
 * The chunker is structure-aware — it reads heading lines and blank lines — so
 * whatever comes out of here has to look like prose, not like a page dump.
 */

/** An upload we will not index: an extension we cannot read, or a file with no text in it. */
export class UploadError extends Error {
  constructor(readonly status: 415 | 422, message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Extensions the upload route accepts; the file input's `accept` mirrors this. */
export const UPLOAD_EXTENSIONS = /\.(md|markdown|txt|pdf)$/i;

/** Decode an upload to text, or throw `UploadError` describing why it cannot be indexed. */
export async function extractText(fileName: string, bytes: Uint8Array): Promise<string> {
  const extension = UPLOAD_EXTENSIONS.exec(fileName)?.[1]?.toLowerCase();
  if (!extension) throw new UploadError(415, "only .md, .txt and .pdf");

  const text = extension === "pdf" ? await pdfText(bytes) : new TextDecoder().decode(bytes);
  // A scanned PDF parses fine and yields nothing. Indexing it would leave the
  // seller with a listing whose assistant has never read the thing it is selling.
  if (!text.trim()) throw new UploadError(422, "no text in the document — a scan needs OCR first");
  return text;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js transfers the buffer it is handed to its worker, and the route still
  // has to store those bytes afterwards, so parse a copy.
  const parser = new PDFParse({ data: bytes.slice() });
  try {
    // pageJoiner off: the default inserts a "-- 1 of 3 --" line per page, which
    // the chunker would happily index and the assistant would later cite.
    const { text } = await parser.getText({ pageJoiner: "" });
    return text;
  } catch (cause) {
    throw new UploadError(422, `could not read the PDF: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await parser.destroy();
  }
}
