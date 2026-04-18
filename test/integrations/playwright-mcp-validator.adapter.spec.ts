import { describe, expect, it } from 'vitest'
import { PlaywrightMcpValidatorAdapter } from '../../src/integrations/playwright/playwright-mcp-validator.adapter.js'

describe('PlaywrightMcpValidatorAdapter', () => {
  it('returns unavailable after close', async () => {
    const adapter = new PlaywrightMcpValidatorAdapter({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 100,
    })
    await adapter.close()
    const out = await adapter.validate({
      locator: '#a',
      kind: 'css',
      domSnapshot: '<div id="a"></div>',
      platform: 'web',
      retries: 1,
    })
    expect(out.executed).toBe(false)
    expect(out.notes.join(' ')).toContain('closed')
  })
})
