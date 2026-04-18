import { RANKING_WEIGHTS, LENGTH_NORM_TARGET } from '../../utils/constants.js'
import { clamp01, lengthScore } from '../../utils/scoring-utils.js'
import type { LocatorCandidate, RankedLocator } from '../contracts/types.js'

/**
 * Weighted scoring (AGENTS.md): uniqueness (hard gate), stability, readability,
 * maintainability, length. Tie-break: lower `priorityTier` wins.
 */
export class RankingEngine {
  rank(
    candidates: ReadonlyArray<LocatorCandidate>,
    uniquenessMatchCounts: ReadonlyMap<string, number>,
  ): RankedLocator[] {
    const ranked: RankedLocator[] = []

    for (const c of candidates) {
      const uniquenessMatchCount = uniquenessMatchCounts.get(mapKey(c)) ?? 0
      const uniquenessFactor = uniquenessMatchCount === 1 ? 1 : 0

      const stability = clamp01(c.stabilityScore)
      const readability = clamp01(c.readabilityScore)
      const len = lengthScore(c.locator.length, LENGTH_NORM_TARGET)
      const maintainability = combinedMaintainability(c.locator, c.strategy)

      const breakdown = {
        uniqueness: uniquenessFactor,
        attributeStability: stability,
        readability,
        length: len,
        maintainability,
      } as const

      const total =
        RANKING_WEIGHTS.uniqueness * breakdown.uniqueness +
        RANKING_WEIGHTS.attributeStability * breakdown.attributeStability +
        RANKING_WEIGHTS.readability * breakdown.readability +
        RANKING_WEIGHTS.length * breakdown.length +
        RANKING_WEIGHTS.maintainability * breakdown.maintainability

      ranked.push({
        ...c,
        uniquenessMatchCount,
        totalScore: clamp01(uniquenessFactor === 0 ? 0 : total),
        breakdown: {
          uniqueness: breakdown.uniqueness,
          attributeStability: breakdown.attributeStability,
          readability: breakdown.readability,
          length: breakdown.length,
          maintainability: breakdown.maintainability,
        },
      })
    }

    ranked.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
      return a.priorityTier - b.priorityTier
    })
    return ranked
  }
}

function mapKey(c: LocatorCandidate): string {
  return `${c.kind}::${c.locator}`
}

function combinedMaintainability(locator: string, strategy: string): number {
  const noRegex = !/[()[\]{}]/.test(locator) || strategy === 'role'
  const avoidLongChains = locator.split('//').length < 6
  return clamp01((noRegex ? 0.55 : 0.25) + (avoidLongChains ? 0.45 : 0.2))
}
