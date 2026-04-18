import type {
  LocatorCandidateProvider,
  LocatorGenerationContext,
} from '../locator-extension.js'
import type { LocatorCandidate } from '../../contracts/types.js'
import { LOCATOR_PRIORITY_TIERS } from '../../../utils/locator-priority.js'

/**
 * SAMPLE provider for virtualized React list/grid UIs
 * (react-window/react-virtualized style).
 * Use this as a reference/template for custom virtualized UI providers.
 */
export class ReactVirtualizedLocatorProvider implements LocatorCandidateProvider {
  readonly id = 'react-virtualized-provider'

  provideCandidates(ctx: LocatorGenerationContext): Array<
    Omit<LocatorCandidate, 'metadata'> & { metadata?: Record<string, unknown> }
  > {
    if (ctx.platform !== 'web') return []
    if (!isVirtualizedContext(ctx)) return []

    const row = ctx.target.parents('[data-index], [data-rowindex], [aria-rowindex], [role="row"]').first()
    if (!row.length) return []

    const rowIndex = row.attr('data-index') ?? row.attr('data-rowindex') ?? row.attr('aria-rowindex')
    const action = pickStableAction(ctx)
    if (!rowIndex || !action) return []

    const out: Array<Omit<LocatorCandidate, 'metadata'> & { metadata?: Record<string, unknown> }> = [
      {
        locator: `[data-index="${escapeCss(rowIndex)}"] ${ctx.tag}[${action.name}="${escapeCss(action.value)}"]`,
        kind: 'css',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
        stabilityScore: 0.81,
        readabilityScore: 0.76,
        metadata: { provider: this.id, virtualized: true, rowIndex, action },
      },
      {
        locator: `//*[@data-index=${toXPathLiteral(rowIndex)} or @data-rowindex=${toXPathLiteral(rowIndex)} or @aria-rowindex=${toXPathLiteral(rowIndex)}]//${ctx.tag}[@${action.name}=${toXPathLiteral(action.value)}]`,
        kind: 'xpath',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        stabilityScore: 0.77,
        readabilityScore: 0.7,
        metadata: { provider: this.id, virtualized: true, rowIndex, action },
      },
    ]
    return out
  }
}

function isVirtualizedContext(ctx: LocatorGenerationContext): boolean {
  const root = ctx.$.root().html() ?? ''
  if (/react-window|react-virtualized|virtualized|data-index/.test(root)) return true
  return ctx.target.parents('[data-index], [data-rowindex], [aria-rowindex]').length > 0
}

function pickStableAction(ctx: LocatorGenerationContext): { name: string; value: string } | null {
  for (const key of ['data-testid', 'aria-label', 'name', 'id', 'role'] as const) {
    const val = ctx.attrs[key]
    if (!val) continue
    if (looksDynamic(val)) continue
    return { name: key, value: val }
  }
  return null
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
