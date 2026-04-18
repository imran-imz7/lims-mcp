import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { DomRepository } from '../infrastructure/parsers/dom-repository.js'
import { fingerprintFromCheerio, fingerprintFromUnknownPayload } from '../domain/element-fingerprint/element-fingerprint.js'
import { TargetResolver } from '../domain/locator/target-resolver.js'
import type { PluginRegistry } from '../domain/plugin/plugin-registry.js'
import type {
  ReportLocatorResultRequest,
  ReportLocatorResultResponse,
  TargetDescriptor,
} from '../domain/contracts/types.js'
import { LocatorGenerationService } from './locator-generation.service.js'
import { LocatorHealingService } from './locator-healing.service.js'
import { DomainError } from '../utils/errors.js'

export class LocatorFeedbackService {
  constructor(
    private readonly dom: DomRepository,
    private readonly resolver: TargetResolver,
    private readonly generation: LocatorGenerationService,
    private readonly healing: LocatorHealingService,
    private readonly log: LoggerPort,
    private readonly plugins: PluginRegistry,
  ) {}

  async report(params: ReportLocatorResultRequest): Promise<ReportLocatorResultResponse> {
    if (params.platform !== 'web') {
      throw new DomainError('report_locator_result currently supports only web', 'UNSUPPORTED_PLATFORM')
    }

    const targetHint = deriveTargetHint(params.target, params.targetDescriptor)
    const source = await this.resolveSource(params)
    const fingerprint = fingerprintFromUnknownPayload(params.fingerprint) ??
      (source.dom && source.targetDescriptor
        ? this.fingerprintFromSource(source.dom, source.targetDescriptor)
        : null)
    const recordedAt = new Date().toISOString()
    const artifactResult = params.artifactRef && this.plugins.artifactStore
      ? await this.plugins.artifactStore.appendOutcome(params.artifactRef, {
          status: params.status,
          locator: params.locator,
          failureMessage: params.failureMessage,
          recordedAt,
        })
      : undefined
    const artifact = artifactResult ?? undefined

    if (this.plugins.learning) {
      await this.plugins.learning.recordOutcome({
        pageUrl: source.runtimeContext?.pageUrl ?? params.pageUrl,
        targetHint,
        fingerprint: fingerprint ? { ...fingerprint } as Record<string, unknown> : null,
        locator: params.locator,
        status: params.status === 'passed' ? 'success' : 'failure',
        failureMessage: params.failureMessage,
      })
    }

    let improved: ReportLocatorResultResponse['improved'] | undefined
    if (params.status === 'failed' && source.dom && (targetHint || source.targetDescriptor)) {
      improved = await this.tryImprove({
        ...source,
        locator: params.locator,
        targetHint,
        fingerprint: fingerprint ? { ...fingerprint } : undefined,
        artifactRef: params.artifactRef,
      })
    }

    const learned = this.plugins.learning
      ? await this.plugins.learning.getInsights({
          pageUrl: source.runtimeContext?.pageUrl ?? params.pageUrl,
          targetHint,
          fingerprint: fingerprint ? { ...fingerprint } as Record<string, unknown> : null,
        })
      : {
          preferredLocators: [],
          failedLocators: [],
          healedPairs: [],
        }

    return {
      recorded: true,
      status: params.status,
      learned,
      artifact,
      improved,
    }
  }

  private fingerprintFromSource(domSource: string, descriptor: TargetDescriptor) {
    const parsed = this.dom.parse(domSource, 'html')
    const resolved = this.resolver.resolveDescriptor(parsed.$, parsed.xmlDoc, descriptor)
    if (!resolved) return null
    return fingerprintFromCheerio(resolved.node)
  }

  private async resolveSource(params: ReportLocatorResultRequest): Promise<{
    dom?: string
    screenshot?: string
    targetDescriptor?: TargetDescriptor
    runtimeContext?: ReportLocatorResultRequest['runtimeContext']
  }> {
    if (params.artifactRef && this.plugins.artifactStore) {
      const artifact = await this.plugins.artifactStore.getArtifact(params.artifactRef)
      if (artifact) {
        return {
          dom: params.dom ?? artifact.dom,
          screenshot: params.screenshot ?? artifact.screenshotBase64,
          targetDescriptor: params.targetDescriptor ?? artifact.targetDescriptor ?? undefined,
          runtimeContext: params.runtimeContext ?? artifact.runtimeContext,
        }
      }
    }
    if (params.dom || params.screenshot) {
      return {
        dom: params.dom,
        screenshot: params.screenshot,
        targetDescriptor: params.targetDescriptor,
        runtimeContext: params.runtimeContext,
      }
    }
    if (this.plugins.pageCapture && (params.pageUrl || params.html) && (params.target || params.targetDescriptor)) {
      const captured = await this.plugins.pageCapture.capture({
        pageUrl: params.pageUrl,
        html: params.html,
        target: params.target,
        targetDescriptor: params.targetDescriptor,
        runtimeContext: params.runtimeContext,
        includeInteractiveElements: false,
        captureFullPage: true,
      })
      return {
        dom: captured.dom,
        screenshot: captured.screenshotBase64,
        targetDescriptor: captured.targetDescriptor ?? params.targetDescriptor,
        runtimeContext: {
          ...params.runtimeContext,
          pageUrl: captured.pageUrl ?? params.pageUrl ?? params.runtimeContext?.pageUrl,
          mode: 'live-page',
        },
      }
    }
    return {
      targetDescriptor: params.targetDescriptor,
      runtimeContext: params.runtimeContext,
    }
  }

  private async tryImprove(input: {
    dom?: string
    screenshot?: string
    targetDescriptor?: TargetDescriptor
    locator: string
    targetHint?: string
    fingerprint?: Record<string, unknown>
    artifactRef?: string
    runtimeContext?: ReportLocatorResultRequest['runtimeContext']
  }): Promise<ReportLocatorResultResponse['improved']> {
    if (!input.dom) return undefined
    try {
      const healed = await this.healing.heal({
        dom: input.dom,
        screenshot: input.screenshot,
        platform: 'web',
        oldLocator: input.locator,
        fingerprint: input.fingerprint,
        runtimeContext: input.runtimeContext,
      })
      await this.recordHealedOutcome(input, healed.healedLocator)
      await this.appendArtifactHealedOutcome(input, healed.healedLocator)
      return {
        locator: healed.healedLocator,
        confidence: healed.confidence,
        explanation: healed.explanation,
        source: 'heal',
      }
    } catch (err) {
      this.log.debug({ err }, 'heal during feedback failed, falling back to regenerate')
    }

    if (!input.targetDescriptor && !input.targetHint) return undefined
    const generated = await this.generation.generate({
      dom: input.dom,
      screenshot: input.screenshot,
      platform: 'web',
      target: input.targetHint,
      targetDescriptor: input.targetDescriptor,
      runtimeContext: input.runtimeContext,
    })
    await this.recordHealedOutcome(input, generated.bestLocator)
    await this.appendArtifactHealedOutcome(input, generated.bestLocator)
    return {
      locator: generated.bestLocator,
      confidence: generated.confidence,
      explanation: generated.explanation,
      source: 'regenerate',
    }
  }

  private async recordHealedOutcome(
    input: {
      locator: string
      targetHint?: string
      fingerprint?: Record<string, unknown>
      artifactRef?: string
      runtimeContext?: ReportLocatorResultRequest['runtimeContext']
    },
    replacementLocator: string,
  ): Promise<void> {
    if (!this.plugins.learning) return
    await this.plugins.learning.recordOutcome({
      pageUrl: input.runtimeContext?.pageUrl,
      targetHint: input.targetHint,
      fingerprint: input.fingerprint ?? null,
      locator: input.locator,
      status: 'healed',
      replacementLocator,
    })
  }

  private async appendArtifactHealedOutcome(
    input: {
      locator: string
      artifactRef?: string
    },
    replacementLocator: string,
  ): Promise<void> {
    if (!input.artifactRef || !this.plugins.artifactStore) return
    await this.plugins.artifactStore.appendOutcome(input.artifactRef, {
      status: 'healed',
      locator: input.locator,
      improvedLocator: replacementLocator,
      recordedAt: new Date().toISOString(),
    })
  }
}

function deriveTargetHint(target?: string, descriptor?: TargetDescriptor): string | undefined {
  return target?.trim() ||
    descriptor?.text ||
    descriptor?.name ||
    descriptor?.css ||
    descriptor?.xpath ||
    descriptor?.accessibilityId ||
    descriptor?.resourceId ||
    descriptor?.role ||
    descriptor?.region ||
    undefined
}
