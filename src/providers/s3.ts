import { createHash, createHmac } from "node:crypto";

/**
 * An S3-compatible bucket: PUT and GET, SigV4-signed with `node:crypto`.
 *
 * Two requests against a published protocol, so no SDK — the same trade this
 * project already makes by talking to pgvector in raw SQL. Addressing is
 * path-style (`/bucket/key`), which R2 and MinIO require and AWS accepts.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

export type S3Config = {
  /** Origin without the bucket: `https://<account>.r2.cloudflarestorage.com`, `https://s3.eu-west-1.amazonaws.com`. */
  endpoint: string;
  bucket: string;
  /** `auto` on R2; the real region on AWS, because it is signed. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Swapped in tests; the bucket is otherwise reached over the network. */
  fetch?: typeof globalThis.fetch;
};

/** A request with every header it will be signed with already on it. */
type Signable = {
  method: "GET" | "PUT";
  url: URL;
  headers: Record<string, string> & { host: string; "x-amz-date": string; "x-amz-content-sha256": string };
};

const hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * The `Authorization` header for one request, per SigV4. Separate from the
 * transport below because it is the only part of this file with a published
 * spec — and a signature that is wrong by one byte is rejected as forged.
 */
export function authorization(config: Pick<S3Config, "accessKeyId" | "secretAccessKey" | "region">, request: Signable): string {
  const amzDate = request.headers["x-amz-date"];
  const scope = `${amzDate.slice(0, 8)}/${config.region}/${SERVICE}/aws4_request`;

  const names = Object.keys(request.headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${request.headers[name]!.trim()}\n`).join("");
  const query = [...request.url.searchParams]
    .sort()
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");
  // Keys are sanitised to `[\w.\-]` before they get here, so the path the URL
  // carries is already its own canonical encoding.
  const canonical = [request.method, request.url.pathname, query, canonicalHeaders, names.join(";"), request.headers["x-amz-content-sha256"]].join("\n");

  let key: Uint8Array = Buffer.from(`AWS4${config.secretAccessKey}`, "utf8");
  for (const part of [amzDate.slice(0, 8), config.region, SERVICE, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update([ALGORITHM, amzDate, scope, hex(canonical)].join("\n")).digest("hex");

  return `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

/** Percent-encoding as SigV4 defines it, which keeps four characters `encodeURIComponent` lets through. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** PUT and GET one object, signed. */
export function s3Bucket(config: S3Config) {
  const call = async (method: "GET" | "PUT", key: string, body?: Uint8Array): Promise<Response> => {
    const url = new URL(`${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${key}`);
    const request: Signable = {
      method,
      url,
      headers: {
        host: url.host,
        "x-amz-date": `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
        // S3 requires the payload hash even on a GET, where it is the hash of nothing.
        "x-amz-content-sha256": hex(body ?? new Uint8Array()),
      },
    };
    const send = config.fetch ?? globalThis.fetch;
    return send(url, { method, headers: { ...request.headers, authorization: authorization(config, request) }, body: body as BodyInit | undefined });
  };

  return {
    async put(key: string, bytes: Uint8Array): Promise<void> {
      const response = await call("PUT", key, bytes);
      if (!response.ok) throw new Error(`s3 PUT ${key} failed: ${response.status} ${await response.text()}`);
    },
    async get(key: string): Promise<Buffer> {
      const response = await call("GET", key);
      if (!response.ok) throw new Error(`s3 GET ${key} failed: ${response.status} ${await response.text()}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
