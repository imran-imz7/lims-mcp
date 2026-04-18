# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project follows [Semantic Versioning](https://semver.org/).

---

## [0.1.1] — 2026-04-18

### Fixed

- **Node 18 compatibility** — `engines.node` relaxed from `>=20` to `>=18`. All APIs used (`fetch`, `node:crypto`, `node:` imports, ES2022 target) are available in Node 18.0+.
- **CI matrix** — Added Node 18.x to GitHub Actions build-and-test matrix (now runs on 18.x, 20.x, 22.x).
- **`@vitest/coverage-v8` version** — Downgraded from `4.x` to `2.x` to match `vitest@2.x`. The major version mismatch caused `npm ci` to fail in CI with a peer dependency error.
- **`packageManager` field removed** — Removed `"packageManager": "pnpm@9.15.0"` from `package.json` to prevent npm CI environments from treating the project as pnpm-only.
- **README Quick Start** — Updated primary setup to use `npx lims-mcp` (no clone required). Local build instructions preserved as Option B. Fixed placeholder path `/absolute/path/to/lims-mcp/dist/cli.js` that caused `MODULE_NOT_FOUND` errors on other machines.
- **Package renamed** — `locator-intelligence-mcp-server` → `lims-mcp`. Single bin alias `lims-mcp` retained.
- **Docs updated** — All five docs (`WORKFLOW_DIAGRAM`, `API_SPEC`, `ARCHITECTURE`, `MCP_WORKING_GUIDE`, `PLAYWRIGHT_INTEGRATION`) rewritten to reflect current implementation: exact function call order, 3 runtime modes with priority, similarity scoring weights, confidence fusion formula, artifact/learning store data flow, `LIMS_ACTIVE` marker, `mergeGeneratedBlock` rules.
- **Mermaid diagrams** — Added architecture flowchart and two sequence diagrams to `README.md` for direct rendering on GitHub.

---

## [0.1.0] — 2026-04-18

First public release.

### Added

**Core locator engine**
- 8-tier priority strategy: `data-testid` → aria → structural id → form hints → visible text → relative → XPath → CSS class
- Uniqueness enforcement — every candidate must match exactly 1 element or is refined/rejected
- Weighted ranking engine — uniqueness (0.35), attribute stability (0.25), readability (0.15), maintainability (0.15), length (0.10)
- Dynamic text classifier — automatically blocks `HIGHLY_DYNAMIC` values (live prices, timers, counters) from being used as locator signals
- Confidence fusion — combines DOM score (0.50) + runtime validation (0.30) + visual/OCR (0.20)

**Seven MCP tools**
- `generate_locator` — ranked locators from DOM, XML, or screenshot input
- `capture_generate_locator` — live page capture + generation in one call
- `heal_locator` — fingerprint-based structural matching to recover broken locators
- `report_locator_result` — pass/fail feedback loop with learning store bias
- `sync_playwright_framework` — writes `feature.spec.ts`, `feature.page.ts`, `feature.locator.ts`
- `analyze_dom` — framework detection, attribute stability report, visual hints
- `health_check` — verifies Playwright, Tesseract, runtime validation mode

**Playwright integration**
- Three runtime validation modes: HTTP shared server, stdio subprocess, local DOM fallback
- `PlaywrightMcpValidatorAdapter` supports both `StdioClientTransport` and `StreamableHTTPClientTransport`
- `LIMS_PLAYWRIGHT_MCP_URL` for connecting to a shared running playwright-mcp HTTP server
- `LIMS_PLAYWRIGHT_MCP_COMMAND` for LIMS-managed subprocess
- Graceful degradation to local DOM heuristics when no Playwright is configured

**Platform support**
- Web (Playwright): full generation, validation, healing, framework sync
- Web (Selenium): CSS + XPath output, compatible locators
- Android (Appium): UIAutomator XML-based generation and healing
- iOS (Appium): XCUI XML-based generation and healing

**Extension points**
- `LocatorCandidateProvider` interface for custom locator strategies
- Built-in providers: AG Grid, React Virtualized, Flutter Web
- Plugin registry for composing providers

**Infrastructure**
- Artifact store (`.lims/artifacts/`) — stores DOM + fingerprint + locators per element
- Learning store (`.lims/locator-learning.json`) — records pass/fail history, biases future rankings
- In-memory DOM cache with configurable TTL and max entries
- Pino structured logging

**Documentation**
- `README.md` — full file map, locator priority table, confidence score breakdown, ranking weights, customisation guide
- `docs/END_TO_END_GUIDE.md` — complete step-by-step walkthrough with backend internals explained
- `docs/API_SPEC.md` — every MCP tool input/output
- `docs/ARCHITECTURE.md` — layer boundaries and dependency rules
- `docs/WORKFLOW_DIAGRAM.md` — Mermaid sequence diagrams

**CI**
- GitHub Actions workflow: builds and runs tests on Node 20 and 22 (extended to 18, 20, 22 in v0.1.1)

### Technical notes

- TypeScript strict mode — `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` all enabled
- ESM-only (`"type": "module"`, `NodeNext` module resolution)
- `playwright` moved to `optionalDependencies` — not downloaded automatically on `npm install`
- 67 tests across 22 spec files covering all layers

---

## Upcoming

- Native Android live capture (Appium server integration)
- Native iOS live capture
- Selenium WebDriver live validation bridge
- Mobile framework sync (`*.spec`, `*.page`, `*.locator` for Appium)
- VS Code extension for right-click locator generation
