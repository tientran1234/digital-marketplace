export const money = (minor: number, currency: string, locale = "en") =>
  minor === 0 ? null : new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);

/** An average rating always carries its decimal, so 5 and 4.3 are the same width. */
export const average = (rating: number, locale = "en") =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating);

/**
 * A locale's language, named in `inLocale`: "Vietnamese" for a prompt written
 * in English, "Tiếng Việt" for a seller reading their own form. ICU knows the
 * names, so adding a locale never means adding a label for it here.
 */
export const language = (locale: string, inLocale = "en") =>
  new Intl.DisplayNames([inLocale], { type: "language" }).of(locale) ?? locale;
