import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ServiceContainer } from '../di/container.js'
import {
  AnalyzeDomInputSchema,
  CaptureContextSchema,
  CaptureGenerateLocatorInputSchema,
  GenerateLocatorInputSchema,
  HealLocatorInputSchema,
  PlaywrightLanguageSchema,
  PlaywrightLocatorBindingSchema,
  PlaywrightTestCaseSchema,
  ReportLocatorResultInputSchema,
  RuntimeContextSchema,
  SyncPlaywrightFrameworkInputSchema,
  TargetDescriptorSchema,
} from './schemas.js'
import { DomainError, ValidationError } from '../utils/errors.js'

/** MCP adapter: schema validation + delegation to application layer only. */
export function registerTools(server: McpServer, services: ServiceContainer): void {
  server.registerTool(
    'sync_playwright_framework',
    {
      title: 'Sync Playwright framework files',
      description:
        'Creates or updates feature-level Playwright spec/page/locator files using generated locators or stored artifact references.',
      inputSchema: {
        feature: z.string(),
        language: PlaywrightLanguageSchema.optional(),
        outputDir: z.string().optional(),
        specDir: z.string().optional(),
        pageDir: z.string().optional(),
        locatorDir: z.string().optional(),
        pageUrl: z.string().optional(),
        locatorBindings: z.array(PlaywrightLocatorBindingSchema),
        testCases: z.array(z.union([z.string(), PlaywrightTestCaseSchema])).optional(),
      },
    },
    async (args) => {
      const parsed = SyncPlaywrightFrameworkInputSchema.safeParse(args)
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'sync_playwright_framework')
      }
      try {
        const out = await services.frameworkSync.sync(parsed.data)
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'sync_playwright_framework'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'sync_playwright_framework')
      }
    },
  )

  server.registerTool(
    'capture_generate_locator',
    {
      title: 'Capture and generate locator',
      description:
        'Opens a web page or HTML in Playwright, captures DOM + screenshot + target descriptor, then generates locator candidates.',
      inputSchema: {
        pageUrl: z.string().optional(),
        html: z.string().optional(),
        platform: z.literal('web'),
        target: z.string().optional(),
        targetDescriptor: TargetDescriptorSchema.optional(),
        runtimeContext: RuntimeContextSchema.optional(),
        captureContext: CaptureContextSchema.optional(),
        includeInteractiveElements: z.boolean().optional(),
        captureFullPage: z.boolean().optional(),
      },
    },
    async (args) => {
      const parsed = CaptureGenerateLocatorInputSchema.safeParse(args)
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'capture_generate_locator')
      }
      try {
        const out = await services.capture.captureAndGenerate(parsed.data)
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'capture_generate_locator'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'capture_generate_locator')
      }
    },
  )

  server.registerTool(
    'generate_locator',
    {
      title: 'Generate locator',
      description:
        'Generates ranked, explainable locators for Web/Android/iOS-oriented DOM snapshots (Clean Architecture pipeline).',
      inputSchema: {
        dom: z.string().optional(),
        xml: z.string().optional(),
        screenshot: z.string().optional(),
        domFile: z.string().optional(),
        xmlFile: z.string().optional(),
        screenshotFile: z.string().optional(),
        domSnapshots: z.array(z.string()).optional(),
        xmlSnapshots: z.array(z.string()).optional(),
        screenshotSnapshots: z.array(z.string()).optional(),
        targetRegion: z.string().optional(),
        targetDescriptor: TargetDescriptorSchema.optional(),
        runtimeContext: RuntimeContextSchema.optional(),
        platform: z.enum(['web', 'android', 'ios']),
        target: z.string().optional(),
      },
    },
    async (args) => {
      const parsed = GenerateLocatorInputSchema.safeParse(args)
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'generate_locator')
      }
      try {
        const resolved = await resolveSourceInputs(parsed.data)
        const out = await services.generation.generate(resolved)
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'generate_locator'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'generate_locator')
      }
    },
  )

  server.registerTool(
    'heal_locator',
    {
      title: 'Heal locator',
      description:
        'Re-validates oldLocator on new DOM, or uses optional fingerprint + similarity to recover the element.',
      inputSchema: {
        dom: z.string().optional(),
        xml: z.string().optional(),
        screenshot: z.string().optional(),
        domFile: z.string().optional(),
        xmlFile: z.string().optional(),
        screenshotFile: z.string().optional(),
        domSnapshots: z.array(z.string()).optional(),
        screenshotSnapshots: z.array(z.string()).optional(),
        platform: z.enum(['web', 'android', 'ios']).optional(),
        oldLocator: z.string(),
        runtimeContext: RuntimeContextSchema.optional(),
        fingerprint: z.record(z.unknown()).optional(),
      },
    },
    async (args) => {
      const raw = args as Record<string, unknown>
      const parsed = HealLocatorInputSchema.safeParse({
        dom: raw.dom,
        xml: raw.xml,
        screenshot: raw.screenshot,
        domFile: raw.domFile,
        xmlFile: raw.xmlFile,
        screenshotFile: raw.screenshotFile,
        domSnapshots: raw.domSnapshots,
        screenshotSnapshots: raw.screenshotSnapshots,
        platform: raw.platform,
        oldLocator: raw.oldLocator,
        runtimeContext: raw.runtimeContext,
        fingerprint: raw.fingerprint,
      })
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'heal_locator')
      }
      try {
        const {
          dom,
          xml,
          screenshot,
          domFile,
          xmlFile,
          screenshotFile,
          domSnapshots,
          screenshotSnapshots,
          platform,
          oldLocator,
          runtimeContext,
          fingerprint,
        } = parsed.data
        const resolved = await resolveSourceInputs({
          dom,
          xml,
          screenshot,
          domFile,
          xmlFile,
          screenshotFile,
        })
        const out = await services.healing.heal({
          dom: resolved.dom,
          xml: resolved.xml,
          screenshot: resolved.screenshot,
          domSnapshots,
          screenshotSnapshots,
          platform,
          oldLocator,
          runtimeContext,
          fingerprint,
        })
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'heal_locator'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'heal_locator')
      }
    },
  )

  server.registerTool(
    'health_check',
    {
      title: 'Health check',
      description: 'Checks prerequisites and active runtime validation mode.',
      inputSchema: {},
    },
    async () => {
      try {
        const out = await services.health.check()
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'health_check'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'health_check')
      }
    },
  )

  server.registerTool(
    'report_locator_result',
    {
      title: 'Report locator result',
      description:
        'Records test pass/fail feedback for a locator and optionally heals/regenerates it using the latest page state.',
      inputSchema: {
        locator: z.string(),
        status: z.enum(['passed', 'failed']),
        platform: z.literal('web'),
        artifactRef: z.string().optional(),
        pageUrl: z.string().optional(),
        html: z.string().optional(),
        dom: z.string().optional(),
        screenshot: z.string().optional(),
        target: z.string().optional(),
        targetDescriptor: TargetDescriptorSchema.optional(),
        runtimeContext: RuntimeContextSchema.optional(),
        captureContext: CaptureContextSchema.optional(),
        fingerprint: z.record(z.unknown()).optional(),
        failureMessage: z.string().optional(),
      },
    },
    async (args) => {
      const parsed = ReportLocatorResultInputSchema.safeParse(args)
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'report_locator_result')
      }
      try {
        const out = await services.feedback.report(parsed.data)
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'report_locator_result'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'report_locator_result')
      }
    },
  )

  server.registerTool(
    'analyze_dom',
    {
      title: 'Analyze DOM',
      description: 'Detects framework markers and attribute stability intelligence.',
      inputSchema: {
        dom: z.string().optional(),
        xml: z.string().optional(),
        domFile: z.string().optional(),
        xmlFile: z.string().optional(),
      },
    },
    async (args) => {
      const parsed = AnalyzeDomInputSchema.safeParse(args)
      if (!parsed.success) {
        return errorContent(`Invalid input: ${parsed.error.message}`, 'analyze_dom')
      }
      try {
        const resolved = await resolveSourceInputs(parsed.data)
        const out = services.analysis.analyze({
          dom: resolved.dom,
          xml: resolved.xml,
        })
        return { content: [{ type: 'text', text: JSON.stringify(withLimsMarker(out, 'analyze_dom'), null, 2) }] }
      } catch (e) {
        return errorContent(formatErr(e), 'analyze_dom')
      }
    },
  )
}

function errorContent(
  msg: string,
  tool: 'sync_playwright_framework' | 'capture_generate_locator' | 'generate_locator' | 'heal_locator' | 'analyze_dom' | 'health_check' | 'report_locator_result',
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload = withLimsMarker(
    {
      error: true,
      message: msg,
    },
    tool,
  )
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function formatErr(e: unknown): string {
  if (e instanceof DomainError) return JSON.stringify({ error: e.code, message: e.message, cause: e.cause })
  if (e instanceof ValidationError) return JSON.stringify({ error: 'VALIDATION', message: e.message, details: e.details })
  if (e instanceof Error) return JSON.stringify({ error: 'INTERNAL', message: e.message })
  return JSON.stringify({ error: 'INTERNAL', message: String(e) })
}

function withLimsMarker<T extends object>(
  output: T,
  tool: 'sync_playwright_framework' | 'capture_generate_locator' | 'generate_locator' | 'heal_locator' | 'analyze_dom' | 'health_check' | 'report_locator_result',
): T & {
  status: 'LIMS_ACTIVE'
  _lims: {
    provider: 'LIMS MCP'
    inUse: true
    tool: string
    message: string
  }
} {
  return {
    ...output,
    status: 'LIMS_ACTIVE',
    _lims: {
      provider: 'LIMS MCP',
      inUse: true,
      tool,
      message: `Currently LIMS MCP is in use. Response generated by LIMS for tool "${tool}".`,
    },
  }
}

async function resolveSourceInputs<T extends {
  dom?: string
  xml?: string
  screenshot?: string
  domFile?: string
  xmlFile?: string
  screenshotFile?: string
}>(input: T): Promise<Omit<T, 'domFile' | 'xmlFile' | 'screenshotFile'> & {
  dom?: string
  xml?: string
  screenshot?: string
}> {
  const dom = input.dom ?? (input.domFile ? await readUtf8(input.domFile) : undefined)
  const xml = input.xml ?? (input.xmlFile ? await readUtf8(input.xmlFile) : undefined)
  const screenshot = input.screenshot ?? (input.screenshotFile ? await readScreenshotInput(input.screenshotFile) : undefined)
  const { domFile: _d, xmlFile: _x, screenshotFile: _s, ...rest } = input
  return {
    ...rest,
    dom,
    xml,
    screenshot,
  }
}

async function readUtf8(filePath: string): Promise<string> {
  const abs = resolve(process.cwd(), filePath)
  try {
    const txt = await readFile(abs, 'utf8')
    const trimmed = txt.trim()
    if (!trimmed) {
      throw new ValidationError(`File is empty: ${filePath}`)
    }
    return trimmed
  } catch (e) {
    if (e instanceof ValidationError) throw e
    throw new ValidationError(`Could not read file: ${filePath}`, { cause: String(e) })
  }
}

async function readScreenshotInput(filePath: string): Promise<string> {
  const abs = resolve(process.cwd(), filePath)
  try {
    if (/\.(txt|base64)$/i.test(filePath)) {
      const txt = await readFile(abs, 'utf8')
      const trimmed = txt.trim()
      if (!trimmed) throw new ValidationError(`Screenshot file is empty: ${filePath}`)
      return trimmed
    }
    const bytes = await readFile(abs)
    if (!bytes.length) throw new ValidationError(`Screenshot file is empty: ${filePath}`)
    return bytes.toString('base64')
  } catch (e) {
    if (e instanceof ValidationError) throw e
    throw new ValidationError(`Could not read screenshot file: ${filePath}`, { cause: String(e) })
  }
}
