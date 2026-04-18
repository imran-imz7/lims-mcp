# 🔍 LIMS — Locator Intelligence MCP Server

> **Generate, validate, rank, and auto-heal UI locators for Playwright, Selenium, and Appium — directly inside Cursor AI.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![Tests](https://img.shields.io/badge/tests-67%20passing-brightgreen)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](#)

---

## 📋 Table of Contents

| # | Section | What you'll find |
|---|---|---|
| 1 | [What LIMS Does](#-what-lims-does) | Problem solved, core capabilities |
| 2 | [Quick Start](#-quick-start) | Install, build, connect to Cursor |
| 3 | [Architecture](#-architecture) | How all pieces fit together |
| 4 | [The 7 MCP Tools](#-the-7-mcp-tools) | Every tool, its input, its output |
| 5 | [File Map](#-file-map) | Every file explained — what it does, when to touch it |
| 6 | [Locator Priority Strategy](#-locator-priority-strategy) | Why certain selectors win over others |
| 7 | [Confidence Score Explained](#-confidence-score-explained) | What 0.98 vs 0.61 actually means |
| 8 | [Ranking Weights](#-ranking-weights) | The scoring formula, every knob |
| 9 | [Customisation Guide](#-customisation-guide) | Where to change configs, priorities, thresholds |
| 10 | [Runtime Modes](#-runtime-modes) | Playwright MCP subprocess vs HTTP vs standalone |
| 11 | [Platform Support](#-platform-support) | Web, Android, iOS |
| 12 | [Documentation Index](#-documentation-index) | All docs with descriptions |

---

## 🎯 What LIMS Does

Writing automation code in Playwright, Selenium, or Appium has one recurring problem: **finding locators that do not break**.

LIMS solves this as an MCP server inside Cursor. You describe an element in plain language. LIMS opens the page, inspects the DOM, generates ranked locators ordered by stability, validates them against a real browser, writes your Page Object files, and heals them automatically when the UI changes.

```
You say:  "Generate locators for the Login button on https://myapp.com"

LIMS:     captures DOM + screenshot
          runs 7 priority tiers of candidate generation
          enforces: must match exactly 1 element
          ranks by stability + uniqueness + readability
          validates in real Chromium browser
          returns ──────────────────────────────────────────────────────
          {
            bestLocator:  page.getByTestId('login-btn')   confidence: 0.98
            fallbacks: [
              page.getByRole('button', { name: 'Login' }) confidence: 0.91
              page.locator('#login-submit')                confidence: 0.85
              //button[text()='Login']                     confidence: 0.40
            ]
          }
          writes: login.locator.ts  login.page.ts  login.spec.ts
```

---

## ⚡ Quick Start

### 1 — Install and build

```bash
git clone https://github.com/imran-imz7/locator-intelligence-mcp
cd locator-intelligence-mcp

npm install
npm run build   # compiles TypeScript → dist/
npm test        # runs 67 tests — all should pass
```

**Browser install (optional — only needed for local Playwright capture):**

```bash
npx playwright install chromium
```

> If you are using `LIMS_PLAYWRIGHT_MCP_COMMAND` (subprocess mode) or `LIMS_PLAYWRIGHT_MCP_URL` (HTTP mode), LIMS uses the external `playwright-mcp` binary for its browser and you do **not** need to install Chromium separately. You can also suppress any automatic browser download during `npm install` with:
> ```bash
> PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
> ```

### 2 — Connect to Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Playwright": {
      "command": "playwright-mcp",
      "args": ["--headless", "--isolated"]
    },
    "LIMS": {
      "command": "node",
      "args": ["/absolute/path/to/lims-mcp/dist/cli.js"],
      "env": {
        "LIMS_PLAYWRIGHT_MCP_COMMAND": "playwright-mcp",
        "LIMS_PLAYWRIGHT_MCP_ARGS":    "[\"--headless\", \"--isolated\"]",
        "LIMS_PLAYWRIGHT_AUTO_BRIDGE": "false",
        "LIMS_LEARNING_ENABLED":       "true",
        "LIMS_ARTIFACTS_ENABLED":      "true",
        "LIMS_ARTIFACTS_DIR":          "/absolute/path/to/lims-mcp/.lims/artifacts",
        "LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS": "10000"
      }
    }
  }
}
```

> Playwright MCP requires `npm install -g @playwright/mcp`. If you skip it, LIMS still works — it falls back to local DOM mode automatically.

### 3 — Restart Cursor and use it

```
"Generate Playwright locators and a test file for the login form at https://myapp.com"
```

---

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         CURSOR AI AGENT                            │
│  You describe elements → Agent calls LIMS tools → Gets locators    │
└────────────┬──────────────────────────────────────┬───────────────┘
             │ MCP calls                            │ MCP calls
             ▼                                      ▼
  ┌─────────────────────┐               ┌──────────────────────────┐
  │   Playwright MCP    │               │          LIMS            │
  │  (agent's browser)  │               │  (locator intelligence)  │
  │                     │               │                          │
  │  browser_navigate   │               │  generate_locator        │
  │  browser_snapshot   │               │  heal_locator            │
  │  browser_screenshot │               │  sync_playwright_        │
  │  browser_click      │               │    framework             │
  │                     │               │  analyze_dom             │
  └─────────────────────┘               │  report_locator_result   │
                                        │  capture_generate_       │
                                        │    locator               │
                                        │  health_check            │
                                        └──────────┬───────────────┘
                                                   │ internal
                                                   ▼
                                        ┌──────────────────────────┐
                                        │  LIMS internal layers    │
                                        │                          │
                                        │  mcp/         ← schemas  │
                                        │  application/ ← usecases │
                                        │  domain/      ← engines  │
                                        │  infra/       ← storage  │
                                        │  integrations/← browser  │
                                        └──────────────────────────┘
```

**Key rule:** Playwright MCP and LIMS are isolated processes. They cannot call each other. The Cursor agent bridges them. LIMS has its own internal playwright-mcp subprocess for locator validation — completely separate from Cursor's Playwright MCP.

---

## 🛠 The 7 MCP Tools

| Tool | When to use | Key inputs | Key outputs |
|---|---|---|---|
| `capture_generate_locator` | Point at a live URL — capture + generate in one call | `pageUrl` or `runtimeContext.useCurrentPage=true`, `target` | `bestLocator`, `fallbacks`, `artifactRef` |
| `generate_locator` | You already have the HTML/XML snapshot | `dom` or `xml`, `platform`, `target` | `bestLocator`, `confidence`, `fallbacks`, `automation` |
| `heal_locator` | A locator broke after a UI change | `dom`, `oldLocator`, optional `fingerprint` | `healedLocator`, `confidence`, `diff`, `explanation` |
| `report_locator_result` | After running your test — tell LIMS pass or fail | `locator`, `status`, `artifactRef` | `learned`, optional `improved` |
| `sync_playwright_framework` | Write Page Object files to disk | `feature`, `language`, `locatorBindings` | Written file paths: `*.spec.*`, `*.page.*`, `*.locator.*` |
| `analyze_dom` | Inspect a page before generating locators | `dom` or `xml` | `framework`, `recommendedAttributes`, `stabilityReport` |
| `health_check` | Verify server and all integrations are working | none | `healthy`, `prerequisites`, `runtime`, `issues` |

---

## 🗂 File Map

Every file in the project — what it does, when you need to open it.

### Entry Points

```
src/index.ts          MCP server startup, StdioServerTransport wiring
src/cli.ts            CLI entry point (node dist/cli.js)
src/di/container.ts   Composition root — wires every dependency together
```

> **To add a new dependency or swap an adapter:** `src/di/container.ts`

---

### `src/mcp/` — MCP Transport Layer

> **Rule:** No business logic here. Only input/output schema and tool registration.

| File | Purpose | When to touch it |
|---|---|---|
| `schemas.ts` | Zod schemas for every tool input | Add or change a tool's input fields |
| `register-tools.ts` | Registers all 7 tools with the MCP server | Add a new MCP tool |

---

### `src/application/` — Use Cases (Orchestration)

> Each file = one use case. Composes domain engines and integration adapters.

| File | Purpose | When to touch it |
|---|---|---|
| `locator-generation.service.ts` | Full pipeline: parse → resolve → generate → validate → fuse → catalog | Change the generation flow or add a new signal |
| `locator-healing.service.ts` | Healing flow: try old → fingerprint → similarity → regenerate → validate | Change how healing decisions are made |
| `locator-analysis.service.ts` | DOM analysis: framework detection + stability report | Change what `analyze_dom` returns |
| `locator-capture.service.ts` | Capture live page then generate | Change the capture + generate pipeline |
| `locator-feedback.service.ts` | Record pass/fail, trigger healing on failure | Change learning or feedback behaviour |
| `playwright-framework-sync.service.ts` | Write `.spec`, `.page`, `.locator` files | Change file-writing logic |
| `health-check.service.ts` | Check Playwright, Tesseract, runtime mode | Add new health checks |

---

### `src/domain/` — Core Intelligence

> Framework-agnostic business logic. No MCP types. No file I/O.

#### Locator Generation

| File | Purpose | When to touch it |
|---|---|---|
| `locator/locator-engine.ts` | **Main engine** — runs all 7 priority tiers, deduplicates, enforces uniqueness, calls ranking | Change candidate generation logic |
| `locator/locator-engine-patterns.ts` | Pattern helpers for candidate extraction | Add new attribute patterns |
| `locator/locator-engine-trading-helpers.ts` | Trading/financial UI special cases | Add trading platform support |
| `locator/locator-engine-runtime-uniqueness.ts` | Runtime uniqueness bridge | Change uniqueness checking |
| `locator/target-resolver.ts` | Resolves `target` string/descriptor to a DOM node | Change how targets are identified |
| `locator/multi-platform-codegen.ts` | Generates platform-specific locator strings | Add Appium, Selenium, or custom formats |
| `locator/ui-pattern-intelligence.ts` | Detects UI patterns: tables, modals, forms | Add new UI pattern detection |
| `locator/locator-extension.ts` | `LocatorCandidateProvider` interface | Implement a custom locator provider |

#### Locator Providers (plug-in pattern)

| File | Purpose | Register in |
|---|---|---|
| `locator/providers/ag-grid-provider.ts` | AG Grid row/cell locators | `src/di/container.ts` |
| `locator/providers/react-virtualized-provider.ts` | React Virtualized list locators | `src/di/container.ts` |
| `locator/providers/flutter-web-provider.ts` | Flutter web element locators | `src/di/container.ts` |

> **To add a new framework provider:** implement `LocatorCandidateProvider`, add to `container.ts`.

#### Scoring and Ranking

| File | Purpose | When to touch it |
|---|---|---|
| `ranking-engine/ranking-engine.ts` | Weighted ranking of candidates | Change how candidates are ordered |
| `confidence/confidence-fusion-engine.ts` | Fuses DOM score + visual + runtime into final confidence | Change how confidence is calculated |
| `uniqueness-engine/uniqueness-engine.ts` | Enforces 1-match rule per candidate | Change uniqueness enforcement |
| `attribute-stability/attribute-stability-analyzer.ts` | Scores attribute stability | Add new stable/unstable attribute rules |
| `selector-validator/selector-validator.ts` | Validates selector syntax | Add selector syntax rules |

#### Healing

| File | Purpose | When to touch it |
|---|---|---|
| `similarity-engine/similarity-engine.ts` | Structural similarity for healing (tag, text, attributes, hierarchy) | Change how broken locators are matched to new DOM |
| `element-fingerprint/element-fingerprint.ts` | Element fingerprint generation | Change what gets stored in an artifact |

#### Dynamic / Temporal

| File | Purpose | When to touch it |
|---|---|---|
| `dynamic/temporal-stability-engine.ts` | Compares snapshots across time, rates mutation | Change temporal stability scoring |
| `dynamic/snapshot-comparator.ts` | DOM diff between two snapshots | Change snapshot comparison logic |
| `dynamic/index.ts` | `STATIC` / `SEMI_DYNAMIC` / `HIGHLY_DYNAMIC` text classifier | **Change dynamic text classification rules** |

#### Visual / Chart

| File | Purpose | When to touch it |
|---|---|---|
| `visual/visual-locator-engine.ts` | Screenshot + OCR correlation | Change visual locator logic |
| `visual/canvas-element-detector.ts` | Canvas / WebGL / SVG detection | Add chart surface detection |
| `visual/dom-correlation-engine.ts` | Correlates DOM elements with visual regions | Change visual-DOM mapping |

#### Framework Detection and Codegen

| File | Purpose | When to touch it |
|---|---|---|
| `framework-detector/framework-detector.ts` | Detects React, Angular, Vue, etc. | Add new framework detection |
| `framework-sync/playwright-framework-codegen.ts` | Renders `.spec`, `.page`, `.locator` TypeScript/JavaScript | Change generated file templates |

#### Other Domain

| File | Purpose |
|---|---|
| `heuristics/heuristics-engine.ts` | DOM heuristics (placeholder, label, input type detection) |
| `css-builder/css-builder.ts` | Builds CSS selectors from element attributes |
| `xpath-builder/xpath-builder.ts` | Builds XPath expressions |
| `relative-locator-engine/relative-locator-engine.ts` | `near()`, `above()`, `below()` relative locators |
| `trading/trading-ui-support.ts` | Trading/financial dashboard special handling |
| `runtime/playwright-validator.ts` | Domain facade for runtime validation |
| `contracts/types.ts` | All shared TypeScript types |
| `contracts/ports.ts` | All interface contracts (ports) |
| `plugin/plugin-registry.ts` | Plugin registry wiring |

---

### `src/infrastructure/` — Storage, Config, Parsing

| File | Purpose | When to touch it |
|---|---|---|
| **`config/app-config.ts`** | **All environment variable definitions and defaults** | **Add or change any config option** |
| `cache/locator-artifact-store.ts` | Reads/writes `.lims/artifacts/*.json` | Change artifact format |
| `cache/locator-learning-store.ts` | Reads/writes `.lims/locator-learning.json` | Change learning data format |
| `cache/memory-cache.ts` | In-memory TTL cache | Change cache eviction |
| `parsers/dom-repository.ts` | Parses HTML/XML into Cheerio + xmldom | Change DOM parsing |
| `files/text-file-repository.ts` | Writes framework files to disk | Change file output |
| `logging/pino-logger.ts` | Structured JSON logging via pino | Change log format |

---

### `src/integrations/` — External Adapters

| File | Purpose | When to touch it |
|---|---|---|
| `playwright/playwright-mcp-validator.adapter.ts` | Connects to playwright-mcp via **stdio** or **HTTP** | Change how LIMS talks to playwright-mcp |
| `playwright/playwright-validator.adapter.ts` | Tries MCP → HTTP bridge → local DOM fallback | Change validation fallback chain |
| `playwright/playwright-web-capture.adapter.ts` | Local Playwright page capture | Change local capture logic |
| `playwright/composite-page-capture.adapter.ts` | Tries adapters in order (MCP first, local second) | Change capture priority |
| `playwright/runtime-validator-bridge.ts` | Optional local HTTP validation server | Change HTTP bridge behaviour |
| `ocr/tesseract-cli-ocr.adapter.ts` | Tesseract CLI for screenshot OCR | Swap OCR engine |
| `vision/basic-screenshot-analyzer.ts` | Screenshot analysis using OCR | Change screenshot analysis |

---

### `src/utils/` — Shared Utilities

| File | Purpose | When to touch it |
|---|---|---|
| **`utils/constants.ts`** | **RANKING_WEIGHTS, STABILITY_SCORES, LENGTH_NORM_TARGET** | **Tune scoring weights** |
| **`utils/locator-priority.ts`** | **LOCATOR_PRIORITY_TIERS (1–8)** | **Change locator priority order** |
| `utils/scoring-utils.ts` | `clamp01`, `lengthScore` helpers | Change scoring math |
| `utils/regex-patterns.ts` | Regex for dynamic ID detection, hash detection | Add new unstable ID patterns |
| `utils/playwright-locator-parse.ts` | Parse `page.getByTestId(...)` strings | Add new Playwright locator patterns |
| `utils/errors.ts` | `DomainError` class | Change error codes |

---

## 🏆 Locator Priority Strategy

LIMS always evaluates candidates in this strict tier order. Lower tier number = tried first = preferred when stable.

```
┌─────┬──────────────────────┬────────────────────────────────────────────┬────────────┐
│Tier │ Strategy             │ Examples                                   │ Stability  │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  1  │ Test attributes      │ data-testid="submit"                       │ ██████████ │
│     │                      │ data-test="login-btn"                      │ Highest    │
│     │                      │ data-qa="email-field"                      │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  2  │ Accessibility        │ aria-label="Close dialog"                  │ █████████░ │
│     │                      │ role="button" + name="Submit"              │ Very high  │
│     │                      │ getByRole('textbox', {name:'Email'})       │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  3  │ Structural anchors   │ id="login-form"  (non-dynamic only)        │ ████████░░ │
│     │                      │ name="email"                               │ High       │
│     │                      │ Dynamic IDs auto-rejected (hash/uuid/ts)  │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  4  │ Form hints           │ placeholder="Enter your email"             │ ███████░░░ │
│     │                      │ type="submit"                              │ Medium-high│
│     │                      │ label[for=...] associations                │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  5  │ Visible text         │ getByText('Login')  — STATIC text only     │ ██████░░░░ │
│     │                      │ SEMI_DYNAMIC → lower confidence            │ Medium     │
│     │                      │ HIGHLY_DYNAMIC → ❌ rejected automatically │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  6  │ Relative locators    │ near('Email label')                        │ █████░░░░░ │
│     │                      │ above('Password field')                    │ Medium-low │
│     │                      │ right-of('Submit')                        │            │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  7  │ XPath fallback       │ //input[@type='email']                     │ ███░░░░░░░ │
│     │                      │ (constrained, not absolute paths)          │ Low        │
├─────┼──────────────────────┼────────────────────────────────────────────┼────────────┤
│  8  │ CSS class (last)     │ .btn-primary  .submit-button               │ █░░░░░░░░░ │
│     │                      │ Utility classes (.flex, .p-4) rejected     │ Lowest     │
└─────┴──────────────────────┴────────────────────────────────────────────┴────────────┘
```

**Dynamic text classification** — automatically applied before any text-based locator is used:

```
STATIC          → safe to use as locator signal
                  e.g. "Login", "Submit", "Email address"

SEMI_DYNAMIC    → used with reduced confidence
                  e.g. "Welcome, John" (changes per user)

HIGHLY_DYNAMIC  → never used as locator signal ❌
                  e.g. "$1,234.56", "00:03:42", "Loading 87%..."
```

> **To change the priority order:** edit `src/utils/locator-priority.ts`
> **To change dynamic text rules:** edit `src/domain/dynamic/index.ts`

---

## 📊 Confidence Score Explained

Every locator LIMS returns has a `confidence` between `0.0` and `1.0`. Here is what that number means and how it is calculated.

### What the number means

```
1.00 ──── Perfect. Unique, visible, interactable, test-attribute based.
│         Passes all runtime checks. Will not break on normal UI changes.
│
0.90 ──── Excellent. Aria or structural anchor, runtime validated.
│
0.80 ──── Good. Stable attribute but no test-id. Passes DOM uniqueness.
│
0.70 ──── Acceptable. Visible text or relative locator. Stable enough.
│
0.60 ──── Use with caution. Placeholder or weak anchor.
│
0.50 ──── Fragile. May break on minor UI refactor.
│
0.30 ──── Last resort. XPath or class-based. High break risk.
│
0.00 ──── Rejected. Not unique (matches >1 element) or not visible.
```

### How confidence is calculated

LIMS fuses three signals into one final score:

```
Final Confidence = (DOM score × 0.50)
                 + (Visual score × 0.20)   ← only if screenshot provided
                 + (Runtime score × 0.30)  ← only if browser validation ran
```

#### DOM Score — from the ranking engine (5 weighted factors)

```
┌─────────────────────┬────────┬───────────────────────────────────────────┐
│ Factor              │ Weight │ What it measures                          │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ Uniqueness          │  0.35  │ Matches exactly 1 element = 1.0           │
│                     │        │ Matches >1 element = 0.0 (hard gate)      │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ Attribute stability │  0.25  │ STABLE attribute (testid, aria) = 1.0     │
│                     │        │ SEMI_STABLE (id, name) = 0.55             │
│                     │        │ UNSTABLE (dynamic class, index) = 0.0     │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ Readability         │  0.15  │ Human-readable selector = higher score    │
│                     │        │ Long XPath chain = lower score            │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ Maintainability     │  0.15  │ No complex regex = 0.55 base              │
│                     │        │ No long chain (< 6 hops) = +0.45         │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ Length              │  0.10  │ Shorter locator = higher score            │
│                     │        │ Normalised against 120-char target        │
└─────────────────────┴────────┴───────────────────────────────────────────┘
```

#### Runtime Score — from live browser validation

```
┌─────────────────────┬────────┬───────────────────────────────────────────┐
│ Check               │ Points │ What it means                             │
├─────────────────────┼────────┼───────────────────────────────────────────┤
│ executed            │  +0.20 │ Browser validation actually ran           │
│ unique              │  +0.25 │ locator.count() === 1 in real browser     │
│ visible             │  +0.25 │ element.isVisible() === true              │
│ interactable        │  +0.20 │ click({trial:true}) did not throw         │
│ success             │  +0.10 │ All above passed together                 │
└─────────────────────┴────────┴───────────────────────────────────────────┘
Max runtime score = 1.0 (all five checks pass)
```

#### Visual Score — from screenshot + OCR (when screenshot provided)

```
0.0 – 1.0  based on how closely the OCR-extracted text near the element
           matches the target description. Higher = better visual match.
```

### Example: how a score of 0.94 is built

```
Element: Login button  (data-testid="login-btn", visible, interactable)

DOM score:
  uniqueness        1.0 × 0.35 = 0.350
  attribute stab.   1.0 × 0.25 = 0.250   ← data-testid = STABLE
  readability       0.9 × 0.15 = 0.135
  maintainability   1.0 × 0.15 = 0.150
  length            0.9 × 0.10 = 0.090
  ─────────────────────────────────────
  DOM total                    = 0.975

Runtime score:
  executed+unique+visible+interactable+success = 1.0

Final confidence:
  (0.975 × 0.50) + (1.0 × 0.30) = 0.487 + 0.300 = 0.787
  → normalised → 0.94
```

---

## ⚖️ Ranking Weights

All weights live in one file: **`src/utils/constants.ts`**

```typescript
export const RANKING_WEIGHTS = {
  uniqueness:         0.35,   // ← most important: must match exactly 1 element
  attributeStability: 0.25,   // ← second: is the attribute type stable?
  readability:        0.15,   // ← human-readable selectors preferred
  maintainability:    0.15,   // ← avoid regex chains and long XPath
  length:             0.10,   // ← shorter is better
}

export const STABILITY_SCORES = {
  STABLE:      1.00,   // data-testid, aria-label, role
  SEMI_STABLE: 0.55,   // id, name, placeholder
  UNSTABLE:    0.00,   // dynamic classes, index-based, hash IDs
}

export const LENGTH_NORM_TARGET = 120   // chars — locator longer than this scores 0 on length
```

**To make uniqueness even more dominant:** increase `uniqueness` weight and decrease others (all must sum to 1.0).
**To favour shorter locators more:** increase `length` weight.
**To treat `id` as stable (not semi-stable):** change `SEMI_STABLE` to `1.00` — but only if your app uses consistent IDs.

---

## ⚙️ Customisation Guide

### Where to change what — quick reference

```
WHAT YOU WANT TO CHANGE                    WHERE TO CHANGE IT
──────────────────────────────────────────────────────────────────────
Add/change config env variable             src/infrastructure/config/app-config.ts
Change locator priority order              src/utils/locator-priority.ts
Tune confidence/ranking weights            src/utils/constants.ts
Change dynamic text classification         src/domain/dynamic/index.ts
Add a new locator provider (AG Grid etc.)  src/domain/locator/providers/
                                           + register in src/di/container.ts
Change healing similarity logic            src/domain/similarity-engine/similarity-engine.ts
Change generated file templates            src/domain/framework-sync/playwright-framework-codegen.ts
Add a new MCP tool                         src/mcp/schemas.ts
                                           + src/mcp/register-tools.ts
                                           + new service in src/application/
Change Playwright connection mode          src/infrastructure/config/app-config.ts
                                           (LIMS_PLAYWRIGHT_MCP_URL or COMMAND)
Change artifact storage location          LIMS_ARTIFACTS_DIR env var
Change learning store location            LIMS_LEARNING_STORE_PATH env var
```

### All environment variables

| Variable | Default | What it controls |
|---|---|---|
| `LIMS_PLAYWRIGHT_MCP_URL` | _(none)_ | HTTP URL of a shared playwright-mcp server (e.g. `http://localhost:8931/mcp`) |
| `LIMS_PLAYWRIGHT_MCP_COMMAND` | _(none)_ | Command to spawn playwright-mcp as subprocess (e.g. `playwright-mcp`) |
| `LIMS_PLAYWRIGHT_MCP_ARGS` | `[]` | JSON array of args for subprocess (e.g. `["--headless","--isolated"]`) |
| `LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS` | `7000` | Timeout per playwright-mcp call in ms |
| `LIMS_PLAYWRIGHT_VALIDATOR_URL` | _(none)_ | URL of a custom HTTP validation endpoint |
| `LIMS_PLAYWRIGHT_AUTO_BRIDGE` | `true` | Auto-start local HTTP validation bridge when no MCP |
| `LIMS_PLAYWRIGHT_BRIDGE_PORT` | `4010` | Port for the auto bridge |
| `LIMS_LEARNING_ENABLED` | `true` | Record pass/fail outcomes for future ranking bias |
| `LIMS_LEARNING_STORE_PATH` | `.lims/locator-learning.json` | Path to learning history file |
| `LIMS_ARTIFACTS_ENABLED` | `true` | Save DOM + locator snapshots for healing |
| `LIMS_ARTIFACTS_DIR` | `.lims/artifacts` | Directory for artifact JSON files |
| `LIMS_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `LIMS_CACHE_TTL_MS` | `60000` | In-memory DOM cache TTL in ms |
| `LIMS_CACHE_MAX_ENTRIES` | `500` | Max entries in in-memory DOM cache |
| `LIMS_HEALTH_PROFILE` | `balanced` | Health check mode: `balanced`, `dom-first`, `screenshot-first` |

---

## 🔌 Runtime Modes

LIMS picks a runtime validation mode automatically based on what is configured. Priority: URL > command > standalone.

```
┌─────┬──────────────────────────────┬───────────────────────────────────────────────┐
│ Pri │ Mode                         │ How to activate                               │
├─────┼──────────────────────────────┼───────────────────────────────────────────────┤
│  1  │ HTTP — shared server         │ Set LIMS_PLAYWRIGHT_MCP_URL                   │
│     │ One browser for Cursor+LIMS  │ Run: playwright-mcp --headless --port 8931    │
│     │ Most efficient               │ Cursor: { "url": "http://localhost:8931/mcp" }│
├─────┼──────────────────────────────┼───────────────────────────────────────────────┤
│  2  │ stdio — LIMS subprocess      │ Set LIMS_PLAYWRIGHT_MCP_COMMAND               │
│     │ LIMS owns its browser        │ playwright-mcp must be installed globally      │
│     │ Fully self-contained         │ npm install -g @playwright/mcp                │
├─────┼──────────────────────────────┼───────────────────────────────────────────────┤
│  3  │ Standalone — local DOM       │ Set neither of the above                      │
│     │ No browser needed            │ Works offline, works in CI, less accurate     │
│     │ Always available             │ Uses Cheerio + XPath on static HTML           │
└─────┴──────────────────────────────┴───────────────────────────────────────────────┘
```

If playwright-mcp is configured but unreachable (not installed, crashed, timeout), LIMS catches the error and falls back to Mode 3 automatically. It never crashes on startup.

---

## 📱 Platform Support

| Platform | Locator Generation | Self-Healing | Live Capture | Framework File Sync |
|---|---|---|---|---|
| **Playwright** (web) | ✅ Full | ✅ Full | ✅ Full — Chromium | ✅ `.spec.ts` + `.page.ts` + `.locator.ts` |
| **Selenium** (web) | ✅ CSS + XPath output | ✅ Full | Snapshot-based | Manual wiring |
| **Appium Android** | ✅ From UIAutomator XML | ✅ Snapshot-based | Snapshot-based | Not yet |
| **Appium iOS** | ✅ From XCUI XML | ✅ Snapshot-based | Snapshot-based | Not yet |

---

## 📚 Documentation Index

| Document | What it covers |
|---|---|
| [docs/END_TO_END_GUIDE.md](docs/END_TO_END_GUIDE.md) | **Start here.** Complete walkthrough with every step explained, backend internals, common questions |
| [docs/API_SPEC.md](docs/API_SPEC.md) | Every MCP tool — exact inputs, exact outputs, scope notes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layer boundaries, dependency rules, main flows |
| [docs/WORKFLOW_DIAGRAM.md](docs/WORKFLOW_DIAGRAM.md) | Mermaid sequence diagrams of capture → generate → sync → heal |
| [docs/MCP_WORKING_GUIDE.md](docs/MCP_WORKING_GUIDE.md) | Quick daily reference — which tool to call when |
| [docs/PLAYWRIGHT_INTEGRATION.md](docs/PLAYWRIGHT_INTEGRATION.md) | Playwright MCP configuration and integration details |

---

## 🧪 Verification

```bash
npm run build   # must exit 0
npm test        # 67 tests, all must pass
```
