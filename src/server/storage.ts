import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { s3Bucket, type S3Config } from "@/providers/s3";
import { env } from "@/lib/env";

/**
 * Where product files live: an S3-compatible bucket when one is configured,
 * local disk otherwise. Disk is the dev default and it is also what Vercel
 * gives you, where it is ephemeral — the file a seller uploads is gone from
 * under the download route by the time a buyer asks for it.
 *
 * Both backends address objects by the same key, so moving to a bucket is
 * copying the storage directory into it.
 */
export type FileStore = {
  readonly name: "disk" | "s3";
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
};

/** The settings that decide the backend. Kept narrow so the choice can be exercised without a whole environment. */
export type StorageEnv = Partial<Record<"S3_ENDPOINT" | "S3_BUCKET" | "S3_REGION" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY", string>>;

/**
 * `productId/filename`, the filename cut down to what is safe in both a path
 * and a URL. Runs of dots go too: a single dot is wanted (`guide.v2.pdf`) but
 * `..` would survive the character filter and produce a key `readFileByKey`
 * then refuses forever, leaving the product undownloadable.
 */
export function fileKey(productId: string, fileName: string): string {
  return `${productId}/${fileName.replace(/[^\w.\-]+/g, "_").replace(/\.\.+/g, "_")}`;
}

export function localStore(root: string): FileStore {
  return {
    name: "disk",
    async put(key, bytes) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      return readFile(join(root, key));
    },
  };
}

export function s3Store(config: S3Config): FileStore {
  return { name: "s3", ...s3Bucket(config) };
}

/**
 * Half-configured S3 is an error rather than a quiet fall back to disk: on
 * Vercel that fallback looks like a working upload and a missing file an
 * hour later, which is exactly the failure the bucket is here to prevent.
 */
export function selectStore(e: StorageEnv, localRoot: string): FileStore {
  const required = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = required.filter((name) => !e[name]);
  if (missing.length === required.length) return localStore(localRoot);
  if (missing.length) throw new Error(`object storage is half-configured: ${missing.join(", ")} missing`);
  return s3Store({
    endpoint: e.S3_ENDPOINT!,
    bucket: e.S3_BUCKET!,
    // `auto` is what R2 signs with; AWS wants the bucket's own region.
    region: e.S3_REGION ?? "auto",
    accessKeyId: e.S3_ACCESS_KEY_ID!,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
  });
}

let override: FileStore | null = null;
let cached: FileStore | null = null;

/** Tests inject a store here. */
export function setFileStoreForTests(s: FileStore | null) {
  override = s;
  cached = null;
}

function store(): FileStore {
  if (override) return override;
  if (!cached) cached = selectStore(env(), process.env.STORAGE_DIR ?? join(process.cwd(), "storage"));
  return cached;
}

export async function saveFile(productId: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const key = fileKey(productId, fileName);
  await store().put(key, bytes);
  return key;
}

export async function readFileByKey(key: string): Promise<Buffer> {
  if (key.includes("..")) throw new Error("invalid key");
  return store().get(key);
}
