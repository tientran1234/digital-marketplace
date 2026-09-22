"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function RefundButton({ orderId }: { orderId: string }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "done" | string>("idle");
  if (state === "done") return <span className="muted">{t("refundRequested")}</span>;
  return (
    <span className="row">
      <button className="ghost" onClick={async () => {
        try { await post(`/api/orders/${orderId}/refund`); setState("done"); router.refresh(); }
        catch (err) { setState((err as Error).message); }
      }}>{t("refund")}</button>
      {state !== "idle" && <span className="err">{state}</span>}
    </span>
  );
}
