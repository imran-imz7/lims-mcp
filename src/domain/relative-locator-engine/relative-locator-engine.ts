import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { CssBuilder } from '../css-builder/css-builder.js'
import { XPathBuilder } from '../xpath-builder/xpath-builder.js'

export interface RelativeLocatorCandidate {
  kind: 'xpath' | 'css'
  value: string
  label: string
}

/**
 * Label/proximity/sibling relative locator strategies.
 */
export class RelativeLocatorEngine {
  constructor(
    private readonly xpath = new XPathBuilder(),
    private readonly css = new CssBuilder(),
  ) {}

  generateForNode(target: cheerio.Cheerio<Element>, _$: cheerio.CheerioAPI): RelativeLocatorCandidate[] {
    const out: RelativeLocatorCandidate[] = []
    const tag = (target.get(0)?.name ?? 'div').toLowerCase()
    const text = target.text().trim().slice(0, 80)

    const prevLabel = target.prevAll('label').first()
    if (prevLabel.length) {
      const lt = prevLabel.text().trim()
      if (lt) {
        out.push({
          kind: 'xpath',
          value: this.xpath.followingInputAfterLabelText(lt),
          label: 'label → following input',
        })
      }
    }

    const parentForm = target.parents('form').first()
    if (parentForm.length && tag === 'input') {
      const formId = parentForm.attr('id')
      if (formId) {
        out.push({
          kind: 'css',
          value: this.css.descendant(this.css.byId(formId), `input[name="${escapeAttr(target.attr('name') ?? '')}"]`),
          label: 'form scope + input name',
        })
      }
    }

    const prevSib = target.prev()
    if (prevSib.length && prevSib.get(0)?.type === 'tag') {
      const psTag = (prevSib.get(0) as Element).name
      if (psTag === 'label') {
        out.push({
          kind: 'xpath',
          value: `//label[normalize-space(.)=${safeLit(prevSib.text())}]/following-sibling::${tag}[1]`,
          label: 'label sibling',
        })
      }
    }

    if (text && ['button', 'a'].includes(tag)) {
      out.push({
        kind: 'xpath',
        value: this.xpath.byContainsText(tag, text),
        label: 'text proximity (contains)',
      })
    }

    const stableAncestor = nearestStableAncestor(target)
    if (stableAncestor) {
      const childSel = target.attr('name')
        ? `${tag}[name="${escapeAttr(target.attr('name') ?? '')}"]`
        : tag
      out.push({
        kind: 'css',
        value: this.css.nestedScoped(
          stableAncestor.tag,
          { name: stableAncestor.attrName, value: stableAncestor.attrValue },
          childSel,
        ),
        label: 'nested stable ancestor scope',
      })
      out.push({
        kind: 'xpath',
        value: `//${stableAncestor.tag}[@${stableAncestor.attrName}=${safeLit(stableAncestor.attrValue)}]//${tag}`,
        label: 'nested ancestor xpath scope',
      })
    }

    return out
  }
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function safeLit(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (!t.includes("'")) return `'${t}'`
  return `"${t.replace(/"/g, '\\"')}"`
}

function nearestStableAncestor(target: cheerio.Cheerio<Element>):
  | { tag: string; attrName: string; attrValue: string }
  | null {
  const ancestors = target.parents().toArray()
  for (const node of ancestors) {
    const tag = (node as Element).name
    const attrs = (node as Element).attribs ?? {}
    for (const k of ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name', 'id'] as const) {
      const v = attrs[k]
      if (!v) continue
      if (looksDynamic(v)) continue
      return { tag, attrName: k, attrValue: v }
    }
  }
  return null
}

function looksDynamic(v: string): boolean {
  if (/\d{4,}/.test(v)) return true
  if (/[a-f0-9]{8,}/i.test(v)) return true
  return false
}
