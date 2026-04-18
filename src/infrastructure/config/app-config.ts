import { CACHE_DEFAULT_MAX_ENTRIES, CACHE_DEFAULT_TTL_MS } from '../../utils/constants.js'

export interface AppConfig {
  logLevel: string
  cacheTtlMs: number
  cacheMaxEntries: number
  playwrightValidatorUrl?: string
  // Playwright MCP — three mutually exclusive connection modes (priority: url > command > none)
  playwrightMcpUrl?: string      // HTTP/SSE: connect to a shared running playwright-mcp server
  playwrightMcpCommand?: string  // stdio: LIMS spawns its own playwright-mcp subprocess
  playwrightMcpArgs: string[]
  playwrightMcpEnv?: Record<string, string>
  playwrightMcpCwd?: string
  playwrightMcpToolName?: string
  playwrightMcpTimeoutMs: number
  healthProfile: 'balanced' | 'screenshot-first' | 'dom-first'
  playwrightAutoBridge: boolean
  playwrightBridgePort: number
  learningEnabled: boolean
  learningStorePath: string
  artifactsEnabled: boolean
  artifactsDir: string
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawArgs = env.LIMS_PLAYWRIGHT_MCP_ARGS?.trim()
  const rawEnv = env.LIMS_PLAYWRIGHT_MCP_ENV?.trim()
  return {
    logLevel: env.LIMS_LOG_LEVEL ?? 'info',
    cacheTtlMs: Number(env.LIMS_CACHE_TTL_MS ?? CACHE_DEFAULT_TTL_MS),
    cacheMaxEntries: Number(env.LIMS_CACHE_MAX_ENTRIES ?? CACHE_DEFAULT_MAX_ENTRIES),
    playwrightValidatorUrl: env.LIMS_PLAYWRIGHT_VALIDATOR_URL || undefined,
    playwrightMcpUrl: env.LIMS_PLAYWRIGHT_MCP_URL || undefined,
    playwrightMcpCommand: env.LIMS_PLAYWRIGHT_MCP_COMMAND || undefined,
    playwrightMcpArgs: rawArgs ? safeParseJsonArray(rawArgs) : [],
    playwrightMcpEnv: rawEnv ? safeParseJsonRecord(rawEnv) : undefined,
    playwrightMcpCwd: env.LIMS_PLAYWRIGHT_MCP_CWD || undefined,
    playwrightMcpToolName: env.LIMS_PLAYWRIGHT_MCP_TOOL_NAME || undefined,
    playwrightMcpTimeoutMs: Number(env.LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS ?? 7000),
    healthProfile: normalizeHealthProfile(env.LIMS_HEALTH_PROFILE),
    playwrightAutoBridge: (env.LIMS_PLAYWRIGHT_AUTO_BRIDGE ?? 'true').toLowerCase() !== 'false',
    playwrightBridgePort: Number(env.LIMS_PLAYWRIGHT_BRIDGE_PORT ?? 4010),
    learningEnabled: (env.LIMS_LEARNING_ENABLED ?? 'true').toLowerCase() !== 'false',
    learningStorePath: env.LIMS_LEARNING_STORE_PATH || '.lims/locator-learning.json',
    artifactsEnabled: (env.LIMS_ARTIFACTS_ENABLED ?? 'true').toLowerCase() !== 'false',
    artifactsDir: env.LIMS_ARTIFACTS_DIR || '.lims/artifacts',
  }
}

function normalizeHealthProfile(raw: string | undefined): 'balanced' | 'screenshot-first' | 'dom-first' {
  const v = (raw ?? 'balanced').toLowerCase().trim()
  if (v === 'screenshot-first' || v === 'dom-first' || v === 'balanced') return v
  return 'balanced'
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((v) => String(v))
  } catch {
    return raw.split(/\s+/).map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function safeParseJsonRecord(raw: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) out[String(k)] = String(v)
    return out
  } catch {
    return undefined
  }
}
