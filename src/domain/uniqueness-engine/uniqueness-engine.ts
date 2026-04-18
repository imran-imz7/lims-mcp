import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { DomRepository } from '../../infrastructure/parsers/dom-repository.js'
import type { SelectorValidator } from '../selector-validator/selector-validator.js'

export interface UniquenessResult {
  matchCount: number
  refined?: { kind: 'css' | 'xpath'; value: string }
}

/**
 * Ensures locator resolves to exactly one element; proposes refinements when needed.
 * Positional XPath `[1]` is a last resort (AGENTS.md).
 */
export class UniquenessEngine {
  constructor(
    private readonly dom: DomRepository,
    private readonly validator: SelectorValidator,
  ) {}

  count(kind: 'css' | 'xpath', value: string, $: cheerio.CheerioAPI, xmlDoc: globalThis.Document): number {
    if (kind === 'css') {
      const v = this.validator.validateCss(value)
      if (!v.ok) return 0
      try {
        return $(value).length
      } catch {
        return 0
      }
    }
    return this.dom.xpathCount(value, xmlDoc)
  }

  /** Count elements whose normalized visible text equals `text` (Playwright getByText parity). */
  countExactNormalizedText($: cheerio.CheerioAPI, text: string): number {
    const want = normalizeVisible(text)
    if (!want) return 0
    let n = 0
    $('*').each((_i, el) => {
      if (el.type !== 'tag') return
      const t = normalizeVisible($(el).text())
      if (t === want) n++
    })
    return n
  }

  refineCssWithHierarchy(
    baseCss: string,
    target: cheerio.Cheerio<Element>,
    $: cheerio.CheerioAPI,
    xmlDoc: globalThis.Document,
  ): UniquenessResult {
    const initial = this.count('css', baseCss, $, xmlDoc)
    if (initial === 1) return { matchCount: 1 }

    let cur = target
    let attempt = baseCss
    for (let i = 0; i < 6 && cur.length; i++) {
      const parent = cur.parent()
      const pEl = parent.get(0)
      if (!pEl || pEl.type !== 'tag') break
      const pid = parent.attr('id')
      if (pid) {
        attempt = `#${cssEscape(pid)} ${baseCss}`
        const c = this.count('css', attempt, $, xmlDoc)
        if (c === 1) return { matchCount: 1, refined: { kind: 'css', value: attempt } }
      }
      for (const a of ['data-testid', 'data-test', 'data-qa'] as const) {
        const pval = parent.attr(a)
        if (pval) {
          attempt = `[${a}="${escapeAttr(pval)}"] ${baseCss}`
          const c = this.count('css', attempt, $, xmlDoc)
          if (c === 1) return { matchCount: 1, refined: { kind: 'css', value: attempt } }
        }
      }
      cur = parent
    }

    return { matchCount: initial }
  }

  refineXPathWithPosition(expression: string, $: cheerio.CheerioAPI, xmlDoc: globalThis.Document): UniquenessResult {
    const c = this.count('xpath', expression, $, xmlDoc)
    if (c === 1) return { matchCount: 1 }
    if (c <= 1) return { matchCount: c }
    const positioned = `(${expression})[1]`
    const c2 = this.count('xpath', positioned, $, xmlDoc)
    if (c2 === 1) return { matchCount: 1, refined: { kind: 'xpath', value: positioned } }
    return { matchCount: c }
  }
}

function normalizeVisible(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function cssEscape(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
