import { describe, expect, it } from 'vitest'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import { TargetResolver } from '../../src/domain/locator/target-resolver.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'

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

function setup(html: string, mode: 'html' | 'xml' = 'html') {
  const log = logger()
  const dom = new DomRepository(new MemoryCache(10_000, 100), log)
  const parsed = dom.parse(html, mode)
  const resolver = new TargetResolver(dom, log)
  return { resolver, ...parsed }
}

describe('TargetResolver', () => {
  it('resolves by css selector', () => {
    const { resolver, $, xmlDoc } = setup('<button id="buy">Buy</button>')
    const out = resolver.resolve($, xmlDoc, '#buy')
    expect(out?.node.attr('id')).toBe('buy')
  })

  it('resolves by xpath', () => {
    const { resolver, $, xmlDoc } = setup('<div><button id="buy">Buy</button></div>')
    const out = resolver.resolve($, xmlDoc, '//*[@id="buy"]')
    expect(out?.node.attr('id')).toBe('buy')
  })

  it('resolves by text: prefix', () => {
    const { resolver, $, xmlDoc } = setup('<div><button>Buy</button></div>')
    const out = resolver.resolve($, xmlDoc, 'text:Buy')
    expect(out?.node.text()).toContain('Buy')
  })

  it('resolves android resource-id prefix', () => {
    const { resolver, $, xmlDoc } = setup('<node resource-id="com.app:id/buy" text="Buy"/>', 'xml')
    const out = resolver.resolve($, xmlDoc, 'resource-id:com.app:id/buy')
    expect(out?.node.attr('resource-id')).toBe('com.app:id/buy')
  })

  it('resolves android content-desc prefix', () => {
    const { resolver, $, xmlDoc } = setup('<node content-desc="buy-btn" text="Buy"/>', 'xml')
    const out = resolver.resolve($, xmlDoc, 'content-desc:buy-btn')
    expect(out?.node.attr('content-desc')).toBe('buy-btn')
  })

  it('resolves ios-name prefix', () => {
    const { resolver, $, xmlDoc } = setup('<XCUIElementTypeButton name="Buy"/>', 'xml')
    const out = resolver.resolve($, xmlDoc, 'ios-name:Buy')
    expect(out?.node.attr('name')).toBe('Buy')
  })

  it('resolves trading contextual target symbol|action', () => {
    const { resolver, $, xmlDoc } = setup(`
      <section>
        <div data-testid="portfolioRow">
          <span>TATAAML-TATAGOLDBSETF</span>
          <button data-testid="Show Chart">Show Chart</button>
        </div>
        <div data-testid="portfolioRow">
          <span>SBIN-EQ</span>
          <button data-testid="Show Chart">Show Chart</button>
        </div>
      </section>
    `)
    const out = resolver.resolve($, xmlDoc, 'symbol:TATAAML-TATAGOLDBSETF|action:Show Chart')
    expect(out?.node.attr('data-testid')).toBe('Show Chart')
    expect(out?.node.closest('[data-testid="portfolioRow"]').text()).toContain('TATAAML-TATAGOLDBSETF')
  })

  it('resolves trading row action via button label attribute', () => {
    const { resolver, $, xmlDoc } = setup(`
      <section>
        <div data-testid="portfolioRow">
          <div>TATAAML-TATAGOLD</div>
          <button type="button" label="B">B</button>
          <button type="button" label="S">S</button>
        </div>
        <div data-testid="portfolioRow">
          <div>SBIN-EQ</div>
          <button type="button" label="B">B</button>
          <button type="button" label="S">S</button>
        </div>
      </section>
    `)
    const out = resolver.resolve($, xmlDoc, 'symbol:TATAAML-TATAGOLD|action:B')
    expect(out?.node.attr('label')).toBe('B')
    expect(out?.node.closest('[data-testid="portfolioRow"]').text()).toContain('TATAAML-TATAGOLD')
  })

  it('supports rowsymbol/actionlabel aliases in trading context targets', () => {
    const { resolver, $, xmlDoc } = setup(`
      <div data-testid="portfolioRow">
        <div>TATAAML-TATAGOLD</div>
        <button type="button" label="S">S</button>
      </div>
    `)
    const out = resolver.resolve($, xmlDoc, 'rowsymbol:TATAAML-TATAGOLD|actionlabel:S')
    expect(out?.node.attr('label')).toBe('S')
  })

  it('resolves generated playwright role locators', () => {
    const { resolver, $, xmlDoc } = setup('<div><button aria-label="Buy">Buy</button></div>')
    const out = resolver.resolve($, xmlDoc, `page.getByRole('button', { name: "Buy" })`)
    expect(out?.node.text()).toContain('Buy')
  })

  it('resolveIfUnique supports Appium and Playwright locators', () => {
    const web = setup('<div><button data-testid="buy-btn">Buy</button></div>')
    const webOut = web.resolver.resolveIfUnique(web.$, web.xmlDoc, `page.getByTestId("buy-btn")`)
    expect(webOut?.node.attr('data-testid')).toBe('buy-btn')

    const mobile = setup('<hierarchy><node resource-id="com.app:id/buy" text="Buy"/></hierarchy>', 'xml')
    const mobileOut = mobile.resolver.resolveIfUnique(mobile.$, mobile.xmlDoc, 'AppiumBy.id("com.app:id/buy")')
    expect(mobileOut?.node.attr('resource-id')).toBe('com.app:id/buy')
  })

  it('resolves structured target descriptors', () => {
    const { resolver, $, xmlDoc } = setup('<div><button data-testid="buy-btn">Buy</button></div>')
    const out = resolver.resolveDescriptor($, xmlDoc, {
      attributes: {
        'data-testid': 'buy-btn',
      },
      text: 'Buy',
      tag: 'button',
    })
    expect(out?.node.attr('data-testid')).toBe('buy-btn')
  })
})
