import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  CapturedPage,
  PageCaptureInput,
  PageCapturePort,
  PlaywrightValidatorPort,
  RuntimeValidationInput,
} from '../../domain/contracts/ports.js'
import type { RuntimeValidation, TargetDescriptor } from '../../domain/contracts/types.js'
import { DomainError } from '../../utils/errors.js'

const DEFAULT_TOOL_CANDIDATES = [
  'validate_locator',
  'playwright_validate_locator',
  'locator_validate',
  'browser_run_code',
] as const

export type PlaywrightMcpConfig =
  | { mode: 'http'; url: string; toolName?: string; timeoutMs?: number }
  | {
      mode: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      toolName?: string
      timeoutMs?: number
    }

/**
 * MCP-to-MCP validator adapter.
 *
 * Supports two connection modes:
 *  - http:  connect to a shared Playwright MCP server already running on a port
 *           (e.g. playwright-mcp --port 8931). Both Cursor and LIMS share one browser.
 *  - stdio: LIMS spawns its own playwright-mcp subprocess. Fully self-contained.
 *
 * Gracefully degrades to local-DOM fallback (via PlaywrightValidatorAdapter) when
 * the Playwright MCP server is unreachable or not configured at all.
 */
export class PlaywrightMcpValidatorAdapter implements PlaywrightValidatorPort, PageCapturePort {
  private client!: Client
  private transport!: Transport
  private connectPromise: Promise<void> | null = null
  private connected = false
  private closed = false
  private resolvedToolName: string | null = null

  constructor(private readonly config: PlaywrightMcpConfig) {
    this.recreateClient()
  }

  private recreateClient(): void {
    this.client = new Client({
      name: 'lims-playwright-runtime-validator',
      version: '1.0.0',
    })

    if (this.config.mode === 'http') {
      this.transport = new StreamableHTTPClientTransport(new URL(this.config.url))
    } else {
      const params: StdioServerParameters = {
        command: this.config.command,
        args: normalizePlaywrightMcpArgs(this.config.args ?? []),
        env: this.config.env,
        cwd: this.config.cwd,
        stderr: 'inherit',
      }
      const t = new StdioClientTransport(params)
      t.onclose = () => {
        this.connected = false
        this.resolvedToolName = null
      }
      t.onerror = () => {
        this.connected = false
        this.resolvedToolName = null
      }
      this.transport = t
    }
  }

  /** Which mode is active — for health reporting. */
  get connectionMode(): 'http' | 'stdio' {
    return this.config.mode
  }

  /** The URL or command being used — for health reporting. */
  get connectionTarget(): string {
    return this.config.mode === 'http' ? this.config.url : this.config.command
  }

  async validate(input: RuntimeValidationInput): Promise<RuntimeValidation> {
    if (this.closed) {
      return unavailable('playwright MCP validator is closed')
    }
    try {
      await this.ensureConnected()
      const toolName = await this.resolveToolName()
      if (!toolName) {
        return unavailable('playwright MCP does not expose a locator validation tool')
      }

      const call = await withTimeout(
        this.client.callTool(buildToolCall(toolName, input)),
        this.config.timeoutMs ?? 7000,
      )
      return parseToolResult(call as unknown)
    } catch (err) {
      return unavailable(`playwright MCP call failed: ${String(err)}`)
    }
  }

  async capture(input: PageCaptureInput): Promise<CapturedPage> {
    if (this.closed) {
      throw new DomainError('playwright MCP capture adapter is closed', 'PLAYWRIGHT_MCP_CLOSED')
    }
    try {
      await this.ensureConnected()
      const toolName = await this.resolveCaptureToolName()
      if (!toolName) {
        throw new DomainError(
          'playwright MCP does not expose browser_run_code required for live capture',
          'PLAYWRIGHT_MCP_CAPTURE_UNAVAILABLE',
        )
      }
      const call = await withTimeout(
        this.client.callTool({
          name: toolName,
          arguments: {
            code: buildBrowserCaptureCode(input),
          },
        }),
        this.config.timeoutMs ?? 7000,
      )
      return parseCaptureResult(call as unknown)
    } catch (err) {
      if (err instanceof DomainError) throw err
      throw new DomainError('playwright MCP capture failed', 'PLAYWRIGHT_MCP_CAPTURE_FAILED', {
        cause: String(err),
      })
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.connected = false
    this.connectPromise = null
    this.resolvedToolName = null
    await this.transport.close()
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect(this.transport)
        .then(() => {
          this.connected = true
        })
        .catch(async (firstErr) => {
          this.connected = false
          this.resolvedToolName = null
          await this.transport.close().catch(() => undefined)
          // HTTP transport: do not retry — the server is simply not running
          if (this.config.mode === 'http') {
            throw firstErr
          }
          // stdio transport: recreate client and attempt one reconnect
          if (!this.closed) {
            this.recreateClient()
            await this.client.connect(this.transport)
            this.connected = true
          }
        })
        .finally(() => {
          this.connectPromise = null
        })
    }
    await this.connectPromise
  }

  private async resolveToolName(): Promise<string | null> {
    if (this.resolvedToolName) return this.resolvedToolName
    const listed = await withTimeout(
      this.client.listTools(),
      this.config.timeoutMs ?? 7000,
    )
    const names = new Set((listed.tools ?? []).map((t) => t.name))
    const preferred = this.config.toolName?.trim()
    if (preferred && names.has(preferred)) {
      this.resolvedToolName = preferred
      return this.resolvedToolName
    }
    for (const name of DEFAULT_TOOL_CANDIDATES) {
      if (names.has(name)) {
        this.resolvedToolName = name
        return this.resolvedToolName
      }
    }
    return null
  }

  private async resolveCaptureToolName(): Promise<string | null> {
    const listed = await withTimeout(
      this.client.listTools(),
      this.config.timeoutMs ?? 7000,
    )
    const names = new Set((listed.tools ?? []).map((t) => t.name))
    return names.has('browser_run_code') ? 'browser_run_code' : null
  }
}

function normalizePlaywrightMcpArgs(args: string[]): string[] {
  const next = [...args]
  const joined = next.join(' ').toLowerCase()
  const isOfficialPlaywrightMcp = joined.includes('@playwright/mcp')
  const hasIsolated = next.includes('--isolated')
  if (isOfficialPlaywrightMcp && !hasIsolated) {
    next.push('--isolated')
  }
  return next
}

function buildToolCall(
  toolName: string,
  input: RuntimeValidationInput,
): {
  name: string
  arguments: Record<string, unknown>
} {
  if (toolName === 'browser_run_code') {
    return {
      name: toolName,
      arguments: {
        code: buildBrowserRunCode(input),
      },
    }
  }
  return {
    name: toolName,
    arguments: {
      locator: input.locator,
      kind: input.kind,
      domSnapshot: input.domSnapshot,
      domSnapshots: input.domSnapshots,
      targetHint: input.targetHint,
      platform: input.platform,
      retries: input.retries ?? 1,
      runtimeContext: input.runtimeContext,
    },
  }
}

function unavailable(note: string): RuntimeValidation {
  return {
    executed: false,
    unique: false,
    visible: false,
    interactable: false,
    success: false,
    notes: [note],
  }
}

function parseToolResult(result: unknown): RuntimeValidation {
  const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  if (obj.isError === true) {
    const text = extractToolText(obj)
    return unavailable(`playwright MCP validation tool returned an error${text ? `: ${text}` : ''}`)
  }
  const structured = isRecord(obj.structuredContent) ? obj.structuredContent : undefined
  if (structured) {
    const parsed = toRuntimeValidation(structured)
    if (parsed) return parsed
  }
  const text = extractToolText(obj)
  if (text) {
    const asJson = tryParseJsonRecord(text)
    if (asJson) {
      const parsed = toRuntimeValidation(asJson)
      if (parsed) return parsed
    }
    return unavailable('playwright MCP returned non-JSON tool output')
  }
  return unavailable('playwright MCP returned unsupported validation output')
}

function parseCaptureResult(result: unknown): CapturedPage {
  const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  if (obj.isError === true) {
    const text = extractToolText(obj)
    throw new DomainError(
      `playwright MCP capture tool returned an error${text ? `: ${text}` : ''}`,
      'PLAYWRIGHT_MCP_CAPTURE_FAILED',
    )
  }
  const structured = isRecord(obj.structuredContent) ? obj.structuredContent : undefined
  if (structured) {
    const parsed = toCapturedPage(structured)
    if (parsed) return parsed
  }
  const text = extractToolText(obj)
  if (text) {
    const asJson = tryParseJsonRecord(text)
    if (asJson) {
      const parsed = toCapturedPage(asJson)
      if (parsed) return parsed
    }
  }
  throw new DomainError(
    'playwright MCP capture returned unsupported output',
    'PLAYWRIGHT_MCP_CAPTURE_FAILED',
  )
}

function toCapturedPage(value: Record<string, unknown>): CapturedPage | null {
  if (typeof value.dom !== 'string' || typeof value.screenshotBase64 !== 'string') return null
  return {
    pageUrl: typeof value.pageUrl === 'string' ? value.pageUrl : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    dom: value.dom,
    screenshotBase64: value.screenshotBase64,
    targetDescriptor: toTargetDescriptor(value.targetDescriptor),
    interactiveElements: Array.isArray(value.interactiveElements)
      ? value.interactiveElements.filter(isRecord).map((item) => ({
          tag: typeof item.tag === 'string' ? item.tag : 'unknown',
          text: typeof item.text === 'string' ? item.text : undefined,
          role: typeof item.role === 'string' ? item.role : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          testId: typeof item.testId === 'string' ? item.testId : undefined,
          cssPath: typeof item.cssPath === 'string' ? item.cssPath : undefined,
          attributes: isRecord(item.attributes)
            ? Object.fromEntries(Object.entries(item.attributes).map(([key, itemValue]) => [key, String(itemValue)]))
            : {},
          bbox: isRecord(item.bbox) &&
            typeof item.bbox.x === 'number' &&
            typeof item.bbox.y === 'number' &&
            typeof item.bbox.width === 'number' &&
            typeof item.bbox.height === 'number'
            ? {
                x: item.bbox.x,
                y: item.bbox.y,
                width: item.bbox.width,
                height: item.bbox.height,
              }
            : undefined,
        }))
      : [],
  }
}

function toTargetDescriptor(value: unknown): TargetDescriptor | null {
  if (!isRecord(value)) return null
  return {
    css: typeof value.css === 'string' ? value.css : undefined,
    xpath: typeof value.xpath === 'string' ? value.xpath : undefined,
    text: typeof value.text === 'string' ? value.text : undefined,
    role: typeof value.role === 'string' ? value.role : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    tag: typeof value.tag === 'string' ? value.tag : undefined,
    attributes: isRecord(value.attributes)
      ? Object.fromEntries(Object.entries(value.attributes).map(([key, itemValue]) => [key, String(itemValue)]))
      : undefined,
    accessibilityId: typeof value.accessibilityId === 'string' ? value.accessibilityId : undefined,
    resourceId: typeof value.resourceId === 'string' ? value.resourceId : undefined,
    iosName: typeof value.iosName === 'string' ? value.iosName : undefined,
    region: typeof value.region === 'string' ? value.region : undefined,
  }
}

function toRuntimeValidation(value: Record<string, unknown>): RuntimeValidation | null {
  if (typeof value.success !== 'boolean') return null
  const notes = Array.isArray(value.notes)
    ? value.notes.map((n) => String(n))
    : ['playwright MCP validated']
  if (!notes.some((n) => n.includes('source:playwright-mcp'))) {
    notes.push('source:playwright-mcp')
  }
  return {
    executed: typeof value.executed === 'boolean' ? value.executed : true,
    unique: typeof value.unique === 'boolean' ? value.unique : false,
    visible: typeof value.visible === 'boolean' ? value.visible : false,
    interactable: typeof value.interactable === 'boolean' ? value.interactable : false,
    success: value.success,
    notes,
    attempts: typeof value.attempts === 'number' ? value.attempts : undefined,
    stableOverRetries: typeof value.stableOverRetries === 'boolean' ? value.stableOverRetries : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  const direct = safeParseRecord(text)
  if (direct) return direct

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    const fromFence = safeParseRecord(fence[1].trim())
    if (fromFence) return fromFence
  }

  const objSnippet = extractFirstJsonObject(text)
  if (objSnippet) {
    const fromSnippet = safeParseRecord(objSnippet)
    if (fromSnippet) return fromSnippet
  }
  return null
}

function extractToolText(obj: Record<string, unknown>): string | undefined {
  const content = Array.isArray(obj.content) ? obj.content as Array<Record<string, unknown>> : []
  return content.find((c) => c.type === 'text' && typeof c.text === 'string')?.text as string | undefined
}

function safeParseRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractFirstJsonObject(text: string): string | null {
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      if (start < 0) start = i
      depth += 1
    } else if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

function buildBrowserRunCode(input: RuntimeValidationInput): string {
  const payload = JSON.stringify({
    locator: input.locator,
    kind: input.kind,
    domSnapshot: input.domSnapshot,
    domSnapshots: input.domSnapshots,
    retries: input.retries ?? 1,
    runtimeContext: input.runtimeContext,
  })
  return `async (page) => {
  const input = ${payload};
  const html = input.domSnapshot || (Array.isArray(input.domSnapshots) ? input.domSnapshots[0] : undefined);
  const runtimeContext = input.runtimeContext || {};
  const wantsLivePage = Boolean(runtimeContext.mode === 'live-page' || runtimeContext.useCurrentPage || runtimeContext.pageUrl);
  if (!html && !wantsLivePage) {
    return {
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['playwright MCP browser_run_code skipped: no dom snapshot or live runtime context', 'source:playwright-mcp'],
      attempts: Math.max(1, Number(input.retries || 1)),
      stableOverRetries: false,
    };
  }
  const retries = Math.max(1, Number(input.retries || 1));
  let successCount = 0;
  let last = {
    executed: false,
    unique: false,
    visible: false,
    interactable: false,
    success: false,
    notes: ['playwright MCP browser_run_code did not run', 'source:playwright-mcp'],
  };

  const root = runtimeContext.frameLocator ? page.frameLocator(runtimeContext.frameLocator) : page;

  const parseLocatorText = (fnName) => {
    const jsonMatch = String(input.locator).match(new RegExp(fnName + '\\\\(\\\\s*("[^"\\\\\\\\]*(?:\\\\\\\\.[^"\\\\\\\\]*)*")\\\\s*\\\\)'));
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {}
    }
    const manual = String(input.locator).match(new RegExp(fnName + '\\\\(\\\\s*([\\'"\\\`])([\\\\s\\\\S]*?)\\\\1\\\\s*\\\\)'));
    return manual && manual[2] ? manual[2].replace(/\\\\(.)/g, '$1') : null;
  };

  const buildLocator = () => {
    if (input.kind === 'css') return root.locator(input.locator);
    if (input.kind === 'xpath') return root.locator('xpath=' + input.locator);
    if (input.kind === 'playwright') {
      const txt = parseLocatorText('getByText');
      if (txt) return root.getByText(txt);
      const roleMatch = String(input.locator).match(/getByRole\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*(?:,\\s*\\{\\s*name:\\s*['"\`]([^'"\`]+)['"\`]\\s*\\})?\\s*\\)/);
      if (roleMatch && roleMatch[1]) {
        return roleMatch[2]
          ? root.getByRole(roleMatch[1], { name: roleMatch[2] })
          : root.getByRole(roleMatch[1]);
      }
      const labelMatch = parseLocatorText('getByLabel');
      if (labelMatch) return root.getByLabel(labelMatch);
      const placeholderMatch = parseLocatorText('getByPlaceholder');
      if (placeholderMatch) return root.getByPlaceholder(placeholderMatch);
      const testIdMatch = parseLocatorText('getByTestId');
      if (testIdMatch) return root.getByTestId(testIdMatch);
      const altMatch = parseLocatorText('getByAltText');
      if (altMatch) return root.getByAltText(altMatch);
      const titleMatch = parseLocatorText('getByTitle');
      if (titleMatch) return root.getByTitle(titleMatch);
      const cssMatch = parseLocatorText('locator');
      if (cssMatch && String(cssMatch).startsWith('xpath=')) return root.locator(String(cssMatch));
      if (cssMatch) return root.locator(String(cssMatch));
      const contextual = String(input.locator).match(/getByText\\((['"\`])([\\s\\S]+?)\\1\\)\\.locator\\(['"\`]\\.\\.['"\`]\\)\\.locator\\((['"\`])\\[(.+?)=(['"\`])([\\s\\S]+?)\\5\\]\\3\\)/);
      if (contextual && contextual[2] && contextual[4] && contextual[6]) {
        return root.getByText(contextual[2]).locator('..').locator('[' + contextual[4] + '="' + contextual[6] + '"]');
      }
      return root.locator(input.locator);
    }
    if (input.kind === 'appium') {
      if (String(input.locator).startsWith('//') || String(input.locator).startsWith('(//')) {
        return root.locator('xpath=' + input.locator);
      }
      const a11yMatch = String(input.locator).match(/AppiumBy\\.accessibilityId\\((.*)\\)/);
      if (a11yMatch && a11yMatch[1]) {
        const raw = String(a11yMatch[1]).trim().replace(/^['"\`]|['"\`]$/g, '');
        return root.locator('[content-desc="' + raw + '"],[name="' + raw + '"],[label="' + raw + '"],[aria-label="' + raw + '"]');
      }
      const idMatch = String(input.locator).match(/AppiumBy\\.id\\((.*)\\)/);
      if (idMatch && idMatch[1]) {
        const raw = String(idMatch[1]).trim().replace(/^['"\`]|['"\`]$/g, '');
        return root.locator('[resource-id="' + raw + '"],[id="' + raw + '"]');
      }
      return root.locator('[data-lims-never-match="1"]');
    }
    return root.locator('[data-lims-never-match="1"]');
  };

  for (let i = 0; i < retries; i++) {
    try {
      if (runtimeContext.pageUrl) {
        await page.goto(runtimeContext.pageUrl, { waitUntil: 'domcontentloaded' });
      } else if (html) {
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
      }
      if (runtimeContext.waitForSelector) {
        await page.waitForSelector(runtimeContext.waitForSelector, { timeout: 5000 });
      }
      if (runtimeContext.waitForTimeoutMs) {
        await page.waitForTimeout(runtimeContext.waitForTimeoutMs);
      }
      const locator = buildLocator();
      const count = await locator.count();
      const unique = count === 1;
      let visible = false;
      let interactable = false;
      if (unique) {
        const first = locator.first();
        visible = await first.isVisible();
        try {
          await first.click({ trial: true, timeout: 2000 });
          interactable = true;
        } catch {
          interactable = false;
        }
      }
      last = {
        executed: true,
        unique,
        visible,
        interactable,
        success: unique && visible && interactable,
        notes: ['playwright MCP browser_run_code count=' + count, 'source:playwright-mcp'],
      };
      if (last.success) successCount += 1;
    } catch (err) {
      last = {
        executed: true,
        unique: false,
        visible: false,
        interactable: false,
        success: false,
        notes: ['playwright MCP browser_run_code error: ' + String(err), 'source:playwright-mcp'],
      };
    }
  }
  const stable = successCount === retries;
  return {
    ...last,
    success: Boolean(last.success && stable),
    attempts: retries,
    stableOverRetries: stable,
    notes: [...(Array.isArray(last.notes) ? last.notes : []), 'playwright MCP retry stability ' + successCount + '/' + retries, 'source:playwright-mcp'],
  };
}`
}

function buildBrowserCaptureCode(input: PageCaptureInput): string {
  const payload = JSON.stringify(input)
  return `async (page) => {
  const input = ${payload};
  const runtimeContext = input.runtimeContext || {};
  const shouldReuseCurrentPage = Boolean(runtimeContext.useCurrentPage || runtimeContext.mode === 'live-page');
  if (input.pageUrl) {
    await page.goto(input.pageUrl, { waitUntil: 'domcontentloaded' });
  } else if (runtimeContext.pageUrl) {
    await page.goto(runtimeContext.pageUrl, { waitUntil: 'domcontentloaded' });
  } else if (input.html) {
    await page.setContent(input.html, { waitUntil: 'domcontentloaded' });
  } else if (!shouldReuseCurrentPage) {
    throw new Error('pageUrl, html, or runtimeContext.useCurrentPage is required for capture');
  }
  if (runtimeContext.waitForSelector) {
    await page.waitForSelector(runtimeContext.waitForSelector, { timeout: 5000 });
  }
  if (runtimeContext.waitForTimeoutMs) {
    await page.waitForTimeout(runtimeContext.waitForTimeoutMs);
  }

  const normalizeVisible = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const cssEscape = (value) => String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\\\\]^\\\`{|}~])/g, '\\\\$1');
  const cssPath = (node) => {
    const parts = [];
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      const tag = current.tagName.toLowerCase();
      const id = current.id && String(current.id).trim();
      if (id) {
        parts.unshift('#' + cssEscape(id));
        break;
      }
      let part = tag;
      const testId = current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-qa');
      if (testId) {
        part += '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
        parts.unshift(part);
        break;
      }
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current.tagName)
        : [];
      if (siblings.length > 1) {
        part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const pickInterestingAttributes = (attrs) => Object.fromEntries(
    Object.entries(attrs).filter(([name, value]) => {
      if (!String(value || '').trim()) return false;
      return ['id', 'name', 'type', 'role', 'aria-label', 'placeholder', 'title', 'data-testid', 'data-test', 'data-qa'].includes(name);
    }),
  );
  const parseLocatorText = (value, fnName) => {
    const jsonMatch = String(value).match(new RegExp(fnName + '\\\\(\\\\s*("[^"\\\\\\\\]*(?:\\\\\\\\.[^"\\\\\\\\]*)*")\\\\s*\\\\)'));
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {}
    }
    const manual = String(value).match(new RegExp(fnName + '\\\\(\\\\s*([\\'"\\\`])([\\\\s\\\\S]*?)\\\\1\\\\s*\\\\)'));
    return manual && manual[2] ? manual[2].replace(/\\\\(.)/g, '$1') : null;
  };

  const root = runtimeContext.frameLocator ? page.frameLocator(runtimeContext.frameLocator) : page;
  const targetDescriptor = input.targetDescriptor || null;
  const locatorFromDescriptor = (descriptor) => {
    if (!descriptor) return null;
    if (descriptor.css) return root.locator(descriptor.css);
    if (descriptor.xpath) return root.locator('xpath=' + descriptor.xpath);
    if (descriptor.role) {
      return descriptor.name || descriptor.text
        ? root.getByRole(descriptor.role, { name: descriptor.name || descriptor.text })
        : root.getByRole(descriptor.role);
    }
    if (descriptor.accessibilityId) return root.getByLabel(descriptor.accessibilityId);
    if (descriptor.text) return root.getByText(descriptor.text);
    if (descriptor.attributes && typeof descriptor.attributes === 'object') {
      const testId = descriptor.attributes['data-testid'] || descriptor.attributes['data-test'] || descriptor.attributes['data-qa'];
      if (testId) return root.getByTestId(String(testId));
      let selector = descriptor.tag && String(descriptor.tag).trim() ? String(descriptor.tag).trim() : '*';
      selector += Object.entries(descriptor.attributes)
        .map(([name, val]) => '[' + name + '="' + String(val).replace(/"/g, '\\\\"') + '"]')
        .join('');
      return root.locator(selector);
    }
    return null;
  };
  const locatorFromTarget = (target) => {
    if (!target) return null;
    const trimmed = String(target).trim();
    const roleMatch = trimmed.match(/getByRole\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*(?:,\\s*\\{\\s*name:\\s*['"\`]([^'"\`]+)['"\`]\\s*\\})?\\s*\\)/);
    if (roleMatch && roleMatch[1]) {
      return roleMatch[2] ? root.getByRole(roleMatch[1], { name: roleMatch[2] }) : root.getByRole(roleMatch[1]);
    }
    const testId = parseLocatorText(trimmed, 'getByTestId');
    if (testId) return root.getByTestId(testId);
    const txt = parseLocatorText(trimmed, 'getByText');
    if (txt) return root.getByText(txt);
    const label = parseLocatorText(trimmed, 'getByLabel');
    if (label) return root.getByLabel(label);
    const placeholder = parseLocatorText(trimmed, 'getByPlaceholder');
    if (placeholder) return root.getByPlaceholder(placeholder);
    const alt = parseLocatorText(trimmed, 'getByAltText');
    if (alt) return root.getByAltText(alt);
    const title = parseLocatorText(trimmed, 'getByTitle');
    if (title) return root.getByTitle(title);
    if (trimmed.startsWith('//') || trimmed.startsWith('(//')) return root.locator('xpath=' + trimmed);
    if (trimmed.toLowerCase().startsWith('text:')) return root.getByText(trimmed.slice(5).trim());
    if (trimmed.toLowerCase().startsWith('role:')) {
      const parts = trimmed.slice(5).split('|').map((item) => item.trim()).filter(Boolean);
      return parts[1] ? root.getByRole(parts[0], { name: parts[1] }) : root.getByRole(parts[0]);
    }
    return root.locator(trimmed);
  };

  let extractedTargetDescriptor = targetDescriptor;
  const targetLocator = locatorFromDescriptor(targetDescriptor) || locatorFromTarget(input.target);
  if (targetLocator && await targetLocator.count() > 0) {
    extractedTargetDescriptor = await targetLocator.first().evaluate((el) => {
      const attrs = {};
      for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
      const descriptor = {
        tag: el.tagName.toLowerCase(),
        text: normalizeVisible(el.innerText || el.textContent || ''),
        role: attrs.role || undefined,
        name: attrs['aria-label'] || attrs.name || attrs.title || undefined,
        css: cssPath(el),
        attributes: pickInterestingAttributes(attrs),
      };
      return {
        ...descriptor,
        accessibilityId: descriptor.name || undefined,
      };
    });
  }

  let contentFrame = null;
  if (runtimeContext.frameLocator) {
    const handle = await page.locator(runtimeContext.frameLocator).elementHandle();
    contentFrame = handle ? await handle.contentFrame() : null;
  }
  const contentScope = contentFrame || page;
  const dom = await contentScope.content();
  const interactiveElements = input.includeInteractiveElements
    ? await contentScope.evaluate(() => {
        const selector = [
          'button',
          'a[href]',
          'input',
          'select',
          'textarea',
          '[role="button"]',
          '[role="link"]',
          '[role="tab"]',
          '[role="switch"]',
          '[data-testid]',
          '[aria-label]',
          'canvas',
          'svg',
        ].join(', ');
        return Array.from(document.querySelectorAll(selector))
          .slice(0, 150)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const attrs = {};
            for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
            return {
              tag: el.tagName.toLowerCase(),
              text: normalizeVisible(el.innerText || el.textContent || ''),
              role: attrs.role || undefined,
              name: attrs['aria-label'] || attrs.name || attrs.title || undefined,
              testId: attrs['data-testid'] || attrs['data-test'] || attrs['data-qa'] || undefined,
              cssPath: cssPath(el),
              attributes: pickInterestingAttributes(attrs),
              bbox: rect.width > 0 || rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
            };
          })
          .filter((item) => Boolean(item.text || item.role || item.name || item.testId || item.tag === 'canvas' || item.tag === 'svg'));
      })
    : [];
  const screenshotBytes = await page.screenshot({
    fullPage: input.captureFullPage !== false,
    type: 'png',
  });
  return {
    pageUrl: page.url(),
    title: await page.title().catch(() => undefined),
    dom,
    screenshotBase64: Buffer.from(screenshotBytes).toString('base64'),
    targetDescriptor: extractedTargetDescriptor,
    interactiveElements,
  };
}`
}
