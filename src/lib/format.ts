export const money = (minor: number, currency: string, locale = "en") =>
  minor === 0 ? null : new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
