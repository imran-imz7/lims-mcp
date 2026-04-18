import type {
  PlaywrightValidatorPort,
  RuntimeValidationInput,
} from '../contracts/ports.js'
import type { RuntimeValidation } from '../contracts/types.js'

/**
 * Runtime validation orchestrator with adapter fallback support.
 */
export class PlaywrightValidator {
  constructor(private readonly adapter: PlaywrightValidatorPort) {}

  async validate(input: RuntimeValidationInput): Promise<RuntimeValidation> {
    return this.adapter.validate(input)
  }
}
