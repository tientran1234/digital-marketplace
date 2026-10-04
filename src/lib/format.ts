export const money = (minor: number, currency: string, locale = "en") =>
  minor === 0 ? null : new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);

/** An average rating always carries its decimal, so 5 and 4.3 are the same width. */
export const average = (rating: number, locale = "en") =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating);
