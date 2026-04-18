import { describe, expect, it, vi } from 'vitest'
import { HealthCheckService } from '../../src/application/health-check.service.js'
import type { AppConfig } from '../../src/infrastructure/config/app-config.js'
import type { PlaywrightValidatorPort } from '../../src/domain/contracts/ports.js'
import * as systemChecks from '../../src/infrastructure/system/system-checks.js'

describe('HealthCheckService', () => {
  it('marks unhealthy when MCP is configured but not active', async () => {
    const runtime: PlaywrightValidatorPort = {
      validate: async () => ({
        executed: true,
        unique: true,
        visible: true,
        interactable: true,
        success: true,
        notes: ['local-runtime match count=1'],
      }),
    }
    const cfg: AppConfig = {
      logLevel: 'info',
      cacheTtlMs: 1000,
      cacheMaxEntries: 10,
      playwrightValidatorUrl: undefined,
      playwrightMcpCommand: 'npx',
      playwrightMcpArgs: ['-y', 'some-mcp'],
      playwrightMcpEnv: undefined,
      playwrightMcpCwd: undefined,
      playwrightMcpToolName: 'validate_locator',
      playwrightMcpTimeoutMs: 7000,
      healthProfile: 'balanced',
      playwrightAutoBridge: false,
      playwrightBridgePort: 4010,
    }
    const out = await new HealthCheckService(runtime, cfg).check()
    expect(out.healthy).toBe(false)
    expect(out.runtime.activeMode).toBe('local-fallback')
    expect(out.issues.some((i: string) => i.includes('not active'))).toBe(true)
  })

  it('marks unhealthy in screenshot-first profile when tesseract is missing', async () => {
    vi.spyOn(systemChecks, 'checkCommandAvailable').mockResolvedValue({
      available: false,
    })
    vi.spyOn(systemChecks, 'checkPlaywrightPackageInstalled').mockResolvedValue(true)

    const runtime: PlaywrightValidatorPort = {
      validate: async () => ({
        executed: true,
        unique: true,
        visible: true,
        interactable: true,
        success: true,
        notes: ['source:playwright-mcp'],
      }),
    }
    const cfg: AppConfig = {
      logLevel: 'info',
      cacheTtlMs: 1000,
      cacheMaxEntries: 10,
      playwrightValidatorUrl: undefined,
      playwrightMcpCommand: 'npx',
      playwrightMcpArgs: ['-y', 'some-mcp'],
      playwrightMcpEnv: undefined,
      playwrightMcpCwd: undefined,
      playwrightMcpToolName: 'validate_locator',
      playwrightMcpTimeoutMs: 7000,
      healthProfile: 'screenshot-first',
      playwrightAutoBridge: false,
      playwrightBridgePort: 4010,
    }
    const out = await new HealthCheckService(runtime, cfg).check()
    expect(out.healthy).toBe(false)
    expect(out.runtime.activeMode).toBe('playwright-mcp')
    expect(out.issues.some((i: string) => i.includes('screenshot OCR'))).toBe(true)
  })
})
