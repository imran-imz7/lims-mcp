import type * as cheerio from 'cheerio'
import {
  isLikelyTradingPlatformText,
  isTradingWebAttribute,
} from '../trading/trading-ui-support.js'

export type FrameworkKind = 'react' | 'angular' | 'vue' | 'flutter-web' | 'unknown'

export interface FrameworkProfile {
  kind: FrameworkKind
  recommendedAttributes: string[]
  hints: string[]
}

/**
 * Framework awareness (AGENTS.md): React / Angular / Flutter Web markers.
 */
export class FrameworkDetector {
  detect($: cheerio.CheerioAPI): FrameworkProfile {
    const html = $.root().html() ?? ''
    const hints: string[] = []
    const hostHint = $('meta[property="og:site_name"]').attr('content') ?? ''
    const titleHint = $('title').first().text() ?? ''

    let reactScore = 0
    if (/data-reactroot/i.test(html) || /data-reactid/i.test(html)) reactScore += 2
    if ($('[data-testid]').length || $('[data-test]').length || $('[data-qa]').length) {
      reactScore += 3
      hints.push('test id attributes present')
    }

    let angularScore = 0
    if ($('[ng-version]').length) {
      angularScore += 2
      hints.push('ng-version')
    }
    const ngReflect = $('[ng-reflect-name], [ng-reflect-model]').length
    if (ngReflect) {
      angularScore += 2
      hints.push('ng-reflect-* attributes')
    }

    let vueScore = 0
    if (/data-v-[a-f0-9]{8}/i.test(html)) {
      vueScore += 2
      hints.push('Vue scoped attribute')
    }

    let flutterScore = 0
    if (/flt-|flutter-view|flutter-decoration/i.test(html)) {
      flutterScore += 3
      hints.push('Flutter web markers')
    }

    let paytmMoneyScore = 0
    if (
      isLikelyTradingPlatformText(html) ||
      isLikelyTradingPlatformText(hostHint) ||
      isLikelyTradingPlatformText(titleHint)
    ) {
      paytmMoneyScore += 3
      hints.push('trading platform text marker')
    }
    const tradingAttrHits = $('*')
      .slice(0, 600)
      .toArray()
      .reduce((acc, el) => {
        if (el.type !== 'tag') return acc
        const attrs = (el as { attribs?: Record<string, string> }).attribs ?? {}
        for (const k of Object.keys(attrs)) {
          if (isTradingWebAttribute(k)) return acc + 1
        }
        return acc
      }, 0)
    if (tradingAttrHits > 0) {
      paytmMoneyScore += 2
      hints.push('trading data attributes present')
    }

    const scores: Array<{ k: FrameworkKind; s: number }> = [
      { k: 'react', s: reactScore },
      { k: 'angular', s: angularScore },
      { k: 'vue', s: vueScore },
      { k: 'flutter-web', s: flutterScore },
    ]
    scores.sort((a, b) => b.s - a.s)
    const winner = scores[0]
    if (!winner || winner.s === 0) {
      const unknownHints = [...hints]
      if (!unknownHints.length) unknownHints.push('no strong framework markers')
      return {
        kind: 'unknown',
        recommendedAttributes: [
          'data-testid',
          'data-test',
          'data-qa',
          'data-symbol',
          'data-scrip',
          'data-security-id',
          'data-token',
          'data-instrument-token',
          'data-segment',
          'data-exchange',
          'data-side',
          'data-action',
          'id',
          'name',
          'aria-label',
          'role',
          'type',
          'placeholder',
        ],
        hints: unknownHints,
      }
    }

    return {
      kind: winner.k,
      recommendedAttributes: mergeUnique(
        recommendedFor(winner.k),
        paytmMoneyScore > 0
          ? [
              'data-symbol',
              'data-scrip',
              'data-security-id',
              'data-token',
              'data-instrument-token',
              'data-segment',
              'data-exchange',
              'data-side',
              'data-action',
              'aria-label',
              'name',
              'id',
            ]
          : [],
      ),
      hints,
    }
  }
}

function recommendedFor(kind: FrameworkKind): string[] {
  switch (kind) {
    case 'react':
      return ['data-testid', 'data-test', 'data-qa', 'data-cy', 'aria-label', 'role', 'name', 'id']
    case 'angular':
      return ['data-testid', 'data-test', 'data-qa', 'ng-reflect-name', 'name', 'id', 'aria-label', 'formcontrolname']
    case 'vue':
      return ['data-testid', 'data-test', 'data-qa', 'data-cy', 'aria-label', 'role', 'name']
    case 'flutter-web':
      return ['flt-semantics-identifier', 'aria-label', 'role', 'data-flt-semantics']
    default:
      return ['data-testid', 'data-test', 'data-qa', 'id', 'name', 'aria-label']
  }
}

function mergeUnique(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])]
}
