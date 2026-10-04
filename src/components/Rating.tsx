import { RATING_MAX, type RatingSummary } from "@/domain/review";
import { average } from "@/lib/format";

/**
 * The one place an average becomes stars, so a card and a product page never
 * draw the same reviews differently. A product nobody has rated gets nothing
 * rather than an empty row of stars that reads as a bad score.
 *
 * The stars are decoration — the label carries the number for anyone who is
 * not looking at them. How many people rated it is part of the number on a
 * listing and noise on one person's own review, hence `showCount`.
 */
export function Rating({ summary, locale, label, showCount = true }: { summary: RatingSummary; locale: string; label: string; showCount?: boolean }) {
  if (summary.average === null) return null;
  const filled = Math.round(summary.average);
  return (
    <span className="rating" aria-label={label}>
      <span className="stars" aria-hidden>{"★".repeat(filled)}{"☆".repeat(RATING_MAX - filled)}</span>
      {average(summary.average, locale)}
      {showCount && <span className="muted"> ({summary.count})</span>}
    </span>
  );
}
