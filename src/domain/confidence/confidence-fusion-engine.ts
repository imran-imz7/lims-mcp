import type { RuntimeValidation, VisualMatch } from '../contracts/types.js'
import { clamp01 } from '../../utils/scoring-utils.js'

export interface ConfidenceFusionInput {
  domScore: number
  visual: VisualMatch | null
  runtime: RuntimeValidation | null
}

/**
 * Weighted confidence fusion:
 * final = w_dom*dom + w_visual*visual + w_runtime*runtime
 */
export class ConfidenceFusionEngine {
  private readonly weights = {
    dom: 0.5,
    visual: 0.2,
    runtime: 0.3,
  } as const

  fuse(input: ConfidenceFusionInput): number {
    const dom = clamp01(input.domScore)
    const visual = clamp01(input.visual?.confidence ?? 0)
    const runtime = input.runtime ? runtimeScore(input.runtime) : 0
    const parts: Array<{ value: number; weight: number }> = [
      { value: dom, weight: this.weights.dom },
      ...(input.visual ? [{ value: visual, weight: this.weights.visual }] : []),
      ...(input.runtime?.executed ? [{ value: runtime, weight: this.weights.runtime }] : []),
    ]
    const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0)
    if (totalWeight <= 0) return 0
    const weighted = parts.reduce((acc, p) => acc + (p.value * p.weight), 0)
    return clamp01(weighted / totalWeight)
  }
}

function runtimeScore(r: RuntimeValidation): number {
  let score = 0
  if (r.executed) score += 0.2
  if (r.unique) score += 0.25
  if (r.visible) score += 0.25
  if (r.interactable) score += 0.2
  if (r.success) score += 0.1
  return clamp01(score)
}
