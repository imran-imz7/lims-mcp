import { describe, expect, it } from 'vitest'
import { LocatorCaptureService } from '../../src/application/locator-capture.service.js'
import { LocatorGenerationService } from '../../src/application/locator-generation.service.js'
import { TargetResolver } from '../../src/domain/locator/target-resolver.js'
import type { PageCaptureInput, RuntimeValidationInput } from '../../src/domain/contracts/ports.js'
import type { PluginRegistry } from '../../src/domain/plugin/plugin-registry.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'

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

function createServices(
  runtimeCalls: RuntimeValidationInput[],
  captureCalls: PageCaptureInput[],
): LocatorCaptureService {
  const logger = createLogger()
  const dom = new DomRepository(new MemoryCache(10_000, 100), logger)
  const resolver = new TargetResolver(dom, logger)
  const plugins: PluginRegistry = {
    screenshotAnalyzer: {
      analyze: async () => ({
        width: 1440,
        height: 900,
        tokens: [],
      }),
    },
    ocr: {
      extractTokens: async () => [],
    },
    runtimeValidator: {
      validate: async (input) => {
        runtimeCalls.push(input)
        return {
          executed: true,
          unique: true,
          visible: true,
          interactable: true,
          success: true,
          attempts: input.retries ?? 1,
          stableOverRetries: true,
          notes: ['capture flow runtime pass'],
        }
      },
    },
    pageCapture: {
      capture: async (input) => {
        captureCalls.push(input)
        return {
          pageUrl: input.pageUrl ?? 'https://example.com/app',
          title: 'Checkout',
          dom: `
            <main data-testid="checkout-page">
              <button data-testid="buy-btn" aria-label="Buy now">Buy</button>
            </main>
          `,
          screenshotBase64: 'fake-base64-image',
          targetDescriptor: {
            tag: 'button',
            text: 'Buy',
            name: 'Buy now',
            attributes: {
              'data-testid': 'buy-btn',
            },
          },
          interactiveElements: [
            {
              tag: 'button',
              text: 'Buy',
              name: 'Buy now',
              testId: 'buy-btn',
              cssPath: '[data-testid="buy-btn"]',
              attributes: {
                'data-testid': 'buy-btn',
                'aria-label': 'Buy now',
              },
            },
          ],
        }
      },
    },
    learning: {
      getInsights: async () => ({
        preferredLocators: [],
        failedLocators: [],
        healedPairs: [],
      }),
      recordOutcome: async () => undefined,
    },
    artifactStore: {
      saveArtifact: async () => ({
        ref: 'artifact-1',
        storedAt: '2026-04-08T00:00:00.000Z',
        path: '/tmp/artifact-1.json',
      }),
      getArtifact: async () => null,
      appendOutcome: async () => null,
    },
    locatorCandidateProviders: [],
  }

  const generation = new LocatorGenerationService(dom, resolver, logger, plugins)
  return new LocatorCaptureService(generation, logger, plugins)
}

describe('LocatorCaptureService', () => {
  it('captures the page and returns an automation-ready locator bundle', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const captureCalls: PageCaptureInput[] = []
    const service = createServices(runtimeCalls, captureCalls)

    const result = await service.captureAndGenerate({
      pageUrl: 'https://example.com/app',
      platform: 'web',
      target: 'button:Buy',
      includeInteractiveElements: true,
      runtimeContext: {
        useCurrentPage: true,
        waitForSelector: '[data-testid="buy-btn"]',
      },
      captureContext: {
        suite: 'checkout',
        feature: 'buy',
        testCase: 'can place buy order',
      },
    })

    expect(captureCalls).toHaveLength(1)
    expect(captureCalls[0]?.pageUrl).toBe('https://example.com/app')
    expect(captureCalls[0]?.includeInteractiveElements).toBe(true)
    expect(result.capture.pageUrl).toBe('https://example.com/app')
    expect(result.capture.interactiveElements).toHaveLength(1)
    expect(result.capture.targetDescriptor?.attributes?.['data-testid']).toBe('buy-btn')
    expect(result.capture.artifacts.screenshotCaptured).toBe(true)
    expect(result.capture.artifact?.ref).toBe('artifact-1')
    expect(result.bestLocator).toContain('buy-btn')
    expect(result.automation.runtimeContext?.mode).toBe('live-page')
    expect(runtimeCalls[0]?.runtimeContext?.pageUrl).toBe('https://example.com/app')
  })
})
