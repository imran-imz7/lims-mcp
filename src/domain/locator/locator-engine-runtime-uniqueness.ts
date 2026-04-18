import type * as cheerio from 'cheerio'
import { escapeCssAttrValue } from '../css-builder/css-builder.js'
import { UniquenessEngine } from '../uniqueness-engine/uniqueness-engine.js'
import { parsePlaywrightLocator } from '../../utils/playwright-locator-parse.js'

export function countPlaywrightUniqueness(
  locator: string,
  $: cheerio.CheerioAPI,
  uniqueness: UniquenessEngine,
): number {
  const parsed = parsePlaywrightLocator(locator)
  if (!parsed) return 0
  if (parsed.kind === 'contextual-attribute') {
    const parents = $('*').filter(
      (_i, el) => $(el).text().replace(/\s+/g, ' ').trim() === parsed.anchorText,
    )
    let count = 0
    parents.each((_i, el) => {
      const p = $(el).parent()
      if (!p.length) return
      count += p.find(`[${parsed.attribute}="${escapeCssAttrValue(parsed.value)}"]`).length
    })
    return count
  }
  if (parsed.kind === 'text') return uniqueness.countExactNormalizedText($, parsed.text)
  if (parsed.kind === 'placeholder') {
    return $(`[placeholder="${escapeCssAttrValue(parsed.text)}"]`).length
  }
  if (parsed.kind === 'label') {
    const forIds = $('label')
      .filter((_i, el) => $(el).text().replace(/\s+/g, ' ').trim() === parsed.text)
      .map((_i, el) => $(el).attr('for'))
      .get()
      .filter(Boolean)
    const byFor = forIds.reduce((acc, id) => acc + $(`#${cssEscapeId(String(id))}`).length, 0)
    const byAria = $(`[aria-label="${escapeCssAttrValue(parsed.text)}"], [label="${escapeCssAttrValue(parsed.text)}"]`).length
    return byFor + byAria
  }
  if (parsed.kind === 'test-id') {
    return $(
      `[data-testid="${escapeCssAttrValue(parsed.text)}"], [data-test="${escapeCssAttrValue(parsed.text)}"], [data-qa="${escapeCssAttrValue(parsed.text)}"]`,
    ).length
  }
  if (parsed.kind === 'alt') return $(`[alt="${escapeCssAttrValue(parsed.text)}"]`).length
  if (parsed.kind === 'title') return $(`[title="${escapeCssAttrValue(parsed.text)}"]`).length
  if (parsed.kind === 'css') {
    try {
      return $(parsed.selector).length
    } catch {
      return 0
    }
  }
  if (parsed.kind === 'xpath') return 0
  if (parsed.kind === 'role') {
    const role = parsed.role.toLowerCase()
    const sel = roleSelector(role)
    if (!sel) return 0
    const nodes = $(sel)
    if (!parsed.name) return nodes.length
    return nodes.filter((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      const aria = ($(el).attr('aria-label') ?? '').trim()
      const label = ($(el).attr('label') ?? '').trim()
      return text === parsed.name || aria === parsed.name || label === parsed.name
    }).length
  }
  return 0
}

export function countAppiumUniqueness(
  locator: string,
  $: cheerio.CheerioAPI,
  xmlDoc: globalThis.Document,
  uniqueness: UniquenessEngine,
): number {
  const a11y = locator.match(/AppiumBy\.accessibilityId\((.*)\)/)
  if (a11y?.[1]) {
    const raw = a11y[1].trim().replace(/^['"`]|['"`]$/g, '')
    return $(
      `[content-desc="${escapeCssAttrValue(raw)}"],[name="${escapeCssAttrValue(raw)}"],[label="${escapeCssAttrValue(raw)}"],[aria-label="${escapeCssAttrValue(raw)}"]`,
    ).length
  }
  const byId = locator.match(/AppiumBy\.id\((.*)\)/)
  if (byId?.[1]) {
    const raw = byId[1].trim().replace(/^['"`]|['"`]$/g, '')
    return $(`[resource-id="${escapeCssAttrValue(raw)}"],[id="${escapeCssAttrValue(raw)}"]`).length
  }
  if (locator.startsWith('//') || locator.startsWith('(//')) {
    return uniqueness.count('xpath', locator, $, xmlDoc)
  }
  return 0
}

function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function roleSelector(role: string): string | null {
  const direct = `[role="${escapeCssAttrValue(role)}"]`
  if (role === 'button') return `${direct},button,input[type="button"],input[type="submit"]`
  if (role === 'textbox') return `${direct},input[type="text"],input:not([type]),textarea`
  if (role === 'combobox') return `${direct},select,input[list]`
  if (role === 'switch') return `${direct},input[type="checkbox"]`
  if (role === 'tab') return direct
  return direct
}
