import { loadConfigFromEnv } from '../infrastructure/config/app-config.js'
import { MemoryCache } from '../infrastructure/cache/memory-cache.js'
import { createPinoLogger } from '../infrastructure/logging/pino-logger.js'
import { DomRepository } from '../infrastructure/parsers/dom-repository.js'
import { LocatorGenerationService } from '../application/locator-generation.service.js'
import { LocatorHealingService } from '../application/locator-healing.service.js'
import { LocatorAnalysisService } from '../application/locator-analysis.service.js'
import { LocatorCaptureService } from '../application/locator-capture.service.js'
import { LocatorFeedbackService } from '../application/locator-feedback.service.js'
import { PlaywrightFrameworkSyncService } from '../application/playwright-framework-sync.service.js'
import { HealthCheckService } from '../application/health-check.service.js'
import { TargetResolver } from '../domain/locator/target-resolver.js'
import { TesseractCliOCRAdapter } from '../integrations/ocr/tesseract-cli-ocr.adapter.js'
import { BasicScreenshotAnalyzer } from '../integrations/vision/basic-screenshot-analyzer.js'
import { PlaywrightValidatorAdapter } from '../integrations/playwright/playwright-validator.adapter.js'
import { PlaywrightMcpValidatorAdapter } from '../integrations/playwright/playwright-mcp-validator.adapter.js'
import { PlaywrightWebCaptureAdapter } from '../integrations/playwright/playwright-web-capture.adapter.js'
import { CompositePageCaptureAdapter } from '../integrations/playwright/composite-page-capture.adapter.js'
import { DefaultPluginRegistry } from '../domain/plugin/plugin-registry.js'
import { PlaywrightRuntimeValidatorBridge } from '../integrations/playwright/runtime-validator-bridge.js'
import { LocatorLearningStore } from '../infrastructure/cache/locator-learning-store.js'
import { TextFileRepository } from '../infrastructure/files/text-file-repository.js'
import { LocatorArtifactStore } from '../infrastructure/cache/locator-artifact-store.js'
import type { LocatorCandidateProvider } from '../domain/locator/locator-extension.js'
import {
  AgGridLocatorProvider,
  FlutterWebLocatorProvider,
  ReactVirtualizedLocatorProvider,
} from '../domain/locator/providers/index.js'

export interface ServiceContainer {
  generation: LocatorGenerationService
  healing: LocatorHealingService
  analysis: LocatorAnalysisService
  capture: LocatorCaptureService
  feedback: LocatorFeedbackService
  frameworkSync: PlaywrightFrameworkSyncService
  health: HealthCheckService
  plugins: DefaultPluginRegistry
  bridge?: PlaywrightRuntimeValidatorBridge
  shutdown: () => Promise<void>
}

/** Composition root — infrastructure → domain factories inside application services. */
export function buildContainer(env = process.env): ServiceContainer {
  const config = loadConfigFromEnv(env)
  const cache = new MemoryCache(config.cacheTtlMs, config.cacheMaxEntries)
  const log = createPinoLogger(config.logLevel)
  const dom = new DomRepository(cache, log)
  const resolver = new TargetResolver(dom, log)
  const files = new TextFileRepository()
  const ocr = new TesseractCliOCRAdapter()
  const screenshotAnalyzer = new BasicScreenshotAnalyzer(ocr)
  const localPageCapture = new PlaywrightWebCaptureAdapter()
  const learning = config.learningEnabled
    ? new LocatorLearningStore(config.learningStorePath)
    : undefined
  const artifactStore = config.artifactsEnabled
    ? new LocatorArtifactStore(config.artifactsDir)
    : undefined
  // Playwright MCP connection — three modes, evaluated in priority order:
  //  1. HTTP mode  (LIMS_PLAYWRIGHT_MCP_URL)   → connect to a shared running playwright-mcp server
  //  2. stdio mode (LIMS_PLAYWRIGHT_MCP_COMMAND) → LIMS spawns its own subprocess
  //  3. standalone (neither set)               → local DOM heuristics only
  const mcpValidator = config.playwrightMcpUrl
    ? new PlaywrightMcpValidatorAdapter({
        mode: 'http',
        url: config.playwrightMcpUrl,
        toolName: config.playwrightMcpToolName,
        timeoutMs: config.playwrightMcpTimeoutMs,
      })
    : config.playwrightMcpCommand
      ? new PlaywrightMcpValidatorAdapter({
          mode: 'stdio',
          command: config.playwrightMcpCommand,
          args: config.playwrightMcpArgs,
          env: config.playwrightMcpEnv,
          cwd: config.playwrightMcpCwd,
          toolName: config.playwrightMcpToolName,
          timeoutMs: config.playwrightMcpTimeoutMs,
        })
      : undefined
  const pageCapture = mcpValidator
    ? new CompositePageCaptureAdapter([mcpValidator, localPageCapture])
    : localPageCapture
  let bridge: PlaywrightRuntimeValidatorBridge | undefined
  let runtimeUrl = config.playwrightValidatorUrl
  if (!runtimeUrl && config.playwrightAutoBridge && !mcpValidator) {
    bridge = new PlaywrightRuntimeValidatorBridge(config.playwrightBridgePort)
    bridge.start()
    runtimeUrl = `http://127.0.0.1:${config.playwrightBridgePort}/validate`
  }
  const runtimeValidator = new PlaywrightValidatorAdapter(runtimeUrl, mcpValidator)
  /*
   * Scalable extension seam:
   * register custom locator candidate providers here (or from external package wiring)
   * so new locator strategies can be added without modifying core LocatorEngine.
   * NOTE: current built-in providers are sample/reference implementations.
   */
  const locatorCandidateProviders: LocatorCandidateProvider[] = [
    new AgGridLocatorProvider(),
    new ReactVirtualizedLocatorProvider(),
    new FlutterWebLocatorProvider(),
  ]
  const plugins = new DefaultPluginRegistry(
    screenshotAnalyzer,
    ocr,
    runtimeValidator,
    pageCapture,
    learning,
    artifactStore,
    locatorCandidateProviders,
  )

  const generation = new LocatorGenerationService(dom, resolver, log, plugins)
  const healing = new LocatorHealingService(dom, resolver, log, plugins)

  return {
    generation,
    healing,
    analysis: new LocatorAnalysisService(dom, log),
    capture: new LocatorCaptureService(generation, log, plugins),
    feedback: new LocatorFeedbackService(dom, resolver, generation, healing, log, plugins),
    frameworkSync: new PlaywrightFrameworkSyncService(files, log, plugins),
    health: new HealthCheckService(runtimeValidator, config),
    plugins,
    bridge,
    shutdown: async () => {
      bridge?.stop()
      await pageCapture.close?.()
      await runtimeValidator.close()
    },
  }
}
