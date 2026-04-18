import { describe, expect, it } from 'vitest'
import { LocatorHealingService } from '../../src/application/locator-healing.service.js'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import { TargetResolver } from '../../src/domain/locator/target-resolver.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import type { PluginRegistry } from '../../src/domain/plugin/plugin-registry.js'
import type { RuntimeValidationInput } from '../../src/domain/contracts/ports.js'

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

function buildService(calls: RuntimeValidationInput[]) {
  const log = logger()
  const dom = new DomRepository(new MemoryCache(10_000, 100), log)
  const resolver = new TargetResolver(dom, log)
  const plugins: PluginRegistry = {
    screenshotAnalyzer: {
      analyze: async () => ({ width: 100, height: 100, tokens: [] }),
    },
    ocr: {
      extractTokens: async () => [],
    },
    runtimeValidator: {
      validate: async (input) => {
        calls.push(input)
        return {
          executed: true,
          unique: true,
          visible: true,
          interactable: true,
          success: true,
          notes: ['source:local-fallback'],
        }
      },
    },
  }
  return new LocatorHealingService(dom, resolver, log, plugins)
}

describe('LocatorHealingService platform behavior', () => {
  it('uses explicit ios platform during healing runtime validation', async () => {
    const calls: RuntimeValidationInput[] = []
    const svc = buildService(calls)
    await svc.heal({
      xml: '<hierarchy><node id="x1" name="Buy" /></hierarchy>',
      platform: 'ios',
      oldLocator: '//*[@id="x1"]',
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.platform === 'ios')).toBe(true)
  })

  it('defaults to android when xml platform not provided', async () => {
    const calls: RuntimeValidationInput[] = []
    const svc = buildService(calls)
    await svc.heal({
      xml: '<hierarchy><node id="x1" content-desc="Buy" /></hierarchy>',
      oldLocator: '//*[@id="x1"]',
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.platform === 'android')).toBe(true)
  })

  it('screenshot-only healing honors provided platform', async () => {
    const calls: RuntimeValidationInput[] = []
    const svc = buildService(calls)
    await svc.heal({
      screenshot: 'fake-image',
      platform: 'ios',
      oldLocator: 'AppiumBy.accessibilityId("buy-btn")',
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.platform).toBe('ios')
  })

  it('revalidates generated Playwright locators without requiring fingerprint', async () => {
    const calls: RuntimeValidationInput[] = []
    const svc = buildService(calls)
    const out = await svc.heal({
      dom: '<div><button data-testid="buy-btn">Buy</button></div>',
      oldLocator: 'page.getByTestId("buy-btn")',
      runtimeContext: {
        mode: 'live-page',
        pageUrl: 'https://example.com/app',
      },
    })
    expect(out.healedLocator.length).toBeGreaterThan(0)
    expect(calls[0]?.runtimeContext?.pageUrl).toBe('https://example.com/app')
  })
})
