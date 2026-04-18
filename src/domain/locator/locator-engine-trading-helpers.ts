import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { escapeCssAttrValue } from '../css-builder/css-builder.js'
import { isTradingWebAttribute } from '../trading/trading-ui-support.js'
import { platformChildAnchorAttributes } from './ui-pattern-intelligence.js'
import type { Platform } from '../contracts/types.js'

const TRADING_CHILD_KEYS = [
  'data-action',
  'data-side',
  'data-testid',
  'label',
  'name',
  'aria-label',
  'role',
  'id',
] as const

export function nearestTradingAnchor(target: cheerio.Cheerio<Element>):
  | { tag: string; attrName: string; attrValue: string }
  | null {
  const ancestors = target.parents().toArray()
  for (const node of ancestors) {
    const tag = (node as Element).name
    const attrs = (node as Element).attribs ?? {}
    for (const [k, v] of Object.entries(attrs)) {
      if (!v) continue
      if (!isTradingWebAttribute(k)) continue
      if (looksDynamicAnchorValue(v)) continue
      return { tag, attrName: k, attrValue: v }
    }
  }
  return null
}

export function tradingChildSelector(tag: string, attrs: Record<string, string>): string {
  for (const key of TRADING_CHILD_KEYS) {
    const val = attrs[key]
    if (!val) continue
    if (looksDynamicAnchorValue(val)) continue
    return `${tag}[${key}="${escapeCssAttrValue(val)}"]`
  }
  return tag
}

export function tradingChildAttr(attrs: Record<string, string>): { name: string; value: string } | null {
  for (const key of TRADING_CHILD_KEYS) {
    const val = attrs[key]
    if (!val) continue
    if (looksDynamicAnchorValue(val)) continue
    return { name: key, value: val }
  }
  return null
}

export function genericChildSelector(tag: string, attrs: Record<string, string>, platform: Platform): string {
  const child = genericChildAttr(attrs, platform)
  if (!child) return tag
  return `${tag}[${child.name}="${escapeCssAttrValue(child.value)}"]`
}

export function genericChildAttr(attrs: Record<string, string>, platform: Platform): { name: string; value: string } | null {
  for (const key of platformChildAnchorAttributes(platform)) {
    const val = attrs[key]
    if (!val) continue
    if (looksDynamicAnchorValue(val)) continue
    return { name: key, value: val }
  }
  return null
}

export function nearestTradingSymbolContext(
  target: cheerio.Cheerio<Element>,
  $: cheerio.CheerioAPI,
): { symbol: string } | null {
  const ancestors = target.parents().toArray()
  for (const node of ancestors) {
    const text = $(node).text().replace(/\s+/g, ' ').trim()
    const symbol = extractTradingSymbol(text)
    if (symbol) return { symbol }
  }
  return null
}

function extractTradingSymbol(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const m1 = t.match(/\b[A-Z]{2,12}\/[A-Z]{2,12}\b/)
  if (m1?.[0]) return m1[0]
  const mDash = t.match(/\b[A-Z0-9]{2,20}(?:-[A-Z0-9]{2,20})+\b/)
  if (mDash?.[0]) return mDash[0]
  const m2 = t.match(/\b[A-Z]{2,12}(?:-EQ|-BE|-FUT|-CE|-PE)\b/)
  if (m2?.[0]) return m2[0]
  const m3 = t.match(/\b[A-Z][A-Z0-9]{2,15}\b/)
  if (m3?.[0]) return m3[0]
  return null
}

function looksDynamicAnchorValue(v: string): boolean {
  const s = v.trim()
  if (!s) return true
  if (/\b\d{6,}\b/.test(s)) return true
  if (/[a-f0-9]{10,}/i.test(s)) return true
  return false
}
