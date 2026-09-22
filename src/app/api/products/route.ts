import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";
const Body = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  priceMinor: z.number().int().min(0).max(100_000_00),
});

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Create a DRAFT. Upload a document next, then submit for review. */
export const POST = handle(async (request) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const body = await json(request, Body);
  const base = slugify(body.title) || "product";
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const product = await db.product.create({ data: { ...body, slug, sellerId: user.id } });
  return Response.json({ id: product.id, slug: product.slug }, { status: 201 });
});
