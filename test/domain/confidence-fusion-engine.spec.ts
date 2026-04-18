import { describe, expect, it } from 'vitest'
import { ConfidenceFusionEngine } from '../../src/domain/confidence/confidence-fusion-engine.js'

describe('ConfidenceFusionEngine', () => {
  it('uses dom-only weight when visual/runtime are missing', () => {
    const engine = new ConfidenceFusionEngine()
    const score = engine.fuse({
      domScore: 0.8,
      visual: null,
      runtime: null,
    })
    expect(score).toBeCloseTo(0.8, 6)
  })

  it('renormalizes weights when runtime is not executed', () => {
    const engine = new ConfidenceFusionEngine()
    const score = engine.fuse({
      domScore: 0.7,
      visual: { confidence: 0.5, reason: 'visual' },
      runtime: {
        executed: false,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['skipped'],
      },
    })
    // (0.5*0.7 + 0.2*0.5) / (0.5+0.2)
    expect(score).toBeCloseTo((0.35 + 0.1) / 0.7, 6)
  })

  it('includes runtime when executed', () => {
    const engine = new ConfidenceFusionEngine()
    const score = engine.fuse({
      domScore: 0.6,
      visual: null,
      runtime: {
        executed: true,
        unique: true,
        visible: true,
        interactable: false,
        success: false,
        notes: ['runtime'],
      },
    })
    expect(score).toBeGreaterThan(0.6)
  })

  it('clamps values into 0..1', () => {
    const engine = new ConfidenceFusionEngine()
    const score = engine.fuse({
      domScore: 10,
      visual: { confidence: 10, reason: 'visual' },
      runtime: {
        executed: true,
        unique: true,
        visible: true,
        interactable: true,
        success: true,
        notes: ['runtime'],
      },
    })
    expect(score).toBeLessThanOrEqual(1)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})
