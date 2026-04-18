import type {
  LocatorArtifactStorePort,
  LocatorLearningPort,
  OCRAdapter,
  PageCapturePort,
  PlaywrightValidatorPort,
  ScreenshotAnalyzerPort,
} from '../contracts/ports.js'
import type { LocatorCandidateProvider } from '../locator/locator-extension.js'

export interface PluginRegistry {
  screenshotAnalyzer: ScreenshotAnalyzerPort
  ocr: OCRAdapter
  runtimeValidator: PlaywrightValidatorPort
  pageCapture?: PageCapturePort
  learning?: LocatorLearningPort
  artifactStore?: LocatorArtifactStorePort
  locatorCandidateProviders: LocatorCandidateProvider[]
}

export class DefaultPluginRegistry implements PluginRegistry {
  constructor(
    public readonly screenshotAnalyzer: ScreenshotAnalyzerPort,
    public readonly ocr: OCRAdapter,
    public readonly runtimeValidator: PlaywrightValidatorPort,
    public readonly pageCapture?: PageCapturePort,
    public readonly learning?: LocatorLearningPort,
    public readonly artifactStore?: LocatorArtifactStorePort,
    public readonly locatorCandidateProviders: LocatorCandidateProvider[] = [],
  ) {}
}
