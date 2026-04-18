import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import {
  nearestRowLikeContainer,
  platformChildAnchorAttributes,
  platformPrimaryAttributes,
  platformSemanticAttributes,
} from '../../src/domain/locator/ui-pattern-intelligence.js'

describe('ui-pattern-intelligence', () => {
  it('returns cross-platform attribute families', () => {
    expect(platformPrimaryAttributes('web')).toContain('data-automation-id')
    expect(platformPrimaryAttributes('android')).toContain('resource-id')
    expect(platformPrimaryAttributes('ios')).toContain('label')
    expect(platformSemanticAttributes('web')).toContain('aria-label')
    expect(platformChildAnchorAttributes('web')).toContain('label')
  })

  it('detects row-like container with stable anchor', () => {
    const $ = load(`
      <section>
        <div class="portfolio-row" data-testid="portfolioRow">
          <div>INFY-EQ</div>
          <button label="B">B</button>
        </div>
      </section>
    `)
    const target = $('button').first()
    const anchor = nearestRowLikeContainer(target, $)
    expect(anchor?.attrName).toBe('data-testid')
    expect(anchor?.attrValue).toBe('portfolioRow')
  })
})
