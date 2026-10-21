/** Loose Persian normalisation for client-side filtering (ي/ك → ی/ک, digits, ZWNJ, spaces). */
export const normalize = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/‌/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
