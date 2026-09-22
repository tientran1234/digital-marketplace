import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";
import { getCurrentUser } from "@/server/auth";
import { edition } from "@/server/license";
import { ReviewActions, RefundDecision } from "@/components/AdminActions";

async function pendingRefunds() {
  const { rows } = await pool().query<{ id: string; data: { input: { orderId: string }; createdAt: number } }>(
    `SELECT id, data FROM workflow_runs WHERE workflow = 'refund-request' AND status = 'waiting' ORDER BY created_at`,
  );
  return rows;
}

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (user.role !== "ADMIN") redirect(`/${locale}`);
  const t = await getTranslations("admin");
  const [pending, refunds, traces] = await Promise.all([
    db.product.findMany({ where: { status: "PENDING_REVIEW" }, include: { seller: { select: { name: true } } } }),
    pendingRefunds(),
    db.agentTrace.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { product: { select: { title: true } }, user: { select: { email: true } } } }),
  ]);
  const ed = edition();

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{t("edition")}: {ed.edition === "cloud" ? "cloud" : ed.valid ? `self-hosted · ${ed.licensee}` : `self-hosted · license ${ed.reason}`}</p>

      <h2>{t("review")}</h2>
      {pending.length === 0 ? <p className="muted">{t("noPending")}</p> : (
        <table><tbody>{pending.map((p) => (
          <tr key={p.id}><td><Link href={`/${locale}/p/${p.slug}`}>{p.title}</Link><div className="muted">{p.seller.name}</div></td><td><ReviewActions productId={p.id} /></td></tr>
        ))}</tbody></table>
      )}

      <h2>{t("refunds")}</h2>
      {refunds.length === 0 ? <p className="muted">{t("noPending")}</p> : (
        <table><tbody>{refunds.map((r) => (
          <tr key={r.id}><td><code>{r.data.input.orderId}</code></td><td><RefundDecision runId={r.id} /></td></tr>
        ))}</tbody></table>
      )}

      <h2>{t("traces")}</h2>
      {traces.length === 0 ? <p className="muted">{t("noPending")}</p> : (
        <table><thead><tr><th>When</th><th>Product</th><th>User</th><th>Calls</th><th>Tokens</th><th>Cost</th><th>ms</th></tr></thead><tbody>
          {traces.map((tr) => (
            <tr key={tr.id}>
              <td>{tr.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td>{tr.product?.title ?? "—"}</td><td>{tr.user?.email ?? "—"}</td>
              <td>{tr.modelCalls} model · {tr.toolCalls} tool</td>
              <td>{tr.inputTokens}+{tr.outputTokens}</td>
              <td>{tr.costUsd === null ? "?" : `$${tr.costUsd.toFixed(4)}`}</td>
              <td>{tr.durationMs}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}
