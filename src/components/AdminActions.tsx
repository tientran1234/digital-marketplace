"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function ReviewActions({ productId }: { productId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const decide = async (approved: boolean) => {
    try { await post("/api/admin/review", { productId, approved, reason: approved ? undefined : "rejected by admin" }); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  };
  return <span className="row"><button onClick={() => decide(true)}>{t("approve")}</button><button className="ghost" onClick={() => decide(false)}>{t("reject")}</button>{error && <span className="err">{error}</span>}</span>;
}

export function RefundDecision({ runId }: { runId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const decide = async (approved: boolean) => {
    try { await post("/api/admin/refund", { runId, approved }); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  };
  return <span className="row"><button onClick={() => decide(true)}>{t("approve")}</button><button className="ghost" onClick={() => decide(false)}>{t("reject")}</button>{error && <span className="err">{error}</span>}</span>;
}
