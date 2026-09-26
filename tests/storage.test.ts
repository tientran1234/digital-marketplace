import { createHmac } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorization, s3Bucket, type S3Config } from "@/providers/s3";
import {
  fileKey,
  localStore,
  readFileByKey,
  saveFile,
  selectStore,
  setFileStoreForTests,
  type FileStore,
} from "@/server/storage";

/**
 * AWS publishes a worked "GET Object" example for Signature Version 4 along
 * with the SHA-256 its canonical request hashes to. Deriving the expected
 * signature from that published digest — rather than from whatever this
 * implementation happens to produce — is what makes it a vector: canonicalise
 * a header differently, or drop one, and the two stop agreeing.
 */
const EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const EXAMPLE_CANONICAL_SHA256 = "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function documentedSignature(canonicalSha256: string, scope: string, amzDate: string): string {
  const hmac = (key: Uint8Array, data: string) => createHmac("sha256", key).update(data).digest();
  let key: Uint8Array = Buffer.from(`AWS4${EXAMPLE.secretAccessKey}`, "utf8");
  for (const part of scope.split("/")) key = hmac(key, part);
  return createHmac("sha256", key).update(["AWS4-HMAC-SHA256", amzDate, scope, canonicalSha256].join("\n")).digest("hex");
}

const exampleRequest = () => ({
  method: "GET" as const,
  url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
  // Deliberately not in the order SigV4 signs them in; the signer sorts.
  headers: {
    "x-amz-date": "20130524T000000Z",
    range: "bytes=0-9",
    host: "examplebucket.s3.amazonaws.com",
    "x-amz-content-sha256": EMPTY_SHA256,
  },
});

describe("authorization", () => {
  it("signs AWS's published GET Object example the way the documentation does", () => {
    const expected = documentedSignature(EXAMPLE_CANONICAL_SHA256, "20130524/us-east-1/s3/aws4_request", "20130524T000000Z");
    expect(authorization(EXAMPLE, exampleRequest())).toBe(
      `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ` +
        `SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${expected}`,
    );
  });

  it("covers the payload, so a bucket cannot be handed different bytes than were signed for", () => {
    const request = exampleRequest();
    const signed = authorization(EXAMPLE, request);
    request.headers["x-amz-content-sha256"] = "0".repeat(64);
    expect(authorization(EXAMPLE, request)).not.toBe(signed);
  });

  it("covers the object key and the date, so a signature cannot be replayed onto another object", () => {
    const signed = authorization(EXAMPLE, exampleRequest());

    const elsewhere = exampleRequest();
    elsewhere.url = new URL("https://examplebucket.s3.amazonaws.com/other.txt");
    expect(authorization(EXAMPLE, elsewhere)).not.toBe(signed);

    const later = exampleRequest();
    later.headers["x-amz-date"] = "20130525T000000Z";
    expect(authorization(EXAMPLE, later)).not.toBe(signed);
  });
});

/** A bucket in a Map, plus the requests it was asked to serve. */
function fakeBucket(objects = new Map<string, Uint8Array>()) {
  const seen: { method: string; url: string; headers: Headers }[] = [];
  const config: S3Config = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "products",
    region: "auto",
    accessKeyId: "key",
    secretAccessKey: "secret",
    async fetch(input, init) {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ method: init?.method ?? "GET", url, headers });
      const key = new URL(url).pathname.replace("/products/", "");
      if (init?.method === "PUT") {
        objects.set(key, new Uint8Array(init.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      const body = objects.get(key);
      return body ? new Response(body as BodyInit) : new Response("NoSuchKey", { status: 404 });
    },
  };
  return { store: s3Bucket(config), objects, seen };
}

describe("s3Bucket", () => {
  it("round-trips bytes through the bucket", async () => {
    const { store } = fakeBucket();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await store.put("prod_1/guide.pdf", bytes);
    expect(new Uint8Array(await store.get("prod_1/guide.pdf"))).toEqual(bytes);
  });

  it("addresses objects path-style and signs every request", async () => {
    const { store, seen } = fakeBucket();
    await store.put("prod_1/guide.pdf", new Uint8Array([1]));
    await store.get("prod_1/guide.pdf");
    expect(seen.map((r) => r.url)).toEqual([
      "https://acct.r2.cloudflarestorage.com/products/prod_1/guide.pdf",
      "https://acct.r2.cloudflarestorage.com/products/prod_1/guide.pdf",
    ]);
    for (const request of seen) expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request, /);
  });

  it("declares the payload hash of the bytes it is actually sending", async () => {
    const { store, seen } = fakeBucket();
    await store.put("prod_1/guide.pdf", new Uint8Array(Buffer.from("hello", "utf8")));
    // sha256("hello")
    expect(seen[0]!.headers.get("x-amz-content-sha256")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("raises the bucket's refusal instead of storing or returning nothing", async () => {
    const { store } = fakeBucket();
    await expect(store.get("prod_1/missing.pdf")).rejects.toThrow(/404/);
  });
});

const S3_ENV = {
  S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  S3_BUCKET: "products",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("selectStore", () => {
  it("keeps local disk when no bucket is configured, so dev needs no credentials", () => {
    expect(selectStore({}, "/tmp/storage").name).toBe("disk");
  });

  it("uses the bucket once it is configured", () => {
    expect(selectStore(S3_ENV, "/tmp/storage").name).toBe("s3");
  });

  it("refuses a half-configured bucket rather than writing to a disk that will not keep the file", () => {
    const { S3_SECRET_ACCESS_KEY: _omitted, ...partial } = S3_ENV;
    expect(() => selectStore(partial, "/tmp/storage")).toThrow(/S3_SECRET_ACCESS_KEY/);
  });
});

describe("fileKey", () => {
  it("prefixes the product and reduces the filename to path-safe characters", () => {
    expect(fileKey("prod_1", "Hướng dẫn sử dụng.pdf")).toBe("prod_1/H_ng_d_n_s_d_ng.pdf");
    expect(fileKey("prod_1", "guide v2.final.md")).toBe("prod_1/guide_v2.final.md");
  });

  it("cannot be talked out of the product's prefix by the filename", () => {
    expect(fileKey("prod_1", "../../etc/passwd")).toBe("prod_1/____etc_passwd");
    expect(fileKey("prod_1", "/absolute")).toBe("prod_1/_absolute");
  });

  it("only ever mints keys the download route will accept", async () => {
    for (const name of ["../../etc/passwd", "..", "report..2026.pdf", "a/../b.md"]) {
      const key = fileKey("prod_1", name);
      expect(key).not.toContain("..");
      // The guard in readFileByKey is the same one, so a key that trips it is a
      // file the seller uploaded successfully and no buyer can ever download.
      setFileStoreForTests({ name: "disk", async put() {}, get: async () => Buffer.alloc(0) });
      await expect(readFileByKey(key)).resolves.toBeInstanceOf(Buffer);
    }
    setFileStoreForTests(null);
  });
});

describe("the file store behind the routes", () => {
  afterEach(() => setFileStoreForTests(null));

  it("round-trips an upload through local disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-"));
    setFileStoreForTests(localStore(root));
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

    const key = await saveFile("prod_1", "guide.pdf", bytes);
    expect(key).toBe("prod_1/guide.pdf");
    expect(new Uint8Array(await readFileByKey(key))).toEqual(bytes);
    // The key is the path under the root, which is what lets a directory be
    // copied into a bucket without rewriting every product's fileKey.
    expect(new Uint8Array(await readFile(join(root, key)))).toEqual(bytes);
  });

  it("never asks the store for a key that climbs out of the product prefix", async () => {
    const asked: string[] = [];
    const spy: FileStore = {
      name: "disk",
      async put() {},
      async get(key) {
        asked.push(key);
        return Buffer.alloc(0);
      },
    };
    setFileStoreForTests(spy);

    await expect(readFileByKey("prod_1/../../secrets.env")).rejects.toThrow(/invalid key/);
    expect(asked).toEqual([]);
  });
});
