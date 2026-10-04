"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RATING_MAX, RATING_MIN } from "@/domain/review";
import { post } from "./client";

/** Best first: the common rating is the one the pointer lands on. */
const SCALE = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MAX - i);

/**
 * Rating one purchase. The page decided which order may still be reviewed and
 * passes it here, so this form posts to that purchase rather than to the
 * product — and the route decides again rather than believing the id.
 */
export function ReviewForm({ orderId }: { orderId: string }) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) return <p className="muted">{t("submitted")}</p>;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true); setError(null);
        try {
          await post(`/api/orders/${orderId}/review`, { rating: Number(fd.get("rating")), body: String(fd.get("body") ?? "") });
          setSent(true);
          router.refresh();
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}
    >
      {/* Words rather than glyphs in the options: a screen reader reads "four
          out of five", and the stars are still drawn beside them. */}
      <label>{t("rating")}</label>
      <select name="rating" defaultValue={RATING_MAX}>
        {SCALE.map((n) => <option key={n} value={n}>{"★".repeat(n)} · {t("scale", { rating: n, max: RATING_MAX })}</option>)}
      </select>
      <label>{t("body")}</label><textarea name="body" rows={3} maxLength={2000} placeholder={t("bodyPlaceholder")} />
      {error && <p className="err">{error}</p>}
      <div style={{ marginTop: 16 }}><button type="submit" disabled={busy}>{t("submit")}</button></div>
    </form>
  );
}
