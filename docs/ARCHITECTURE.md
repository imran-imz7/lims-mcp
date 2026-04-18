# Architecture

LIMS follows a strict clean-architecture split. No business logic crosses layer boundaries.

---

## Layer Responsibilities

### `src/mcp/`
- Zod schema validation (`schemas.ts`)
- MCP tool registration and response shaping (`register-tools.ts`)
- `resolveSourceInputs` — reads `domFile`/`xmlFile`/`screenshotFile` from disk
- `withLimsMarker` — wraps every response with `{ status: "LIMS_ACTIVE", _lims: {...} }`
- **No locator, ranking, or healing logic lives here**

### `src/application/`
Orchestrates end-to-end use cases by composing domain engines and integration adapters:

| Service | Tool | Responsibility |
|---|---|---|
| `LocatorGenerationService` | `generate_locator` | Parse DOM → resolve target → generate → temporal → learning → runtime validate → fuse |
| `LocatorCaptureService` | `capture_generate_locator` | Capture live page → delegate to `LocatorGenerationService` → store artifact |
| `LocatorHealingService` | `heal_locator` | Revalidate old locator → similarity recovery → regenerate → fuse confidence |
| `LocatorFeedbackService` | `report_locator_result` | Record outcome → heal on failure → re-record healed outcome |
| `PlaywrightFrameworkSyncService` | `sync_playwright_framework` | Resolve bindings → codegen → merge-write three files |
| `LocatorAnalysisService` | `analyze_dom` | Framework detect → attribute stability → visual/trading hints |
| `HealthCheckService` | `health_check` | Check tesseract, playwright, MCP config; infer runtime mode |

### `src/domain/`
Core locator intelligence — no I/O, no MCP transport knowledge:

- **`LocatorEngine`** — multi-tier candidate generation (Tiers 1–8 + extension providers)
- **`RankingEngine`** — weighted score: uniqueness×0.35, stability×0.25, readability×0.15, maintainability×0.15, length×0.10
- **`UniquenessEngine`** — validates each candidate matches exactly 1 element
- **`SimilarityEngine`** — element fingerprint distance for healing (tag×0.12, text×0.28, attrs×0.35, hierarchy×0.25)
- **`ConfidenceFusionEngine`** — fuses dom×0.50 + visual×0.20 + runtime×0.30 (renormalised when signals absent)
- **`TemporalStabilityEngine`** + **`SnapshotComparator`** — stability across snapshot arrays
- **`FrameworkDetector`** — detects React, Angular, Vue, Flutter Web, AG Grid, etc.
- **`AttributeStabilityAnalyzer`** — rates attributes STABLE / SEMI_STABLE / UNSTABLE
- **`PlaywrightFrameworkCodegen`** — renders `locator` / `page` / `spec` TypeScript/JavaScript blocks
- Providers: `AgGridProvider`, `ReactVirtualizedProvider`, `FlutterWebProvider`
- Trading/chart heuristics: `TradingUiSupport`, `UiPatternIntelligence`

### `src/infrastructure/`
- **`AppConfig`** — reads all `LIMS_*` env vars (`loadConfigFromEnv`)
- **`LocatorArtifactStore`** — per-element JSON files in `.lims/artifacts/{ref}.json`
- **`LocatorLearningStore`** — single `.lims/locator-learning.json` (max 1000 records)
- **`DomRepository`** — Cheerio HTML parsing + xmldom XML parsing
- **`TextFileRepository`** — read/write framework files
- **`Logger`** — pino-based structured logging

### `src/integrations/`
- **`PlaywrightMcpValidatorAdapter`** — MCP-to-MCP bridge (http or stdio mode)
- **`PlaywrightValidatorAdapter`** — local DOM + HTTP bridge + MCP fallback chain
- **`PlaywrightWebCaptureAdapter`** — direct Playwright page capture
- **`CompositePageCaptureAdapter`** — tries MCP capture, falls back to local Playwright
- **`PlaywrightRuntimeValidatorBridge`** — optional auto-started HTTP server for validation
- **`OCR adapter`** — tesseract-backed; no-op when unavailable

---

## Dependency Injection

`src/di/container.ts` (`buildContainer`) is the **only** wiring point.
Nothing outside `container.ts` directly instantiates adapters.

### Playwright MCP Connection — Priority Order

```
LIMS_PLAYWRIGHT_MCP_URL set?
├── YES → PlaywrightMcpValidatorAdapter { mode: 'http', url }
│         (connects to an already-running playwright-mcp HTTP server)
└── NO  → LIMS_PLAYWRIGHT_MCP_COMMAND set?
          ├── YES → PlaywrightMcpValidatorAdapter { mode: 'stdio', command }
          │         (LIMS spawns its own playwright-mcp subprocess)
          └── NO  → No MCP adapter (standalone mode)
                    Page capture: PlaywrightWebCaptureAdapter only
```

### Runtime Validation Chain (at call time)

```
PlaywrightValidator.validate(locator)
  1. MCP adapter present AND connected?
     → call via PlaywrightMcpValidatorAdapter  (source: "playwright-mcp")
  2. LIMS_PLAYWRIGHT_VALIDATOR_URL set OR LIMS_PLAYWRIGHT_AUTO_BRIDGE=true?
     → POST /validate to HTTP bridge            (source: "http-bridge")
  3. Neither
     → Local DOM heuristics (Cheerio/XPath)    (source: "local-fallback")
```

---

## Key Files

| File | Role |
|---|---|
| `src/di/container.ts` | Composition root — all wiring |
| `src/mcp/register-tools.ts` | MCP surface — schema validation + delegation |
| `src/mcp/schemas.ts` | Zod input/output schemas |
| `src/application/locator-generation.service.ts` | Main generation orchestrator (~886 lines) |
| `src/application/locator-healing.service.ts` | Healing orchestrator |
| `src/application/locator-capture.service.ts` | Live-capture orchestrator |
| `src/application/locator-feedback.service.ts` | Feedback + learning orchestrator |
| `src/application/playwright-framework-sync.service.ts` | Framework file writer |
| `src/domain/locator/locator-engine.ts` | Multi-tier candidate generation |
| `src/domain/ranking-engine/ranking-engine.ts` | Weighted scoring |
| `src/domain/confidence/confidence-fusion-engine.ts` | Signal fusion |
| `src/domain/similarity-engine/similarity-engine.ts` | Fingerprint-based healing |
| `src/infrastructure/config/app-config.ts` | All env-var bindings |
| `src/integrations/playwright/playwright-mcp-validator.adapter.ts` | MCP-to-MCP bridge |
| `src/utils/locator-priority.ts` | LOCATOR_PRIORITY_TIERS (1–8) |
| `src/utils/constants.ts` | RANKING_WEIGHTS, STABILITY_SCORES |

---

## Important Boundaries

- Live browser capture is **web-only** (`CompositePageCaptureAdapter`)
- Framework file sync is **Playwright-only** (`PlaywrightFrameworkSyncService`)
- Android/iOS support is **snapshot-oriented** — no native device runtime adapter
- Domain layer has **no I/O** — all file/network access is via injected ports
- MCP layer has **no business logic** — only schema validation and delegation

---

## Data Flow — Artifact and Learning Stores

```
capture_generate_locator
  └── LocatorArtifactStore.saveArtifact({ref})
        → .lims/artifacts/{ref}.json
           { dom, screenshot, fingerprint, generation, outcomes:[] }

report_locator_result (passed)
  └── LocatorArtifactStore.appendOutcome({ status: 'passed' })
  └── LocatorLearningStore.recordOutcome({ status: 'success' })
        → .lims/locator-learning.json (max 1000 records)

report_locator_result (failed → healed)
  └── LocatorArtifactStore.appendOutcome({ status: 'failed' })
  └── LocatorHealingService.heal → healedLocator
  └── LocatorArtifactStore.appendOutcome({ status: 'healed', improvedLocator })
  └── LocatorLearningStore.recordOutcome({ status: 'healed', replacementLocator })

generate_locator (any subsequent call for same page/target)
  └── LocatorLearningStore.getInsights
        → preferredLocators (boost ranking)
        → failedLocators (penalise ranking)
        → healedPairs (direct substitution hint)
```
