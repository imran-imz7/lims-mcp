import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import { FrameworkDetector } from '../../src/domain/framework-detector/framework-detector.js'

describe('FrameworkDetector trading awareness', () => {
  it('adds trading attributes for Groww-like pages', () => {
    const $ = load(`
      <html>
        <head><title>Groww - Stocks</title></head>
        <body>
          <div data-symbol="RELIANCE" data-segment="NSE"></div>
        </body>
      </html>
    `)
    const out = new FrameworkDetector().detect($)
    expect(out.recommendedAttributes).toContain('data-symbol')
    expect(out.recommendedAttributes).toContain('data-segment')
    expect(out.hints.join(' ')).toContain('trading')
  })
})
