import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import { FlutterWebLocatorProvider } from '../../src/domain/locator/providers/flutter-web-provider.js'
import type { LocatorGenerationContext } from '../../src/domain/locator/locator-extension.js'

describe('FlutterWebLocatorProvider', () => {
  it('returns semantics-aware candidates for flutter web nodes', () => {
    const $ = load(`
      <flt-semantics flt-semantics-identifier="buy_action" role="button" aria-label="Buy">
        Buy
      </flt-semantics>
    `)
    const target = $('flt-semantics').first()
    const ctx: LocatorGenerationContext = {
      $,
      xmlDoc: {} as globalThis.Document,
      target,
      platform: 'web',
      framework: { kind: 'flutter-web', recommendedAttributes: ['flt-semantics-identifier'], hints: [] },
      tag: 'flt-semantics',
      attrs: target.get(0)?.attribs ?? {},
      targetText: target.text().trim(),
    }
    const out = new FlutterWebLocatorProvider().provideCandidates(ctx)
    expect(out.some((c) => c.locator.includes('flt-semantics-identifier'))).toBe(true)
    expect(out.some((c) => c.metadata?.provider === 'flutter-web-provider')).toBe(true)
  })
})
