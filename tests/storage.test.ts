import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorization, s3Bucket, type S3Config } from "@/providers/s3";

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
