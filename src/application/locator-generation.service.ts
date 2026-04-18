import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { DomRepository } from '../infrastructure/parsers/dom-repository.js'
import { LocatorEngine } from '../domain/locator/locator-engine.js'
import { UniquenessEngine } from '../domain/uniqueness-engine/uniqueness-engine.js'
import { SelectorValidator } from '../domain/selector-validator/selector-validator.js'
import { TargetResolver } from '../domain/locator/target-resolver.js'
import type {
  GenerateLocatorRequest,
  GenerateLocatorResponse,
  RankedLocator,
} from '../domain/contracts/types.js'
import { DomainError } from '../utils/errors.js'
import type { PluginRegistry } from '../domain/plugin/plugin-registry.js'
import { ScreenshotAnalyzer } from '../domain/visual/screenshot-analyzer.js'
import { DOMCorrelationEngine } from '../domain/visual/dom-correlation-engine.js'
import { VisualLocatorEngine } from '../domain/visual/visual-locator-engine.js'
import { PlaywrightValidator } from '../domain/runtime/playwright-validator.js'
import { ConfidenceFusionEngine } from '../domain/confidence/confidence-fusion-engine.js'
import { SnapshotComparator, TemporalStabilityEngine } from '../domain/dynamic/index.js'
import type { OCRToken } from '../domain/contracts/ports.js'
import { fingerprintFromCheerio } from '../domain/element-fingerprint/element-fingerprint.js'
import {
  countAppiumUniqueness,
  countPlaywrightUniqueness,
} from '../domain/locator/locator-engine-runtime-uniqueness.js'

type RuntimeTraceEntry = {
  locator: string
  success: boolean
  stableOverRetries?: boolean
  attempts?: number
  score: number
}

type CandidateTemporalTraceEntry = {
  locator: string
  score: number
  uniqueSnapshots: number
  totalSnapshots: number
}

/**
 * Application orchestrator for `generate_locator` MCP tool.
 */
export class LocatorGenerationService {
  private readonly engine: LocatorEngine
  private readonly uniqueness: UniquenessEngine
  private readonly screenshot: ScreenshotAnalyzer
  private readonly correlation = new DOMCorrelationEngine()
  private readonly visualLocator = new VisualLocatorEngine()
  private readonly runtimeValidator: PlaywrightValidator
  private readonly fusion = new ConfidenceFusionEngine()
  private readonly snapshotComparator = new SnapshotComparator()
  private readonly temporalEngine = new TemporalStabilityEngine()

  constructor(
    private readonly dom: DomRepository,
    private readonly resolver: TargetResolver,
    private readonly log: LoggerPort,
    private readonly plugins: PluginRegistry,
  ) {
    const validator = new SelectorValidator()
    this.uniqueness = new UniquenessEngine(dom, validator)
    this.engine = new LocatorEngine(this.uniqueness, {
      candidateProviders: this.plugins.locatorCandidateProviders,
    })
    this.screenshot = new ScreenshotAnalyzer(this.plugins.screenshotAnalyzer)
    this.runtimeValidator = new PlaywrightValidator(this.plugins.runtimeValidator)
  }

  async generate(params: GenerateLocatorRequest): Promise<GenerateLocatorResponse> {
    const targetHint = deriveTargetHint(params)
    const source = params.dom ?? params.xml ?? params.domSnapshots?.[0] ?? params.xmlSnapshots?.[0]
    if (!source) {
      const screenshotSource = params.screenshot ?? params.screenshotSnapshots?.[0]
      if (screenshotSource) {
        return this.generateFromScreenshotOnly(params, screenshotSource, targetHint)
      }
      throw new DomainError('Provide at least one source: dom, xml, or screenshot', 'SOURCE_REQUIRED')
    }
    const mode = params.xml ? 'xml' : 'html'
    const parsed = this.dom.parse(source, mode)
    const resolved = params.targetDescriptor
      ? this.resolver.resolveDescriptor(parsed.$, parsed.xmlDoc, params.targetDescriptor) ??
        (params.target ? this.resolver.resolve(parsed.$, parsed.xmlDoc, params.target) : null)
      : this.resolver.resolve(parsed.$, parsed.xmlDoc, targetHint)
    if (!resolved) {
      throw new DomainError('Could not resolve target in DOM/XML', 'TARGET_NOT_FOUND')
    }

    this.log.info(
      { platform: params.platform, target: targetHint.slice(0, 120), mode },
      'generate_locator',
    )

    const result = this.engine.generate({
      $: parsed.$,
      xmlDoc: parsed.xmlDoc,
      target: resolved.node,
      platform: params.platform,
    })

    let visualMatch: Awaited<ReturnType<DOMCorrelationEngine['correlate']>> | null = null
    let screenshotMeta: Record<string, unknown> | undefined
    let regionAction: GenerateLocatorResponse['automation']['regionAction'] = null
    const screenshotSource = params.screenshot ?? params.screenshotSnapshots?.[0]
    if (screenshotSource) {
      const analysis = await this.screenshot.analyze(screenshotSource)
      visualMatch = this.correlation.correlate({
        targetHint,
        domText: resolved.node.text(),
        node: resolved.node,
        screenshot: analysis,
      })
      screenshotMeta = {
        width: analysis.width,
        height: analysis.height,
        tokenCount: analysis.tokens.length,
      }
      regionAction = buildRegionAction(
        params.platform,
        params.targetRegion ?? params.targetDescriptor?.region,
        targetHint,
        analysis,
        visualMatch?.bbox,
      )
    }

    const candidateTemporalTrace = this.evaluateCandidateTemporalStability(result.ranked, params, mode)
    const candidateTemporalByLocator = new Map(
      candidateTemporalTrace.map((entry) => [entry.locator, entry] as const),
    )
    const targetFingerprintRecord = targetFingerprintRecordFromNode(resolved.node)
    const learningInsights = this.plugins.learning
      ? await this.plugins.learning.getInsights({
          pageUrl: params.runtimeContext?.pageUrl,
          targetHint,
          fingerprint: targetFingerprintRecord,
        })
      : {
          preferredLocators: [],
          failedLocators: [],
          healedPairs: [],
        }
    const learningBiasByLocator = buildLearningBias(learningInsights)

    const runtimeSelection = await this.selectBestRuntimeCandidate(
      result.ranked,
      params,
      targetHint,
      candidateTemporalByLocator,
      learningBiasByLocator,
    )
    const picked = runtimeSelection.picked ?? result.best
    const runtime = runtimeSelection.runtime ?? {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['runtime selection unavailable'],
    }

    const snapshots = params.domSnapshots ?? params.xmlSnapshots ?? []
    const temporal = this.temporalEngine.evaluate(this.snapshotComparator.compare(snapshots))
    const pickedTemporal = candidateTemporalByLocator.get(picked.locator)
    const pickedTemporalScore = pickedTemporal?.score ?? (snapshots.length > 1 ? 0.5 : 1)
    const targetFingerprint = fingerprintFromCheerio(resolved.node)

    const fusedConfidence = this.fusion.fuse({
      domScore: Math.max(
        0,
        Math.min(1, picked.totalScore * (0.65 + temporal.score * 0.15 + pickedTemporalScore * 0.2)),
      ),
      visual: visualMatch,
      runtime,
    })

    const rankedFallbacks = result.ranked
      .filter((r) => r.locator !== picked.locator)
      .slice(0, 8)
      .map((r) => r.locator)
    const visualFallbacks = visualMatch
      ? this.visualLocator.generateFallbacks(visualMatch)
      : []
    const regionFallbacks = params.targetRegion ?? params.targetDescriptor?.region
      ? [`region:${params.targetRegion ?? params.targetDescriptor?.region}|target:${targetHint}`]
      : []
    const fallbacks = dedupe([...rankedFallbacks, ...visualFallbacks, ...regionFallbacks]).slice(0, 8)
    const locatorCatalog = buildCatalogFromDomRanked({
      ranked: result.ranked,
      pickedLocator: picked.locator,
      visualFallbacks,
      regionFallbacks,
      runtimeTrace: runtimeSelection.trace,
      rejected: result.rejected,
    })

    return {
      bestLocator: picked.locator,
      confidence: fusedConfidence,
      fallbacks,
      strategy: picked.strategy,
      explanation: `${result.explanation} Runtime selection: ${runtimeSelection.reason}.`,
      validation: {
        dom: picked.uniquenessMatchCount === 1,
        visual: Boolean(visualMatch && visualMatch.confidence >= 0.45),
        runtime: runtime.success && (runtime.stableOverRetries ?? true),
      },
      locatorCatalog,
      automation: {
        primary: {
          locator: picked.locator,
          strategy: picked.strategy,
          kind: picked.kind,
          snippets: asSnippetRecord(picked.metadata),
        },
        fallbacks: result.ranked
          .filter((r) => r.locator !== picked.locator)
          .slice(0, 5)
          .map((r) => ({
            locator: r.locator,
            kind: r.kind,
            snippets: asSnippetRecord(r.metadata),
          })),
        targetFingerprint: targetFingerprint
          ? { ...targetFingerprint } as Record<string, unknown>
          : null,
        runtimeContext: params.runtimeContext,
        regionAction,
      },
      metadata: {
        framework: result.framework,
        mode,
        ranked: result.ranked.map((r) => ({
          locator: r.locator,
          score: r.totalScore,
          strategy: r.strategy,
          priorityTier: r.priorityTier,
          breakdown: r.breakdown,
        })),
        rejected: result.rejected,
        bestMeta: picked.metadata,
        visualMatch,
        screenshot: screenshotMeta,
        runtime,
        runtimeSelection: runtimeSelection.trace,
        temporal,
        candidateTemporalStability: candidateTemporalTrace,
        learningInsights,
        snapshotsCompared: snapshots.length,
      },
    }
  }

  private async generateFromScreenshotOnly(
    params: GenerateLocatorRequest,
    screenshotSource: string,
    targetHint: string,
  ): Promise<GenerateLocatorResponse> {
    const analysis = await this.screenshot.analyze(screenshotSource)
    const { targetText, intent } = parseTarget(targetHint)
    const visualMatch = pickBestToken(
      analysis.tokens,
      targetText,
      params.targetRegion ?? params.targetDescriptor?.region,
      analysis.width,
      analysis.height,
    )

    const candidates = buildScreenshotOnlyCandidates(
      targetText,
      intent,
      params.platform,
      params.targetRegion ?? params.targetDescriptor?.region,
    )
    const runtimeTrace: RuntimeTraceEntry[] = []
    const learningInsights = this.plugins.learning
      ? await this.plugins.learning.getInsights({
          pageUrl: params.runtimeContext?.pageUrl,
          targetHint,
          fingerprint: params.targetDescriptor ? { ...params.targetDescriptor } as Record<string, unknown> : null,
        })
      : {
          preferredLocators: [],
          failedLocators: [],
          healedPairs: [],
        }
    const learningBiasByLocator = buildLearningBias(learningInsights)
    let picked = candidates[0] ?? `page.getByText(${JSON.stringify(targetText)})`
    let bestRuntimeScore = -1
    let bestRuntime: import('../domain/contracts/types.js').RuntimeValidation | null = null
    for (const locator of candidates.slice(0, 6)) {
      const kind = inferRuntimeKind(locator, params.platform)
      const runtimeSnapshots = runtimeSourceFromGenerateRequest(params)
      const runtime = await this.runtimeValidator.validate({
        locator,
        kind,
        domSnapshot: runtimeSnapshots.domSnapshot,
        domSnapshots: runtimeSnapshots.domSnapshots,
        targetHint,
        platform: params.platform,
        retries: 2,
        runtimeContext: params.runtimeContext,
      })
      const stable = runtime.stableOverRetries ?? runtime.success
      const runtimeFactor = runtime.success && stable ? 1 : runtime.success ? 0.6 : 0
      const visualFactor = visualMatch?.confidence ?? 0.35
      const learningFactor = learningBiasByLocator.get(locator) ?? 0
      const score = runtimeFactor * 0.55 + visualFactor * 0.35 + learningFactor * 0.1
      runtimeTrace.push({
        locator,
        success: runtime.success,
        stableOverRetries: runtime.stableOverRetries,
        attempts: runtime.attempts,
        score,
      })
      if (score > bestRuntimeScore) {
        bestRuntimeScore = score
        picked = locator
        bestRuntime = runtime
      }
    }

    const runtime = bestRuntime ?? {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['runtime unavailable in screenshot-only mode'],
    }
    const fallbackLocators = dedupe(candidates.filter((c) => c !== picked)).slice(0, 8)
    const locatorCatalog = buildCatalogFromScreenshot({
      candidates,
      pickedLocator: picked,
      runtimeTrace,
    })
    const domBase = 0.45
    const confidence = this.fusion.fuse({
      domScore: domBase,
      visual: visualMatch
        ? {
            confidence: visualMatch.confidence,
            matchedText: visualMatch.text,
            bbox: visualMatch.bbox,
            reason: visualMatch.reason,
          }
        : null,
      runtime,
    })

    return {
      bestLocator: picked,
      confidence,
      fallbacks: fallbackLocators,
      strategy: `screenshot-${intent}`,
      explanation: `Generated from screenshot-only input using OCR/intent heuristics for ${intent}.`,
      validation: {
        dom: false,
        visual: Boolean(visualMatch && visualMatch.confidence >= 0.4),
        runtime: runtime.success && (runtime.stableOverRetries ?? true),
      },
      locatorCatalog,
      automation: {
        primary: {
          locator: picked,
          strategy: `screenshot-${intent}`,
          snippets: {},
        },
        fallbacks: fallbackLocators.map((locator) => ({ locator })),
        targetFingerprint: params.targetDescriptor ? { targetDescriptor: params.targetDescriptor } : null,
        runtimeContext: params.runtimeContext,
        regionAction: buildRegionAction(
          params.platform,
          params.targetRegion ?? params.targetDescriptor?.region,
          targetHint,
          analysis,
          visualMatch?.bbox,
        ),
      },
      metadata: {
        mode: 'screenshot-only',
        intent,
        targetText,
        screenshot: {
          width: analysis.width,
          height: analysis.height,
          tokenCount: analysis.tokens.length,
        },
        visualMatch,
        runtime,
        runtimeSelection: runtimeTrace,
        learningInsights,
      },
    }
  }

  private evaluateCandidateTemporalStability(
    ranked: Array<{
      locator: string
      kind: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
    }>,
    params: GenerateLocatorRequest,
    mode: 'html' | 'xml',
  ): CandidateTemporalTraceEntry[] {
    const snapshots = mode === 'xml'
      ? params.xmlSnapshots ?? (params.xml ? [params.xml] : [])
      : params.domSnapshots ?? (params.dom ? [params.dom] : [])
    if (snapshots.length <= 1) return []

    return ranked.slice(0, 8).map((candidate) => {
      let uniqueSnapshots = 0
      for (const snapshot of snapshots) {
        const parsed = this.dom.parse(snapshot, mode)
        const matches = countCandidateMatches(
          candidate.locator,
          normalizeKind(candidate.kind),
          parsed.$,
          parsed.xmlDoc,
          this.uniqueness,
        )
        if (matches === 1) uniqueSnapshots += 1
      }
      return {
        locator: candidate.locator,
        score: uniqueSnapshots / snapshots.length,
        uniqueSnapshots,
        totalSnapshots: snapshots.length,
      }
    })
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
    params: GenerateLocatorRequest,
    targetHint: string,
    candidateTemporalByLocator: Map<string, CandidateTemporalTraceEntry>,
    learningBiasByLocator: Map<string, number>,
  ): Promise<{
    picked: (typeof ranked)[number] | null
    runtime: import('../domain/contracts/types.js').RuntimeValidation | null
    reason: string
    trace: RuntimeTraceEntry[]
  }> {
    const candidates = ranked.slice(0, 8)
    const trace: RuntimeTraceEntry[] = []
    let best: (typeof ranked)[number] | null = null
    let bestRuntime: import('../domain/contracts/types.js').RuntimeValidation | null = null
    let bestScore = -1

    for (const c of candidates) {
      const runtimeSnapshots = runtimeSourceFromGenerateRequest(params)
      const runtime = await this.runtimeValidator.validate({
        locator: c.locator,
        kind: normalizeKind(c.kind),
        domSnapshot: runtimeSnapshots.domSnapshot,
        domSnapshots: runtimeSnapshots.domSnapshots,
        targetHint,
        platform: params.platform,
        retries: 3,
        runtimeContext: params.runtimeContext,
      })
      const stable = runtime.stableOverRetries ?? runtime.success
      const runtimeFactor = runtime.success && stable ? 1 : runtime.success ? 0.6 : 0
      const temporalFactor = candidateTemporalByLocator.get(c.locator)?.score ?? 1
      const learningFactor = learningBiasByLocator.get(c.locator) ?? 0
      const combined = c.totalScore * 0.5 + runtimeFactor * 0.22 + temporalFactor * 0.18 + learningFactor * 0.1
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
      return {
        picked: null,
        runtime: null,
        reason: 'no ranked candidates available',
        trace,
      }
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

function normalizeKind(
  kind: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role',
): 'css' | 'xpath' | 'playwright' | 'appium' {
  if (kind === 'css' || kind === 'xpath' || kind === 'playwright' || kind === 'appium') {
    return kind
  }
  return 'playwright'
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

function parseTarget(target: string): { targetText: string; intent: 'button' | 'tab' | 'toggle' | 'input' | 'dropdown' | 'placeholder' | 'generic' } {
  const t = target.trim()
  const low = t.toLowerCase()
  const targetText = t.replace(/^(text:|target:|label:)/i, '').trim()
  if (/\bbutton\b|\bbuy\b|\bsell\b|\bsubmit\b/.test(low)) return { targetText, intent: 'button' }
  if (/\btab\b/.test(low)) return { targetText, intent: 'tab' }
  if (/\btoggle\b|\bswitch\b/.test(low)) return { targetText, intent: 'toggle' }
  if (/\binput\b|\bfield\b/.test(low)) return { targetText, intent: 'input' }
  if (/\bdropdown\b|\bselect\b/.test(low)) return { targetText, intent: 'dropdown' }
  if (/\bplaceholder\b/.test(low)) return { targetText, intent: 'placeholder' }
  return { targetText, intent: 'generic' }
}

function pickBestToken(
  tokens: OCRToken[],
  targetText: string,
  targetRegion?: string,
  width?: number,
  height?: number,
): { confidence: number; text: string; bbox: { x: number; y: number; width: number; height: number }; reason: string } | null {
  const needle = targetText.toLowerCase().trim()
  if (!needle) return null
  let best: { confidence: number; text: string; bbox: { x: number; y: number; width: number; height: number }; reason: string } | null = null
  for (const tk of tokens) {
    const txt = tk.text.toLowerCase().trim()
    if (!txt) continue
    const overlap = txt === needle ? 1 : txt.includes(needle) || needle.includes(txt) ? 0.8 : wordOverlap(txt, needle)
    const regionFactor = targetRegion && width && height
      ? scoreRegionBias(tk.bbox, targetRegion, width, height)
      : 1
    const score = (overlap * 0.7 + tk.confidence * 0.3) * regionFactor
    if (!best || score > best.confidence) {
      best = {
        confidence: Math.max(0, Math.min(1, score)),
        text: tk.text,
        bbox: tk.bbox,
        reason: `ocr token match "${tk.text}"${targetRegion ? ` near ${targetRegion}` : ''}`,
      }
    }
  }
  return best
}

function buildScreenshotOnlyCandidates(
  targetText: string,
  intent: 'button' | 'tab' | 'toggle' | 'input' | 'dropdown' | 'placeholder' | 'generic',
  platform: 'web' | 'android' | 'ios',
  targetRegion?: string,
): string[] {
  const q = JSON.stringify(targetText || 'target')
  const out: string[] = []
  if (platform === 'web') {
    if (intent === 'button') out.push(`page.getByRole('button', { name: ${q} })`)
    if (intent === 'tab') out.push(`page.getByRole('tab', { name: ${q} })`)
    if (intent === 'toggle') out.push(`page.getByRole('switch', { name: ${q} })`)
    if (intent === 'input') out.push(`page.getByRole('textbox', { name: ${q} })`)
    if (intent === 'dropdown') out.push(`page.getByRole('combobox', { name: ${q} })`)
    if (intent === 'placeholder') out.push(`page.getByPlaceholder(${q})`)
    out.push(`page.getByText(${q})`)
    out.push(`//*[contains(normalize-space(.), ${toXPathLiteral(targetText || 'target')})]`)
  } else {
    out.push(`AppiumBy.accessibilityId(${q})`)
    out.push(`//*[contains(@content-desc, ${toXPathLiteral(targetText || 'target')}) or contains(@name, ${toXPathLiteral(targetText || 'target')}) or contains(@label, ${toXPathLiteral(targetText || 'target')})]`)
  }
  if (targetRegion) {
    out.push(`region:${targetRegion}|target:${targetText || intent}`)
  }
  return dedupe(out)
}

function toXPathLiteral(v: string): string {
  if (!v.includes("'")) return `'${v}'`
  if (!v.includes('"')) return `"${v}"`
  const parts = v.split("'")
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) out.push(`'${parts[i]}'`)
    if (i < parts.length - 1) out.push(`"'"`)
  }
  return `concat(${out.join(', ')})`
}

function wordOverlap(a: string, b: string): number {
  const as = new Set(a.split(/\s+/).filter(Boolean))
  const bs = new Set(b.split(/\s+/).filter(Boolean))
  if (!as.size || !bs.size) return 0
  let inter = 0
  for (const w of as) if (bs.has(w)) inter += 1
  return inter / new Set([...as, ...bs]).size
}

function runtimeSourceFromGenerateRequest(
  params: GenerateLocatorRequest,
): { domSnapshot?: string; domSnapshots?: string[] } {
  const snapshots = params.domSnapshots?.length
    ? params.domSnapshots
    : params.xmlSnapshots?.length
      ? params.xmlSnapshots
      : undefined
  return {
    domSnapshot: params.dom ?? params.xml,
    domSnapshots: snapshots,
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

function countCandidateMatches(
  locator: string,
  kind: 'css' | 'xpath' | 'playwright' | 'appium',
  $: import('cheerio').CheerioAPI,
  xmlDoc: globalThis.Document,
  uniqueness: UniquenessEngine,
): number {
  if (kind === 'css') return uniqueness.count('css', locator, $, xmlDoc)
  if (kind === 'xpath') return uniqueness.count('xpath', locator, $, xmlDoc)
  if (kind === 'playwright') return countPlaywrightUniqueness(locator, $, uniqueness)
  return countAppiumUniqueness(locator, $, xmlDoc, uniqueness)
}

function deriveTargetHint(params: GenerateLocatorRequest): string {
  if (params.target?.trim()) return params.target.trim()
  const descriptor = params.targetDescriptor
  if (!descriptor) {
    throw new DomainError('target or targetDescriptor required', 'TARGET_REQUIRED')
  }
  return descriptor.text ??
    descriptor.name ??
    descriptor.css ??
    descriptor.xpath ??
    descriptor.accessibilityId ??
    descriptor.resourceId ??
    descriptor.iosName ??
    descriptor.role ??
    descriptor.region ??
    'target'
}

function asSnippetRecord(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const snippets = metadata.snippets
  return snippets && typeof snippets === 'object' && !Array.isArray(snippets)
    ? snippets as Record<string, unknown>
    : undefined
}

function targetFingerprintRecordFromNode(
  node: import('cheerio').Cheerio<any>,
): Record<string, unknown> | null {
  const fingerprint = fingerprintFromCheerio(node as any)
  return fingerprint ? { ...fingerprint } as Record<string, unknown> : null
}

function buildLearningBias(insights: {
  preferredLocators: string[]
  failedLocators: string[]
  healedPairs: Array<{ from: string; to: string }>
}): Map<string, number> {
  const bias = new Map<string, number>()
  insights.preferredLocators.forEach((locator, index) => {
    const value = Math.max(0.08, 0.18 - index * 0.02)
    bias.set(locator, Math.max(bias.get(locator) ?? 0, value))
  })
  insights.failedLocators.forEach((locator, index) => {
    const penalty = Math.max(-0.2, -0.12 + index * 0.01)
    bias.set(locator, Math.min(bias.get(locator) ?? 0, penalty))
  })
  insights.healedPairs.forEach((pair, index) => {
    const promote = Math.max(0.1, 0.2 - index * 0.02)
    bias.set(pair.to, Math.max(bias.get(pair.to) ?? 0, promote))
    bias.set(pair.from, Math.min(bias.get(pair.from) ?? 0, -0.18))
  })
  return bias
}

function buildRegionAction(
  platform: 'web' | 'android' | 'ios',
  targetRegion: string | undefined,
  targetHint: string,
  screenshot: { width: number; height: number },
  bbox?: { x: number; y: number; width: number; height: number },
): GenerateLocatorResponse['automation']['regionAction'] {
  const region = targetRegion?.trim()
  if (!region && !bbox) return null
  const point = bbox
    ? {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      }
    : regionCenter(region ?? 'center', screenshot.width, screenshot.height)
  const position = `{ x: ${Math.round(point.x)}, y: ${Math.round(point.y)} }`
  const target = targetHint || region || 'target'

  if (platform === 'web') {
    return {
      description: bbox
        ? `Canvas/SVG fallback action for "${target}" using OCR-aligned position.`
        : `Region fallback action for "${target}" in ${region}.`,
      playwright: `await page.locator('canvas, svg').first().click({ position: ${position} })`,
      bbox,
    }
  }

  return {
    description: bbox
      ? `Mobile visual fallback action for "${target}" using OCR-aligned position.`
      : `Mobile region fallback action for "${target}" in ${region}.`,
    appium: `await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: ${Math.round(point.x)}, y: ${Math.round(point.y)} }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 }] }])`,
    bbox,
  }
}

function scoreRegionBias(
  bbox: { x: number; y: number; width: number; height: number },
  targetRegion: string,
  width: number,
  height: number,
): number {
  const desired = regionCenter(targetRegion, width, height)
  const center = {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  }
  const dx = center.x - desired.x
  const dy = center.y - desired.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const maxDistance = Math.sqrt(width * width + height * height)
  return Math.max(0.55, 1 - distance / Math.max(maxDistance, 1))
}

function regionCenter(region: string, width: number, height: number): { x: number; y: number } {
  const normalized = region.toLowerCase().trim()
  const left = width * 0.25
  const centerX = width * 0.5
  const right = width * 0.75
  const top = height * 0.25
  const centerY = height * 0.5
  const bottom = height * 0.75

  if (normalized === 'top-left') return { x: left, y: top }
  if (normalized === 'top-right') return { x: right, y: top }
  if (normalized === 'bottom-left') return { x: left, y: bottom }
  if (normalized === 'bottom-right') return { x: right, y: bottom }
  if (normalized === 'left') return { x: left, y: centerY }
  if (normalized === 'right') return { x: right, y: centerY }
  if (normalized === 'top') return { x: centerX, y: top }
  if (normalized === 'bottom') return { x: centerX, y: bottom }
  return { x: centerX, y: centerY }
}

function buildCatalogFromDomRanked(input: {
  ranked: RankedLocator[]
  pickedLocator: string
  visualFallbacks: string[]
  regionFallbacks: string[]
  runtimeTrace: RuntimeTraceEntry[]
  rejected: Array<{ locator: string; reason: string }>
}): GenerateLocatorResponse['locatorCatalog'] {
  const runtimeByLocator = new Map(
    input.runtimeTrace.map((t) => [t.locator, t] as const),
  )
  const items: GenerateLocatorResponse['locatorCatalog']['items'] = []
  const seen = new Set<string>()

  for (const r of input.ranked) {
    if (seen.has(r.locator)) continue
    seen.add(r.locator)
    const runtime = runtimeByLocator.get(r.locator)
    items.push({
      rank: 0,
      locator: r.locator,
      category: r.locator === input.pickedLocator ? 'best' : 'fallback',
      source: 'dom-ranked',
      strategy: r.strategy,
      kind: r.kind,
      score: r.totalScore,
      uniquenessMatchCount: r.uniquenessMatchCount,
      runtimeSuccess: runtime?.success,
      runtimeStableOverRetries: runtime?.stableOverRetries,
      runtimeAttempts: runtime?.attempts,
    })
  }

  for (const locator of input.visualFallbacks) {
    if (seen.has(locator)) continue
    seen.add(locator)
    items.push({
      rank: 0,
      locator,
      category: 'fallback',
      source: 'visual',
    })
  }

  for (const locator of input.regionFallbacks) {
    if (seen.has(locator)) continue
    seen.add(locator)
    items.push({
      rank: 0,
      locator,
      category: 'fallback',
      source: 'region',
    })
  }

  assignReadableRanks(items)
  return {
    total: items.length,
    items,
    rejected: input.rejected,
  }
}

function buildCatalogFromScreenshot(input: {
  candidates: string[]
  pickedLocator: string
  runtimeTrace: RuntimeTraceEntry[]
}): GenerateLocatorResponse['locatorCatalog'] {
  const runtimeByLocator = new Map(
    input.runtimeTrace.map((t) => [t.locator, t] as const),
  )
  const items: GenerateLocatorResponse['locatorCatalog']['items'] = input.candidates.map((locator) => {
    const runtime = runtimeByLocator.get(locator)
    return {
      rank: 0,
      locator,
      category: locator === input.pickedLocator ? 'best' : 'fallback',
      source: 'screenshot-heuristic',
      strategy: 'screenshot-heuristic',
      score: runtime?.score,
      runtimeSuccess: runtime?.success,
      runtimeStableOverRetries: runtime?.stableOverRetries,
      runtimeAttempts: runtime?.attempts,
    }
  })
  assignReadableRanks(items)
  return {
    total: items.length,
    items,
    rejected: [],
  }
}

function assignReadableRanks(items: GenerateLocatorResponse['locatorCatalog']['items']): void {
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'best' ? -1 : 1
    const aScore = a.score ?? -1
    const bScore = b.score ?? -1
    return bScore - aScore
  })
  for (let i = 0; i < items.length; i++) {
    items[i].rank = i + 1
  }
}
