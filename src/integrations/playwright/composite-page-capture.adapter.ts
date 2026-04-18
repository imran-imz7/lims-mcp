import type { PageCaptureInput, PageCapturePort } from '../../domain/contracts/ports.js'
import { DomainError } from '../../utils/errors.js'

export class CompositePageCaptureAdapter implements PageCapturePort {
  constructor(private readonly adapters: PageCapturePort[]) {}

  async capture(input: PageCaptureInput) {
    const errors: string[] = []
    for (const adapter of this.adapters) {
      try {
        return await adapter.capture(input)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    throw new DomainError(
      `All configured page capture adapters failed: ${errors.join(' | ') || 'no adapters available'}`,
      'CAPTURE_FAILED',
    )
  }

  async close(): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.close?.().catch(() => undefined)))
  }
}
