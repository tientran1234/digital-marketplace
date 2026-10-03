"use client";
import { useState } from "react";
import { post } from "./client";

export function ConnectPayoutsButton({ locale, label }: { locale: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row">
      <button onClick={async () => {
        try { const { url } = await post<{ url: string }>("/api/seller/payouts", { locale }); window.location.href = url; }
        catch (err) { setError((err as Error).message); }
      }}>{label}</button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
