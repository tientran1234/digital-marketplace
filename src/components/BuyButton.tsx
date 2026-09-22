"use client";
import { useState } from "react";
import { post } from "./client";

export function BuyButton({ productId, label }: { productId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row">
      <button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { const { checkoutUrl } = await post<{ checkoutUrl: string }>("/api/checkout/order", { productId }); window.location.href = checkoutUrl; }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>{label}</button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
