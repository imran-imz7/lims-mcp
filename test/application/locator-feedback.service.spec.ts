import { describe, expect, it } from 'vitest'
import { LocatorFeedbackService } from '../../src/application/locator-feedback.service.js'
import { LocatorGenerationService } from '../../src/application/locator-generation.service.js'
import { LocatorHealingService } from '../../src/application/locator-healing.service.js'
import { TargetResolver } from '../../src/domain/locator/target-resolver.js'
import type {
  LocatorLearningEvent,
  LocatorLearningInsights,
  RuntimeValidationInput,
} from '../../src/domain/contracts/ports.js'
import type { PluginRegistry } from '../../src/domain/plugin/plugin-registry.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js'
import { DomRepository } from '../../src/infrastructure/parsers/dom-repository.js'
import type { StoredLocatorArtifact } from '../../src/domain/contracts/types.js'

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

function deriveInsights(events: LocatorLearningEvent[]): LocatorLearningInsights {
  const preferredLocators: string[] = []
  const failedLocators: string[] = []
  const healedPairs: Array<{ from: string; to: string }> = []

  for (const event of events) {
    if (event.status === 'success') preferredLocators.push(event.locator)
    if (event.status === 'failure') failedLocators.push(event.locator)
    if (event.status === 'healed' && event.replacementLocator) {
      preferredLocators.push(event.replacementLocator)
      failedLocators.push(event.locator)
      healedPairs.push({ from: event.locator, to: event.replacementLocator })
    }
  }

  return {
    preferredLocators: [...new Set(preferredLocators)],
    failedLocators: [...new Set(failedLocators)],
    healedPairs,
  }
}

function createServices(
  runtimeCalls: RuntimeValidationInput[],
  learningEvents: LocatorLearningEvent[],
): LocatorFeedbackService {
  const logger = createLogger()
  const dom = new DomRepository(new MemoryCache(10_000, 100), logger)
  const resolver = new TargetResolver(dom, logger)
  const storedArtifact: StoredLocatorArtifact = {
    ref: 'artifact-1',
    storedAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    platform: 'web',
    pageUrl: 'https://example.com/app',
    target: 'button:Buy',
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
    },
    dom: `
      <main>
        <button data-testid="buy-btn" aria-label="Buy">Buy</button>
      </main>
    `,
    screenshotBase64: 'fake-base64-image',
    interactiveElements: [],
    generation: {
      bestLocator: 'page.getByTestId("buy-btn")',
      confidence: 0.91,
      strategy: 'testid',
      fallbacks: [],
    },
    outcomes: [],
  }
  const plugins: PluginRegistry = {
    screenshotAnalyzer: {
      analyze: async () => ({
        width: 1280,
        height: 720,
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
          notes: ['feedback flow runtime pass'],
        }
      },
    },
    learning: {
      getInsights: async () => deriveInsights(learningEvents),
      recordOutcome: async (event) => {
        learningEvents.push(event)
      },
    },
    artifactStore: {
      saveArtifact: async () => ({
        ref: storedArtifact.ref,
        storedAt: storedArtifact.storedAt,
        path: `/tmp/${storedArtifact.ref}.json`,
      }),
      getArtifact: async (ref) => (ref === storedArtifact.ref ? storedArtifact : null),
      appendOutcome: async (ref, outcome) => {
        if (ref !== storedArtifact.ref) return null
        storedArtifact.outcomes.push(outcome)
        storedArtifact.updatedAt = outcome.recordedAt
        return {
          ref: storedArtifact.ref,
          storedAt: storedArtifact.storedAt,
          path: `/tmp/${storedArtifact.ref}.json`,
        }
      },
    },
    locatorCandidateProviders: [],
  }

  const generation = new LocatorGenerationService(dom, resolver, logger, plugins)
  const healing = new LocatorHealingService(dom, resolver, logger, plugins)

  return new LocatorFeedbackService(dom, resolver, generation, healing, logger, plugins)
}

describe('LocatorFeedbackService', () => {
  it('records failures and returns a regenerated locator when the old one is stale', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const learningEvents: LocatorLearningEvent[] = []
    const service = createServices(runtimeCalls, learningEvents)

    const result = await service.report({
      locator: 'page.getByText("Old Buy")',
      status: 'failed',
      platform: 'web',
      artifactRef: 'artifact-1',
      failureMessage: 'locator did not match any element',
    })

    expect(result.recorded).toBe(true)
    expect(result.artifact?.ref).toBe('artifact-1')
    expect(['heal', 'regenerate']).toContain(result.improved?.source)
    expect(result.improved?.locator).toContain('buy-btn')
    expect(result.learned.failedLocators).toContain('page.getByText("Old Buy")')
    expect(result.learned.healedPairs[0]?.from).toBe('page.getByText("Old Buy")')
    expect(learningEvents.map((event) => event.status)).toEqual(['failure', 'healed'])
    expect(runtimeCalls.some((call) => call.runtimeContext?.pageUrl === 'https://example.com/app')).toBe(true)
  })

  it('records passing locator feedback without forcing a new locator', async () => {
    const runtimeCalls: RuntimeValidationInput[] = []
    const learningEvents: LocatorLearningEvent[] = []
    const service = createServices(runtimeCalls, learningEvents)

    const result = await service.report({
      locator: 'page.getByTestId("buy-btn")',
      status: 'passed',
      platform: 'web',
      dom: '<button data-testid="buy-btn">Buy</button>',
      target: 'button:Buy',
    })

    expect(result.recorded).toBe(true)
    expect(result.improved).toBeUndefined()
    expect(result.learned.preferredLocators).toContain('page.getByTestId("buy-btn")')
    expect(learningEvents).toHaveLength(1)
    expect(learningEvents[0]?.status).toBe('success')
    expect(result.artifact).toBeUndefined()
    expect(runtimeCalls).toHaveLength(0)
  })
})
