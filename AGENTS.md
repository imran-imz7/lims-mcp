# AGENTS.md

## Mission

Build and evolve a production-grade Locator Intelligence MCP Server that generates,
validates, ranks, and heals locators across web, Android, and iOS with
high reliability in dynamic, real-time, and chart-heavy UIs.

### Current implementation baseline

- The strongest implemented workflow is Playwright web capture, generation, feedback, and framework sync.
- Android/iOS support currently focuses on snapshot-based generation and healing, not full native runtime automation.
- Generic UI pattern intelligence is part of domain locator generation.
- Refactors must be additive and non-breaking; preserve ranking/uniqueness semantics.
- Avoid reintroducing duplicate candidate generation paths.

## Setup Commands

- Install dependencies: `npm install` or `pnpm install`
- Build: `npm run build`
- Start server: `npm start`
- Dev mode: `npm run dev`
- Tests: `npm test`

---

## Non-Negotiable Architecture Rules

Follow clean architecture with strict responsibility boundaries:

- `mcp/`
  - MCP transport contract only
  - input/output schema validation only
  - no business logic
- `application/`
  - orchestrates use cases
  - composes domain engines and integration adapters
- `domain/`
  - core logic and decision engines
  - framework-agnostic business rules
- `infrastructure/`
  - parsing, logging, config, cache, low-level helpers
- `integrations/`
  - external system adapters (vision, OCR, Playwright validator)

Hard rules:

- Do not place ranking, healing, selector generation, or dynamic logic in MCP layer
- Domain must not depend on MCP transport types
- Prefer composition over inheritance
- Keep modules small and replaceable

---

## Coding Standards

- TypeScript strict mode
- Single quotes, no semicolons
- Pure functions preferred where practical
- No hardcoded environment assumptions
- Deterministic behavior preferred over implicit heuristics

---

## Locator Intelligence Strategy

### Priority Order (strict)

1. `data-testid`, `data-test`, `data-qa`
2. `aria-label` and accessibility identifiers
3. Structural anchors (`id`, `name`, stable container semantics)
4. Relative locators
5. Region-based locators (charts/dashboards)
6. Visual anchors (OCR-correlated)
7. XPath fallback

### Anti-Patterns to Avoid

- Dynamic IDs (random/hash/timestamp suffix)
- Long brittle absolute XPath
- Pure index-based selectors except final fallback
- Raw volatile values (live prices, countdown timers, streaming counters)

### Mandatory Uniqueness Rule

Every primary locator must match exactly one element in current snapshot.
If uniqueness fails:

1. refine with parent/container context
2. add stable attribute filters
3. fallback to next strategy

---

## Dynamic and Real-Time UI Rules

Support complex UIs including trading/chart dashboards.

### Dynamic Text Classification

Classify text as:

- `STATIC`
- `SEMI_DYNAMIC`
- `HIGHLY_DYNAMIC`

Policy:

- Never use `HIGHLY_DYNAMIC` text as primary locator signal
- Use stable labels/containers around dynamic values
- Prefer anchor context over changing numeric values

### Temporal Stability

When multiple snapshots exist:

- compare snapshots
- estimate mutation rate
- reduce confidence for unstable candidates
- prefer candidates stable across snapshots

---

## Visual and Chart UI Rules

For Canvas/WebGL/SVG and chart-heavy UIs:

- detect chart surface presence (`canvas`, `svg`, webgl markers)
- anchor on nearby stable text/labels
- support region-based targeting (e.g., `top-right`, `bottom-left`)
- produce hybrid fallback (DOM anchor + visual context)

SVG support must include:

- `<svg>`, `<g>`, `<text>`, `<path>` compatible selectors
- nested structure handling

---

## Multi-Platform Rules

### Web

Prefer semantic and test attributes before text/XPath fallback.
Treat Playwright web as the primary enterprise path in the current codebase.

### Android (UIAutomator XML)

Prioritize:

- `resource-id`
- `content-desc`
- stable `text` only if not highly dynamic
- package/class as contextual filters

### iOS (XCUI XML)

Prioritize:

- `name`
- `label`
- accessibility identifier/value
- structural context

---

## Ranking and Confidence Rules

Score candidates with weighted model:

- uniqueness (hard gate)
- attribute/temporal stability
- readability
- maintainability
- length

Confidence fusion should combine:

- DOM score
- visual match confidence (if available)
- runtime validation confidence
- temporal stability (if snapshots provided)

Always return:

- best locator
- confidence in `[0, 1]`
- ranked fallbacks
- explanation of why selected/rejected

---

## Runtime Validation Rules

Use Playwright validator adapter to assess:

- uniqueness
- visibility
- interactability
- stability across retries/snapshots

Flaky locators should be penalized or rejected.

---

## Auto-Healing Rules

Use fingerprint-based recovery with:

- tag
- text
- attributes
- hierarchy/structure

Healing flow:

1. try old locator on new snapshot
2. if invalid, find closest structural match
3. regenerate/rank locators
4. validate runtime + optional visual/temporal signals
5. return healed locator with confidence and explanation

---

## MCP Tool Contracts (Operational)

### `generate_locator`

Must support:

- `dom?` or `xml?` (at least one)
- optional `screenshot`
- optional `domSnapshots`, `xmlSnapshots`, `screenshotSnapshots`
- `platform`
- `target`
- optional region context

### `heal_locator`

Must support:

- `dom?` or `xml?`
- optional screenshot/snapshots
- `oldLocator`
- optional `fingerprint`

### `analyze_dom`

Must provide:

- framework detection
- recommended stable attributes
- stability report
- visual/trading/chart hints

---

## Quality Gates Before Completion

Before finalizing meaningful changes:

1. `npm run build` passes
2. `npm test` passes
3. modified files compile cleanly
4. behavior aligns with architecture boundaries
5. explanation and docs are kept consistent with implementation

---

## Implementation Workflow

1. Clarify responsibility boundary (which layer owns the change)
2. Implement domain logic first
3. Wire through application orchestrator
4. Expose via MCP schema/handler
5. Validate with tests/build
6. Update relevant docs

---

## Goal

Deliver a highly reliable, extensible, and intelligent locator platform that:

- handles dynamic and streaming interfaces robustly
- is production-strong on Playwright web first
- remains extensible for future Android and iOS runtime adapters
- remains maintainable under clean architecture discipline
- integrates smoothly with Cursor MCP workflows
