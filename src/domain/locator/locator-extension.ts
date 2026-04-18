import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { FrameworkProfile } from '../framework-detector/framework-detector.js'
import type { LocatorCandidate, Platform } from '../contracts/types.js'

/**
 * Immutable context exposed to external locator candidate providers.
 * Providers can inspect parsed structures and return additive candidates.
 */
export interface LocatorGenerationContext {
  $: cheerio.CheerioAPI
  xmlDoc: globalThis.Document
  target: cheerio.Cheerio<Element>
  platform: Platform
  framework: FrameworkProfile
  tag: string
  attrs: Record<string, string>
  targetText: string
}

/**
 * Pluggable strategy contract for scale:
 * add new provider modules without touching core LocatorEngine internals.
 */
export interface LocatorCandidateProvider {
  id: string
  provideCandidates(ctx: LocatorGenerationContext): Array<
    Omit<LocatorCandidate, 'metadata'> & { metadata?: Record<string, unknown> }
  >
}
