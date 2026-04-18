import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import { ReactVirtualizedLocatorProvider } from '../../src/domain/locator/providers/react-virtualized-provider.js'
import type { LocatorGenerationContext } from '../../src/domain/locator/locator-extension.js'

describe('ReactVirtualizedLocatorProvider', () => {
  it('returns row-index scoped candidates for virtualized rows', () => {
    const $ = load(`
      <div class="react-window-list">
        <div data-index="7" class="row">
          <button data-testid="buy-btn">Buy</button>
        </div>
      </div>
    `)
    const target = $('button').first()
    const ctx: LocatorGenerationContext = {
      $,
      xmlDoc: {} as globalThis.Document,
      target,
      platform: 'web',
      framework: { kind: 'react', recommendedAttributes: ['data-testid'], hints: [] },
      tag: 'button',
      attrs: target.get(0)?.attribs ?? {},
      targetText: target.text().trim(),
    }
    const out = new ReactVirtualizedLocatorProvider().provideCandidates(ctx)
    expect(out.some((c) => c.locator.includes('data-index="7"'))).toBe(true)
    expect(out.some((c) => c.metadata?.provider === 'react-virtualized-provider')).toBe(true)
  })
})
