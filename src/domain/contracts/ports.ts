import type * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type {
  CapturedInteractiveElement,
  LocatorArtifactOutcome,
  LocatorArtifactSummary,
  Platform,
  RuntimeContext,
  RuntimeValidation,
  StoredLocatorArtifact,
  TargetDescriptor,
  VisualMatch,
} from './types.js'

export interface OCRToken {
  text: string
  confidence: number
  bbox: { x: number; y: number; width: number; height: number }
}

export interface OCRAdapter {
  extractTokens(imageBytes: Buffer): Promise<OCRToken[]>
}

export interface ScreenshotAnalyzerPort {
  analyze(base64: string): Promise<{
    width: number
    height: number
    tokens: OCRToken[]
  }>
}

export interface RuntimeValidationInput {
  locator: string
  kind: 'css' | 'xpath' | 'playwright' | 'appium'
  domSnapshot?: string
  domSnapshots?: string[]
  targetHint?: string
  platform: Platform
  retries?: number
  runtimeContext?: RuntimeContext
}

export interface PlaywrightValidatorPort {
  validate(input: RuntimeValidationInput): Promise<RuntimeValidation>
}

export interface PageCaptureInput {
  pageUrl?: string
  html?: string
  target?: string
  targetDescriptor?: TargetDescriptor
  runtimeContext?: RuntimeContext
  includeInteractiveElements?: boolean
  captureFullPage?: boolean
}

export interface CapturedPage {
  pageUrl?: string
  title?: string
  dom: string
  screenshotBase64: string
  targetDescriptor: TargetDescriptor | null
  interactiveElements: CapturedInteractiveElement[]
}

export interface PageCapturePort {
  capture(input: PageCaptureInput): Promise<CapturedPage>
  close?(): Promise<void>
}

export interface LocatorLearningQuery {
  pageUrl?: string
  targetHint?: string
  fingerprint?: Record<string, unknown> | null
}

export interface LocatorLearningInsights {
  preferredLocators: string[]
  failedLocators: string[]
  healedPairs: Array<{ from: string; to: string }>
}

export interface LocatorLearningEvent {
  pageUrl?: string
  targetHint?: string
  fingerprint?: Record<string, unknown> | null
  locator: string
  status: 'success' | 'failure' | 'healed'
  replacementLocator?: string
  failureMessage?: string
  recordedAt?: string
}

export interface LocatorLearningPort {
  getInsights(query: LocatorLearningQuery): Promise<LocatorLearningInsights>
  recordOutcome(event: LocatorLearningEvent): Promise<void>
}

export interface LocatorArtifactStorePort {
  saveArtifact(
    artifact: Omit<StoredLocatorArtifact, 'ref' | 'storedAt' | 'updatedAt'>,
  ): Promise<LocatorArtifactSummary>
  getArtifact(ref: string): Promise<StoredLocatorArtifact | null>
  appendOutcome(ref: string, outcome: LocatorArtifactOutcome): Promise<LocatorArtifactSummary | null>
}

export interface TextFileRepositoryPort {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
}

export interface CorrelationInput {
  targetHint: string
  domText: string
  node: cheerio.Cheerio<Element>
  screenshot: { width: number; height: number; tokens: OCRToken[] }
}

export interface DomCorrelationPort {
  correlate(input: CorrelationInput): VisualMatch
}
