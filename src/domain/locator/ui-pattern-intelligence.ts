import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { Platform } from '../contracts/types.js'

const WEB_PRIMARY_AUTOMATION_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'data-automation-id',
  'data-automationid',
  'automation-id',
  'test-id',
  'qa-id',
] as const

const WEB_SEMANTIC_ATTRIBUTES = [
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'role',
  'name',
  'title',
  'placeholder',
  'alt',
] as const

const ANDROID_PRIMARY_ATTRIBUTES = [
  'resource-id',
  'content-desc',
  'text',
  'hint',
  'class',
  'package',
] as const

const IOS_PRIMARY_ATTRIBUTES = [
  'name',
  'label',
  'value',
  'type',
  'accessibility-id',
] as const

const ROWLIKE_ROLE_HINTS = ['row', 'listitem', 'gridcell', 'option', 'menuitem', 'presentation'] as const
const ROWLIKE_CLASS_HINTS = ['row', 'item', 'tile', 'card', 'entry', 'record', 'cell', 'position'] as const
const ROWLIKE_ATTR_HINTS = [
  'data-testid',
  'data-row',
  'data-row-id',
  'data-item-id',
  'data-symbol',
  'data-scrip',
  'data-security-id',
] as const

export function platformPrimaryAttributes(platform: Platform): string[] {
  if (platform === 'android') return [...ANDROID_PRIMARY_ATTRIBUTES]
  if (platform === 'ios') return [...IOS_PRIMARY_ATTRIBUTES]
  return [...WEB_PRIMARY_AUTOMATION_ATTRIBUTES]
}

export function platformSemanticAttributes(platform: Platform): string[] {
  if (platform === 'web') return [...WEB_SEMANTIC_ATTRIBUTES]
  if (platform === 'android') return ['resource-id', 'content-desc', 'hint', 'text']
  return ['name', 'label', 'value', 'type', 'accessibility-id']
}

export function platformChildAnchorAttributes(platform: Platform): string[] {
  if (platform === 'android') return ['resource-id', 'content-desc', 'text', 'class']
  if (platform === 'ios') return ['name', 'label', 'value', 'type']
  return ['data-action', 'data-side', 'data-testid', 'label', 'aria-label', 'name', 'role', 'id', 'type']
}

export function nearestRowLikeContainer(
  target: cheerio.Cheerio<Element>,
  $: cheerio.CheerioAPI,
): { tag: string; attrName: string; attrValue: string; contextText?: string } | null {
  const ancestors = target.parents().toArray()
  for (const node of ancestors) {
    const tag = node.name
    const attrs = node.attribs ?? {}
    const role = (attrs.role ?? '').toLowerCase()
    const klass = (attrs.class ?? '').toLowerCase()
    const isRowLike =
      ROWLIKE_ROLE_HINTS.includes(role as (typeof ROWLIKE_ROLE_HINTS)[number]) ||
      ROWLIKE_CLASS_HINTS.some((h) => klass.includes(h)) ||
      Object.keys(attrs).some((k) => ROWLIKE_ATTR_HINTS.includes(k as (typeof ROWLIKE_ATTR_HINTS)[number]))
    if (!isRowLike) continue
    for (const key of ROWLIKE_ATTR_HINTS) {
      const val = attrs[key]
      if (!val) continue
      if (looksDynamic(val)) continue
      return {
        tag,
        attrName: key,
        attrValue: val,
        contextText: pickStableContextText($(node), $),
      }
    }
    if (attrs.role && !looksDynamic(attrs.role)) {
      return {
        tag,
        attrName: 'role',
        attrValue: attrs.role,
        contextText: pickStableContextText($(node), $),
      }
    }
  }
  return null
}

function pickStableContextText(node: cheerio.Cheerio<Element>, $: cheerio.CheerioAPI): string | undefined {
  const txt = node
    .find('*')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
    .find((t) => t.length >= 3 && t.length <= 48 && !looksMostlyDynamicText(t))
  return txt
}

function looksDynamic(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  if (/\b\d{5,}\b/.test(v)) return true
  if (/[a-f0-9]{10,}/i.test(v)) return true
  return false
}

function looksMostlyDynamicText(value: string): boolean {
  const t = value.trim()
  if (!t) return true
  if (/^\d+([.,]\d+)?$/.test(t)) return true
  if (/\d{2}:\d{2}(:\d{2})?/.test(t)) return true
  if (/^-?\d+(\.\d+)?%$/.test(t)) return true
  return false
}
