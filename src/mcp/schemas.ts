import { z } from 'zod'

export const PlatformSchema = z.enum(['web', 'android', 'ios'])

export const TargetDescriptorSchema = z.object({
  css: z.string().min(1).optional(),
  xpath: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  accessibilityId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  iosName: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
})

export const RuntimeContextSchema = z.object({
  mode: z.enum(['snapshot', 'live-page']).optional(),
  pageUrl: z.string().url().optional(),
  useCurrentPage: z.boolean().optional(),
  waitForSelector: z.string().min(1).optional(),
  frameLocator: z.string().min(1).optional(),
  waitForTimeoutMs: z.number().int().min(0).max(60_000).optional(),
})

export const CaptureContextSchema = z.object({
  suite: z.string().min(1).optional(),
  feature: z.string().min(1).optional(),
  testCase: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
})

export const PlaywrightLanguageSchema = z.enum(['js', 'ts'])

export const PlaywrightLocatorBindingSchema = z.object({
  name: z.string().min(1),
  artifactRef: z.string().min(1).optional(),
  locator: z.string().min(1).optional(),
  description: z.string().optional(),
}).refine((v) => Boolean(v.artifactRef || v.locator), {
  message: 'locator binding requires artifactRef or locator',
})

export const PlaywrightTestStepSchema = z.object({
  locator: z.string().min(1),
  action: z.enum(['click', 'fill', 'press', 'hover', 'check', 'uncheck', 'select', 'assertVisible', 'assertText']),
  value: z.string().optional(),
  expectedText: z.string().optional(),
})

export const PlaywrightTestCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(PlaywrightTestStepSchema).optional(),
})

const DomOrXmlSourceSchema = z
  .object({
    dom: z.string().min(1).optional(),
    xml: z.string().min(1).optional(),
    domFile: z.string().min(1).optional(),
    xmlFile: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.dom || v.xml || v.domFile || v.xmlFile), {
    message: 'either dom/xml content or domFile/xmlFile must be provided',
  })

const AnySourceSchema = z
  .object({
    dom: z.string().min(1).optional(),
    xml: z.string().min(1).optional(),
    screenshot: z.string().min(1).optional(),
    domFile: z.string().min(1).optional(),
    xmlFile: z.string().min(1).optional(),
    screenshotFile: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.dom || v.xml || v.screenshot || v.domFile || v.xmlFile || v.screenshotFile), {
    message: 'provide at least one source: dom/xml/screenshot content or domFile/xmlFile/screenshotFile',
  })

export const GenerateLocatorInputSchema = z.object({
  dom: z.string().min(1).optional(),
  xml: z.string().min(1).optional(),
  screenshot: z.string().min(1).optional(),
  domFile: z.string().min(1).optional(),
  xmlFile: z.string().min(1).optional(),
  screenshotFile: z.string().min(1).optional(),
  domSnapshots: z.array(z.string().min(1)).optional(),
  xmlSnapshots: z.array(z.string().min(1)).optional(),
  screenshotSnapshots: z.array(z.string().min(1)).optional(),
  targetRegion: z.string().min(1).optional(),
  targetDescriptor: TargetDescriptorSchema.optional(),
  runtimeContext: RuntimeContextSchema.optional(),
  platform: PlatformSchema,
  target: z.string().min(1).optional(),
})
  .and(AnySourceSchema)
  .refine((v) => Boolean(v.target || v.targetDescriptor), {
    message: 'target or targetDescriptor required',
  })

const FingerprintSchema = z
  .object({
    tag: z.string().optional(),
    attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    text: z.string().optional(),
    position: z
      .object({
        index: z.number().optional(),
        depth: z.number().optional(),
      })
      .optional(),
    parentHierarchy: z.array(z.string()).optional(),
  })
  .passthrough()

export const HealLocatorInputSchema = z.object({
  dom: z.string().min(1).optional(),
  xml: z.string().min(1).optional(),
  screenshot: z.string().min(1).optional(),
  domFile: z.string().min(1).optional(),
  xmlFile: z.string().min(1).optional(),
  screenshotFile: z.string().min(1).optional(),
  domSnapshots: z.array(z.string().min(1)).optional(),
  screenshotSnapshots: z.array(z.string().min(1)).optional(),
  platform: PlatformSchema.optional(),
  oldLocator: z.string().min(1),
  runtimeContext: RuntimeContextSchema.optional(),
  /** Optional; required when `oldLocator` is ambiguous or stale on the new DOM (AGENTS.md fingerprint rules). */
  fingerprint: z.union([z.record(z.unknown()), FingerprintSchema]).optional(),
}).and(AnySourceSchema)

export const AnalyzeDomInputSchema = z.object({
  dom: z.string().min(1).optional(),
  xml: z.string().min(1).optional(),
  domFile: z.string().min(1).optional(),
  xmlFile: z.string().min(1).optional(),
}).and(DomOrXmlSourceSchema)

export const CaptureGenerateLocatorInputSchema = z.object({
  pageUrl: z.string().url().optional(),
  html: z.string().min(1).optional(),
  platform: z.literal('web'),
  target: z.string().min(1).optional(),
  targetDescriptor: TargetDescriptorSchema.optional(),
  runtimeContext: RuntimeContextSchema.optional(),
  captureContext: CaptureContextSchema.optional(),
  includeInteractiveElements: z.boolean().optional(),
  captureFullPage: z.boolean().optional(),
}).refine((v) => Boolean(v.pageUrl || v.html || v.runtimeContext?.useCurrentPage), {
  message: 'pageUrl, html, or runtimeContext.useCurrentPage required for capture',
}).refine((v) => Boolean(v.target || v.targetDescriptor), {
  message: 'target or targetDescriptor required for capture generation',
})

export const ReportLocatorResultInputSchema = z.object({
  locator: z.string().min(1),
  status: z.enum(['passed', 'failed']),
  platform: z.literal('web'),
  artifactRef: z.string().min(1).optional(),
  pageUrl: z.string().url().optional(),
  html: z.string().min(1).optional(),
  dom: z.string().min(1).optional(),
  screenshot: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  targetDescriptor: TargetDescriptorSchema.optional(),
  runtimeContext: RuntimeContextSchema.optional(),
  captureContext: CaptureContextSchema.optional(),
  fingerprint: z.union([z.record(z.unknown()), FingerprintSchema]).optional(),
  failureMessage: z.string().optional(),
}).refine((v) => Boolean(v.artifactRef || v.dom || v.pageUrl || v.html || v.targetDescriptor || v.target), {
  message: 'provide artifactRef, pageUrl/html/dom, or target information so feedback can improve future locators',
})

export const SyncPlaywrightFrameworkInputSchema = z.object({
  feature: z.string().min(1),
  language: PlaywrightLanguageSchema.optional(),
  outputDir: z.string().min(1).optional(),
  specDir: z.string().min(1).optional(),
  pageDir: z.string().min(1).optional(),
  locatorDir: z.string().min(1).optional(),
  pageUrl: z.string().url().optional(),
  locatorBindings: z.array(PlaywrightLocatorBindingSchema).min(1),
  testCases: z.array(z.union([z.string().min(1), PlaywrightTestCaseSchema])).optional(),
})

export type GenerateLocatorInput = z.infer<typeof GenerateLocatorInputSchema>
export type HealLocatorInput = z.infer<typeof HealLocatorInputSchema>
export type AnalyzeDomInput = z.infer<typeof AnalyzeDomInputSchema>
export type CaptureGenerateLocatorInput = z.infer<typeof CaptureGenerateLocatorInputSchema>
export type ReportLocatorResultInput = z.infer<typeof ReportLocatorResultInputSchema>
export type SyncPlaywrightFrameworkInput = z.infer<typeof SyncPlaywrightFrameworkInputSchema>
