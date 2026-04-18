import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import { AgGridLocatorProvider } from '../../src/domain/locator/providers/ag-grid-provider.js'
import type { LocatorGenerationContext } from '../../src/domain/locator/locator-extension.js'

describe('AgGridLocatorProvider', () => {
  it('returns row-scoped candidates for AG Grid rows', () => {
    const $ = load(`
      <div class="ag-root">
        <div class="ag-row" row-id="12">
          <div class="ag-cell" col-id="action">
            <button data-testid="buy-btn">Buy</button>
          </div>
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
    const out = new AgGridLocatorProvider().provideCandidates(ctx)
    expect(out.some((c) => c.locator.includes('row-id="12"'))).toBe(true)
    expect(out.some((c) => c.metadata?.provider === 'ag-grid-provider')).toBe(true)
  })
})
