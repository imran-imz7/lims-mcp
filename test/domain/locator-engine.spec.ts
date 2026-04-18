import { describe, expect, it } from 'vitest'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import { UniquenessEngine } from '../../src/domain/uniqueness-engine/uniqueness-engine.js'
import { SelectorValidator } from '../../src/domain/selector-validator/selector-validator.js'
import { LocatorEngine } from '../../src/domain/locator/locator-engine.js'
import type { LocatorCandidateProvider } from '../../src/domain/locator/locator-extension.js'

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

function build(mode: 'html' | 'xml', source: string) {
  const dom = new DomRepository(new MemoryCache(10_000, 100), logger())
  const parsed = dom.parse(source, mode)
  const uniqueness = new UniquenessEngine(dom, new SelectorValidator())
  const engine = new LocatorEngine(uniqueness)
  return { ...parsed, engine }
}

describe('LocatorEngine uniqueness guards', () => {
  it('rejects ambiguous playwright getByRole candidates', () => {
    const { $, xmlDoc, engine } = build('html', `
      <div>
        <button role="button" aria-label="Buy">Buy</button>
        <button role="button" aria-label="Buy">Buy</button>
      </div>
    `)
    const target = $('button').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    const roleByName = out.ranked.find((r) => r.locator.includes('getByRole') && r.locator.includes('Buy'))
    expect(roleByName).toBeUndefined()
  })

  it('rejects ambiguous Appium accessibilityId candidates', () => {
    const { $, xmlDoc, engine } = build('xml', `
      <hierarchy>
        <node content-desc="buy-btn" />
        <node content-desc="buy-btn" />
      </hierarchy>
    `)
    const target = $('node').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'android' })
    const appium = out.ranked.find((r) => r.kind === 'appium' && r.locator.includes('buy-btn'))
    expect(appium).toBeUndefined()
  })

  it('keeps unique appium candidate viable', () => {
    const { $, xmlDoc, engine } = build('xml', `
      <hierarchy>
        <node content-desc="buy-btn" />
      </hierarchy>
    `)
    const target = $('node').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'android' })
    expect(out.ranked.some((r) => r.kind === 'appium')).toBe(true)
  })

  it('scores unsupported playwright expressions as non-unique', () => {
    const { $, xmlDoc, engine } = build('html', `
      <div><button class="buy">Buy</button></div>
    `)
    const target = $('button').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    const suspect = out.ranked.find((r) => r.locator.includes('page.locator('))
    expect(suspect).toBeUndefined()
  })

  it('generates regex-like stable pattern locator for dynamic id', () => {
    const { $, xmlDoc, engine } = build('html', `
      <div>
        <button id="order-984533-buy">Buy</button>
      </div>
    `)
    const target = $('button').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    const regexLike = out.ranked.find((r) => (r.metadata as Record<string, unknown>).regexLike === true)
    expect(regexLike).toBeDefined()
  })

  it('generates nested locator using stable ancestor context', () => {
    const { $, xmlDoc, engine } = build('html', `
      <section data-testid="trade-panel">
        <div>
          <button name="buy">Buy</button>
        </div>
      </section>
    `)
    const target = $('button').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    const nested = out.ranked.find((r) => r.locator.includes('trade-panel') && r.locator.includes('button'))
    expect(nested).toBeDefined()
  })

  it('generates row-scoped locator for div-based pseudo table rows', () => {
    const { $, xmlDoc, engine } = build('html', `
      <section>
        <div class="portfolio-row" role="presentation" data-testid="portfolioRow">
          <div>TATAAML-TATAGOLD</div>
          <button label="B">B</button>
        </div>
        <div class="portfolio-row" role="presentation" data-testid="portfolioRow">
          <div>SBIN-EQ</div>
          <button label="B">B</button>
        </div>
      </section>
    `)
    const target = $('button[label="B"]').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'web' })
    expect(
      out.ranked.some((r) => r.strategy === 'relative' && (r.metadata as Record<string, unknown>).genericUiPattern === true),
    ).toBe(true)
  })

  it('supports Android resource-id as Appium id candidate', () => {
    const { $, xmlDoc, engine } = build('xml', `
      <hierarchy>
        <node resource-id="com.app:id/buyButton" text="Buy"/>
      </hierarchy>
    `)
    const target = $('node').first()
    const out = engine.generate({ $, xmlDoc, target, platform: 'android' })
    expect(out.ranked.some((r) => r.kind === 'appium' && r.locator.includes('AppiumBy.id'))).toBe(true)
  })

  it('accepts external candidate providers without core engine edits', () => {
    const dom = new DomRepository(new MemoryCache(10_000, 100), logger())
    const parsed = dom.parse('<div><button id="buy-now" data-robot="buy">Buy</button></div>', 'html')
    const uniqueness = new UniquenessEngine(dom, new SelectorValidator())
    const provider: LocatorCandidateProvider = {
      id: 'custom-provider',
      provideCandidates: () => [
        {
          locator: 'button[data-robot="buy"]',
          kind: 'css',
          strategy: 'css',
          priorityTier: 3,
          stabilityScore: 0.9,
          readabilityScore: 0.9,
          metadata: { source: 'external' },
        },
      ],
    }
    const engine = new LocatorEngine(uniqueness, { candidateProviders: [provider] })
    const out = engine.generate({
      $: parsed.$,
      xmlDoc: parsed.xmlDoc,
      target: parsed.$('button').first(),
      platform: 'web',
    })
    expect(
      out.ranked.some((r) => r.locator === 'button[data-robot="buy"]' && (r.metadata as Record<string, unknown>).extensionProvider === 'custom-provider'),
    ).toBe(true)
  })
})
