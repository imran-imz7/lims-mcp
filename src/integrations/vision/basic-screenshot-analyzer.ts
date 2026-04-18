import type {
  OCRAdapter,
  ScreenshotAnalyzerPort,
} from '../../domain/contracts/ports.js'
import { parseImageDimensions } from '../../infrastructure/vision/image-dimensions.js'
import { DomainError } from '../../utils/errors.js'

export class BasicScreenshotAnalyzer implements ScreenshotAnalyzerPort {
  constructor(private readonly ocr: OCRAdapter) {}

  async analyze(base64: string): Promise<{
    width: number
    height: number
    tokens: Awaited<ReturnType<OCRAdapter['extractTokens']>>
  }> {
    const bytes = decodeBase64Image(base64)
    const dims = parseImageDimensions(bytes)
    const tokens = await this.ocr.extractTokens(bytes)
    return {
      width: dims.width,
      height: dims.height,
      tokens,
    }
  }
}

function decodeBase64Image(raw: string): Buffer {
  const normalized = raw.includes(',') ? raw.split(',')[1] ?? '' : raw
  try {
    return Buffer.from(normalized, 'base64')
  } catch (cause) {
    throw new DomainError('Invalid screenshot base64 payload', 'INVALID_SCREENSHOT', {
      cause,
    })
  }
}
