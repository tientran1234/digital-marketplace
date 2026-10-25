"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { language } from "@/lib/format";
import { post } from "./client";

/**
 * Three calls, one form: create draft → upload + index document → submit for
 * review. The listing is written in the language the seller is working in;
 * `others` are the locales it can also be written in, which the page supplies
 * the way it supplies one to the payouts button.
 *
 * A fourth call is optional: the model drafts one of those languages from the
 * words above, into the fields the seller then corrects. It fills a field and
 * nothing else — what is submitted is whatever they left in the form.
 */
export function NewProductForm({ others }: { others: readonly string[] }) {
  const t = useTranslations("sell");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The draft lands in the fields rather than in state: they are the seller's
   * now, and a form that reads itself on submit cannot tell ours from theirs —
   * which is the point. A language they have already written in is left alone,
   * because their sentence is the one worth keeping.
   */
  async function draft(form: HTMLFormElement, other: string) {
    const fields = form.elements;
    const title = fields.namedItem(`title.${other}`) as HTMLInputElement;
    const description = fields.namedItem(`description.${other}`) as HTMLTextAreaElement;
    if (title.value.trim() || description.value.trim()) return setError(t("draftKeep"));
    const fd = new FormData(form);
    setDrafting(other); setError(null);
    try {
      const drafted = await post<{ title: string; description: string }>("/api/products/translate", {
        title: fd.get("title"), description: fd.get("description"), from: locale, to: other,
      });
      title.value = drafted.title;
      description.value = drafted.description;
    } catch (err) { setError((err as Error).message); }
    finally { setDrafting(null); }
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setBusy(true); setError(null);
        try {
          const { id } = await post<{ id: string }>("/api/products", {
            title: fd.get("title"), description: fd.get("description"), locale, priceMinor: Number(fd.get("priceMinor") ?? 0),
            translations: others.map((l) => ({ locale: l, title: String(fd.get(`title.${l}`) ?? ""), description: String(fd.get(`description.${l}`) ?? "") })),
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
      {/* Not required: a language left empty means the listing reads in its own
          there, which is better than a seller padding out a translation to get
          past the form. minLength still holds for one they do start. */}
      {others.map((other) => (
        <Fragment key={other}>
          <label>{t("titleIn", { language: language(other, locale) })}</label>
          <input name={`title.${other}`} minLength={3} maxLength={120} />
          <label>{t("descriptionIn", { language: language(other, locale) })}</label>
          <textarea name={`description.${other}`} rows={3} minLength={10} maxLength={2000} />
          <button
            type="button"
            className="ghost"
            disabled={busy || drafting !== null}
            onClick={(e) => draft(e.currentTarget.form!, other)}
          >
            {drafting === other ? t("drafting") : t("draft", { language: language(other, locale) })}
          </button>
        </Fragment>
      ))}
      <label>{t("price")}</label><input name="priceMinor" type="number" min={0} step={1} defaultValue={0} />
      <label>{t("file")}</label><input name="file" type="file" accept=".md,.txt,.markdown,.pdf" required />
      {error && <p className="err">{error}</p>}
      <div style={{ marginTop: 16 }}><button type="submit" disabled={busy}>{t("create")}</button></div>
    </form>
  );
}
