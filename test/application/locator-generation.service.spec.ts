import { describe, it, expect } from 'vitest'
import { LocatorGenerationService } from '../../src/application/locator-generation.service.js'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import { TargetResolver } from '../../src/domain/locator/target-resolver.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import type { PluginRegistry } from '../../src/domain/plugin/plugin-registry.js'
import type { OCRToken, RuntimeValidationInput } from '../../src/domain/contracts/ports.js'
import type { RuntimeValidation } from '../../src/domain/contracts/types.js'

function createLogger(): LoggerPort {
  const logger: LoggerPort = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  return logger
}

function createPlugins(runtimeCalls: RuntimeValidationInput[]): PluginRegistry {
  return {
    screenshotAnalyzer: {
      analyze: async () => ({
        width: 1200,
        height: 800,
        tokens: [
          {
            text: 'Buy',
            confidence: 0.95,
            bbox: { x: 500, y: 300, width: 60, height: 24 },
          } satisfies OCRToken,
        ],
      }),
    },
    ocr: {
      extractTokens: async () => [],
    },
    runtimeValidator: {
      validate: async (input): Promise<RuntimeValidation> => {
        runtimeCalls.push(input)
        return {
          executed: true,
          unique: true,
          visible: true,
          interactable: true,
          success: true,
          attempts: input.retries ?? 1,
          stableOverRetries: true,
          notes: ['mock runtime pass'],
        }
      },
    },
  }
}

function createService(runtimeCalls: RuntimeValidationInput[]): LocatorGenerationService {
  const logger = createLogger()
  const dom = new DomRepository(new MemoryCache(10_000, 100), logger)
  const resolver = new TargetResolver(dom, logger)
  return new LocatorGenerationService(dom, resolver, logger, createPlugins(runtimeCalls))
}

describe('LocatorGenerationService integration modes', () => {
  it('generates locator with screenshot-only input', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const service = createService(runtimeCalls)
    const result = await service.generate({
      screenshot: 'fake-base64-image',
      platform: 'web',
      target: 'button:Buy',
    })

    expect(result.bestLocator.length).toBeGreaterThan(0)
    expect(result.strategy.startsWith('screenshot-')).toBe(true)
    expect(result.validation.visual).toBe(true)
    expect(result.metadata.mode).toBe('screenshot-only')
    expect(result.locatorCatalog.total).toBeGreaterThan(0)
    expect(result.locatorCatalog.items[0]?.category).toBe('best')
    expect(runtimeCalls.length).toBeGreaterThan(0)
  })

  it('generates locator with screenshot + html dom input', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const service = createService(runtimeCalls)
    const result = await service.generate({
      screenshot: 'fake-base64-image',
      dom: `
        <main>
          <button data-testid="buy-btn" aria-label="Buy">Buy</button>
        </main>
      `,
      platform: 'web',
      target: '[data-testid="buy-btn"]',
    })

    expect(result.bestLocator.length).toBeGreaterThan(0)
    expect(result.validation.dom).toBe(true)
    expect(result.validation.visual).toBe(true)
    expect(result.metadata.mode).toBe('html')
    expect(result.locatorCatalog.total).toBeGreaterThan(0)
    expect(result.locatorCatalog.items.some((i) => i.category === 'best')).toBe(true)
    expect(result.automation.primary.snippets).toBeDefined()
    expect(runtimeCalls.length).toBeGreaterThan(0)
  })

  it('generates locator with xml-only input', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const service = createService(runtimeCalls)
    const result = await service.generate({
      xml: `
        <hierarchy>
          <node content-desc="Buy">Buy</node>
        </hierarchy>
      `,
      platform: 'android',
      target: 'text:Buy',
    })

    expect(result.bestLocator.length).toBeGreaterThan(0)
    expect(result.validation.dom).toBe(true)
    expect(result.metadata.mode).toBe('xml')
    expect(result.locatorCatalog.total).toBeGreaterThan(0)
    expect(result.locatorCatalog.items.some((i) => i.source === 'dom-ranked')).toBe(true)
    expect(runtimeCalls.length).toBeGreaterThan(0)
  })

  it('supports structured target descriptors and forwards runtime context', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const service = createService(runtimeCalls)
    const result = await service.generate({
      dom: `
        <main>
          <button data-testid="buy-btn" aria-label="Buy">Buy</button>
        </main>
      `,
      platform: 'web',
      targetDescriptor: {
        tag: 'button',
        text: 'Buy',
        attributes: {
          'data-testid': 'buy-btn',
        },
      },
      runtimeContext: {
        mode: 'live-page',
        pageUrl: 'https://example.com/app',
        waitForSelector: '[data-testid="buy-btn"]',
      },
    })

    expect(result.bestLocator.length).toBeGreaterThan(0)
    expect(result.automation.targetFingerprint).toBeTruthy()
    expect(result.automation.runtimeContext?.pageUrl).toBe('https://example.com/app')
    expect(runtimeCalls[0]?.runtimeContext?.pageUrl).toBe('https://example.com/app')
  })
})
