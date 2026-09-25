"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { post } from "./client";

/** Three calls, one form: create draft → upload + index document → submit for review. */
export function NewProductForm() {
  const t = useTranslations("sell");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setBusy(true); setError(null);
        try {
          const { id } = await post<{ id: string }>("/api/products", {
            title: fd.get("title"), description: fd.get("description"), priceMinor: Number(fd.get("priceMinor") ?? 0),
          });
          const upload = new FormData(); upload.append("file", fd.get("file") as File);
          await post(`/api/products/${id}/upload`, upload);
          await post(`/api/products/${id}/submit`);
          form.reset();
          router.refresh();
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <label>{t("productTitle")}</label><input name="title" required minLength={3} />
      <label>{t("description")}</label><textarea name="description" rows={3} required minLength={10} />
      <label>{t("price")}</label><input name="priceMinor" type="number" min={0} step={1} defaultValue={0} />
      <label>{t("file")}</label><input name="file" type="file" accept=".md,.txt,.markdown,.pdf" required />
      {error && <p className="err">{error}</p>}
      <div style={{ marginTop: 16 }}><button type="submit" disabled={busy}>{t("create")}</button></div>
    </form>
  );
}
