import { db } from "@/lib/db";
import { downloadAccess } from "@/domain/access";
import { getCurrentUser } from "@/server/auth";
import { handle, type Params } from "@/server/http";
import { readFileByKey } from "@/server/storage";

export const runtime = "nodejs";

export const GET = handle<Params<"id">>(async (_request, { params }) => {
  const { id } = await params;
  const user = await getCurrentUser();
  const product = await db.product.findUniqueOrThrow({ where: { id } });
  const orders = user ? await db.order.findMany({ where: { buyerId: user.id, productId: id }, select: { status: true } }) : [];

  const access = downloadAccess({ userId: user?.id ?? null, role: user?.role ?? null, product, orderStatuses: orders.map((o) => o.status) });
  if (!access.allowed) return Response.json({ error: access.reason }, { status: access.reason === "anonymous" ? 401 : 403 });
  if (!product.fileKey) return Response.json({ error: "no file" }, { status: 404 });

  const bytes = await readFileByKey(product.fileKey);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${product.fileName ?? "download"}"` },
  });
});
