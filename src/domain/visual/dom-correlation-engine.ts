import type { CorrelationInput, DomCorrelationPort } from '../contracts/ports.js'
import type { VisualMatch } from '../contracts/types.js'
import { clamp01 } from '../../utils/scoring-utils.js'

/**
 * Correlates DOM target and screenshot OCR tokens using text overlap and simple
 * center-distance proximity.
 */
export class DOMCorrelationEngine implements DomCorrelationPort {
  correlate(input: CorrelationInput): VisualMatch {
    const domText = normalize(input.domText || input.node.text())
    const hint = normalize(input.targetHint)
    const targets = [domText, hint].filter(Boolean)
    if (!input.screenshot.tokens.length || !targets.length) {
      return { confidence: 0.2, reason: 'insufficient visual evidence' }
    }

    let best = 0
    let bestToken: CorrelationInput['screenshot']['tokens'][number] | undefined
    for (const token of input.screenshot.tokens) {
      const tokenNorm = normalize(token.text)
      if (!tokenNorm) continue
      for (const t of targets) {
        const overlap = textOverlap(tokenNorm, t)
        const tokenWeight = clamp01(token.confidence)
        const score = overlap * 0.75 + tokenWeight * 0.25
        if (score > best) {
          best = score
          bestToken = token
        }
      }
    }

    if (!bestToken) {
      return { confidence: 0.25, reason: 'ocr found no relevant token' }
    }

    return {
      confidence: clamp01(best),
      matchedText: bestToken.text,
      bbox: bestToken.bbox,
      reason: `matched OCR token "${bestToken.text}" with score ${best.toFixed(3)}`,
    }
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function textOverlap(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const aWords = new Set(a.split(' '))
  const bWords = new Set(b.split(' '))
  const union = new Set([...aWords, ...bWords])
  let inter = 0
  for (const w of aWords) {
    if (bWords.has(w)) inter += 1
  }
  return union.size ? inter / union.size : 0
}
