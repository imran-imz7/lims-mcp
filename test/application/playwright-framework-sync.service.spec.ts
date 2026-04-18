import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlaywrightFrameworkSyncService } from '../../src/application/playwright-framework-sync.service.js'
import { TextFileRepository } from '../../src/infrastructure/files/text-file-repository.js'
import type { PluginRegistry } from '../../src/domain/plugin/plugin-registry.js'
import type { LoggerPort } from '../../src/infrastructure/logging/logger.port.js'
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

describe('PlaywrightFrameworkSyncService', () => {
  it('creates spec/page/locator files from stored artifact locators', async () => {
    const artifact: StoredLocatorArtifact = {
      ref: 'artifact-1',
      storedAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      platform: 'web',
      pageUrl: 'https://example.com/payments',
      target: 'button:Pay now',
      targetDescriptor: null,
      runtimeContext: {
        mode: 'live-page',
        pageUrl: 'https://example.com/payments',
      },
      dom: '<button data-testid="pay-now">Pay now</button>',
      screenshotBase64: 'fake',
      interactiveElements: [],
      generation: {
        bestLocator: 'page.getByTestId("pay-now")',
        confidence: 0.94,
        strategy: 'testid',
        fallbacks: [],
      },
      outcomes: [],
    }

    const plugins: PluginRegistry = {
      screenshotAnalyzer: { analyze: async () => ({ width: 1, height: 1, tokens: [] }) },
      ocr: { extractTokens: async () => [] },
      runtimeValidator: {
        validate: async () => ({
          executed: false,
          unique: false,
          visible: false,
          interactable: false,
          success: false,
          notes: ['not used'],
        }),
      },
      artifactStore: {
        saveArtifact: async () => ({ ref: artifact.ref, storedAt: artifact.storedAt, path: `/tmp/${artifact.ref}.json` }),
        getArtifact: async (ref) => ref === artifact.ref ? artifact : null,
        appendOutcome: async () => null,
      },
      locatorCandidateProviders: [],
    }

    const dir = await mkdtemp(join(tmpdir(), 'lims-framework-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      const service = new PlaywrightFrameworkSyncService(new TextFileRepository(), createLogger(), plugins)
      const result = await service.sync({
        feature: 'payments',
        language: 'ts',
        outputDir: 'e2e',
        locatorBindings: [
          {
            name: 'pay now button',
            artifactRef: 'artifact-1',
          },
        ],
        testCases: [
          {
            name: 'user can submit a payment',
            steps: [
              {
                locator: 'pay now button',
                action: 'assertVisible',
              },
              {
                locator: 'pay now button',
                action: 'click',
              },
            ],
          },
        ],
      })

      const locatorFile = await readFile(join(dir, result.files.locator), 'utf8')
      const pageFile = await readFile(join(dir, result.files.page), 'utf8')
      const specFile = await readFile(join(dir, result.files.spec), 'utf8')

      expect(result.language).toBe('ts')
      expect(result.locatorNames).toContain('payNowButton')
      expect(locatorFile).toContain(`export const paymentsLocators`)
      expect(locatorFile).toContain(`page.getByTestId("pay-now")`)
      expect(pageFile).toContain(`export class PaymentsPage`)
      expect(pageFile).toContain(`async open(): Promise<void>`)
      expect(specFile).toContain(`await expect(pageObject.payNowButton()).toBeVisible()`)
      expect(specFile).toContain(`await pageObject.payNowButton().click()`)
    } finally {
      process.chdir(cwd)
      await rm(dir, { recursive: true, force: true })
    }
  })
})
