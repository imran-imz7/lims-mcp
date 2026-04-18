import type { ElementFingerprint } from '../element-fingerprint/element-fingerprint.js';
import { fingerprintFromCheerio } from '../element-fingerprint/element-fingerprint.js';
import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

/**
 * Structural + attribute similarity for healing (weighted overlap, not embeddings).
 */
export class SimilarityEngine {
  bestMatch(
    fp: ElementFingerprint,
    candidates: cheerio.Cheerio<Element>,
    $: cheerio.CheerioAPI,
  ): { node: cheerio.Cheerio<Element>; score: number; explanation: string[] } | null {
    let best: cheerio.Cheerio<Element> | null = null;
    let bestScore = -1;
    const explain: string[] = [];

    candidates.each((_i, el) => {
      const ch = $(el);
      const candFp = fingerprintFromCheerio(ch)
      if (!candFp) return;
      const { score, parts } = scorePair(fp, candFp);
      if (score > bestScore) {
        bestScore = score;
        best = ch;
        explain.length = 0;
        explain.push(...parts);
      }
    });

    if (!best) return null;
    return { node: best, score: clamp(bestScore), explanation: explain };
  }
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function scorePair(a: ElementFingerprint, b: ElementFingerprint): { score: number; parts: string[] } {
  const parts: string[] = [];
  let s = 0;
  let wsum = 0;

  const wTag = 0.12;
  wsum += wTag;
  if (a.tag === b.tag) {
    s += wTag;
    parts.push('tag match');
  }

  const wText = 0.28;
  wsum += wText;
  if (a.normalizedText && a.normalizedText === b.normalizedText) {
    s += wText;
    parts.push('exact text');
  } else if (
    a.normalizedText &&
    b.normalizedText &&
    (a.normalizedText.includes(b.normalizedText) || b.normalizedText.includes(a.normalizedText))
  ) {
    s += wText * 0.65;
    parts.push('partial text');
  }

  const wAttr = 0.35;
  wsum += wAttr;
  s += attributeOverlap(a.attributes, b.attributes) * wAttr;
  parts.push('attribute overlap weighted');

  const wStruct = 0.25;
  wsum += wStruct;
  const sh = hierarchySimilarity(a.parentHierarchy, b.parentHierarchy);
  s += sh * wStruct;
  if (sh > 0.7) parts.push('strong parent chain similarity');

  return { score: wsum > 0 ? s / wsum : 0, parts };
}

function attributeOverlap(a: Record<string, string>, b: Record<string, string>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (!keys.size) return 0;
  let matched = 0;
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (!va || !vb) continue;
    if (va === vb) matched += 1;
    else if (levenshteinNormalized(va, vb) > 0.82) matched += 0.75;
  }
  return matched / keys.size;
}

function hierarchySimilarity(a: string[], b: string[]): number {
  const max = Math.max(a.length, b.length, 1);
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) same++;
  }
  return same / max;
}

function levenshteinNormalized(a: string, b: string): number {
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j] + 1, dp[i]![j - 1] + 1, dp[i - 1]![j - 1] + cost);
    }
  }
  return dp[m]![n]!;
}
