import { describe, expect, it } from 'vitest'
import { PlaywrightRuntimeValidatorBridge } from '../../src/integrations/playwright/runtime-validator-bridge.js'

describe('PlaywrightRuntimeValidatorBridge', () => {
  it('rejects payload larger than max body limit', async () => {
    const port = 4600 + Math.floor(Math.random() * 200)
    const bridge = new PlaywrightRuntimeValidatorBridge(port)
    bridge.start()
    await new Promise((r) => setTimeout(r, 80))
    try {
      const huge = 'x'.repeat(8 * 1024 * 1024 + 2048)
      const response = await fetch(`http://127.0.0.1:${port}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: huge,
      })
      expect(response.status).toBe(413)
      const body = await response.json()
      expect(body.error).toBe('payload_too_large')
    } finally {
      bridge.stop()
    }
  })
})
