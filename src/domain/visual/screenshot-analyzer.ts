import type { ScreenshotAnalyzerPort } from '../contracts/ports.js'

/**
 * Domain-level facade for screenshot analysis.
 */
export class ScreenshotAnalyzer {
  constructor(private readonly adapter: ScreenshotAnalyzerPort) {}

  async analyze(base64: string): ReturnType<ScreenshotAnalyzerPort['analyze']> {
    return this.adapter.analyze(base64)
  }
}
