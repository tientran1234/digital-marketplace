"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

interface Chip { name: string; done: boolean; error?: boolean }

/** Streams the assistant's SSE events: text as it arrives, tool calls as chips. */
export function AskBox({ productId }: { productId: string }) {
  const t = useTranslations("product");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setAnswer(""); setChips([]); setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok || !res.body) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status}`); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const e = JSON.parse(data) as { type: string; text?: string; name?: string; isError?: boolean; message?: string; result?: { text: string } };
          if (e.type === "text_delta") setAnswer((a) => a + (e.text ?? ""));
          else if (e.type === "tool_call") setChips((c) => [...c, { name: e.name ?? "tool", done: false }]);
          else if (e.type === "tool_result") setChips((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, done: true, error: e.isError } : x)));
          else if (e.type === "error") setError(e.message ?? "error");
          else if (e.type === "done" && e.result) setAnswer(e.result.text);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t("askTitle")}</h2>
      <p className="muted">{t("askHint")}</p>
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("askPlaceholder")} required />
        <div className="row" style={{ marginTop: 8 }}><button type="submit" disabled={busy}>{t("ask")}</button></div>
      </form>
      {chips.length > 0 && <div className="chips">{chips.map((c, i) => <span key={i} className={`tag ${c.error ? "bad" : c.done ? "ok" : ""}`}>{c.name}{c.done ? " ✓" : "…"}</span>)}</div>}
      {(answer || busy) && <div className="answer">{answer || "…"}</div>}
      {error && <p className="err">{error}</p>}
    </section>
  );
}
