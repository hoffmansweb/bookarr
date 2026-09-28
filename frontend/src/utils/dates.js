// publishedDate arrives in several shapes depending on the source:
//   "2024"            (year only)
//   "2024-03-15"      (ISO)
//   "March 15, 2024"  (Goodreads/Amazon prose)
//   "15 March 2024"   (other prose)
// Pull the year out of any of them so the UI shows it consistently, regardless of the browser's
// locale, and never falls back to toLocaleDateString's localized (or default-year) output.
export const extractYear = (value) => {
  if (value == null) return null;
  const match = String(value).match(/\b(?:19|20)\d{2}\b/);
  return match ? match[0] : null;
};
