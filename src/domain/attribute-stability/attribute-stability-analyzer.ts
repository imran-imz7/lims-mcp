import { UNSTABLE_VALUE_PATTERNS } from '../../utils/regex-patterns.js';
import { normalizedEntropy } from '../../utils/scoring-utils.js';
import { STABILITY_SCORES } from '../../utils/constants.js';
import type { AttributeStabilityClass } from '../contracts/types.js';
import type { StabilityReportEntry } from '../contracts/types.js';

export interface AttributeStabilityResult {
  clazz: AttributeStabilityClass;
  score: number;
  reason: string;
}

/**
 * Scores attribute name/value pairs for locator suitability using entropy + pattern heuristics.
 */
export class AttributeStabilityAnalyzer {
  analyzeNameAndValue(name: string, value: string): AttributeStabilityResult {
    const lower = name.toLowerCase();

    if (!value || value.length < 2) {
      return { clazz: 'SEMI_STABLE', score: ST_STABILITY('SEMI_STABLE'), reason: 'short or empty value' };
    }

    for (const { name: pname, re } of UNSTABLE_VALUE_PATTERNS) {
      if (re.test(value)) {
        return { clazz: 'UNSTABLE', score: ST_STABILITY('UNSTABLE'), reason: `matches unstable pattern: ${pname}` };
      }
    }

    if (
      lower.includes('react') ||
      lower === 'style' ||
      lower.startsWith('on') ||
      lower === 'id' && /^ember\d+|ember-view/.test(value)
    ) {
      /* continue to entropy */
    }

    const ent = normalizedEntropy(value);
    if (ent > 0.92 && value.length > 24) {
      return { clazz: 'UNSTABLE', score: ST_STABILITY('UNSTABLE'), reason: 'high entropy suggests generated payload' };
    }

    if (lower === 'class' && value.split(/\s+/).length > 6) {
      return { clazz: 'SEMI_STABLE', score: ST_STABILITY('SEMI_STABLE'), reason: 'long compound class list' };
    }

    if (
      lower === 'id' ||
      lower === 'name' ||
      lower.startsWith('data-') ||
      lower === 'for' ||
      lower.startsWith('aria-') ||
      lower === 'role'
    ) {
      return { clazz: 'STABLE', score: ST_STABILITY('STABLE'), reason: 'semantic/stable attribute family' };
    }

    if (ent > 0.75) {
      return { clazz: 'SEMI_STABLE', score: ST_STABILITY('SEMI_STABLE'), reason: 'moderate entropy' };
    }

    return { clazz: 'STABLE', score: ST_STABILITY('STABLE'), reason: 'low entropy literal' };
  }

  buildReportFromDomAttributes(
    samples: ReadonlyArray<Record<string, string>>,
    maxEntries = 40,
  ): { entries: StabilityReportEntry[]; sampleSize: number } {
    const totals = new Map<string, { values: string[] }>();
    for (const attrs of samples) {
      for (const [k, v] of Object.entries(attrs)) {
        const key = k.toLowerCase();
        if (!totals.has(key)) totals.set(key, { values: [] });
        totals.get(key)!.values.push(v);
      }
    }

    const entries: StabilityReportEntry[] = [];
    for (const [attr, { values }] of totals.entries()) {
      if (entries.length >= maxEntries) break;
      const uniq = new Set(values);
      const variance = values.length > 0 ? uniq.size / values.length : 0;
      const first = values[0] ?? '';
      const base = this.analyzeNameAndValue(attr, first);

      let stability = base.clazz;
      let score = base.score;
      let reason = base.reason;

      if (variance > 0.85 && values.length >= 5) {
        stability = 'UNSTABLE';
        score = ST_STABILITY('UNSTABLE');
        reason = 'high frequency variance across DOM sample';
      } else if (variance > 0.45 && values.length >= 5) {
        stability = 'SEMI_STABLE';
        score = Math.min(score, ST_STABILITY('SEMI_STABLE'));
        reason = `${reason}; elevated attribute variance`;
      }

      entries.push({ attribute: attr, stability, score, reason });
    }

    entries.sort((a, b) => b.score - a.score);
    return { entries, sampleSize: samples.length };
  }
}

function ST_STABILITY(c: AttributeStabilityClass): number {
  if (c === 'STABLE') return STABILITY_SCORES.STABLE;
  if (c === 'SEMI_STABLE') return STABILITY_SCORES.SEMI_STABLE;
  return STABILITY_SCORES.UNSTABLE;
}
