import type * as cheerio from 'cheerio'
import type { Element as DomHandlerElement } from 'domhandler'
import xpath from 'xpath'
import type { DomRepository } from '../../infrastructure/parsers/dom-repository.js'
import type { LoggerPort } from '../../infrastructure/logging/logger.port.js'
import type { TargetDescriptor } from '../contracts/types.js'
import { parsePlaywrightLocator } from '../../utils/playwright-locator-parse.js'

export interface ResolvedTarget {
  node: cheerio.Cheerio<DomHandlerElement>
}

/**
 * Resolves MCP `target` string to a cheerio node (CSS, XPath, text:, role:, or a11y:).
 */
export class TargetResolver {
  constructor(
    private readonly dom: DomRepository,
    private readonly log: LoggerPort,
  ) {}

  resolveIfUnique($: cheerio.CheerioAPI, xmlDoc: globalThis.Document, oldLocator: string): ResolvedTarget | null {
    const t = oldLocator.trim()
    if (!t) return null
    try {
      if (t.startsWith('//') || t.startsWith('(//') || /^\/html/i.test(t)) {
        if (this.dom.xpathCount(t, xmlDoc) !== 1) return null
        return this.byXPath($, xmlDoc, t)
      }
      if (t.startsWith('AppiumBy.')) {
        return this.byAppiumLocator($, xmlDoc, t, true)
      }
      const parsedPlaywright = parsePlaywrightLocator(t)
      if (parsedPlaywright) {
        return this.byPlaywrightLocator($, xmlDoc, parsedPlaywright, true)
      }
      const hit = $(t)
      if (hit.length === 1) return { node: hit.first() as cheerio.Cheerio<DomHandlerElement> }
    } catch (err) {
      this.log.debug({ err, t }, 'resolveIfUnique failed')
    }
    return null
  }

  resolveDescriptor(
    $: cheerio.CheerioAPI,
    xmlDoc: globalThis.Document,
    descriptor: TargetDescriptor,
  ): ResolvedTarget | null {
    if (descriptor.xpath) return this.byXPath($, xmlDoc, descriptor.xpath)
    if (descriptor.css) {
      const hit = $(descriptor.css).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    if (descriptor.accessibilityId) {
      const hit = $(
        `[content-desc="${escapeCss(descriptor.accessibilityId)}"], [accessibility-id="${escapeCss(descriptor.accessibilityId)}"], [name="${escapeCss(descriptor.accessibilityId)}"], [label="${escapeCss(descriptor.accessibilityId)}"], [aria-label="${escapeCss(descriptor.accessibilityId)}"]`,
      ).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    if (descriptor.resourceId) {
      const hit = $(`[resource-id="${escapeCss(descriptor.resourceId)}"], [id="${escapeCss(descriptor.resourceId)}"]`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    if (descriptor.iosName) {
      const hit = $(`[name="${escapeCss(descriptor.iosName)}"], [label="${escapeCss(descriptor.iosName)}"]`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    if (descriptor.role) {
      const roleHit = this.byPlaywrightLocator(
        $,
        xmlDoc,
        { kind: 'role', role: descriptor.role, name: descriptor.name ?? descriptor.text },
        false,
      )
      if (roleHit) return roleHit
    }
    if (descriptor.attributes && Object.keys(descriptor.attributes).length) {
      const attrs = Object.entries(descriptor.attributes)
      let selector = descriptor.tag?.trim() || '*'
      selector += attrs
        .map(([name, value]) => `[${name}="${escapeCss(String(value))}"]`)
        .join('')
      const hit = $(selector).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    if (descriptor.text) {
      const hit = this.bestTextNode($, descriptor.text)
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }
    return null
  }

  resolve($: cheerio.CheerioAPI, xmlDoc: globalThis.Document, target: string): ResolvedTarget | null {
    const t = target.trim()
    if (!t) return null

    const trading = this.byTradingContext($, t)
    if (trading) return trading

    if (t.toLowerCase().startsWith('xpath:')) {
      return this.byXPath($, xmlDoc, t.slice(6).trim())
    }

    if (t.startsWith('//') || t.startsWith('(//')) {
      return this.byXPath($, xmlDoc, t)
    }

    if (t.startsWith('AppiumBy.')) {
      return this.byAppiumLocator($, xmlDoc, t, false)
    }

    const parsedPlaywright = parsePlaywrightLocator(t)
    if (parsedPlaywright) {
      return this.byPlaywrightLocator($, xmlDoc, parsedPlaywright, false)
    }

    if (t.toLowerCase().startsWith('text:')) {
      const needle = t.slice(5).trim()
      const hit = this.bestTextNode($, needle)
      return hit.length ? { node: hit as cheerio.Cheerio<DomHandlerElement> } : null
    }

    if (t.toLowerCase().startsWith('role:')) {
      const rest = t.slice(5).trim()
      const [role, namePart] = rest.split('|').map((s) => s.trim())
      let sel = `[role="${role}"]`
      if (namePart) sel += `:contains("${safeContains(namePart)}")`
      const hit = $(sel).first()
      return hit.length ? { node: hit as cheerio.Cheerio<DomHandlerElement> } : null
    }

    if (t.toLowerCase().startsWith('a11y:') || t.toLowerCase().startsWith('accessibilityid:')) {
      const id = t.split(':').slice(1).join(':').trim()
      const hit = $(`[data-testid="${escapeCss(id)}"], [aria-label="${escapeCss(id)}"], #${cssEscape(id)}`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }

    if (t.toLowerCase().startsWith('resource-id:')) {
      const id = t.split(':').slice(1).join(':').trim()
      const hit = $(`[resource-id="${escapeCss(id)}"]`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }

    if (t.toLowerCase().startsWith('content-desc:')) {
      const desc = t.split(':').slice(1).join(':').trim()
      const hit = $(`[content-desc="${escapeCss(desc)}"], [aria-label="${escapeCss(desc)}"]`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }

    if (t.toLowerCase().startsWith('ios-name:')) {
      const name = t.split(':').slice(1).join(':').trim()
      const hit = $(`[name="${escapeCss(name)}"], [label="${escapeCss(name)}"]`).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    }

    try {
      const hit = $(t).first()
      if (hit.length) return { node: hit as cheerio.Cheerio<DomHandlerElement> }
    } catch (err) {
      this.log.debug({ err, t }, 'css target parse failed')
    }

    const fuzzy = this.bestTextNode($, t)
    return fuzzy.length ? { node: fuzzy as cheerio.Cheerio<DomHandlerElement> } : null
  }

  private byTradingContext($: cheerio.CheerioAPI, target: string): ResolvedTarget | null {
    const low = target.toLowerCase()
    const hasRowKey = low.includes('symbol:') || low.includes('instrument:') || low.includes('rowsymbol:')
    const hasActionKey = low.includes('action:') || low.includes('actionlabel:')
    if (!low.includes('|') || !hasRowKey || !hasActionKey) {
      return null
    }
    const kv = new Map<string, string>()
    for (const part of target.split('|')) {
      const idx = part.indexOf(':')
      if (idx <= 0) continue
      const k = part.slice(0, idx).trim().toLowerCase()
      const v = part.slice(idx + 1).trim()
      if (k && v) kv.set(k, v)
    }
    const symbol = kv.get('symbol') ?? kv.get('instrument') ?? kv.get('rowsymbol')
    const action = kv.get('action') ?? kv.get('actionlabel')
    if (!symbol || !action) return null

    const rowCandidates = $('[data-testid="portfolioRow"], [data-symbol], [data-scrip], [data-security-id], [id*="row"], [class*="row"]')
      .filter((_i, el) => containsIgnoreCase($(el).text(), symbol))
    if (!rowCandidates.length) return null

    const actionNodes: Array<cheerio.Cheerio<DomHandlerElement>> = []
    rowCandidates.each((_i, row) => {
      const r = $(row)
      const directAttr = r.find(`[data-testid="${escapeCss(action)}"], [aria-label="${escapeCss(action)}"], [label="${escapeCss(action)}"]`)
      if (directAttr.length) {
        actionNodes.push(directAttr.first() as cheerio.Cheerio<DomHandlerElement>)
        return
      }
      const byRoleBtn = r.find(`[role="button"]:contains("${safeContains(action)}"), button:contains("${safeContains(action)}")`)
      if (byRoleBtn.length) {
        actionNodes.push(byRoleBtn.first() as cheerio.Cheerio<DomHandlerElement>)
      }
    })
    if (!actionNodes.length) return null
    return { node: actionNodes[0] }
  }

  private bestTextNode($: cheerio.CheerioAPI, needleRaw: string): cheerio.Cheerio<DomHandlerElement> {
    const needle = normalizeText(needleRaw)
    if (!needle) return $()
    const all = $('*')
    const exact: Array<{ node: cheerio.Cheerio<DomHandlerElement>; depth: number; len: number }> = []
    const partial: Array<{ node: cheerio.Cheerio<DomHandlerElement>; depth: number; len: number }> = []
    all.each((_i, el) => {
      const node = $(el) as cheerio.Cheerio<DomHandlerElement>
      const txt = normalizeText(node.text())
      if (!txt) return
      const rec = { node, depth: node.parents().length, len: txt.length }
      if (txt === needle) exact.push(rec)
      else if (txt.includes(needle)) partial.push(rec)
    })
    const pick = (arr: Array<{ node: cheerio.Cheerio<DomHandlerElement>; depth: number; len: number }>) => {
      arr.sort((a, b) => {
        if (b.depth !== a.depth) return b.depth - a.depth
        return a.len - b.len
      })
      return arr[0]?.node ?? $()
    }
    if (exact.length) return pick(exact)
    return pick(partial)
  }

  private byXPath($: cheerio.CheerioAPI, xmlDoc: globalThis.Document, expr: string): ResolvedTarget | null {
    try {
      const selected = xpath.select(expr, xmlDoc)
      const nodes = Array.isArray(selected) ? selected : [selected]
      const domEl = nodes.find(
        (n) => n && typeof n === 'object' && 'nodeType' in n && (n as { nodeType: number }).nodeType === 1,
      ) as globalThis.Element | undefined
      if (!domEl) return null
      const cheerioHit = this.mapXmlToCheerio($, domEl)
      return cheerioHit ? { node: cheerioHit } : null
    } catch (err) {
      this.log.warn({ err, expr }, 'xpath target failed')
      return null
    }
  }

  private mapXmlToCheerio($: cheerio.CheerioAPI, el: globalThis.Element): cheerio.Cheerio<DomHandlerElement> | null {
    const id = el.getAttribute('id')
    if (id) {
      const hit = $(`#${cssEscape(id)}`)
      if (hit.length === 1) return hit as cheerio.Cheerio<DomHandlerElement>
    }
    for (const a of ['data-testid', 'data-test', 'data-qa', 'resource-id', 'content-desc', 'accessibility-id', 'name', 'label', 'text', 'value'] as const) {
      const v = el.getAttribute(a)
      if (v) {
        const hit = $(`[${a}="${escapeCss(v)}"]`)
        if (hit.length === 1) return hit as cheerio.Cheerio<DomHandlerElement>
      }
    }
    const name = el.getAttribute('name')
    const tag = el.tagName?.toLowerCase() ?? '*'
    if (name) {
      const hit = $(`${tag}[name="${escapeCss(name)}"]`)
      if (hit.length === 1) return hit as cheerio.Cheerio<DomHandlerElement>
    }
    return null
  }

  private byPlaywrightLocator(
    $: cheerio.CheerioAPI,
    xmlDoc: globalThis.Document,
    locator: ReturnType<typeof parsePlaywrightLocator>,
    requireUnique: boolean,
  ): ResolvedTarget | null {
    if (!locator) return null
    switch (locator.kind) {
      case 'css': {
        const hit = $(locator.selector)
        return uniqueOrFirst(hit, requireUnique)
      }
      case 'xpath':
        return requireUnique && this.dom.xpathCount(locator.selector, xmlDoc) !== 1
          ? null
          : this.byXPath($, xmlDoc, locator.selector)
      case 'text': {
        const hit = this.findExactTextMatches($, locator.text)
        if (hit.length) return uniqueOrFirst(hit, requireUnique)
        return uniqueOrFirst(this.bestTextNode($, locator.text), requireUnique)
      }
      case 'label': {
        const hit = this.findLabeledElements($, locator.text)
        return uniqueOrFirst(hit, requireUnique)
      }
      case 'placeholder':
        return uniqueOrFirst($(`[placeholder="${escapeCss(locator.text)}"]`), requireUnique)
      case 'test-id':
        return uniqueOrFirst(
          $(
            `[data-testid="${escapeCss(locator.text)}"], [data-test="${escapeCss(locator.text)}"], [data-qa="${escapeCss(locator.text)}"]`,
          ),
          requireUnique,
        )
      case 'alt':
        return uniqueOrFirst($(`[alt="${escapeCss(locator.text)}"]`), requireUnique)
      case 'title':
        return uniqueOrFirst($(`[title="${escapeCss(locator.text)}"]`), requireUnique)
      case 'role': {
        const hit = this.findRoleMatches($, locator.role, locator.name)
        return uniqueOrFirst(hit, requireUnique)
      }
      case 'contextual-attribute': {
        const parents = this.findExactTextMatches($, locator.anchorText)
        const scoped = parents
          .map((_i, el) => $(el).parent().find(`[${locator.attribute}="${escapeCss(locator.value)}"]`).toArray())
          .get()
        const hit = $(scoped)
        return uniqueOrFirst(hit, requireUnique)
      }
    }
  }

  private byAppiumLocator(
    $: cheerio.CheerioAPI,
    xmlDoc: globalThis.Document,
    locator: string,
    requireUnique: boolean,
  ): ResolvedTarget | null {
    if (locator.startsWith('//') || locator.startsWith('(//')) {
      return requireUnique && this.dom.xpathCount(locator, xmlDoc) !== 1
        ? null
        : this.byXPath($, xmlDoc, locator)
    }
    const a11y = locator.match(/AppiumBy\.accessibilityId\((.*)\)/)
    if (a11y?.[1]) {
      const raw = a11y[1].trim().replace(/^['"`]|['"`]$/g, '')
      return uniqueOrFirst(
        $(
          `[content-desc="${escapeCss(raw)}"], [accessibility-id="${escapeCss(raw)}"], [name="${escapeCss(raw)}"], [label="${escapeCss(raw)}"], [aria-label="${escapeCss(raw)}"]`,
        ),
        requireUnique,
      )
    }
    const byId = locator.match(/AppiumBy\.id\((.*)\)/)
    if (byId?.[1]) {
      const raw = byId[1].trim().replace(/^['"`]|['"`]$/g, '')
      return uniqueOrFirst(
        $(`[resource-id="${escapeCss(raw)}"], [id="${escapeCss(raw)}"]`),
        requireUnique,
      )
    }
    return null
  }

  private findRoleMatches(
    $: cheerio.CheerioAPI,
    role: string,
    name?: string,
  ): cheerio.Cheerio<DomHandlerElement> {
    const normalizedRole = role.toLowerCase()
    const sel = roleSelector(normalizedRole)
    if (!sel) return $()
    const hits = $(sel)
    if (!name) return hits as cheerio.Cheerio<DomHandlerElement>
    const want = normalizeText(name)
    return hits.filter((_i, el) => {
      const text = normalizeText($(el).text())
      const aria = normalizeText($(el).attr('aria-label') ?? '')
      const label = normalizeText($(el).attr('label') ?? '')
      const nodeName = normalizeText($(el).attr('name') ?? '')
      return [text, aria, label, nodeName].includes(want)
    }) as cheerio.Cheerio<DomHandlerElement>
  }

  private findLabeledElements($: cheerio.CheerioAPI, labelText: string): cheerio.Cheerio<DomHandlerElement> {
    const normalized = normalizeText(labelText)
    const byFor = $('label')
      .filter((_i, el) => normalizeText($(el).text()) === normalized)
      .map((_i, el) => $(el).attr('for'))
      .get()
      .filter(Boolean)
      .map((id) => `#${cssEscape(String(id))}`)
    const direct = $(`[aria-label="${escapeCss(labelText)}"], [label="${escapeCss(labelText)}"]`).toArray()
    const joined = [
      ...direct,
      ...byFor.flatMap((selector) => $(selector).toArray()),
    ]
    return $(joined) as cheerio.Cheerio<DomHandlerElement>
  }

  private findExactTextMatches($: cheerio.CheerioAPI, needleRaw: string): cheerio.Cheerio<DomHandlerElement> {
    const needle = normalizeText(needleRaw)
    const hits = $('*').filter((_i, el) => normalizeText($(el).text()) === needle)
    return hits as cheerio.Cheerio<DomHandlerElement>
  }
}

function safeContains(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeCss(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function cssEscape(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function containsIgnoreCase(text: string, needle: string): boolean {
  return normalizeText(text).includes(normalizeText(needle))
}

function normalizeText(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase()
}

function uniqueOrFirst(
  hit: cheerio.Cheerio<any>,
  requireUnique: boolean,
): ResolvedTarget | null {
  if (!hit.length) return null
  if (requireUnique && hit.length !== 1) return null
  return { node: hit.first() as cheerio.Cheerio<DomHandlerElement> }
}

function roleSelector(role: string): string | null {
  const direct = `[role="${escapeCss(role)}"]`
  if (role === 'button') return `${direct},button,input[type="button"],input[type="submit"]`
  if (role === 'textbox') return `${direct},input[type="text"],input:not([type]),textarea`
  if (role === 'combobox') return `${direct},select,input[list]`
  if (role === 'switch') return `${direct},input[type="checkbox"]`
  if (role === 'tab') return direct
  return direct
}
