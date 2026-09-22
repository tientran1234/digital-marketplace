import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where product files live. Local disk here; on Vercel the filesystem is
 * ephemeral, so production swaps this for S3 / Vercel Blob behind the same
 * two functions.
 */
const ROOT = process.env.STORAGE_DIR ?? join(process.cwd(), "storage");

export async function saveFile(productId: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const safe = fileName.replace(/[^\w.\-]+/g, "_");
  const dir = join(ROOT, productId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, safe), bytes);
  return `${productId}/${safe}`;
}

export async function readFileByKey(key: string): Promise<Buffer> {
  if (key.includes("..")) throw new Error("invalid key");
  return readFile(join(ROOT, key));
}
