# Workflow Diagrams

All diagrams reflect the **current codebase** exactly — function names, call order, file paths, and response shapes match what is implemented.

---

## Part 1 — Capture, Generate, and Write Framework Files

```mermaid
sequenceDiagram
    actor U  as "You / Tester"
    participant C  as "Cursor AI Agent"
    participant L  as "LIMS MCP Server"
    participant PW as "Playwright MCP (Cursor's)"
    participant LP as "LIMS Internal playwright-mcp"
    participant S  as ".lims/ Store"
    participant FS as "Framework Files on Disk"

    U  ->> C : Describe test case in plain language

    C  ->> PW : browser_navigate(pageUrl)
    PW -->> C : page loaded

    C  ->> PW : browser_snapshot()
    PW -->> C : accessibility tree + DOM HTML

    C  ->> L  : capture_generate_locator OR generate_locator(dom, target, platform)

    Note over L: MCP layer — schema validation only<br/>CaptureGenerateLocatorInputSchema.safeParse<br/>resolveSourceInputs (reads domFile/xmlFile if provided)

    L  ->> L  : LocatorCaptureService.captureAndGenerate<br/>OR LocatorGenerationService.generate

    alt live page capture via CompositePageCaptureAdapter
        L  ->> LP : browser_run_code (capture code)
        LP -->> L : { dom, screenshotBase64, targetDescriptor, interactiveElements }
    else HTML already provided in input
        L  ->> L  : DomRepository.parse(dom, 'html' | 'xml')
    end

    Note over L: TargetResolver.resolve / resolveDescriptor<br/>→ finds target Cheerio node in DOM

    L  ->> L  : LocatorEngine.generate($, xmlDoc, target, platform)<br/>Tier 1: TEST_ATTRIBUTE (data-testid, data-test, data-qa)<br/>Tier 2: ACCESSIBILITY (aria-label, role, getByRole)<br/>Tier 3: STRUCTURAL_ANCHOR + STABLE_ID (id, name — non-dynamic)<br/>Tier 4: NAME_OR_FORM_HINT (placeholder, type, label[for])<br/>Tier 5: VISIBLE_TEXT (STATIC / SEMI_DYNAMIC only)<br/>Tier 6: RELATIVE (near, above, below, left-of, right-of)<br/>Tier 7: XPATH_FALLBACK<br/>Tier 8: CLASS_LOW<br/>UniquenessEngine — rejects anything matching ≠ 1 element<br/>RankingEngine — scores by uniqueness(0.35) stability(0.25)<br/>readability(0.15) maintainability(0.15) length(0.10)

    L  ->> L  : evaluateCandidateTemporalStability<br/>(if domSnapshots[] provided: SnapshotComparator)

    L  ->> L  : learning.getInsights → preferredLocators / failedLocators<br/>(biases ranking when learning store has history)

    L  ->> L  : selectBestRuntimeCandidate<br/>(tests up to 8 top candidates via PlaywrightValidator)

    L  ->> LP : browser_run_code (validate each candidate)<br/>locator.count() + isVisible() + click({trial:true})
    LP -->> L : { executed, unique, visible, interactable, success, attempts }

    Note over L: ConfidenceFusionEngine.fuse<br/>final = (dom×0.50) + (visual×0.20) + (runtime×0.30)<br/>weights renormalised when visual/runtime absent

    L  ->> S  : LocatorArtifactStore.saveArtifact → .lims/artifacts/{ref}.json<br/>(dom, screenshot, fingerprint, generation, outcomes)

    L  -->> C : { bestLocator, confidence, fallbacks, automation,<br/>locatorCatalog, capture, status:"LIMS_ACTIVE", _lims:{...} }

    C  ->> L  : sync_playwright_framework(feature, language, locatorBindings, testCases)

    Note over L: SyncPlaywrightFrameworkInputSchema.safeParse<br/>resolveBindings → LocatorArtifactStore.getArtifact for each artifactRef<br/>renderPlaywrightFeatureFiles → mergeGeneratedBlock (appends if file exists)

    L  ->> FS : write feature.locator.ts (or .js)
    L  ->> FS : write feature.page.ts (or .js)
    L  ->> FS : write feature.spec.ts (or .js)

    L  -->> C : { written:[...paths], locatorNames:[...], warnings:[...],<br/>status:"LIMS_ACTIVE", _lims:{...} }
```

---

## Part 2 — Test Run, Feedback, and Self-Healing

```mermaid
sequenceDiagram
    actor U  as "You / Tester"
    participant C  as "Cursor AI Agent"
    participant PW as "Playwright Test Runner"
    participant L  as "LIMS MCP Server"
    participant LP as "LIMS Internal playwright-mcp"
    participant S  as ".lims/ Store"
    participant FS as "Framework Files on Disk"

    U  ->> PW : npx playwright test feature.spec.ts

    PW -->> C : pass OR fail + failure message

    C  ->> L  : report_locator_result(locator, status, artifactRef, pageUrl?)

    Note over L: ReportLocatorResultInputSchema.safeParse<br/>LocatorFeedbackService.report

    L  ->> S  : LocatorArtifactStore.appendOutcome (if artifactRef provided)
    L  ->> S  : LocatorLearningStore.recordOutcome → .lims/locator-learning.json<br/>(locator, status, pageUrl, targetHint, recordedAt)

    alt status = "passed"
        L  -->> C : { learned:true, status:"LIMS_ACTIVE" }
    else status = "failed" → tryImprove
        L  ->> S  : LocatorArtifactStore.getArtifact (load original fingerprint + DOM)

        alt fresh DOM available (pageUrl or html in request)
            L  ->> LP : capture or parse current DOM
            LP -->> L : current DOM
            L  ->> L  : LocatorHealingService.heal

            Note over L: resolveIfUnique → still works? → re-rank + validate<br/>OR SimilarityEngine.bestMatch<br/>tag(0.12)+text(0.28)+attrs(0.35)+hierarchy(0.25)<br/>→ LocatorEngine.generate on matched node<br/>→ selectBestRuntimeCandidate → runtime validate
        else screenshot only
            L  ->> L  : healFromScreenshotOnly → OCR + heuristics
        end

        L  ->> S  : LocatorArtifactStore.appendOutcome (healed mapping)
        L  ->> S  : LocatorLearningStore.recordOutcome (status:"healed")

        L  -->> C : { learned:true, improved:{ healedLocator, confidence, diff,<br/>explanation }, status:"LIMS_ACTIVE" }

        C  ->> L  : sync_playwright_framework (with healed locator)
        L  ->> FS : update feature.locator.ts (inside <lims:locator> block)
        L  -->> C : { written:[...], status:"LIMS_ACTIVE" }
    end
```

---

## Part 3 — Playwright MCP Connection Modes (inside LIMS)

```mermaid
flowchart TD
    A[LIMS starts — buildContainer] --> B{LIMS_PLAYWRIGHT_MCP_URL set?}

    B -- yes --> C[PlaywrightMcpValidatorAdapter<br/>mode: 'http'<br/>StreamableHTTPClientTransport<br/>connects to running playwright-mcp server]
    B -- no  --> D{LIMS_PLAYWRIGHT_MCP_COMMAND set?}

    D -- yes --> E[PlaywrightMcpValidatorAdapter<br/>mode: 'stdio'<br/>StdioClientTransport<br/>LIMS spawns playwright-mcp subprocess]
    D -- no  --> F[No MCP adapter<br/>standalone mode]

    C --> G[PlaywrightValidatorAdapter runtime chain]
    E --> G
    F --> G

    G --> H{MCP adapter present AND executed?}
    H -- yes --> I[Use MCP result<br/>source: playwright-mcp]
    H -- no  --> J{LIMS_PLAYWRIGHT_VALIDATOR_URL set?}
    J -- yes --> K[HTTP bridge — POST /validate<br/>source: http-bridge]
    J -- no  --> L{LIMS_PLAYWRIGHT_AUTO_BRIDGE = true?}
    L -- yes --> M[PlaywrightRuntimeValidatorBridge<br/>auto-starts on LIMS_PLAYWRIGHT_BRIDGE_PORT<br/>source: http-bridge]
    L -- no  --> N[Local DOM heuristics<br/>Cheerio + XPath on static HTML<br/>source: local-fallback]
```

---

## Part 4 — Internal Locator Generation Pipeline

```mermaid
flowchart LR
    A[generate_locator / capture_generate_locator] --> B[resolveSourceInputs<br/>dom / xml / screenshot<br/>or read domFile / xmlFile / screenshotFile]
    B --> C[DomRepository.parse<br/>'html' or 'xml' mode]
    C --> D[TargetResolver.resolve or resolveDescriptor<br/>→ Cheerio node]
    D --> E[LocatorEngine.generate]

    E --> E1[Tier 1: TEST_ATTRIBUTE<br/>data-testid / data-test / data-qa]
    E --> E2[Tier 2: ACCESSIBILITY<br/>aria-label / role / getByRole]
    E --> E3[Tier 3: STRUCTURAL_ANCHOR + STABLE_ID<br/>id / name — dynamic IDs rejected]
    E --> E4[Tier 4: NAME_OR_FORM_HINT<br/>placeholder / type / label association]
    E --> E5[Tier 5: VISIBLE_TEXT<br/>STATIC only — HIGHLY_DYNAMIC blocked]
    E --> E6[Tier 6: RELATIVE<br/>near / above / below / left-of / right-of]
    E --> E7[Tier 7: XPATH_FALLBACK]
    E --> E8[Tier 8: CLASS_LOW]
    E --> E9[Extension providers<br/>AG Grid / React Virtualized / Flutter Web]

    E1 & E2 & E3 & E4 & E5 & E6 & E7 & E8 & E9 --> F[Dedup by kind::locator]
    F --> G[UniquenessEngine<br/>each candidate → count in DOM<br/>≠ 1? refine or reject]
    G --> H[RankingEngine — weighted score<br/>uniqueness×0.35 + stability×0.25<br/>readability×0.15 + maintainability×0.15<br/>length×0.10<br/>uniquenessMatchCount≠1 → score=0]
    H --> I[evaluateCandidateTemporalStability<br/>SnapshotComparator across domSnapshots]
    I --> J[learning.getInsights<br/>preferredLocators → bias boost<br/>failedLocators → penalty]
    J --> K[selectBestRuntimeCandidate<br/>test up to 8 top candidates<br/>PlaywrightValidator.validate each]
    K --> L[ConfidenceFusionEngine.fuse<br/>dom×0.50 + visual×0.20 + runtime×0.30<br/>renormalise when signal absent]
    L --> M[Build response<br/>bestLocator + confidence + fallbacks<br/>automation snippets + locatorCatalog<br/>status: LIMS_ACTIVE]
```

---

## Part 5 — Component Responsibilities

```mermaid
flowchart LR
    U["You / Tester"]
    C["Cursor AI Agent"]
    PW["Playwright MCP\n(Cursor's — agent browser control)"]
    L["LIMS MCP Server"]
    LP["LIMS internal\nplaywright-mcp subprocess\n(locator validation only)"]
    AF[".lims/artifacts/\n{ref}.json per element"]
    LS[".lims/locator-learning.json\nmax 1000 records"]
    FS["Framework Files\nfeature.locator.ts\nfeature.page.ts\nfeature.spec.ts"]

    U  -->|"plain language prompts"| C
    C  -->|"browser_navigate\nbrowser_snapshot\nbrowser_screenshot"| PW
    PW -->|"DOM, accessibility tree, screenshot"| C
    C  -->|"MCP tool calls"| L

    L  -->|"validation: browser_run_code\ncapture: browser_run_code"| LP
    LP -->|"runtime validation results\ncaptured page data"| L

    L  --> AF
    L  --> LS
    AF -->|"artifact lookup for healing\nlocator + fingerprint reuse"| L
    LS -->|"ranking bias: preferred/failed/healed"| L

    L  -->|"write / merge inside lims: blocks"| FS
    FS -->|"playwright test execution"| PW
    PW -->|"pass / fail result"| C
    C  -->|"report_locator_result"| L
```

---

## Exact Tool → Function Map

| MCP Tool | Schema | Service | Key internal calls |
|---|---|---|---|
| `generate_locator` | `GenerateLocatorInputSchema` | `LocatorGenerationService.generate` | `resolveSourceInputs` → `dom.parse` → `TargetResolver.resolve` → `LocatorEngine.generate` → temporal eval → learning insights → `selectBestRuntimeCandidate` → `ConfidenceFusionEngine.fuse` |
| `capture_generate_locator` | `CaptureGenerateLocatorInputSchema` | `LocatorCaptureService.captureAndGenerate` | `CompositePageCaptureAdapter.capture` → `LocatorGenerationService.generate` → `LocatorArtifactStore.saveArtifact` |
| `heal_locator` | `HealLocatorInputSchema` | `LocatorHealingService.heal` | `dom.parse` → `resolveIfUnique` OR `SimilarityEngine.bestMatch` → `LocatorEngine.generate` → `selectBestRuntimeCandidate` → `ConfidenceFusionEngine.fuse` |
| `report_locator_result` | `ReportLocatorResultInputSchema` | `LocatorFeedbackService.report` | `resolveSource` → `appendOutcome` → `learning.recordOutcome` → on fail: `healing.heal` or `generation.generate` → `appendOutcome` + `recordOutcome` |
| `sync_playwright_framework` | `SyncPlaywrightFrameworkInputSchema` | `PlaywrightFrameworkSyncService.sync` | `resolveBindings` → `artifactStore.getArtifact` → `renderPlaywrightFeatureFiles` → `mergeGeneratedBlock` → `files.write` ×3 |
| `analyze_dom` | `AnalyzeDomInputSchema` | `LocatorAnalysisService.analyze` | `dom.parse` → `FrameworkDetector.detect` → `AttributeStabilityAnalyzer` → `CanvasElementDetector` → trading hints |
| `health_check` | _(no input)_ | `HealthCheckService.check` | `checkCommandAvailable('tesseract')` → `checkPlaywrightPackageInstalled` → `runtimeValidator.validate` (synthetic DOM) → `detectRuntimeMode` from notes |

---

## Every Response Includes `LIMS_ACTIVE` Marker

Every successful response from any LIMS tool is wrapped with `withLimsMarker` in `register-tools.ts`:

```
{
  ...toolOutput,
  "status": "LIMS_ACTIVE",
  "_lims": {
    "provider": "LIMS MCP",
    "inUse": true,
    "tool": "<tool name>",
    "message": "Currently LIMS MCP is in use. Response generated by LIMS for tool \"<tool>\"."
  }
}
```

Error responses use `{ isError: true }` on the MCP content block and include a `DomainError` code and message.

---

## Files Written by `sync_playwright_framework`

Three files are always written (or merged if they already exist):

```
{outputDir}/{locatorDir ?? '.'}/{featureBase}.locator.{ts|js}
{outputDir}/{pageDir    ?? '.'}/{featureBase}.page.{ts|js}
{outputDir}/{specDir    ?? '.'}/{featureBase}.spec.{ts|js}
```

Each file uses **`<lims:locator>`**, **`<lims:page>`**, **`<lims:spec>`** marker blocks. `mergeGeneratedBlock` replaces the block if markers exist; otherwise appends. Custom code outside the markers is preserved.

**`language`** is inferred from the spec file extension if the file already exists, or from `params.language`, defaulting to `'ts'`.

---

## Similarity Scoring Used in Healing

When `resolveIfUnique` fails (old locator no longer unique), `SimilarityEngine.bestMatch` scans the DOM:

```
Element score = (tag match × 0.12) + (text match × 0.28) + (attribute overlap × 0.35) + (hierarchy similarity × 0.25)
                ─────────────────────────────────────────────────────────────────────────────────────────────────────
                          sum of weights for each axis (renormalised per pair)

text:      exact match = full weight; partial (contains) = ×0.65
attrs:     per-key comparison; near-match via Levenshtein (>0.82 similarity) = ×0.75 of that key's share
hierarchy: fraction of matching parent-tag sequence up to depth traversed
```

---

## Scope Note

This diagram reflects the current implemented path:

- **Playwright web** — full end-to-end: capture, generate, validate, heal, sync, feedback
- **Android / iOS** — snapshot-based generation and healing (XML input); no live device capture
- **Selenium** — CSS/XPath compatible output; no live Selenium validation adapter
