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
  throw new UploadError(415, `not implemented (${fileName}, ${bytes.length} bytes)`);
}
