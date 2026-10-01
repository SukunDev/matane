/** Folds case and accents ("Café" → "cafe") for matching. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** True when every word of the query starts a word of the label ("set rea" → "Settings › Reader"). */
export function matches(label: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const target = fold(label)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words.every((word) => target.some((part) => part.startsWith(word)));
}
