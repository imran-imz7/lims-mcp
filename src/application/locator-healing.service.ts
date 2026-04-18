import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { DomRepository } from '../infrastructure/parsers/dom-repository.js'
import { SimilarityEngine } from '../domain/similarity-engine/similarity-engine.js'
import { fingerprintFromUnknownPayload } from '../domain/element-fingerprint/element-fingerprint.js'
import { LocatorEngine } from '../domain/locator/locator-engine.js'
import { UniquenessEngine } from '../domain/uniqueness-engine/uniqueness-engine.js'
import { SelectorValidator } from '../domain/selector-validator/selector-validator.js'
import { TargetResolver } from '../domain/locator/target-resolver.js'
import { DomainError } from '../utils/errors.js'
import type { PluginRegistry } from '../domain/plugin/plugin-registry.js'
import { ScreenshotAnalyzer } from '../domain/visual/screenshot-analyzer.js'
import { DOMCorrelationEngine } from '../domain/visual/dom-correlation-engine.js'
import { PlaywrightValidator } from '../domain/runtime/playwright-validator.js'
import { ConfidenceFusionEngine } from '../domain/confidence/confidence-fusion-engine.js'
import type { HealLocatorRequest } from '../domain/contracts/types.js'

/**
 * Orchestrates healing: prefer exact old locator on new DOM; else fingerprint similarity (AGENTS.md).
 */
export class LocatorHealingService {
  private readonly similarity = new SimilarityEngine()
  private readonly engine: LocatorEngine
  private readonly screenshot: ScreenshotAnalyzer
  private readonly correlation = new DOMCorrelationEngine()
  private readonly runtimeValidator: PlaywrightValidator
  private readonly fusion = new ConfidenceFusionEngine()

  constructor(
    private readonly dom: DomRepository,
    private readonly resolver: TargetResolver,
    private readonly log: LoggerPort,
    private readonly plugins: PluginRegistry,
  ) {
    const uniqueness = new UniquenessEngine(dom, new SelectorValidator())
    this.engine = new LocatorEngine(uniqueness, {
      candidateProviders: this.plugins.locatorCandidateProviders,
    })
    this.screenshot = new ScreenshotAnalyzer(this.plugins.screenshotAnalyzer)
    this.runtimeValidator = new PlaywrightValidator(this.plugins.runtimeValidator)
  }

  async heal(params: HealLocatorRequest) {
    const platform = resolveHealPlatform(params)
    const source = params.dom ?? params.xml
    if (!source) {
      const screenshot = params.screenshot ?? params.screenshotSnapshots?.[0]
      if (screenshot) {
        return this.healFromScreenshotOnly(params, screenshot, platform)
      }
      throw new DomainError('Provide at least one source: dom, xml, or screenshot', 'SOURCE_REQUIRED')
    }
    const mode = params.xml ? 'xml' : 'html'
    const parsed = this.dom.parse(source, mode)
    const { $, xmlDoc } = parsed

    const stillUnique = this.resolver.resolveIfUnique($, xmlDoc, params.oldLocator)
    if (stillUnique) {
      const gen = this.engine.generate({
        $,
        xmlDoc,
        target: stillUnique.node,
        platform,
      })
      this.log.info({ path: 'old_locator_still_unique' }, 'heal_locator')

      const auto = await this.selectBestRuntimeCandidate(
        gen.ranked,
        params,
        platform,
      )
      const picked = auto.picked ?? gen.best
      const runtime = auto.runtime ?? {
        executed: false,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['runtime selection unavailable'],
      }

      const visualMatch = await computeVisualMatch(
        params.screenshot ?? params.screenshotSnapshots?.[0],
        this.screenshot,
        this.correlation,
        stillUnique.node.text(),
        stillUnique.node,
        params.oldLocator,
      )
      return {
        healedLocator: picked.locator,
        confidence: this.fusion.fuse({
          domScore: picked.totalScore * 0.92 + 0.08,
          visual: visualMatch,
          runtime,
        }),
        explanation: `Previous locator still resolves uniquely; regenerated candidates for stability. ${gen.explanation} Runtime selection: ${auto.reason}.`,
        diff: {
          old: params.oldLocator,
          new: picked.locator,
          path: 'revalidate',
          runtime,
          runtimeContext: params.runtimeContext,
          visualMatch,
          runtimeSelection: auto.trace,
        },
      }
    }

    const fp =
      params.fingerprint !== undefined && params.fingerprint !== null
        ? fingerprintFromUnknownPayload(params.fingerprint)
        : null

    if (!fp) {
      throw new DomainError(
        'Provide fingerprint when old locator does not resolve uniquely, or capture element snapshot before DOM change',
        'FINGERPRINT_REQUIRED',
      )
    }

    const candidates = $('*').filter((_i, el) => el.type === 'tag') as cheerio.Cheerio<Element>

    const match = this.similarity.bestMatch(fp, candidates, $)
    if (!match || match.score < 0.35) {
      throw new DomainError('No sufficiently similar element for healing', 'HEAL_NO_MATCH', {
        bestScore: match?.score,
      })
    }

    const gen = this.engine.generate({
      $,
      xmlDoc,
      target: match.node,
      platform,
    })

    this.log.info({ score: match.score, oldLocator: params.oldLocator.slice(0, 120) }, 'heal_locator')

    const auto = await this.selectBestRuntimeCandidate(
      gen.ranked,
      params,
      platform,
    )
    const picked = auto.picked ?? gen.best
    const runtime = auto.runtime ?? {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['runtime selection unavailable'],
    }
    const visualMatch = await computeVisualMatch(
      params.screenshot ?? params.screenshotSnapshots?.[0],
      this.screenshot,
      this.correlation,
      match.node.text(),
      match.node,
      params.oldLocator,
    )

    return {
      healedLocator: picked.locator,
      confidence: this.fusion.fuse({
        domScore: picked.totalScore * 0.65 + match.score * 0.35,
        visual: visualMatch,
        runtime,
      }),
      explanation: `Healed using similarity (${match.explanation.join(
        ', ',
      )}). Old locator not usable alone; regenerated from closest twin. ${gen.explanation} Runtime selection: ${auto.reason}.`,
      diff: {
        old: params.oldLocator,
        new: picked.locator,
        similaritySignals: match.explanation,
        fingerprintTag: fp.tag,
        runtime,
        runtimeContext: params.runtimeContext,
        visualMatch,
        runtimeSelection: auto.trace,
      },
    }
  }

  private async healFromScreenshotOnly(
    params: HealLocatorRequest,
    screenshot: string,
    platform: 'web' | 'android' | 'ios',
  ) {
    const analysis = await this.screenshot.analyze(screenshot)
    const fpText =
      params.fingerprint && typeof params.fingerprint === 'object' && 'text' in params.fingerprint
        ? String((params.fingerprint as Record<string, unknown>).text ?? '')
        : ''
    const targetHint = fpText || params.oldLocator
    const bestToken = analysis.tokens
      .map((t) => ({
        token: t,
        score: t.text.toLowerCase().includes(targetHint.toLowerCase()) ? 1 : t.confidence * 0.5,
      }))
      .sort((a, b) => b.score - a.score)[0]

    const runtime = await this.runtimeValidator.validate({
      locator: params.oldLocator,
      kind: inferRuntimeKind(params.oldLocator, platform),
      domSnapshot: runtimeSourceFromHealRequest(params).domSnapshot,
      domSnapshots: runtimeSourceFromHealRequest(params).domSnapshots,
      targetHint,
      platform,
      retries: 2,
      runtimeContext: params.runtimeContext,
    })
    const visualBonus = bestToken ? Math.min(1, bestToken.score) : 0.35
    const confidence = this.fusion.fuse({
      domScore: 0.42,
      visual: bestToken
        ? {
            confidence: visualBonus,
            matchedText: bestToken.token.text,
            bbox: bestToken.token.bbox,
            reason: 'screenshot-only token alignment',
          }
        : null,
      runtime,
    })

    return {
      healedLocator: params.oldLocator,
      confidence,
      explanation: 'Screenshot-only healing keeps previous locator and re-validates with visual/runtime signals.',
      diff: {
        old: params.oldLocator,
        new: params.oldLocator,
        path: 'screenshot_only_revalidate',
        runtime,
        runtimeContext: params.runtimeContext,
        visualMatch: bestToken
          ? {
              confidence: visualBonus,
              matchedText: bestToken.token.text,
              bbox: bestToken.token.bbox,
              reason: 'screenshot-only token alignment',
            }
          : null,
      },
    }
  }

  private async selectBestRuntimeCandidate(
    ranked: Array<{
      locator: string
      kind: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
      totalScore: number
      uniquenessMatchCount: number
      strategy: string
      priorityTier: number
      metadata: Record<string, unknown>
      readabilityScore: number
      stabilityScore: number
      breakdown: Record<string, number>
    }>,
    params: HealLocatorRequest,
    platform: 'web' | 'android' | 'ios',
  ): Promise<{
    picked: (typeof ranked)[number] | null
    runtime: import('../domain/contracts/types.js').RuntimeValidation | null
    reason: string
    trace: Array<{
      locator: string
      success: boolean
      stableOverRetries?: boolean
      attempts?: number
      score: number
    }>
  }> {
    const candidates = ranked.slice(0, 8)
    const trace: Array<{
      locator: string
      success: boolean
      stableOverRetries?: boolean
      attempts?: number
      score: number
    }> = []
    let best: (typeof ranked)[number] | null = null
    let bestRuntime: import('../domain/contracts/types.js').RuntimeValidation | null = null
    let bestScore = -1
    for (const c of candidates) {
      const runtimeSnapshots = runtimeSourceFromHealRequest(params)
      const runtime = await this.runtimeValidator.validate({
        locator: c.locator,
        kind: normalizeKind(c.kind),
        domSnapshot: runtimeSnapshots.domSnapshot,
        domSnapshots: runtimeSnapshots.domSnapshots,
        targetHint: params.oldLocator,
        platform,
        retries: 3,
        runtimeContext: params.runtimeContext,
      })
      const stable = runtime.stableOverRetries ?? runtime.success
      const runtimeFactor = runtime.success && stable ? 1 : runtime.success ? 0.6 : 0
      const combined = c.totalScore * 0.7 + runtimeFactor * 0.3
      trace.push({
        locator: c.locator,
        success: runtime.success,
        stableOverRetries: runtime.stableOverRetries,
        attempts: runtime.attempts,
        score: combined,
      })
      if (combined > bestScore) {
        best = c
        bestRuntime = runtime
        bestScore = combined
      }
    }

    if (!best) {
      return { picked: null, runtime: null, reason: 'no ranked candidates available', trace }
    }
    const passed = trace.find((t) => t.locator === best!.locator)
    return {
      picked: best,
      runtime: bestRuntime,
      reason: passed?.success ? 'best runtime-validated candidate selected automatically' : 'no runtime pass; selected highest combined score',
      trace,
    }
  }
}

async function computeVisualMatch(
  screenshot: string | undefined,
  analyzer: ScreenshotAnalyzer,
  correlation: DOMCorrelationEngine,
  domText: string,
  node: cheerio.Cheerio<Element>,
  targetHint: string,
) {
  if (!screenshot) return null
  const analysis = await analyzer.analyze(screenshot)
  return correlation.correlate({
    domText,
    node,
    screenshot: analysis,
    targetHint,
  })
}

function normalizeKind(
  kind: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role',
): 'css' | 'xpath' | 'playwright' | 'appium' {
  if (kind === 'css' || kind === 'xpath' || kind === 'playwright' || kind === 'appium') {
    return kind
  }
  return 'playwright'
}

function runtimeSourceFromHealRequest(
  params: HealLocatorRequest,
): { domSnapshot?: string; domSnapshots?: string[] } {
  return {
    domSnapshot: params.dom ?? params.xml,
    domSnapshots: params.domSnapshots?.length ? params.domSnapshots : undefined,
  }
}

function inferRuntimeKind(
  locator: string,
  platform: 'web' | 'android' | 'ios',
): 'css' | 'xpath' | 'playwright' | 'appium' {
  if (locator.startsWith('//') || locator.startsWith('(//')) return 'xpath'
  if (platform !== 'web' || locator.startsWith('AppiumBy.')) return 'appium'
  return 'playwright'
}

function resolveHealPlatform(params: HealLocatorRequest): 'web' | 'android' | 'ios' {
  if (params.platform) return params.platform
  if (params.xml && /XCUIElementType|xcuielementtype/i.test(params.xml)) return 'ios'
  if (params.oldLocator.includes('@label') || params.oldLocator.includes('@name')) return 'ios'
  if (params.oldLocator.startsWith('AppiumBy.')) return 'android'
  if (params.xml) return 'android'
  return 'web'
}
