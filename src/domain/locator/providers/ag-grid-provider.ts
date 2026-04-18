import type { Element } from 'domhandler'
import type {
  LocatorCandidateProvider,
  LocatorGenerationContext,
} from '../locator-extension.js'
import { LOCATOR_PRIORITY_TIERS } from '../../../utils/locator-priority.js'

/**
 * SAMPLE provider for AG Grid-like UIs.
 * Use this as a reference/template for writing custom providers.
 * This module is additive and can be replaced/extended independently.
 */
export class AgGridLocatorProvider implements LocatorCandidateProvider {
  readonly id = 'ag-grid-provider'

  provideCandidates(ctx: LocatorGenerationContext) {
    if (ctx.platform !== 'web') return []
    if (!isAgGridContext(ctx)) return []

    const row = nearestAgRow(ctx)
    if (!row) return []
    const rowId = row.attr('row-id')
    if (!rowId) return []

    const tag = ctx.tag
    const targetAttr = pickTargetAttr(ctx)
    const cell = ctx.target.closest('[col-id], .ag-cell')
    const colId = cell.attr('col-id') ?? ctx.attrs['col-id']

    const out: ReturnType<LocatorCandidateProvider['provideCandidates']> = []
    if (targetAttr) {
      out.push({
        locator: `.ag-row[row-id="${escapeCss(rowId)}"] ${tag}[${targetAttr.name}="${escapeCss(targetAttr.value)}"]`,
        kind: 'css',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
        stabilityScore: 0.82,
        readabilityScore: 0.76,
        metadata: { provider: this.id, agGrid: true, rowId, targetAttr },
      })
      out.push({
        locator: `//div[contains(@class,'ag-row') and @row-id=${toXPathLiteral(rowId)}]//${tag}[@${targetAttr.name}=${toXPathLiteral(targetAttr.value)}]`,
        kind: 'xpath',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        stabilityScore: 0.78,
        readabilityScore: 0.69,
        metadata: { provider: this.id, agGrid: true, rowId, targetAttr },
      })
    }

    if (colId) {
      out.push({
        locator: `.ag-row[row-id="${escapeCss(rowId)}"] [col-id="${escapeCss(colId)}"] ${tag}`,
        kind: 'css',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.STRUCTURAL_ANCHOR,
        stabilityScore: 0.8,
        readabilityScore: 0.72,
        metadata: { provider: this.id, agGrid: true, rowId, colId },
      })
      out.push({
        locator: `//div[contains(@class,'ag-row') and @row-id=${toXPathLiteral(rowId)}]//*[@col-id=${toXPathLiteral(colId)}]//${tag}`,
        kind: 'xpath',
        strategy: 'relative',
        priorityTier: LOCATOR_PRIORITY_TIERS.XPATH_FALLBACK,
        stabilityScore: 0.75,
        readabilityScore: 0.67,
        metadata: { provider: this.id, agGrid: true, rowId, colId },
      })
    }

    return out
  }
}

function isAgGridContext(ctx: LocatorGenerationContext): boolean {
  const rootHtml = ctx.$.root().html() ?? ''
  if (/ag-grid|ag-root|ag-row|ag-cell/.test(rootHtml)) return true
  const ancestor = ctx.target.parents().toArray().find((n) => hasClass(n, 'ag-row') || hasClass(n, 'ag-cell'))
  return Boolean(ancestor)
}

function nearestAgRow(ctx: LocatorGenerationContext) {
  return ctx.target.parents('.ag-row,[row-id]').first()
}

function pickTargetAttr(ctx: LocatorGenerationContext): { name: string; value: string } | null {
  for (const key of ['data-testid', 'aria-label', 'name', 'col-id', 'id'] as const) {
    const val = ctx.attrs[key]
    if (!val) continue
    if (looksDynamic(val)) continue
    return { name: key, value: val }
  }
  return null
}

function hasClass(node: Element, klass: string): boolean {
  const classes = (node.attribs?.class ?? '').split(/\s+/).filter(Boolean)
  return classes.includes(klass)
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
