import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaywrightValidatorAdapter } from '../../src/integrations/playwright/playwright-validator.adapter.js'

describe('PlaywrightValidatorAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not treat unsupported playwright locators as unique', async () => {
    const adapter = new PlaywrightValidatorAdapter()
    const out = await adapter.validate({
      locator: "page.locator('.buy').nth(2)",
      kind: 'playwright',
      domSnapshot: '<html><body><button class="buy">Buy</button><button class="buy">Buy</button></body></html>',
      platform: 'web',
      retries: 1,
    })
    expect(out.success).toBe(false)
    expect(out.unique).toBe(false)
    expect(out.notes.join(' ')).toContain('non-unique or missing match')
    expect(out.notes).toContain('source:local-fallback')
  })

  it('retries remote validation and succeeds on second attempt', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('network')
      return new Response(JSON.stringify({
        executed: true,
        unique: true,
        visible: true,
        interactable: true,
        success: true,
        notes: ['remote ok'],
      }), { status: 200 })
    }))
    const adapter = new PlaywrightValidatorAdapter('http://127.0.0.1:4010/validate')
    const out = await adapter.validate({
      locator: '#a',
      kind: 'css',
      domSnapshot: '<div id="a"></div>',
      platform: 'web',
      retries: 1,
    })
    expect(calls).toBe(2)
    expect(out.success).toBe(true)
    expect(out.executed).toBe(true)
    expect(out.notes).toContain('source:http-bridge')
  })

  it('delegates close to MCP validator', async () => {
    const close = vi.fn(async () => undefined)
    const validate = vi.fn(async () => ({
      executed: false,
      unique: false,
      visible: false,
      interactable: false,
      success: false,
      notes: ['closed'],
    }))
    const adapter = new PlaywrightValidatorAdapter(
      undefined,
      { close, validate } as unknown as any,
    )
    await adapter.close()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
