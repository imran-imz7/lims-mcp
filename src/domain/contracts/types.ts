export type Platform = 'web' | 'android' | 'ios'

export type AttributeStabilityClass = 'STABLE' | 'SEMI_STABLE' | 'UNSTABLE'

export type LocatorStrategy =
  | 'css'
  | 'xpath'
  | 'accessibility'
  | 'text'
  | 'role'
  | 'hybrid'
  | 'relative'
  | 'playwright-codegen'
  | 'appium'

export interface LocatorCandidate {
  readonly locator: string
  readonly kind: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
  readonly strategy: LocatorStrategy
  /** AGENTS.md preference order; lower is better for tie-breaks after scoring. */
  readonly priorityTier: number
  readonly stabilityScore: number
  readonly readabilityScore: number
  readonly metadata: Record<string, unknown>
}

export interface RankedLocator extends LocatorCandidate {
  readonly uniquenessMatchCount: number
  readonly totalScore: number
  /** uniqueness, attributeStability, readability, length, maintainability */
  readonly breakdown: Record<string, number>
}

export interface GenerationResult {
  readonly best: RankedLocator
  readonly ranked: RankedLocator[]
  readonly rejected: Array<{ locator: string; reason: string }>
  readonly explanation: string
  readonly framework: string
}

export interface HealResult {
  readonly healedLocator: string
  readonly confidence: number
  readonly explanation: string
  readonly diff: Record<string, unknown>
}

export interface StabilityReportEntry {
  attribute: string
  stability: AttributeStabilityClass
  score: number
  reason: string
}

export interface DomAnalysisResult {
  framework: string
  recommendedAttributes: string[]
  stabilityReport: {
    sampleSize: number
    entries: StabilityReportEntry[]
  }
}

export interface VisualMatch {
  confidence: number
  matchedText?: string
  bbox?: { x: number; y: number; width: number; height: number }
  reason: string
}

export interface RuntimeValidation {
  executed: boolean
  unique: boolean
  visible: boolean
  interactable: boolean
  success: boolean
  notes: string[]
  attempts?: number
  stableOverRetries?: boolean
}

export interface ValidationSummary {
  dom: boolean
  visual: boolean
  runtime: boolean
}

export interface TargetDescriptor {
  css?: string
  xpath?: string
  text?: string
  role?: string
  name?: string
  tag?: string
  attributes?: Record<string, string | number | boolean>
  accessibilityId?: string
  resourceId?: string
  iosName?: string
  region?: string
}

export interface RuntimeContext {
  mode?: 'snapshot' | 'live-page'
  pageUrl?: string
  useCurrentPage?: boolean
  waitForSelector?: string
  frameLocator?: string
  waitForTimeoutMs?: number
}

export interface CapturedInteractiveElement {
  tag: string
  text?: string
  role?: string
  name?: string
  testId?: string
  cssPath?: string
  attributes: Record<string, string>
  bbox?: { x: number; y: number; width: number; height: number }
}

export interface CaptureContext {
  suite?: string
  feature?: string
  testCase?: string
  scenarioId?: string
  tags?: string[]
}

export interface LocatorArtifactSummary {
  ref: string
  storedAt: string
  path: string
}

export interface LocatorArtifactOutcome {
  status: 'passed' | 'failed' | 'healed'
  locator: string
  improvedLocator?: string
  failureMessage?: string
  recordedAt: string
}

export interface StoredLocatorArtifact {
  ref: string
  storedAt: string
  updatedAt: string
  platform: Extract<Platform, 'web'>
  pageUrl?: string
  title?: string
  target?: string
  targetDescriptor?: TargetDescriptor | null
  runtimeContext?: RuntimeContext
  captureContext?: CaptureContext
  dom?: string
  screenshotBase64?: string
  interactiveElements: CapturedInteractiveElement[]
  generation?: {
    bestLocator: string
    confidence: number
    strategy: string
    fallbacks: string[]
  }
  outcomes: LocatorArtifactOutcome[]
}

export type PlaywrightLanguage = 'js' | 'ts'

export type PlaywrightTestAction =
  | 'click'
  | 'fill'
  | 'press'
  | 'hover'
  | 'check'
  | 'uncheck'
  | 'select'
  | 'assertVisible'
  | 'assertText'

export interface PlaywrightLocatorBindingInput {
  name: string
  artifactRef?: string
  locator?: string
  description?: string
}

export interface PlaywrightTestStepInput {
  locator: string
  action: PlaywrightTestAction
  value?: string
  expectedText?: string
}

export interface PlaywrightTestCaseInput {
  name: string
  description?: string
  steps?: PlaywrightTestStepInput[]
}

export interface SyncPlaywrightFrameworkRequest {
  feature: string
  language?: PlaywrightLanguage
  outputDir?: string
  specDir?: string
  pageDir?: string
  locatorDir?: string
  pageUrl?: string
  locatorBindings: PlaywrightLocatorBindingInput[]
  testCases?: Array<string | PlaywrightTestCaseInput>
}

export interface SyncPlaywrightFrameworkResponse {
  feature: string
  language: PlaywrightLanguage
  files: {
    spec: string
    page: string
    locator: string
  }
  locatorNames: string[]
  pageClassName: string
  written: string[]
  warnings: string[]
}

export interface GenerateLocatorRequest {
  dom?: string
  xml?: string
  screenshot?: string
  domSnapshots?: string[]
  xmlSnapshots?: string[]
  screenshotSnapshots?: string[]
  targetRegion?: string
  target?: string
  targetDescriptor?: TargetDescriptor
  runtimeContext?: RuntimeContext
  platform: Platform
}

export interface GenerateLocatorResponse {
  bestLocator: string
  confidence: number
  fallbacks: string[]
  strategy: string
  explanation: string
  validation: ValidationSummary
  locatorCatalog: {
    total: number
    items: Array<{
      rank: number
      locator: string
      category: 'best' | 'fallback'
      source: 'dom-ranked' | 'visual' | 'region' | 'screenshot-heuristic'
      strategy?: string
      kind?: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
      score?: number
      uniquenessMatchCount?: number
      runtimeSuccess?: boolean
      runtimeStableOverRetries?: boolean
      runtimeAttempts?: number
    }>
    rejected: Array<{ locator: string; reason: string }>
  }
  automation: {
    primary: {
      locator: string
      strategy: string
      kind?: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
      snippets?: Record<string, unknown>
    }
    fallbacks: Array<{
      locator: string
      kind?: 'css' | 'xpath' | 'playwright' | 'appium' | 'accessibility' | 'text' | 'role'
      snippets?: Record<string, unknown>
    }>
    targetFingerprint?: Record<string, unknown> | null
    runtimeContext?: RuntimeContext
    regionAction?: {
      description: string
      playwright?: string
      appium?: string
      bbox?: { x: number; y: number; width: number; height: number }
    } | null
  }
  metadata: Record<string, unknown>
}

export interface HealLocatorRequest {
  dom?: string
  xml?: string
  screenshot?: string
  domSnapshots?: string[]
  screenshotSnapshots?: string[]
  platform?: Platform
  oldLocator: string
  fingerprint?: unknown
  runtimeContext?: RuntimeContext
}

export interface CaptureGenerateLocatorRequest {
  pageUrl?: string
  html?: string
  platform: Extract<Platform, 'web'>
  target?: string
  targetDescriptor?: TargetDescriptor
  runtimeContext?: RuntimeContext
  captureContext?: CaptureContext
  includeInteractiveElements?: boolean
  captureFullPage?: boolean
}

export type CaptureGenerateLocatorResponse = GenerateLocatorResponse & {
  capture: {
    pageUrl?: string
    title?: string
    capturedAt: string
    targetDescriptor: TargetDescriptor | null
    interactiveElements: CapturedInteractiveElement[]
    artifacts: {
      domLength: number
      screenshotCaptured: boolean
      fullPage: boolean
    }
    artifact?: LocatorArtifactSummary
  }
}

export interface ReportLocatorResultRequest {
  locator: string
  status: 'passed' | 'failed'
  platform: Extract<Platform, 'web'>
  artifactRef?: string
  pageUrl?: string
  html?: string
  dom?: string
  screenshot?: string
  target?: string
  targetDescriptor?: TargetDescriptor
  runtimeContext?: RuntimeContext
  captureContext?: CaptureContext
  fingerprint?: unknown
  failureMessage?: string
}

export interface ReportLocatorResultResponse {
  recorded: boolean
  status: 'passed' | 'failed'
  learned: {
    preferredLocators: string[]
    failedLocators: string[]
    healedPairs: Array<{ from: string; to: string }>
  }
  artifact?: LocatorArtifactSummary
  improved?: {
    locator: string
    confidence: number
    explanation: string
    source: 'heal' | 'regenerate'
  }
}
