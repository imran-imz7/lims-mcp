import * as cheerio from 'cheerio'
import xpath from 'xpath'
import { DOMParser } from '@xmldom/xmldom'
import type {
  PlaywrightValidatorPort,
  RuntimeValidationInput,
} from '../../domain/contracts/ports.js'
import type { RuntimeValidation } from '../../domain/contracts/types.js'
import type { PlaywrightMcpValidatorAdapter } from './playwright-mcp-validator.adapter.js'
import { parsePlaywrightLocator } from '../../utils/playwright-locator-parse.js'

/**
 * Runtime validation with two modes:
 * - optional remote Playwright MCP bridge (HTTP endpoint)
 * - local DOM heuristic fallback
 */
export class PlaywrightValidatorAdapter implements PlaywrightValidatorPort {
  private static readonly REMOTE_MAX_ATTEMPTS = 2
  private static readonly REMOTE_TIMEOUT_MS = 5000

  constructor(
    private readonly endpointUrl?: string,
    private readonly mcpValidator?: PlaywrightMcpValidatorAdapter,
  ) {}

  async validate(input: RuntimeValidationInput): Promise<RuntimeValidation> {
    if (this.mcpValidator) {
      const mcp = await this.mcpValidator.validate(input)
      if (mcp.executed) return mcp
    }
    if (this.endpointUrl) {
      const remote = await this.validateRemote(input)
      if (remote) return remote
    }
    return tagRuntimeSource(this.validateLocalWithRetries(input), 'local-fallback')
  }

  async close(): Promise<void> {
    if (!this.mcpValidator) return
    await this.mcpValidator.close()
  }

  private async validateRemote(
    input: RuntimeValidationInput,
  ): Promise<RuntimeValidation | null> {
    for (let attempt = 1; attempt <= PlaywrightValidatorAdapter.REMOTE_MAX_ATTEMPTS; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), PlaywrightValidatorAdapter.REMOTE_TIMEOUT_MS)
      try {
        const response = await fetch(this.endpointUrl!, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'validate_locator',
            payload: input,
          }),
          signal: ac.signal,
        })
        if (!response.ok) continue
        const parsed = (await response.json()) as RuntimeValidation
        if (typeof parsed.success === 'boolean') return tagRuntimeSource(parsed, 'http-bridge')
      } catch {
        // retry once
      } finally {
        clearTimeout(timer)
      }
      if (attempt < PlaywrightValidatorAdapter.REMOTE_MAX_ATTEMPTS) {
        await sleep(150 * attempt)
      }
    }
    return null
  }

  private validateLocalWithRetries(input: RuntimeValidationInput): RuntimeValidation {
    const snapshots = input.domSnapshots?.length
      ? input.domSnapshots
      : input.domSnapshot
        ? [input.domSnapshot]
        : []
    const retries = Math.max(1, input.retries ?? 1)
    if (!snapshots.length) {
      return {
        executed: false,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['runtime skipped: no dom snapshot available'],
        attempts: 0,
        stableOverRetries: false,
      }
    }
    const runs: RuntimeValidation[] = []
    for (let i = 0; i < retries; i++) {
      runs.push(this.validateLocal({ ...input, domSnapshot: snapshots[i % snapshots.length] }))
    }
    const successCount = runs.filter((r) => r.success).length
    const stableOverRetries = successCount === runs.length
    const last = runs[runs.length - 1]!
    return {
      ...last,
      success: last.success && stableOverRetries,
      notes: [...last.notes, `retry stability ${successCount}/${runs.length}`],
      attempts: runs.length,
      stableOverRetries,
    }
  }

  private validateLocal(input: RuntimeValidationInput): RuntimeValidation {
    if (!input.domSnapshot) {
      return {
        executed: false,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['runtime skipped: no dom snapshot available'],
      }
    }

    const $ = cheerio.load(input.domSnapshot)
    let matchCount = 0
    try {
      if (input.kind === 'css') {
        matchCount = $(input.locator).length
      } else if (input.kind === 'xpath') {
        const xmlDoc = new DOMParser().parseFromString(input.domSnapshot, 'text/html')
        const nodes = xpath.select(input.locator, xmlDoc)
        matchCount = (Array.isArray(nodes) ? nodes : [nodes]).filter(
          (n) => n && (n as { nodeType?: number }).nodeType === 1,
        ).length
      } else if (input.kind === 'playwright') {
        matchCount = derivePlaywrightCount($, input.locator)
      } else if (input.kind === 'appium') {
        matchCount = deriveAppiumCount($, input.locator)
      } else {
        matchCount = 0
      }
    } catch {
      return {
        executed: true,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['selector parse/evaluation failed'],
      }
    }

    const unique = matchCount === 1
    const visible = unique ? inferVisible($, input, matchCount) : false
    const interactable = unique && visible
    return {
      executed: true,
      unique,
      visible,
      interactable,
      success: unique && visible,
      notes: [
        `local-runtime match count=${matchCount}`,
        unique ? 'unique match' : 'non-unique or missing match',
      ],
    }
  }
}

function derivePlaywrightCount($: cheerio.CheerioAPI, locator: string): number {
  const parsed = parsePlaywrightLocator(locator)
  if (!parsed) return 0
  if (parsed.kind === 'text') {
    let n = 0
    $('*').each((_i, el) => {
      if ($(el).text().replace(/\s+/g, ' ').trim() === parsed.text) n += 1
    })
    return n
  }
  if (parsed.kind === 'placeholder') {
    return $(`[placeholder="${escapeCss(parsed.text)}"]`).length
  }
  if (parsed.kind === 'label') {
    const labelForIds = $('label').filter((_i, el) => $(el).text().replace(/\s+/g, ' ').trim() === parsed.text)
      .map((_i, el) => $(el).attr('for'))
      .get()
      .filter(Boolean)
    const byFor = labelForIds.length
      ? labelForIds.reduce((acc, id) => acc + $(`#${cssEscapeId(String(id))}`).length, 0)
      : 0
    const byAria = $(`[aria-label="${escapeCss(parsed.text)}"], [label="${escapeCss(parsed.text)}"]`).length
    return byFor + byAria
  }
  if (parsed.kind === 'test-id') {
    return $(
      `[data-testid="${escapeCss(parsed.text)}"], [data-test="${escapeCss(parsed.text)}"], [data-qa="${escapeCss(parsed.text)}"]`,
    ).length
  }
  if (parsed.kind === 'alt') return $(`[alt="${escapeCss(parsed.text)}"]`).length
  if (parsed.kind === 'title') return $(`[title="${escapeCss(parsed.text)}"]`).length
  if (parsed.kind === 'css') {
    try {
      return $(parsed.selector).length
    } catch {
      return 0
    }
  }
  if (parsed.kind === 'role') {
    const role = parsed.role.toLowerCase()
    const sel = roleSelector(role)
    if (!sel) return 0
    if (!parsed.name) return $(sel).length
    return $(sel).filter((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      const aria = ($(el).attr('aria-label') ?? '').trim()
      const label = ($(el).attr('label') ?? '').trim()
      return text === parsed.name || aria === parsed.name || label === parsed.name
    }).length
  }
  if (parsed.kind === 'contextual-attribute') {
    const parents = $('*').filter(
      (_i, el) => $(el).text().replace(/\s+/g, ' ').trim() === parsed.anchorText,
    )
    let count = 0
    parents.each((_i, el) => {
      const parent = $(el).parent()
      if (!parent.length) return
      count += parent.find(`[${parsed.attribute}="${escapeCss(parsed.value)}"]`).length
    })
    return count
  }
  return 0
}

function inferVisible(
  $: cheerio.CheerioAPI,
  input: RuntimeValidationInput,
  matchCount: number,
): boolean {
  if (matchCount !== 1) return false
  if (input.kind !== 'css' && input.kind !== 'appium') return true
  try {
    const el = input.kind === 'css'
      ? $(input.locator).first()
      : firstAppiumElement($, input.locator)
    if (!el || !('attr' in el)) return false
    const style = (el.attr('style') ?? '').toLowerCase()
    if (style.includes('display:none') || style.includes('visibility:hidden')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function deriveAppiumCount($: cheerio.CheerioAPI, locator: string): number {
  const a11y = locator.match(/AppiumBy\.accessibilityId\((.*)\)/)
  if (a11y?.[1]) {
    const raw = a11y[1].trim().replace(/^['"`]|['"`]$/g, '')
    return $(
      `[content-desc="${escapeCss(raw)}"],[name="${escapeCss(raw)}"],[label="${escapeCss(raw)}"],[aria-label="${escapeCss(raw)}"]`,
    ).length
  }
  if (locator.startsWith('//') || locator.startsWith('(//')) {
    try {
      const xmlDoc = new DOMParser().parseFromString($.html(), 'text/html')
      const nodes = xpath.select(locator, xmlDoc)
      return (Array.isArray(nodes) ? nodes : [nodes]).filter(
        (n) => n && (n as { nodeType?: number }).nodeType === 1,
      ).length
    } catch {
      return 0
    }
  }
  return 0
}

function firstAppiumElement($: cheerio.CheerioAPI, locator: string): cheerio.Cheerio<any> | null {
  const a11y = locator.match(/AppiumBy\.accessibilityId\((.*)\)/)
  if (!a11y?.[1]) return null
  const raw = a11y[1].trim().replace(/^['"`]|['"`]$/g, '')
  const hit = $(
    `[content-desc="${escapeCss(raw)}"],[name="${escapeCss(raw)}"],[label="${escapeCss(raw)}"],[aria-label="${escapeCss(raw)}"]`,
  ).first()
  return hit.length ? hit : null
}

function escapeCss(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function roleSelector(role: string): string | null {
  const direct = `[role="${escapeCss(role)}"]`
  if (role === 'button') return `${direct},button,input[type="button"],input[type="submit"]`
  if (role === 'textbox') return `${direct},input[type="text"],input:not([type]),textarea`
  if (role === 'combobox') return `${direct},select,input[list]`
  if (role === 'switch') return `${direct},input[type="checkbox"]`
  if (role === 'tab') return `${direct}`
  return direct
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tagRuntimeSource(
  runtime: RuntimeValidation,
  source: 'http-bridge' | 'local-fallback',
): RuntimeValidation {
  const notes = [...(runtime.notes ?? [])]
  const tag = `source:${source}`
  if (!notes.some((n) => n.toLowerCase() === tag)) {
    notes.push(tag)
  }
  return {
    ...runtime,
    notes,
  }
}
