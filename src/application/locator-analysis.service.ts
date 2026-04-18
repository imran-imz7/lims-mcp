import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { DomRepository } from '../infrastructure/parsers/dom-repository.js'
import { FrameworkDetector } from '../domain/framework-detector/framework-detector.js'
import { AttributeStabilityAnalyzer } from '../domain/attribute-stability/attribute-stability-analyzer.js'
import type { Element } from 'domhandler'
import { CanvasElementDetector } from '../domain/visual/canvas-element-detector.js'
import { collectTradingHints } from '../domain/trading/trading-ui-support.js'
import { DomainError } from '../utils/errors.js'

/**
 * Application orchestrator for `analyze_dom` MCP tool.
 */
export class LocatorAnalysisService {
  constructor(
    private readonly dom: DomRepository,
    private readonly log: LoggerPort,
  ) {}

  analyze(params: { dom?: string; xml?: string }) {
    const source = params.dom ?? params.xml
    if (!source) {
      throw new DomainError('Either dom or xml must be provided', 'SOURCE_REQUIRED')
    }
    const mode = params.xml ? 'xml' : 'html'
    const parsed = this.dom.parse(source, mode)
    const fw = new FrameworkDetector().detect(parsed.$)
    const stability = new AttributeStabilityAnalyzer()

    const samples: Array<Record<string, string>> = []
    parsed.$('*')
      .slice(0, 400)
      .each((_i, el) => {
        if (el.type !== 'tag') return
        const te = el as Element
        if (!te.attribs) return
        const rec: Record<string, string> = {}
        for (const [k, v] of Object.entries(te.attribs)) {
          rec[k.toLowerCase()] = String(v)
        }
        if (Object.keys(rec).length) samples.push(rec)
      })

    const report = stability.buildReportFromDomAttributes(samples)
    const canvas = new CanvasElementDetector().detect(parsed.$)
    const tradingHints = samples
      .slice(0, 60)
      .flatMap((a) => collectTradingHints(a, ''))
      .slice(0, 20)

    this.log.info({ framework: fw.kind, samples: report.sampleSize }, 'analyze_dom')

    return {
      framework: fw.kind,
      mode,
      recommendedAttributes: fw.recommendedAttributes,
      stabilityReport: {
        sampleSize: report.sampleSize,
        entries: report.entries,
      },
      hints: fw.hints,
      visualHints: {
        likelyTextAnchors: ['aria-label', 'placeholder', 'textContent', 'content-desc'],
        structuralAnchors: ['data-testid', 'data-test', 'data-qa', 'id', 'name', 'role'],
        canvas,
        tradingHints,
      },
    }
  }
}
