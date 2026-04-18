import type {
  LocatorCandidateProvider,
  LocatorGenerationContext,
} from '../locator-extension.js'
import { LOCATOR_PRIORITY_TIERS } from '../../../utils/locator-priority.js'

/**
 * SAMPLE provider for Flutter Web semantics-heavy DOM.
 * Use this as a reference/template for custom Flutter Web providers.
 */
export class FlutterWebLocatorProvider implements LocatorCandidateProvider {
  readonly id = 'flutter-web-provider'

  provideCandidates(ctx: LocatorGenerationContext) {
    if (ctx.platform !== 'web') return []
    if (!isFlutterWebContext(ctx)) return []

    const semanticsId = ctx.attrs['flt-semantics-identifier'] ?? findSemanticsIdOnAncestors(ctx)
    const semanticLabel = ctx.attrs['aria-label'] ?? ctx.attrs['name']
    const out: ReturnType<LocatorCandidateProvider['provideCandidates']> = []

    if (semanticsId && !looksDynamic(semanticsId)) {
      out.push({
        locator: `[flt-semantics-identifier="${escapeCss(semanticsId)}"]`,
        kind: 'css',
        strategy: 'accessibility',
        priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
        stabilityScore: 0.87,
        readabilityScore: 0.84,
        metadata: { provider: this.id, flutterWeb: true, semanticsId },
      })
      out.push({
        locator: `//*[@flt-semantics-identifier=${toXPathLiteral(semanticsId)}]`,
        kind: 'xpath',
        strategy: 'xpath',
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        stabilityScore: 0.82,
        readabilityScore: 0.72,
        metadata: { provider: this.id, flutterWeb: true, semanticsId },
      })
    }

    if (semanticLabel && !looksDynamic(semanticLabel)) {
      out.push({
        locator: `page.getByRole('${ctx.attrs.role ?? 'generic'}', { name: ${JSON.stringify(semanticLabel)} })`,
        kind: 'playwright',
        strategy: 'role',
        priorityTier: LOCATOR_PRIORITY_TIERS.ACCESSIBILITY,
        stabilityScore: 0.82,
        readabilityScore: 0.86,
        metadata: { provider: this.id, flutterWeb: true, semanticLabel },
      })
    }

    return out
  }
}

function isFlutterWebContext(ctx: LocatorGenerationContext): boolean {
  const root = ctx.$.root().html() ?? ''
  if (/flt-|flutter-view|flutter-semantics|flt-semantics-identifier/.test(root)) return true
  return ctx.target.parents('[flt-semantics-identifier], [data-flt-semantics]').length > 0
}

function findSemanticsIdOnAncestors(ctx: LocatorGenerationContext): string | undefined {
  const hit = ctx.target.parents('[flt-semantics-identifier]').first()
  return hit.attr('flt-semantics-identifier') ?? undefined
}

function looksDynamic(v: string): boolean {
  if (/\b\d{6,}\b/.test(v)) return true
  if (/[a-f0-9]{10,}/i.test(v)) return true
  return false
}

function escapeCss(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function toXPathLiteral(raw: string): string {
  if (!raw.includes("'")) return `'${raw}'`
  if (!raw.includes('"')) return `"${raw}"`
  const chunks = raw.split("'")
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]) parts.push(`'${chunks[i]}'`)
    if (i < chunks.length - 1) parts.push(`"'"`)
  }
  return `concat(${parts.join(', ')})`
}
