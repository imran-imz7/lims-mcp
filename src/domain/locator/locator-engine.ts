import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { LocatorCandidate, GenerationResult, Platform } from '../contracts/types.js'
import { CssBuilder, escapeCssAttrValue } from '../css-builder/css-builder.js'
import { XPathBuilder } from '../xpath-builder/xpath-builder.js'
import { AttributeStabilityAnalyzer } from '../attribute-stability/attribute-stability-analyzer.js'
import { RelativeLocatorEngine } from '../relative-locator-engine/relative-locator-engine.js'
import { UniquenessEngine } from '../uniqueness-engine/uniqueness-engine.js'
import { RankingEngine } from '../ranking-engine/ranking-engine.js'
import { FrameworkDetector, type FrameworkProfile } from '../framework-detector/framework-detector.js'
import { HeuristicsEngine } from '../heuristics/heuristics-engine.js'
import { emitPlatformSnippets } from './multi-platform-codegen.js'
import { LOCATOR_PRIORITY_TIERS, frameworkStabilityBoost } from '../../utils/locator-priority.js'
import { DomainError } from '../../utils/errors.js'
import {
  collectTradingHints,
  isHighlyDynamicTradingText,
  isLikelyTradingSymbol,
  mobileTradingAttributes,
} from '../trading/trading-ui-support.js'
import {
  nearestRowLikeContainer,
  platformPrimaryAttributes,
  platformSemanticAttributes,
} from './ui-pattern-intelligence.js'
import {
  countAppiumUniqueness,
  countPlaywrightUniqueness,
} from './locator-engine-runtime-uniqueness.js'
import {
  genericChildAttr,
  genericChildSelector,
  nearestTradingAnchor,
  nearestTradingSymbolContext,
  tradingChildAttr,
  tradingChildSelector,
} from './locator-engine-trading-helpers.js'
import { safeXPathLiteral, splitStablePattern, stableTextTokens } from './locator-engine-patterns.js'
import type { LocatorCandidateProvider, LocatorGenerationContext } from './locator-extension.js'

/**
 * Multi-strategy generation, uniqueness validation, ranking (domain only).
 * Candidate preference follows AGENTS.md § Locator strategy rules.
 */
export class LocatorEngine {
  private readonly stability = new AttributeStabilityAnalyzer()
  private readonly heuristics: HeuristicsEngine
  private readonly css: CssBuilder
  private readonly xpath: XPathBuilder
  private readonly relative: RelativeLocatorEngine
  private readonly ranking: RankingEngine
  private readonly candidateProviders: LocatorCandidateProvider[]

  constructor(
    private readonly uniqueness: UniquenessEngine,
    deps?: {
      css?: CssBuilder
      xpath?: XPathBuilder
      relative?: RelativeLocatorEngine
      ranking?: RankingEngine
      candidateProviders?: LocatorCandidateProvider[]
    },
  ) {
    this.css = deps?.css ?? new CssBuilder()
    this.xpath = deps?.xpath ?? new XPathBuilder()
    this.relative = deps?.relative ?? new RelativeLocatorEngine()
    this.ranking = deps?.ranking ?? new RankingEngine()
    this.candidateProviders = deps?.candidateProviders ?? []
    this.heuristics = new HeuristicsEngine(this.stability)
  }

  generate(params: {
    $: cheerio.CheerioAPI
    xmlDoc: globalThis.Document
    target: cheerio.Cheerio<Element>
    platform: Platform
  }): GenerationResult {
    const { $, xmlDoc, target, platform } = params
    const frameworkDetector = new FrameworkDetector()
    const fw = frameworkDetector.detect($)
    const rejected: Array<{ locator: string; reason: string }> = []
    const candidates: LocatorCandidate[] = []
    const seen = new Set<string>()

    const tag = (target.get(0)?.name ?? 'div').toLowerCase()
    const attrs = target.get(0)?.attribs ?? {}
    const tradingHints = collectTradingHints(attrs, target.text())
    const tradingAnchor = nearestTradingAnchor(target)
    const tradingSymbolCtx = nearestTradingSymbolContext(target, $)
    const rowLikeAnchor = platform === 'web' ? nearestRowLikeContainer(target, $) : null

    const push = (c: Omit<LocatorCandidate, 'metadata' | 'priorityTier'> & { metadata?: Record<string, unknown>; priorityTier: number }) => {
      const sig = `${c.kind}::${c.locator}`
      if (seen.has(sig)) return
      seen.add(sig)
      candidates.push({
        priorityTier: c.priorityTier,
        metadata: {
          ...c.metadata,
          snippets: emitPlatformSnippets({
            platform,
            kind: c.kind,
            locator: c.locator,
            role: typeof attrs.role === 'string' ? attrs.role : undefined,
            name: target.text().trim().slice(0, 80) || attrs['aria-label'],
            accessibilityId:
              attrs['data-testid'] ??
              attrs['data-test'] ??
              attrs['data-qa'] ??
              attrs['content-desc'] ??
              attrs['name'] ??
              attrs['id'],
          }),
        },
        locator: c.locator,
        kind: c.kind,
        strategy: c.strategy,
        stabilityScore: c.stabilityScore,
        readabilityScore: c.readabilityScore,
      })
    }

    const attrScore = (name: string, value: string) => this.stability.analyzeNameAndValue(name, value)
    const accept = (name: string, value: string) => this.heuristics.attributeAcceptable(name, value)
    const boost = (name: string, base: number) => frameworkStabilityBoost(base, name, fw.recommendedAttributes)

    /* Tier 1 — data-testid, data-test, data-qa */
    for (const attr of ['data-testid', 'data-test', 'data-qa'] as const) {
      const raw = attrs[attr]
      if (!raw || !accept(attr, raw)) continue
      const sc = boost(attr, attrScore(attr, raw).score)
      push({
        locator: this.css.byAttributeEquals(tag, attr, raw),
        kind: 'css',
        strategy: 'hybrid',
        stabilityScore: sc,
        readabilityScore: 0.96,
        priorityTier: LOCATOR_PRIORITY_TIERS.TEST_ATTRIBUTE,
        metadata: { attribute: attr },
      })
      push({
        locator: this.xpath.byAttributeEquals(tag, attr, raw),
        kind: 'xpath',
        strategy: 'xpath',
        stabilityScore: sc * 0.92,
        readabilityScore: 0.78,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { attribute: attr, note: 'XPath sister to CSS test attribute' },
      })
    }

    /* Tier 1b — common automation attributes in heterogeneous frontends */
    if (platform === 'web') {
      for (const attr of platformPrimaryAttributes(platform)) {
        if (['data-testid', 'data-test', 'data-qa'].includes(attr)) continue
        const raw = attrs[attr]
        if (!raw || !accept(attr, raw)) continue
        const sc = boost(attr, attrScore(attr, raw).score)
        push({
          locator: this.css.byAttributeEquals(tag, attr, raw),
          kind: 'css',
          strategy: 'hybrid',
          stabilityScore: sc,
          readabilityScore: 0.9,
          priorityTier: LOCATOR_PRIORITY_TIERS.TEST_ATTRIBUTE,
          metadata: { attribute: attr, genericUiPattern: true },
        })
        push({
          locator: this.xpath.byAttributeEquals(tag, attr, raw),
          kind: 'xpath',
          strategy: 'xpath',
          stabilityScore: sc * 0.9,
          readabilityScore: 0.74,
          priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
          metadata: { attribute: attr, genericUiPattern: true },
        })
      }
    }

    /* Tier 2 — accessibility */
    if (platform === 'android' || platform === 'ios') {
      const a11y = attrs['content-desc'] ?? attrs['accessibility-id'] ?? attrs['name']
      if (a11y && accept('accessibility', a11y)) {
        push({
          locator: `AppiumBy.accessibilityId(${JSON.stringify(a11y)})`,
          kind: 'appium',
          strategy: 'appium',
          stabilityScore: boost('content-desc', attrScore('aria-label', a11y).score),
          readabilityScore: 0.84,
          priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
          metadata: { platform },
        })
      }
    }

    if (attrs['aria-label'] && accept('aria-label', attrs['aria-label'])) {
      const al = attrs['aria-label']
      push({
        locator: `${tag}[aria-label="${escapeCssAttrValue(al)}"]`,
        kind: 'css',
        strategy: 'accessibility',
        stabilityScore: boost('aria-label', attrScore('aria-label', al).score),
        readabilityScore: 0.9,
        priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
        metadata: { attribute: 'aria-label' },
      })
      push({
        locator: `page.getByRole('${attrs.role ?? 'generic'}', { name: ${JSON.stringify(al)} })`,
        kind: 'playwright',
        strategy: 'role',
        stabilityScore: boost('aria-label', attrScore('aria-label', al).score),
        readabilityScore: 0.93,
        priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
        metadata: { attribute: 'aria-label' },
      })
    }

    /* Tier 2b — platform semantic attributes */
    for (const attr of platformSemanticAttributes(platform)) {
      const raw = attrs[attr]
      if (!raw || !accept(attr, raw)) continue
      if (attr === 'text' && isHighlyDynamicTradingText(raw)) continue
      const sc = boost(attr, attrScore(attr, raw).score)
      if (platform === 'web') {
        push({
          locator: this.css.byAttributeEquals(tag, attr, raw),
          kind: 'css',
          strategy: 'accessibility',
          stabilityScore: sc,
          readabilityScore: 0.82,
          priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
          metadata: { attribute: attr, genericUiPattern: true },
        })
      }
      push({
        locator: this.xpath.byAttributeEquals(tag, attr, raw),
        kind: 'xpath',
        strategy: 'xpath',
        stabilityScore: sc * 0.9,
        readabilityScore: 0.7,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { attribute: attr, genericUiPattern: true },
      })
      if (platform === 'android' && attr === 'resource-id') {
        push({
          locator: `AppiumBy.id(${JSON.stringify(raw)})`,
          kind: 'appium',
          strategy: 'appium',
          stabilityScore: sc,
          readabilityScore: 0.87,
          priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
          metadata: { attribute: attr, genericUiPattern: true },
        })
      }
      if (platform !== 'web' && ['content-desc', 'accessibility-id', 'name', 'label'].includes(attr)) {
        push({
          locator: `AppiumBy.accessibilityId(${JSON.stringify(raw)})`,
          kind: 'appium',
          strategy: 'appium',
          stabilityScore: sc,
          readabilityScore: 0.89,
          priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
          metadata: { attribute: attr, genericUiPattern: true },
        })
      }
    }

    /* Trading/mobile attribute support (additive) */
    for (const attr of mobileTradingAttributes(platform)) {
      const raw = attrs[attr]
      if (!raw || !accept(attr, raw)) continue
      if (attr === 'text' && isHighlyDynamicTradingText(raw)) continue
      const sc = boost(attr, attrScore(attr, raw).score)
      if (platform === 'web') {
        push({
          locator: this.css.byAttributeEquals(tag, attr, raw),
          kind: 'css',
          strategy: 'hybrid',
          stabilityScore: sc,
          readabilityScore: 0.82,
          priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
          metadata: { attribute: attr, trading: true },
        })
      }
      push({
        locator: this.xpath.byAttributeEquals(tag, attr, raw),
        kind: 'xpath',
        strategy: 'xpath',
        stabilityScore: sc * 0.92,
        readabilityScore: 0.72,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { attribute: attr, trading: true },
      })
      if (platform !== 'web' && ['content-desc', 'accessibility-id', 'name', 'label'].includes(attr)) {
        push({
          locator: `AppiumBy.accessibilityId(${JSON.stringify(raw)})`,
          kind: 'appium',
          strategy: 'appium',
          stabilityScore: sc,
          readabilityScore: 0.88,
          priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
          metadata: { attribute: attr, trading: true },
        })
      }
    }

    /* Trading ancestor context (watchlist row/order panel/chart legend anchors). */
    if (platform === 'web' && tradingAnchor) {
      const childSel = tradingChildSelector(tag, attrs)
      push({
        locator: this.css.nestedScoped(
          tradingAnchor.tag,
          { name: tradingAnchor.attrName, value: tradingAnchor.attrValue },
          childSel,
        ),
        kind: 'css',
        strategy: 'relative',
        stabilityScore: 0.83,
        readabilityScore: 0.74,
        priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
        metadata: { tradingAnchor, childSel, trading: true },
      })
      push({
        locator: `//${tradingAnchor.tag}[@${tradingAnchor.attrName}=${safeXPathLiteral(tradingAnchor.attrValue)}]//${tag}`,
        kind: 'xpath',
        strategy: 'relative',
        stabilityScore: 0.79,
        readabilityScore: 0.68,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { tradingAnchor, trading: true },
      })
      const childAttr = tradingChildAttr(attrs)
      if (tradingSymbolCtx && childAttr) {
        push({
          locator: `//${tradingAnchor.tag}[@${tradingAnchor.attrName}=${safeXPathLiteral(tradingAnchor.attrValue)}][contains(normalize-space(.), ${safeXPathLiteral(tradingSymbolCtx.symbol)})]//${tag}[@${childAttr.name}=${safeXPathLiteral(childAttr.value)}]`,
          kind: 'xpath',
          strategy: 'relative',
          stabilityScore: 0.86,
          readabilityScore: 0.72,
          priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
          metadata: { tradingAnchor, tradingSymbol: tradingSymbolCtx.symbol, childAttr, trading: true },
        })
        push({
          locator: `page.getByText(${JSON.stringify(tradingSymbolCtx.symbol)}).locator('..').locator('[${childAttr.name}="${escapeCssAttrValue(childAttr.value)}"]')`,
          kind: 'playwright',
          strategy: 'relative',
          stabilityScore: 0.84,
          readabilityScore: 0.8,
          priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
          metadata: { tradingAnchor, tradingSymbol: tradingSymbolCtx.symbol, childAttr, trading: true },
        })
      } else if (tradingSymbolCtx) {
        const childText = target.text().trim()
        if (childText && !isHighlyDynamicTradingText(childText)) {
          push({
            locator: `//${tradingAnchor.tag}[@${tradingAnchor.attrName}=${safeXPathLiteral(tradingAnchor.attrValue)}][contains(normalize-space(.), ${safeXPathLiteral(tradingSymbolCtx.symbol)})]//${tag}[contains(normalize-space(.), ${safeXPathLiteral(childText)})]`,
            kind: 'xpath',
            strategy: 'relative',
            stabilityScore: 0.82,
            readabilityScore: 0.69,
            priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
            metadata: { tradingAnchor, tradingSymbol: tradingSymbolCtx.symbol, trading: true },
          })
        }
      }
    }

    /* Generic pseudo-table/list/card row scope for component-driven UIs */
    if (platform === 'web' && rowLikeAnchor) {
      const childSel = genericChildSelector(tag, attrs, platform)
      push({
        locator: this.css.nestedScoped(
          rowLikeAnchor.tag,
          { name: rowLikeAnchor.attrName, value: rowLikeAnchor.attrValue },
          childSel,
        ),
        kind: 'css',
        strategy: 'relative',
        stabilityScore: 0.8,
        readabilityScore: 0.72,
        priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
        metadata: { rowLikeAnchor, childSel, genericUiPattern: true },
      })
      push({
        locator: `//${rowLikeAnchor.tag}[@${rowLikeAnchor.attrName}=${safeXPathLiteral(rowLikeAnchor.attrValue)}]//${tag}`,
        kind: 'xpath',
        strategy: 'relative',
        stabilityScore: 0.76,
        readabilityScore: 0.66,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { rowLikeAnchor, genericUiPattern: true },
      })
      if (rowLikeAnchor.contextText) {
        const childAttr = genericChildAttr(attrs, platform)
        if (childAttr) {
          push({
            locator: `page.getByText(${JSON.stringify(rowLikeAnchor.contextText)}).locator('..').locator('[${childAttr.name}="${escapeCssAttrValue(childAttr.value)}"]')`,
            kind: 'playwright',
            strategy: 'relative',
            stabilityScore: 0.78,
            readabilityScore: 0.79,
            priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
            metadata: { rowLikeAnchor, contextText: rowLikeAnchor.contextText, childAttr, genericUiPattern: true },
          })
        }
      }
    }

    if (attrs.role) {
      const name = target.text().trim() || attrs['aria-label'] || ''
      if (name) {
        push({
          locator: this.xpath.byRole(attrs.role, { name }),
          kind: 'xpath',
          strategy: 'role',
          stabilityScore: 0.82,
          readabilityScore: 0.68,
          priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
          metadata: { role: attrs.role },
        })
      }
    }

    /* Tier 3 — stable id */
    if (attrs.id && accept('id', attrs.id)) {
      const sc = boost('id', attrScore('id', attrs.id).score)
      push({
        locator: this.css.byId(attrs.id),
        kind: 'css',
        strategy: 'css',
        stabilityScore: sc,
        readabilityScore: 0.92,
        priorityTier: LOCATOR_PRIORITY_TIERS.STABLE_ID,
        metadata: { attribute: 'id' },
      })
      push({
        locator: this.xpath.byAttributeEquals(tag, 'id', attrs.id),
        kind: 'xpath',
        strategy: 'xpath',
        stabilityScore: sc * 0.9,
        readabilityScore: 0.76,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: { attribute: 'id' },
      })
      const pattern = splitStablePattern(attrs.id)
      if (pattern) {
        push({
          locator: this.css.byStartsWithAndEndsWithAttr(tag, 'id', pattern.prefix, pattern.suffix),
          kind: 'css',
          strategy: 'hybrid',
          stabilityScore: Math.max(0.42, sc * 0.75),
          readabilityScore: 0.7,
          priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
          metadata: { attribute: 'id', regexLike: true, pattern },
        })
        push({
          locator: this.xpath.byStartsWithAndEndsLike(tag, 'id', pattern.prefix, pattern.suffix),
          kind: 'xpath',
          strategy: 'xpath',
          stabilityScore: Math.max(0.4, sc * 0.68),
          readabilityScore: 0.64,
          priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
          metadata: { attribute: 'id', regexLike: true, pattern },
        })
      }
    } else if (attrs.id) {
      const pattern = splitStablePattern(attrs.id)
      if (pattern) {
        const sc = Math.max(0.45, attrScore('id', attrs.id).score * 0.78)
        push({
          locator: this.css.byStartsWithAndEndsWithAttr(tag, 'id', pattern.prefix, pattern.suffix),
          kind: 'css',
          strategy: 'hybrid',
          stabilityScore: sc,
          readabilityScore: 0.71,
          priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
          metadata: { attribute: 'id', regexLike: true, pattern },
        })
        push({
          locator: this.xpath.byStartsWithAndEndsLike(tag, 'id', pattern.prefix, pattern.suffix),
          kind: 'xpath',
          strategy: 'xpath',
          stabilityScore: sc * 0.92,
          readabilityScore: 0.66,
          priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
          metadata: { attribute: 'id', regexLike: true, pattern },
        })
      } else {
        rejected.push({ locator: `#${attrs.id}`, reason: `unstable id: ${attrScore('id', attrs.id).reason}` })
      }
    }

    /* Tier 4 — name & form hints */
    if (attrs.name && accept('name', attrs.name)) {
      push({
        locator: this.css.byAttributeEquals(tag, 'name', attrs.name),
        kind: 'css',
        strategy: 'css',
        stabilityScore: boost('name', attrScore('name', attrs.name).score),
        readabilityScore: 0.88,
        priorityTier: LOCATOR_PRIORITY_TIERS.NAME_OR_FORM_HINT,
        metadata: { attribute: 'name' },
      })
    }

    if (attrs.placeholder && accept('placeholder', attrs.placeholder)) {
      push({
        locator: this.xpath.byContainsAttr(tag, 'placeholder', attrs.placeholder),
        kind: 'xpath',
        strategy: 'hybrid',
        stabilityScore: boost('placeholder', attrScore('placeholder', attrs.placeholder).score * 0.9),
        readabilityScore: 0.72,
        priorityTier: LOCATOR_PRIORITY_TIERS.NAME_OR_FORM_HINT,
        metadata: { attribute: 'placeholder' },
      })
    }

    /* Tier 5 — visible text */
    const txt = target.text().trim()
    const dynamicText = isHighlyDynamicTradingText(txt)
    if (txt && txt.length <= 96 && !dynamicText) {
      push({
        locator: `page.getByText(${JSON.stringify(txt)})`,
        kind: 'playwright',
        strategy: 'text',
        stabilityScore: 0.64,
        readabilityScore: 0.86,
        priorityTier: LOCATOR_PRIORITY_TIERS.VISIBLE_TEXT,
        metadata: {},
      })
      push({
        locator: this.xpath.byNormalizedText(tag, txt),
        kind: 'xpath',
        strategy: 'text',
        stabilityScore: 0.62,
        readabilityScore: 0.68,
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        metadata: {},
      })
      const tokenParts = stableTextTokens(txt)
      if (tokenParts.length >= 2) {
        push({
          locator: this.xpath.byContainsAllTokens(tag, tokenParts.slice(0, 3)),
          kind: 'xpath',
          strategy: 'hybrid',
          stabilityScore: 0.68,
          readabilityScore: 0.69,
          priorityTier: LOCATOR_PRIORITY_TIERS.RELATIVE,
          metadata: { textTokens: tokenParts.slice(0, 3), regexLike: true },
        })
      }
    }
    if (txt && dynamicText) {
      rejected.push({
        locator: `text:${txt.slice(0, 80)}`,
        reason: 'highly dynamic trading text rejected as primary locator',
      })
    }

    if (isLikelyTradingSymbol(txt)) {
      push({
        locator: this.xpath.byContainsText(tag, txt),
        kind: 'xpath',
        strategy: 'relative',
        stabilityScore: 0.7,
        readabilityScore: 0.63,
        priorityTier: LOCATOR_PRIORITY_TIERS.RELATIVE,
        metadata: { tradingSymbol: txt },
      })
    }

    /* Tier 6 — relative */
    for (const rel of this.relative.generateForNode(target, $)) {
      push({
        locator: rel.value,
        kind: rel.kind,
        strategy: 'relative',
        stabilityScore: 0.72,
        readabilityScore: 0.6,
        priorityTier: LOCATOR_PRIORITY_TIERS.RELATIVE,
        metadata: { relative: rel.label },
      })
    }

    /* Tier 8 — class (low priority, not in top-7 list) */
    if (attrs.class) {
      const tokens = attrs.class.split(/\s+/).filter(Boolean)
      for (const tok of tokens.slice(0, 3)) {
        if (!accept('class', tok)) continue
        const sc = attrScore('class', tok)
        if (sc.clazz === 'UNSTABLE') continue
        push({
          locator: this.css.byClassAndTag(tag, tok),
          kind: 'css',
          strategy: 'css',
          stabilityScore: sc.score * 0.85,
          readabilityScore: 0.65,
          priorityTier: LOCATOR_PRIORITY_TIERS.CLASS_LOW,
          metadata: { classToken: tok },
        })
        break
      }
    }

    /*
     * Extension pipeline:
     * external providers can append candidates without mutating core rules.
     * This keeps the engine open for growth while keeping existing behavior intact.
     */
    if (this.candidateProviders.length) {
      const extCtx: LocatorGenerationContext = {
        $,
        xmlDoc,
        target,
        platform,
        framework: fw,
        tag,
        attrs,
        targetText: target.text().trim(),
      }
      for (const provider of this.candidateProviders) {
        try {
          const provided = provider.provideCandidates(extCtx)
          for (const c of provided) {
            push({
              locator: c.locator,
              kind: c.kind,
              strategy: c.strategy,
              stabilityScore: c.stabilityScore,
              readabilityScore: c.readabilityScore,
              priorityTier: c.priorityTier,
              metadata: {
                ...c.metadata,
                extensionProvider: provider.id,
              },
            })
          }
        } catch (err) {
          rejected.push({
            locator: `extension:${provider.id}`,
            reason: `candidate provider failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
    }

    const refinedCandidates: LocatorCandidate[] = []
    for (const c of candidates) {
      let loc = c.locator
      const { kind } = c

      if (kind === 'playwright') {
        refinedCandidates.push(c)
        continue
      }

      if (kind === 'appium') {
        refinedCandidates.push(c)
        continue
      }

      if (kind === 'css') {
        let count = this.uniqueness.count('css', loc, $, xmlDoc)
        if (count !== 1) {
          const u = this.uniqueness.refineCssWithHierarchy(loc, target, $, xmlDoc)
          if (u.refined) loc = u.refined.value
          count = this.uniqueness.count('css', loc, $, xmlDoc)
        }
        if (count !== 1) {
          rejected.push({ locator: loc, reason: `CSS match count ${count} != 1 after refinement` })
          continue
        }
      } else if (kind === 'xpath') {
        let ucount = this.uniqueness.count('xpath', loc, $, xmlDoc)
        if (ucount !== 1) {
          const r = this.uniqueness.refineXPathWithPosition(loc, $, xmlDoc)
          if (r.refined) loc = r.refined.value
          ucount = this.uniqueness.count('xpath', loc, $, xmlDoc)
        }
        if (ucount !== 1) {
          rejected.push({ locator: loc, reason: `XPath match count ${ucount} != 1` })
          continue
        }
      }

      refinedCandidates.push({ ...c, locator: loc })
    }

    const uniqMap = new Map<string, number>()
    for (const c of refinedCandidates) {
      if (c.kind === 'css') uniqMap.set(mapKey(c), this.uniqueness.count('css', c.locator, $, xmlDoc))
      else if (c.kind === 'xpath') uniqMap.set(mapKey(c), this.uniqueness.count('xpath', c.locator, $, xmlDoc))
      else if (c.kind === 'playwright') {
        uniqMap.set(mapKey(c), countPlaywrightUniqueness(c.locator, $, this.uniqueness))
      } else if (c.kind === 'appium') {
        uniqMap.set(mapKey(c), countAppiumUniqueness(c.locator, $, xmlDoc, this.uniqueness))
      } else uniqMap.set(mapKey(c), 0)
    }

    const ranked = this.ranking.rank(refinedCandidates, uniqMap)
    const viable = ranked.filter((r) => r.totalScore > 0)

    if (!viable.length) {
      throw new DomainError(
        'No locator passed uniqueness and ranking gates',
        'NO_VIABLE_LOCATOR',
        { rejected, framework: fw.kind },
      )
    }

    const best = viable[0]!
    const explanation = buildExplanation(best, viable.slice(1, 4), rejected.slice(0, 6), fw)

    return {
      best,
      ranked: viable,
      rejected,
      explanation: tradingHints.length
        ? `${explanation} Trading hints: ${tradingHints.map((h) => `${h.key}=${h.value}`).slice(0, 4).join(', ')}`
        : explanation,
      framework: fw.kind,
    }
  }
}

function mapKey(c: LocatorCandidate): string {
  return `${c.kind}::${c.locator}`
}

function buildExplanation(
  best: GenerationResult['best'],
  runnersUp: GenerationResult['ranked'],
  rejected: GenerationResult['rejected'],
  fw: FrameworkProfile,
): string {
  const parts: string[] = []
  parts.push(
    `Primary choice uses strategy "${best.strategy}" (priority tier ${best.priorityTier}) with total score ${best.totalScore.toFixed(3)} and uniqueness matches=${best.uniquenessMatchCount}.`,
  )
  parts.push(
    `Framework detection: ${fw.kind}. Recommended attributes: ${fw.recommendedAttributes.slice(0, 8).join(', ')}.`,
  )
  if (runnersUp.length) {
    parts.push(
      `Fallbacks ranked next: ${runnersUp.map((r) => `${r.strategy}(tier ${r.priorityTier}, ${r.totalScore.toFixed(2)})`).join('; ')}.`,
    )
  }
  if (rejected.length) {
    parts.push(`Rejected examples: ${rejected.map((r) => r.reason).join(' | ')}`)
  }
  return parts.join(' ')
}

