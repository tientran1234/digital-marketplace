"use client";
import { useState } from "react";
import { post } from "./client";

export function UpgradeButton({ label }: { label: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row">
      <button onClick={async () => {
        try { const { checkoutUrl } = await post<{ checkoutUrl: string }>("/api/checkout/subscription"); window.location.href = checkoutUrl; }
        catch (err) { setError((err as Error).message); }
      }}>{label}</button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
