import { describe, expect, it } from 'vitest'
import { buildContainer } from '../../src/di/container.js'

describe('buildContainer runtime wiring', () => {
  it('does not auto-start HTTP bridge when MCP runtime is configured', () => {
    const services = buildContainer({
      LIMS_PLAYWRIGHT_MCP_COMMAND: 'node',
      LIMS_PLAYWRIGHT_MCP_ARGS: '["-e","process.exit(0)"]',
      LIMS_PLAYWRIGHT_AUTO_BRIDGE: 'true',
    } as NodeJS.ProcessEnv)
    expect(services.bridge).toBeUndefined()
  })
})
