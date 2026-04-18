# MCP Working Guide

The simplest reference for daily use of LIMS in Cursor.

---

## Requirements

| Requirement | Minimum |
|---|---|
| Node.js | **18.0+** (18, 20, or 22 — all tested in CI) |
| Cursor | Any version with MCP support |
| Playwright MCP | Optional — LIMS falls back to local DOM mode without it |

---

## What LIMS Does

LIMS (Locator Intelligence MCP Server) wraps the entire locator lifecycle:

| Phase | Tool | What happens |
|---|---|---|
| **Capture** | `capture_generate_locator` | Live-captures DOM + screenshot from a running browser via Playwright MCP |
| **Generate** | `generate_locator` | Generates ranked, validated locators from DOM/XML/screenshot snapshots |
| **Write** | `sync_playwright_framework` | Writes `feature.locator.ts`, `feature.page.ts`, `feature.spec.ts` |
| **Test** | _(your Playwright runner)_ | Runs actual tests against the browser |
| **Feedback** | `report_locator_result` | Records pass/fail; self-heals on failure |
| **Inspect** | `analyze_dom` | Framework + attribute stability report |
| **Debug** | `health_check` | Shows active runtime mode and prerequisites |

Every response from any tool includes `"status": "LIMS_ACTIVE"` so you can confirm LIMS is the active server.

---

## Best Workflow — Web Automation

```
1. Navigate to the page with Playwright MCP:
   → browser_navigate(pageUrl)

2. Capture + generate (LIMS spawns its own playwright-mcp for validation):
   → capture_generate_locator({ platform: "web", target: "Submit button", pageUrl })
   ← { bestLocator, confidence, fallbacks, locatorCatalog, capture.artifact.ref }

3. Write framework files:
   → sync_playwright_framework({
       feature: "checkout",
       locatorBindings: [{ name: "submitBtn", artifactRef: "<ref from step 2>" }],
       testCases: ["User can complete checkout"]
     })
   ← { written: ["checkout.locator.ts", "checkout.page.ts", "checkout.spec.ts"] }

4. Run your tests:
   npx playwright test checkout.spec.ts

5. Report outcome:
   → report_locator_result({ locator, status: "passed"|"failed", artifactRef })
   ← { learned: true }   OR   { improved: { healedLocator, confidence } }

6. If healed, sync again:
   → sync_playwright_framework({ ..., locatorBindings: [{ name: "submitBtn", locator: "<healed>" }] })
```

---

## Snapshot-Only Workflow (No Live Browser)

```
1. Copy DOM HTML from browser DevTools or browser_snapshot output

2. Generate from snapshot:
   → generate_locator({ dom: "<html>...", platform: "web", target: "Login button" })
   ← { bestLocator, confidence, fallbacks }

3. If it breaks later — provide new DOM:
   → heal_locator({ dom: "<new html>...", oldLocator: "button[data-testid='login']" })
   ← { healedLocator, diff, explanation }
```

---

## When to Use Each Tool

### `capture_generate_locator`
Live page is open. LIMS captures everything (DOM, screenshot, interactive elements)
and generates locators in one call. Use `capture.artifact.ref` for later feedback and healing.
**Requires:** Playwright MCP running (via `LIMS_PLAYWRIGHT_MCP_COMMAND` or `LIMS_PLAYWRIGHT_MCP_URL`).

### `generate_locator`
You already have snapshots (DOM from `browser_snapshot`, XML from Appium, etc.).
Supports `dom`, `xml`, `screenshot`, or `*File` paths.
Pass `domSnapshots[]` for temporal stability scoring.

### `heal_locator`
A locator stopped working after a UI change. Provide the latest DOM and `oldLocator`.
Optionally supply a `fingerprint` from the original artifact for more precise recovery.

### `report_locator_result`
Run **after every test execution** to teach LIMS what worked and what failed.
Pass `artifactRef` if available — it lets LIMS reload the original element context for healing.

### `sync_playwright_framework`
Writes (or merges into) three framework files. Accepts:
- `locatorBindings[].locator` — direct locator string
- `locatorBindings[].artifactRef` — looked up from `.lims/artifacts/` automatically
- `outputDir`, `specDir`, `pageDir`, `locatorDir` — fine-grained output control

### `analyze_dom`
Run this **before** generating locators on an unfamiliar page. Returns:
- detected framework (React, Angular, Vue, AG Grid, Flutter Web, etc.)
- stable vs unstable attributes
- visual hints (canvas, SVG, WebGL, chart library, trading indicators)
- recommended test attributes

### `health_check`
Run this during **setup or debugging**. Shows:
- whether `tesseract` is available (for OCR)
- whether `playwright` package is installed
- the active runtime validation mode (`playwright-mcp`, `http-bridge`, or `local-fallback`)

---

## Runtime Validation Modes

LIMS selects its internal browser validation mode automatically based on env vars.
Check the mode with `health_check`.

| Mode | Set via | How it works |
|---|---|---|
| **`playwright-mcp` (HTTP)** | `LIMS_PLAYWRIGHT_MCP_URL=http://localhost:8931` | Connects to a shared, already-running playwright-mcp HTTP server. Both Cursor and LIMS share one browser. |
| **`playwright-mcp` (stdio)** | `LIMS_PLAYWRIGHT_MCP_COMMAND=playwright-mcp` | LIMS spawns its own isolated playwright-mcp subprocess. Fully self-contained. |
| **`http-bridge`** | `LIMS_PLAYWRIGHT_AUTO_BRIDGE=true` OR `LIMS_PLAYWRIGHT_VALIDATOR_URL` | HTTP endpoint for validation. Used when no MCP adapter is configured. |
| **`local-fallback`** | _(none of the above)_ | Cheerio/XPath heuristics on static HTML. No browser. Good for offline use. |

Priority in `buildContainer`:
1. `LIMS_PLAYWRIGHT_MCP_URL` → HTTP mode (checked first)
2. `LIMS_PLAYWRIGHT_MCP_COMMAND` → stdio mode
3. Neither → standalone (no MCP adapter; validation falls back to HTTP bridge or local DOM)

---

## Practical Notes

- `artifactRef` is the single most valuable input — it links feedback, healing, and capture history
- `locatorCatalog` in the response shows **every** candidate ranked — useful for understanding why a locator was chosen
- Custom code outside `<lims:spec>`, `<lims:page>`, `<lims:locator>` markers is always preserved on re-sync
- Android/iOS support = snapshot-based generation/healing; no live device runtime adapter currently
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prevents automatic Chromium download when using `playwright-mcp` subprocess mode
