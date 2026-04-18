import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { RuntimeValidationInput } from '../../domain/contracts/ports.js'
import type { RuntimeValidation } from '../../domain/contracts/types.js'
import { parsePlaywrightLocator } from '../../utils/playwright-locator-parse.js'

let sharedBrowser: import('playwright').Browser | null = null
let browserInit: Promise<import('playwright').Browser> | null = null
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024

/**
 * Lightweight local HTTP bridge so LIMS can auto-validate with real Playwright.
 * Endpoint: POST /validate with payload { action: 'validate_locator', payload: RuntimeValidationInput }
 */
export class PlaywrightRuntimeValidatorBridge {
  private server: ReturnType<typeof createServer> | null = null
  private started = false

  constructor(private readonly port: number) {}

  start(): void {
    if (this.started) return
    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res)
    })
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Common during local development when another LIMS/bridge process is already running.
        // Keep process alive and allow validator to use the already bound endpoint.
        console.warn(`LIMS bridge port ${this.port} already in use, reusing existing runtime bridge if available`)
        this.server = null
        this.started = false
        return
      }
      console.error(`LIMS bridge server error on port ${this.port}: ${String(err)}`)
    })
    this.server.listen(this.port, '127.0.0.1')
    this.started = true
  }

  stop(): void {
    if (!this.server) return
    this.server.close()
    this.server = null
    this.started = false
    if (sharedBrowser) {
      void sharedBrowser.close().catch(() => undefined)
      sharedBrowser = null
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/validate') {
      this.writeJson(res, 404, { error: 'not_found' })
      return
    }
    try {
      const body = await readBody(req, MAX_REQUEST_BODY_BYTES)
      const parsed = JSON.parse(body) as {
        action?: string
        payload?: RuntimeValidationInput
      }
      if (parsed.action !== 'validate_locator' || !parsed.payload) {
        this.writeJson(res, 400, { error: 'bad_request' })
        return
      }
      const out = await validateWithPlaywright(parsed.payload)
      this.writeJson(res, 200, out)
    } catch (err) {
      if (err instanceof Error && err.message === 'payload_too_large') {
        this.writeJson(res, 413, { error: 'payload_too_large' })
        return
      }
      this.writeJson(res, 500, {
        executed: false,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: [`bridge failure: ${String(err)}`],
      } satisfies RuntimeValidation)
    }
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(payload))
  }
}

async function validateWithPlaywright(input: RuntimeValidationInput): Promise<RuntimeValidation> {
  const html = input.domSnapshot ?? input.domSnapshots?.[0]
  const wantsLivePage = Boolean(
    input.runtimeContext?.mode === 'live-page' ||
    input.runtimeContext?.useCurrentPage ||
    input.runtimeContext?.pageUrl,
  )
  if (!html && !wantsLivePage) {
    return {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['bridge runtime skipped: no dom snapshot or live runtime context'],
    }
  }

  let playwrightMod: typeof import('playwright') | null = null
  try {
    playwrightMod = await import('playwright')
  } catch {
    return {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['playwright package not installed in runtime bridge'],
    }
  }

  const browser = await getSharedBrowser(playwrightMod)
  const context = await browser.newContext()
  const page = await context.newPage()
  const retries = Math.max(1, input.retries ?? 1)
  let successCount = 0
  let last: RuntimeValidation = {
    executed: false,
    unique: false,
    visible: false,
    interactable: false,
    success: false,
    notes: [],
  }

  try {
    for (let i = 0; i < retries; i++) {
      await preparePageForValidation(page, input, html)
      const single = await validateSingle(page, input)
      last = single
      if (single.success) successCount += 1
    }
  } finally {
    await context.close()
  }

  const stableOverRetries = successCount === retries
  return {
    ...last,
    success: last.success && stableOverRetries,
    attempts: retries,
    stableOverRetries,
    notes: [...last.notes, `bridge retry stability ${successCount}/${retries}`],
  }
}

async function validateSingle(
  page: import('playwright').Page,
  input: RuntimeValidationInput,
): Promise<RuntimeValidation> {
  try {
    const locator = buildLocator(page, input)
    const count = await locator.count()
    const unique = count === 1
    let visible = false
    let interactable = false
    if (unique) {
      const first = locator.first()
      visible = await first.isVisible()
      try {
        await first.click({ trial: true, timeout: 2000 })
        interactable = true
      } catch {
        interactable = false
      }
    }
    return {
      executed: true,
      unique,
      visible,
      interactable,
      success: unique && visible && interactable,
      notes: [`playwright bridge count=${count}`],
    }
  } catch (err) {
    return {
      executed: true,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: [`playwright bridge error: ${String(err)}`],
    }
  }
}

function buildLocator(
  page: import('playwright').Page,
  input: RuntimeValidationInput,
): import('playwright').Locator {
  const root = input.runtimeContext?.frameLocator
    ? page.frameLocator(input.runtimeContext.frameLocator)
    : page

  if (input.kind === 'css') return root.locator(input.locator)
  if (input.kind === 'xpath') return root.locator(`xpath=${input.locator}`)
  if (input.kind === 'playwright') {
    const parsed = parsePlaywrightLocator(input.locator)
    if (!parsed) return root.locator(input.locator)
    if (parsed.kind === 'text') return root.getByText(parsed.text)
    if (parsed.kind === 'label') return root.getByLabel(parsed.text)
    if (parsed.kind === 'placeholder') return root.getByPlaceholder(parsed.text)
    if (parsed.kind === 'test-id') return root.getByTestId(parsed.text)
    if (parsed.kind === 'alt') return root.getByAltText(parsed.text)
    if (parsed.kind === 'title') return root.getByTitle(parsed.text)
    if (parsed.kind === 'css') return root.locator(parsed.selector)
    if (parsed.kind === 'xpath') return root.locator(`xpath=${parsed.selector}`)
    if (parsed.kind === 'contextual-attribute') {
      return root
        .getByText(parsed.anchorText)
        .locator('..')
        .locator(`[${parsed.attribute}="${escapeCss(parsed.value)}"]`)
    }
    if (parsed.kind === 'role') {
      if (!isKnownAriaRole(parsed.role)) return root.locator(input.locator)
      const typedRole = parsed.role as Parameters<import('playwright').Page['getByRole']>[0]
      return parsed.name
        ? root.getByRole(typedRole, { name: parsed.name })
        : root.getByRole(typedRole)
    }
    return root.locator(input.locator)
  }
  if (input.kind === 'appium') {
    const a11yMatch = input.locator.match(/AppiumBy\.accessibilityId\((.*)\)/)
    if (a11yMatch?.[1]) {
      const raw = a11yMatch[1].trim().replace(/^['"`]|['"`]$/g, '')
      return root.locator(
        `[content-desc="${escapeCss(raw)}"],[name="${escapeCss(raw)}"],[label="${escapeCss(raw)}"],[aria-label="${escapeCss(raw)}"]`,
      )
    }
    if (input.locator.startsWith('//') || input.locator.startsWith('(//')) {
      return root.locator(`xpath=${input.locator}`)
    }
    return root.locator('[data-lims-never-match="1"]')
  }
  return root.locator('[data-lims-never-match="1"]')
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(new Error('payload_too_large'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('data', (c) => {
      size += Buffer.byteLength(c)
      if (size > maxBytes) {
        req.destroy(new Error('payload_too_large'))
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function getSharedBrowser(
  playwrightMod: typeof import('playwright'),
): Promise<import('playwright').Browser> {
  if (sharedBrowser) return sharedBrowser
  if (!browserInit) {
    browserInit = launchBrowser(playwrightMod)
      .then((b) => {
        sharedBrowser = b
        return b
      })
      .finally(() => {
        browserInit = null
      })
  }
  return browserInit
}

async function launchBrowser(
  playwrightMod: typeof import('playwright'),
): Promise<import('playwright').Browser> {
  const headless = (process.env.LIMS_PLAYWRIGHT_BROWSER_HEADLESS ?? 'true').toLowerCase() !== 'false'
  const args = parseLaunchArgs(process.env.LIMS_PLAYWRIGHT_BROWSER_ARGS)
  const preferredChannel = process.env.LIMS_PLAYWRIGHT_BROWSER_CHANNEL?.trim()
  const channelCandidates = preferredChannel
    ? [preferredChannel]
    : ['chrome', 'chromium']

  let lastErr: unknown
  for (const channel of channelCandidates) {
    try {
      if (channel === 'chromium') {
        return await playwrightMod.chromium.launch({ headless, args })
      }
      return await playwrightMod.chromium.launch({
        channel: channel as 'chrome' | 'chrome-beta' | 'msedge' | 'msedge-beta' | 'msedge-dev' | 'msedge-canary',
        headless,
        args,
      })
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to launch Playwright browser')
}

function parseLaunchArgs(raw: string | undefined): string[] {
  const v = raw?.trim()
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    if (Array.isArray(parsed)) return parsed.map((x) => String(x))
  } catch {
    return v.split(/\s+/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

function escapeCss(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function preparePageForValidation(
  page: import('playwright').Page,
  input: RuntimeValidationInput,
  html: string | undefined,
): Promise<void> {
  if (input.runtimeContext?.pageUrl) {
    await page.goto(input.runtimeContext.pageUrl, { waitUntil: 'domcontentloaded' })
  } else if (html) {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
  } else if (!(input.runtimeContext?.useCurrentPage || input.runtimeContext?.mode === 'live-page')) {
    throw new Error('No DOM snapshot or live runtime context available')
  }

  if (input.runtimeContext?.waitForSelector) {
    await page.waitForSelector(input.runtimeContext.waitForSelector, { timeout: 5_000 })
  }
  if (input.runtimeContext?.waitForTimeoutMs) {
    await page.waitForTimeout(input.runtimeContext.waitForTimeoutMs)
  }
}

function isKnownAriaRole(role: string): boolean {
  const known = new Set([
    'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption',
    'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition',
    'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic',
    'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem',
    'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation',
    'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar',
    'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'subscript',
    'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time',
    'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
  ])
  return known.has(role)
}
