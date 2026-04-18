import { describe, expect, it } from 'vitest'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import { UniquenessEngine } from '../../src/domain/uniqueness-engine/uniqueness-engine.js'
import { SelectorValidator } from '../../src/domain/selector-validator/selector-validator.js'
import { LocatorEngine } from '../../src/domain/locator/locator-engine.js'

function logger(): LoggerPort {
  const l: LoggerPort = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => l,
  }
  return l
}

function buildHtml(source: string) {
  const dom = new DomRepository(new MemoryCache(10_000, 100), logger())
  const parsed = dom.parse(source, 'html')
  const uniqueness = new UniquenessEngine(dom, new SelectorValidator())
  const engine = new LocatorEngine(uniqueness)
  return { ...parsed, engine }
}

describe('LocatorEngine trading enhancements', () => {
  it('generates anchor-scoped locator using trading ancestor attributes', () => {
    const { $, xmlDoc, engine } = buildHtml(`
      <div data-symbol="RELIANCE" data-segment="NSE">
        <button data-action="buy">Buy</button>
      </div>
    `)
    const out = engine.generate({ $, xmlDoc, target: $('button').first(), platform: 'web' })
    const anchored = out.ranked.find((r) =>
      r.locator.includes('data-symbol') && r.locator.includes('data-action'),
    )
    expect(anchored).toBeDefined()
  })

  it('includes trading web attributes as direct candidates', () => {
    const { $, xmlDoc, engine } = buildHtml(`
      <div>
        <button data-symbol="SBIN-EQ" data-side="buy">BUY</button>
      </div>
    `)
    const out = engine.generate({ $, xmlDoc, target: $('button').first(), platform: 'web' })
    expect(out.ranked.some((r) => r.locator.includes('data-symbol'))).toBe(true)
  })

  it('generates symbol-scoped locator for repeated trading actions', () => {
    const { $, xmlDoc, engine } = buildHtml(`
      <section>
        <div data-testid="portfolioRow" data-symbol="TATAAML-TATAGOLDBSETF">
          <span>TATAAML-TATAGOLDBSETF</span>
          <button data-testid="Show Chart">Show Chart</button>
        </div>
        <div data-testid="portfolioRow" data-symbol="SBIN-EQ">
          <span>SBIN-EQ</span>
          <button data-testid="Show Chart">Show Chart</button>
        </div>
      </section>
    `)
    const target = $('button[data-testid="Show Chart"]').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    expect(
      out.ranked.some((r) =>
        r.locator.includes('data-symbol') && r.locator.includes('Show Chart'),
      ),
    ).toBe(true)
  })
})
