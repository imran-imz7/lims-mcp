import type * as cheerio from 'cheerio'

export interface CanvasDetection {
  hasCanvasUi: boolean
  hasWebGL: boolean
  hasSvg: boolean
  hints: string[]
}

/**
 * Detects chart/canvas/webgl/svg-heavy interfaces common in trading platforms.
 */
export class CanvasElementDetector {
  detect($: cheerio.CheerioAPI): CanvasDetection {
    const hasCanvasUi = $('canvas').length > 0
    const hasWebGL = $('[data-webgl], [class*="webgl"], [id*="webgl"], canvas[webgl]').length > 0
    const hasSvg = $('svg').length > 0
    const hints: string[] = []
    if (hasCanvasUi) hints.push('canvas nodes present')
    if (hasWebGL) hints.push('webgl marker present')
    if (hasSvg) hints.push('svg graph nodes present')
    return { hasCanvasUi, hasWebGL, hasSvg, hints }
  }
}
