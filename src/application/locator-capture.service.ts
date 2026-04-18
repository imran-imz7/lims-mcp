import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { PluginRegistry } from '../domain/plugin/plugin-registry.js'
import type {
  CaptureGenerateLocatorRequest,
  CaptureGenerateLocatorResponse,
} from '../domain/contracts/types.js'
import { DomainError } from '../utils/errors.js'
import { LocatorGenerationService } from './locator-generation.service.js'

export class LocatorCaptureService {
  constructor(
    private readonly generation: LocatorGenerationService,
    private readonly log: LoggerPort,
    private readonly plugins: PluginRegistry,
  ) {}

  async captureAndGenerate(
    params: CaptureGenerateLocatorRequest,
  ): Promise<CaptureGenerateLocatorResponse> {
    if (params.platform !== 'web') {
      throw new DomainError('capture_generate_locator currently supports only web', 'UNSUPPORTED_PLATFORM')
    }
    if (!this.plugins.pageCapture) {
      throw new DomainError('Playwright page capture adapter is not configured', 'CAPTURE_ADAPTER_MISSING')
    }
    const wantsCurrentPage = Boolean(params.runtimeContext?.useCurrentPage)
    const hasCaptureSource = Boolean(params.pageUrl || params.html || wantsCurrentPage)
    if (!hasCaptureSource) {
      throw new DomainError(
        'pageUrl, html, or runtimeContext.useCurrentPage required for capture generation',
        'CAPTURE_SOURCE_REQUIRED',
      )
    }
    if (!params.target && !params.targetDescriptor) {
      throw new DomainError('target or targetDescriptor required for capture generation', 'TARGET_REQUIRED')
    }

    this.log.info(
      {
        pageUrl: params.pageUrl ?? params.runtimeContext?.pageUrl,
        hasHtml: Boolean(params.html),
        platform: params.platform,
      },
      'capture_generate_locator',
    )

    const captured = await this.plugins.pageCapture.capture({
      pageUrl: params.pageUrl,
      html: params.html,
      target: params.target,
      targetDescriptor: params.targetDescriptor,
      runtimeContext: params.runtimeContext,
      includeInteractiveElements: params.includeInteractiveElements,
      captureFullPage: params.captureFullPage,
    })

    const runtimeContext = {
      ...params.runtimeContext,
      mode: 'live-page' as const,
      pageUrl: captured.pageUrl ?? params.pageUrl ?? params.runtimeContext?.pageUrl,
    }

    const generated = await this.generation.generate({
      dom: captured.dom,
      screenshot: captured.screenshotBase64,
      platform: 'web',
      target: params.target,
      targetDescriptor: captured.targetDescriptor ?? params.targetDescriptor,
      runtimeContext,
    })

    const artifact = this.plugins.artifactStore
      ? await this.plugins.artifactStore.saveArtifact({
          platform: 'web',
          pageUrl: captured.pageUrl,
          title: captured.title,
          target: params.target,
          targetDescriptor: captured.targetDescriptor ?? params.targetDescriptor ?? null,
          runtimeContext,
          captureContext: params.captureContext,
          dom: captured.dom,
          screenshotBase64: captured.screenshotBase64,
          interactiveElements: captured.interactiveElements,
          generation: {
            bestLocator: generated.bestLocator,
            confidence: generated.confidence,
            strategy: generated.strategy,
            fallbacks: generated.fallbacks,
          },
          outcomes: [],
        })
      : undefined

    return {
      ...generated,
      capture: {
        pageUrl: captured.pageUrl,
        title: captured.title,
        capturedAt: new Date().toISOString(),
        targetDescriptor: captured.targetDescriptor,
        interactiveElements: captured.interactiveElements,
        artifacts: {
          domLength: captured.dom.length,
          screenshotCaptured: true,
          fullPage: params.captureFullPage !== false,
        },
        artifact,
      },
    }
  }
}
