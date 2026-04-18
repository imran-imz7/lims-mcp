import type { PageCaptureInput, PageCapturePort } from '../../domain/contracts/ports.js'
import type { CapturedInteractiveElement, TargetDescriptor } from '../../domain/contracts/types.js'
import { DomainError } from '../../utils/errors.js'
import { parsePlaywrightLocator } from '../../utils/playwright-locator-parse.js'

let sharedBrowser: import('playwright').Browser | null = null
let browserInit: Promise<import('playwright').Browser> | null = null

export class PlaywrightWebCaptureAdapter implements PageCapturePort {
  async capture(input: PageCaptureInput) {
    if (!input.pageUrl && !input.html) {
      throw new DomainError(
        'Provide pageUrl or html for capture. Current-page reuse without a pageUrl requires a future Playwright MCP capture adapter.',
        'CAPTURE_SOURCE_REQUIRED',
      )
    }

    let playwrightMod: typeof import('playwright') | null = null
    try {
      playwrightMod = await import('playwright')
    } catch (cause) {
      throw new DomainError('Playwright package is required for page capture', 'PLAYWRIGHT_REQUIRED', { cause })
    }

    const browser = await getSharedBrowser(playwrightMod)
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await preparePage(page, input)

      const frame = await resolveFrame(page, input.runtimeContext?.frameLocator)
      const root = input.runtimeContext?.frameLocator ? page.frameLocator(input.runtimeContext.frameLocator) : page
      const targetLocator = resolveTargetLocator(root as CaptureRoot, input)
      const targetDescriptor = targetLocator
        ? await extractTargetDescriptor(targetLocator)
        : input.targetDescriptor ?? null

      const interactiveElements = input.includeInteractiveElements
        ? await collectInteractiveElements(frame ?? page)
        : []
      const dom = frame ? await frame.content() : await page.content()
      const screenshotBase64 = await page.screenshot({
        fullPage: input.captureFullPage !== false,
        type: 'png',
      }).then((bytes) => bytes.toString('base64'))

      return {
        pageUrl: page.url(),
        title: await page.title().catch(() => undefined),
        dom,
        screenshotBase64,
        targetDescriptor,
        interactiveElements,
      }
    } finally {
      await context.close()
    }
  }

  async close(): Promise<void> {
    if (!sharedBrowser) return
    await sharedBrowser.close().catch(() => undefined)
    sharedBrowser = null
  }
}

type CaptureRoot = Pick<
  import('playwright').Page,
  'locator' | 'getByText' | 'getByRole' | 'getByLabel' | 'getByPlaceholder' | 'getByTestId' | 'getByAltText' | 'getByTitle'
>

function resolveTargetLocator(root: CaptureRoot, input: PageCaptureInput): import('playwright').Locator | null {
  if (input.targetDescriptor) {
    return locatorFromDescriptor(root, input.targetDescriptor)
  }
  if (!input.target) return null
  return locatorFromTarget(root, input.target)
}

function locatorFromDescriptor(root: CaptureRoot, descriptor: TargetDescriptor): import('playwright').Locator | null {
  if (descriptor.css) return root.locator(descriptor.css)
  if (descriptor.xpath) return root.locator(`xpath=${descriptor.xpath}`)
  if (descriptor.role) {
    return descriptor.name ?? descriptor.text
      ? root.getByRole(descriptor.role as Parameters<CaptureRoot['getByRole']>[0], { name: descriptor.name ?? descriptor.text! })
      : root.getByRole(descriptor.role as Parameters<CaptureRoot['getByRole']>[0])
  }
  if (descriptor.accessibilityId) return root.getByLabel(descriptor.accessibilityId)
  if (descriptor.text) return root.getByText(descriptor.text)
  if (descriptor.attributes && Object.keys(descriptor.attributes).length) {
    const testId = descriptor.attributes['data-testid'] ?? descriptor.attributes['data-test'] ?? descriptor.attributes['data-qa']
    if (testId) return root.getByTestId(String(testId))
    let selector = descriptor.tag?.trim() || '*'
    selector += Object.entries(descriptor.attributes)
      .map(([name, value]) => `[${name}="${escapeCss(String(value))}"]`)
      .join('')
    return root.locator(selector)
  }
  return null
}

function locatorFromTarget(root: CaptureRoot, target: string): import('playwright').Locator | null {
  const trimmed = target.trim()
  const parsed = parsePlaywrightLocator(trimmed)
  if (parsed) {
    if (parsed.kind === 'text') return root.getByText(parsed.text)
    if (parsed.kind === 'label') return root.getByLabel(parsed.text)
    if (parsed.kind === 'placeholder') return root.getByPlaceholder(parsed.text)
    if (parsed.kind === 'test-id') return root.getByTestId(parsed.text)
    if (parsed.kind === 'alt') return root.getByAltText(parsed.text)
    if (parsed.kind === 'title') return root.getByTitle(parsed.text)
    if (parsed.kind === 'role') {
      return parsed.name
        ? root.getByRole(parsed.role as Parameters<CaptureRoot['getByRole']>[0], { name: parsed.name })
        : root.getByRole(parsed.role as Parameters<CaptureRoot['getByRole']>[0])
    }
    if (parsed.kind === 'css') return root.locator(parsed.selector)
    if (parsed.kind === 'xpath') return root.locator(`xpath=${parsed.selector}`)
    if (parsed.kind === 'contextual-attribute') {
      return root.getByText(parsed.anchorText).locator('..').locator(`[${parsed.attribute}="${escapeCss(parsed.value)}"]`)
    }
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('(//')) return root.locator(`xpath=${trimmed}`)
  if (trimmed.toLowerCase().startsWith('text:')) return root.getByText(trimmed.slice(5).trim())
  if (trimmed.toLowerCase().startsWith('role:')) {
    const rest = trimmed.slice(5).trim()
    const [role, name] = rest.split('|').map((part) => part.trim())
    return name
      ? root.getByRole(role as Parameters<CaptureRoot['getByRole']>[0], { name })
      : root.getByRole(role as Parameters<CaptureRoot['getByRole']>[0])
  }
  return root.locator(trimmed)
}

async function extractTargetDescriptor(locator: import('playwright').Locator): Promise<TargetDescriptor | null> {
  if (await locator.count() < 1) return null
  const first = locator.first()
  const descriptor = await first.evaluate((el) => {
    const normalizeVisible = (value: string) => value.replace(/\s+/g, ' ').trim()
    const cssPath = (node: Element) => {
      const parts: string[] = []
      let current: Element | null = node
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        const tag = current.tagName.toLowerCase()
        const element = current as HTMLElement
        const id = element.id?.trim()
        if (id) {
          parts.unshift(`#${id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')}`)
          break
        }
        let part = tag
        const testId = current.getAttribute('data-testid') ||
          current.getAttribute('data-test') ||
          current.getAttribute('data-qa')
        if (testId) {
          part += `[data-testid="${testId.replace(/"/g, '\\"')}"]`
          parts.unshift(part)
          break
        }
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current!.tagName)
          : []
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        }
        parts.unshift(part)
        current = current.parentElement
      }
      return parts.join(' > ')
    }
    const pickInterestingAttributes = (attrs: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(attrs).filter(([name, value]) => {
          if (!value?.trim()) return false
          return [
            'id',
            'name',
            'type',
            'role',
            'aria-label',
            'placeholder',
            'title',
            'data-testid',
            'data-test',
            'data-qa',
          ].includes(name)
        }),
      )

    const attrs: Record<string, string> = {}
    for (const attr of Array.from(el.attributes)) {
      attrs[attr.name] = attr.value
    }

    return {
      tag: el.tagName.toLowerCase(),
      text: normalizeVisible((el as HTMLElement).innerText || el.textContent || ''),
      role: attrs.role || undefined,
      name: attrs['aria-label'] || attrs.name || attrs.title || undefined,
      css: cssPath(el),
      attributes: pickInterestingAttributes(attrs),
    }
  })

  if (!descriptor) return null
  const normalized: TargetDescriptor = {
    ...descriptor,
    accessibilityId: descriptor.name,
  }
  return normalized
}

async function collectInteractiveElements(
  scope: import('playwright').Page | import('playwright').Frame,
): Promise<CapturedInteractiveElement[]> {
  return scope.evaluate(() => {
    const normalizeVisible = (value: string) => value.replace(/\s+/g, ' ').trim()
    const cssPath = (node: Element) => {
      const parts: string[] = []
      let current: Element | null = node
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        const tag = current.tagName.toLowerCase()
        const element = current as HTMLElement
        const id = element.id?.trim()
        if (id) {
          parts.unshift(`#${id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')}`)
          break
        }
        let part = tag
        const testId = current.getAttribute('data-testid') ||
          current.getAttribute('data-test') ||
          current.getAttribute('data-qa')
        if (testId) {
          part += `[data-testid="${testId.replace(/"/g, '\\"')}"]`
          parts.unshift(part)
          break
        }
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current!.tagName)
          : []
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        }
        parts.unshift(part)
        current = current.parentElement
      }
      return parts.join(' > ')
    }
    const pickInterestingAttributes = (attrs: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(attrs).filter(([name, value]) => {
          if (!value?.trim()) return false
          return [
            'id',
            'name',
            'type',
            'role',
            'aria-label',
            'placeholder',
            'title',
            'data-testid',
            'data-test',
            'data-qa',
          ].includes(name)
        }),
      )

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
    ].join(', ')

    return Array.from(document.querySelectorAll(selector))
      .slice(0, 150)
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const attrs: Record<string, string> = {}
        for (const attr of Array.from(el.attributes)) {
          attrs[attr.name] = attr.value
        }
        return {
          tag: el.tagName.toLowerCase(),
          text: normalizeVisible((el as HTMLElement).innerText || el.textContent || ''),
          role: attrs.role || undefined,
          name: attrs['aria-label'] || attrs.name || attrs.title || undefined,
          testId: attrs['data-testid'] || attrs['data-test'] || attrs['data-qa'] || undefined,
          cssPath: cssPath(el),
          attributes: pickInterestingAttributes(attrs),
          bbox: rect.width > 0 || rect.height > 0
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : undefined,
        }
      })
      .filter((item) => Boolean(item.text || item.role || item.name || item.testId))
  })
}

async function preparePage(
  page: import('playwright').Page,
  input: PageCaptureInput,
): Promise<void> {
  if (input.pageUrl) {
    await page.goto(input.pageUrl, { waitUntil: 'domcontentloaded' })
  } else if (input.html) {
    await page.setContent(input.html, { waitUntil: 'domcontentloaded' })
  }

  if (input.runtimeContext?.waitForSelector) {
    await page.waitForSelector(input.runtimeContext.waitForSelector, { timeout: 5_000 })
  }
  if (input.runtimeContext?.waitForTimeoutMs) {
    await page.waitForTimeout(input.runtimeContext.waitForTimeoutMs)
  }
}

async function resolveFrame(
  page: import('playwright').Page,
  frameLocator: string | undefined,
): Promise<import('playwright').Frame | null> {
  if (!frameLocator) return null
  const handle = await page.locator(frameLocator).elementHandle()
  if (!handle) return null
  return handle.contentFrame()
}

async function getSharedBrowser(
  playwrightMod: typeof import('playwright'),
): Promise<import('playwright').Browser> {
  if (sharedBrowser) return sharedBrowser
  if (!browserInit) {
    browserInit = launchBrowser(playwrightMod)
      .then((browser) => {
        sharedBrowser = browser
        return browser
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
  const value = raw?.trim()
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map((item) => String(item))
  } catch {
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function escapeCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
