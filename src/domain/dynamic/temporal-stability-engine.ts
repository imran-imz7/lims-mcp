import { clamp01 } from '../../utils/scoring-utils.js'
import type { SnapshotComparison } from './snapshot-comparator.js'

export interface TemporalStabilityResult {
  score: number
  mutationRate: number
  reason: string
}

export class TemporalStabilityEngine {
  evaluate(comp: SnapshotComparison): TemporalStabilityResult {
    const score = clamp01(1 - comp.mutationRate)
    const reason =
      comp.mutationRate > 0.6
        ? 'high mutation rate'
        : comp.mutationRate > 0.3
          ? 'moderate mutation rate'
          : 'low mutation rate'
    return { score, mutationRate: comp.mutationRate, reason }
  }
}
