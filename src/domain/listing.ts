/**
 * A listing's words in the language the reader is in. Pure, so the card, the
 * product page and the assistant's prompt all land on the same text instead of
 * each reaching for a different column.
 */

/** The two fields a listing is read by. */
export interface ListingText {
  title: string;
  description: string;
}

/** One listing's text in one locale, as a translation row carries it. */
export interface ListingTranslation extends ListingText {
  locale: string;
}

/**
 * A listing as the resolver needs to see it: its own text, the locale that
 * text was written in, and whatever translations of it exist. `translations`
 * is optional because most callers load the listing without them and want the
 * text it was written in, which is what a listing with none resolves to.
 */
export interface TranslatableListing extends ListingText {
  locale: string;
  translations?: readonly ListingTranslation[];
}

/** The text to show, and which language it turned out to be in. */
export interface ResolvedListing extends ListingText {
  /** The locale the words are actually in — not the one asked for, when it fell back. */
  locale: string;
  /** True when the reader asked for a language this listing was never written in. */
  fallback: boolean;
}

/**
 * The listing's text for one reader. A translation is taken whole or not at
 * all: a row missing either field counts as absent, because a Vietnamese title
 * over an English description reads as broken in a way that the English pair
 * does not — the same reason the interface copy is checked for being said in
 * both locales rather than most of one.
 */
export function localiseListing(listing: TranslatableListing, locale: string): ResolvedListing {
  const written = listing.translations?.find((t) => t.locale === locale && isWritten(t));
  if (written) return { title: written.title, description: written.description, locale, fallback: false };
  return {
    title: listing.title,
    description: listing.description,
    locale: listing.locale,
    fallback: listing.locale !== locale,
  };
}

/**
 * The translation rows a submitted listing amounts to. A locale the seller
 * left empty is not a row: they have nothing to say in that language yet, and
 * the listing falls back to its own text rather than going blank in it. The
 * locale the listing was written in is dropped too — its text is already in
 * the product's own columns, and a second copy of it would be one more thing
 * to keep in step.
 */
export function writableTranslations(
  submitted: readonly ListingTranslation[],
  baseLocale: string,
): ListingTranslation[] {
  return submitted
    .filter((t) => t.locale !== baseLocale && isWritten(t))
    .map((t) => ({ locale: t.locale, title: t.title.trim(), description: t.description.trim() }));
}

const isWritten = (text: ListingText) => text.title.trim().length > 0 && text.description.trim().length > 0;
