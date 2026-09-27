/**
 * Every "nothing here yet" in the app: a line saying what is missing and a
 * hint saying what to do about it. One component so no page falls back to a
 * bare grey sentence — or to an empty table with headers and no rows.
 */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <p>{title}</p>
      <p className="hint">{hint}</p>
    </div>
  );
}
