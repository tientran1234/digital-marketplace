import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { embedder } from "@/server/assistant";
import { handle, type Params } from "@/server/http";
import { extractText } from "@/server/extract";
import { saveFile } from "@/server/storage";
import { indexProduct } from "@/rag";

export const runtime = "nodejs";
const MAX_BYTES = 2 * 1024 * 1024;

/** Attach the product's document (.md / .txt / .pdf) and index it for the assistant. */
export const POST = handle<Params<"id">>(async (request, { params }) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const { id } = await params;
  const product = await db.product.findUniqueOrThrow({ where: { id } });
  if (product.sellerId !== user.id && user.role !== "ADMIN") return Response.json({ error: "not your product" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "file too large (2 MB max)" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Extract before storing, so a file we cannot index never lands on disk.
  const text = await extractText(file.name, bytes);
  const fileKey = await saveFile(product.id, file.name, bytes);
  const chunks = await indexProduct(product.id, text, embedder());
  await db.product.update({ where: { id }, data: { fileName: file.name, fileKey } });
  return Response.json({ chunks: chunks.length });
});
