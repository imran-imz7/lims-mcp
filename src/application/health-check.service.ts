import type { AppConfig } from '../infrastructure/config/app-config.js'
import type { PlaywrightValidatorPort } from '../domain/contracts/ports.js'
import {
  checkCommandAvailable,
  checkPlaywrightPackageInstalled,
} from '../infrastructure/system/system-checks.js'

export class HealthCheckService {
  constructor(
    private readonly runtimeValidator: PlaywrightValidatorPort,
    private readonly config: AppConfig,
  ) {}

  async check() {
    const [tesseract, playwrightInstalled] = await Promise.all([
      checkCommandAvailable('tesseract', ['--version']),
      checkPlaywrightPackageInstalled(),
    ])

    const runtimeProbe = await this.runtimeValidator.validate({
      locator: '#lims-health-probe',
      kind: 'css',
      domSnapshot: '<html><body><button id="lims-health-probe">health</button></body></html>',
      platform: 'web',
      retries: 1,
      targetHint: 'health-check',
    })

    const runtimeMode = detectRuntimeMode(runtimeProbe.notes)
    const issues: string[] = []
    const warnings: string[] = []
    const mcpExpected = Boolean(this.config.playwrightMcpCommand)
    const httpExpected = Boolean(this.config.playwrightValidatorUrl) || this.config.playwrightAutoBridge

    if (mcpExpected && runtimeMode !== 'playwright-mcp') {
      issues.push('playwright MCP is configured but not active at runtime')
    }
    if (!runtimeProbe.executed) {
      issues.push('runtime validation probe did not execute')
    }
    if (!runtimeProbe.success) {
      issues.push('runtime validation probe did not succeed')
    }
    if (!mcpExpected && !httpExpected && runtimeMode === 'unknown') {
      issues.push('no runtime validation mode is active')
    }
    if (!tesseract.available) {
      warnings.push('tesseract is not installed; screenshot-only OCR quality will be limited')
    }
    if (!playwrightInstalled && this.config.playwrightAutoBridge) {
      warnings.push('playwright package/browsers missing; auto bridge mode may degrade')
    }
    if (this.config.healthProfile === 'screenshot-first' && !tesseract.available) {
      issues.push('health profile requires screenshot OCR, but tesseract is not installed')
    }
    if (this.config.healthProfile === 'dom-first' && !runtimeProbe.executed) {
      issues.push('health profile requires runtime validation execution for dom-first mode')
    }

    return {
      healthy: issues.length === 0,
      prerequisites: {
        nodeVersion: process.version,
        tesseractInstalled: tesseract.available,
        tesseractVersion: tesseract.output?.split('\n')[0] ?? null,
        playwrightPackageInstalled: playwrightInstalled,
      },
      runtime: {
        activeMode: runtimeMode,
        probe: runtimeProbe,
      },
      issues,
      warnings,
      config: {
        playwrightMcpConfigured: Boolean(this.config.playwrightMcpCommand),
        playwrightMcpCommand: this.config.playwrightMcpCommand ?? null,
        playwrightMcpToolName: this.config.playwrightMcpToolName ?? null,
        playwrightHttpConfigured: Boolean(this.config.playwrightValidatorUrl),
        healthProfile: this.config.healthProfile,
        playwrightAutoBridge: this.config.playwrightAutoBridge,
        playwrightBridgePort: this.config.playwrightBridgePort,
      },
    }
  }
}

function detectRuntimeMode(notes: string[]): 'playwright-mcp' | 'http-bridge' | 'local-fallback' | 'unknown' {
  const joined = notes.join(' | ').toLowerCase()
  if (joined.includes('source:playwright-mcp')) return 'playwright-mcp'
  if (joined.includes('source:http-bridge') || joined.includes('playwright bridge')) return 'http-bridge'
  if (joined.includes('source:local-fallback') || joined.includes('local-runtime')) return 'local-fallback'
  return 'unknown'
}
