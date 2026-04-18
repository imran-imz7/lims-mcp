import { describe, it, expect } from 'vitest'
import { RankingEngine } from '../../src/domain/ranking-engine/ranking-engine.js'
import type { LocatorCandidate } from '../../src/domain/contracts/types.js'
import { RANKING_WEIGHTS } from '../../src/utils/constants.js'

function baseCand(over: Partial<LocatorCandidate>): LocatorCandidate {
  return {
    locator: '[data-testid="x"]',
    kind: 'css',
    strategy: 'hybrid',
    priorityTier: 1,
    stabilityScore: 0.9,
    readabilityScore: 0.9,
    metadata: {},
    ...over,
  }
}

describe('RankingEngine', () => {
  it('zeros total score when uniqueness != 1', () => {
    const engine = new RankingEngine()
    const c = baseCand({})
    const m = new Map([[`css::${c.locator}`, 2]])
    const [r] = engine.rank([c], m)
    expect(r.totalScore).toBe(0)
  })

  it('weights sum to 1', () => {
    const s =
      RANKING_WEIGHTS.uniqueness +
      RANKING_WEIGHTS.attributeStability +
      RANKING_WEIGHTS.readability +
      RANKING_WEIGHTS.length +
      RANKING_WEIGHTS.maintainability
    expect(s).toBeCloseTo(1, 6)
  })

  it('tie-break prefers lower priorityTier', () => {
    const engine = new RankingEngine()
    const hi = baseCand({ locator: 'a', priorityTier: 5, stabilityScore: 0.8, readabilityScore: 0.8 })
    const lo = baseCand({ locator: 'b', priorityTier: 2, stabilityScore: 0.8, readabilityScore: 0.8 })
    const m = new Map([
      [`css::a`, 1],
      [`css::b`, 1],
    ])
    const out = engine.rank([hi, lo], m)
    expect(out[0]?.locator).toBe('b')
  })
})
