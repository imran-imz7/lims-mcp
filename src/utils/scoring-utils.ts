/**
 * Normalize a raw score in [0,1] with gentle curve for ranking composition.
 */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Shorter locators score higher once uniqueness is satisfied. Maps length to [0,1].
 */
export function lengthScore(length: number, target: number): number {
  if (length <= 0) return 1;
  return clamp01(1 - Math.min(1, length / (target * 2)));
}

/**
 * Simple Shannon entropy for attribute value stability heuristics (normalized).
 */
export function normalizedEntropy(value: string): number {
  if (!value) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let h = 0;
  const len = value.length;
  for (const c of freq.values()) {
    const p = c / len;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(Math.min(256, Math.max(2, new Set(value).size)));
  return maxH > 0 ? h / maxH : 0;
}
