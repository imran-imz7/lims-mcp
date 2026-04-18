import * as cheerio from 'cheerio';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { createHash } from 'node:crypto';
import type { LoggerPort } from '../logging/logger.port.js';
import type { MemoryCache } from '../cache/memory-cache.js';

export interface ParsedDom {
  readonly source: string
  readonly $: cheerio.CheerioAPI
  readonly xmlDoc: globalThis.Document
  readonly cacheKey: string
  readonly mode: 'html' | 'xml'
}

/**
 * Parses HTML once and exposes cheerio + XPath-compatible document.
 */
export class DomRepository {
  constructor(
    private readonly cache: MemoryCache,
    private readonly log: LoggerPort,
  ) {}

  parse(source: string, mode: 'html' | 'xml' = 'html'): ParsedDom {
    const cacheKey = createHash('sha256').update(`${mode}:${source}`).digest('hex')
    const hit = this.cache.get<ParsedDom>(cacheKey)
    if (hit) return hit

    const $ = cheerio.load(source, { xml: mode === 'xml' })
    const xmlDoc = new DOMParser().parseFromString(
      source,
      mode === 'xml' ? 'application/xml' : 'text/html',
    )

    const parsed: ParsedDom = {
      source,
      $,
      xmlDoc,
      cacheKey,
      mode,
    }
    this.cache.set(cacheKey, parsed)
    this.log.debug({ cacheKey: cacheKey.slice(0, 12), bytes: source.length, mode }, 'source parsed')
    return parsed
  }

  xpathSelect(expression: string, xmlDoc: globalThis.Document): unknown[] {
    try {
      const nodes = xpath.select(expression, xmlDoc)
      return Array.isArray(nodes) ? nodes : [nodes]
    } catch (err) {
      this.log.warn({ err, expression }, 'xpath evaluation failed')
      return []
    }
  }

  xpathCount(expression: string, xmlDoc: globalThis.Document): number {
    const nodes = this.xpathSelect(expression, xmlDoc)
    return nodes.filter((n) => n && (n as { nodeType?: number }).nodeType === 1).length
  }
}
