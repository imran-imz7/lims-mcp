# Playwright Integration

LIMS is designed to work best with Playwright on web projects.
This document describes every Playwright-related configuration option,
the exact priority order for runtime modes, and the env-var reference.

**Node.js compatibility:** LIMS requires **Node 20+**. Tested in CI on Node 20.x and 22.x.
Node 18 is not supported — `@modelcontextprotocol/sdk` depends on `undici` which requires the `File` Web API, only available from Node 20 onwards.

---

## What Playwright Is Used For

| Capability | Component | Required? |
|---|---|---|
| **Live page capture** (DOM + screenshot + interactive elements) | `CompositePageCaptureAdapter` → `PlaywrightMcpValidatorAdapter` or `PlaywrightWebCaptureAdapter` | Optional — LIMS falls back to local DOM heuristics |
| **Runtime locator validation** (unique, visible, interactable) | `PlaywrightValidator` → MCP adapter or HTTP bridge | Optional — falls back gracefully |
| **Current-page reuse** (`runtimeContext.useCurrentPage`) | Playwright MCP adapter | Optional |
| **Framework file codegen** (spec/page/locator) | `PlaywrightFrameworkSyncService` | Always available (no browser needed) |

---

## Two Playwright Instances: Cursor's vs LIMS's

```
┌─────────────────────────────────────────────────┐
│ Cursor AI Agent                                 │
│   Uses: Playwright MCP (its own MCP server)     │
│   → browser_navigate, browser_snapshot, etc.    │
│   Purpose: PAGE BROWSING for the AI agent       │
└───────────────────┬─────────────────────────────┘
                    │
                    │ agent reads DOM, passes to LIMS
                    ▼
┌─────────────────────────────────────────────────┐
│ LIMS MCP Server                                 │
│   Uses: its OWN internal Playwright connection  │
│   → validate locator.count(), isVisible(), etc. │
│   Purpose: LOCATOR VALIDATION only              │
└─────────────────────────────────────────────────┘
```

They are separate by design. Cursor's Playwright MCP controls what the AI sees.
LIMS's internal connection validates whether locators actually work in a browser.

---

## Runtime Modes — Priority Order

`buildContainer` in `src/di/container.ts` checks env vars in this **exact** order:

### Mode 1: HTTP — connect to a shared playwright-mcp server

```bash
LIMS_PLAYWRIGHT_MCP_URL="http://localhost:8931"
```

`PlaywrightMcpValidatorAdapter { mode: 'http' }` — uses `StreamableHTTPClientTransport`.
Both Cursor's Playwright MCP and LIMS share the **same** browser process.
Best when you want fewer processes and shared browser state.

**Requires:** Start `playwright-mcp --port 8931` separately before launching Cursor/LIMS.

### Mode 2: stdio subprocess — LIMS spawns its own playwright-mcp (recommended default)

```bash
LIMS_PLAYWRIGHT_MCP_COMMAND="npx"
LIMS_PLAYWRIGHT_MCP_ARGS='["-y", "@playwright/mcp@latest"]'
```

`PlaywrightMcpValidatorAdapter { mode: 'stdio' }` — uses `StdioClientTransport`.
LIMS manages its own dedicated playwright-mcp process. Fully self-contained.
Each LIMS server start spawns one subprocess.

> **Important:** Use `"npx"` as the command, **not** `"playwright-mcp"`.
> `playwright-mcp` as a bare binary requires a global `npm install -g @playwright/mcp`,
> which most users do not have. `npx` works everywhere without a global install.
>
> Pin the same version Cursor uses to avoid browser compatibility mismatches:
> ```bash
> LIMS_PLAYWRIGHT_MCP_ARGS='["-y", "@playwright/mcp@0.0.70"]'
> ```

Optional extras:
```bash
LIMS_PLAYWRIGHT_MCP_TOOL_NAME="validate_locator"     # override auto-discovered tool name
LIMS_PLAYWRIGHT_MCP_CWD="/absolute/path"              # working directory for subprocess
LIMS_PLAYWRIGHT_MCP_ENV='{"NODE_ENV":"test"}'         # extra env vars for subprocess
LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS="10000"                # per-call timeout (default: 10000)
```

> **Tip — pin the same version as Cursor:** If Cursor uses `@playwright/mcp@0.0.70`,
> set `LIMS_PLAYWRIGHT_MCP_ARGS='["-y","@playwright/mcp@0.0.70"]'` so both use
> the same browser. Using `@latest` on one and a pinned version on the other can
> cause browser/API mismatches.

### Mode 3: HTTP bridge — local /validate endpoint

```bash
LIMS_PLAYWRIGHT_VALIDATOR_URL="http://localhost:4010/validate"
# or enable auto-start:
LIMS_PLAYWRIGHT_AUTO_BRIDGE="true"
LIMS_PLAYWRIGHT_BRIDGE_PORT="4010"  # optional, default: random
```

When `LIMS_PLAYWRIGHT_AUTO_BRIDGE=true`, LIMS starts a local HTTP validation server
(`PlaywrightRuntimeValidatorBridge`) on startup. Useful when you already have a
Playwright process but no MCP server.

### Mode 4: Local DOM heuristics (standalone — no browser)

No env vars needed. LIMS falls back to Cheerio CSS/XPath analysis on static HTML.

- `validation.source` in the response will be `"local-fallback"`
- Still produces ranked locators with DOM-based confidence
- No `executed`, `visible`, or `interactable` runtime checks

---

## Validation Chain at Call Time

Even after the adapter is wired, LIMS applies a **per-call fallback chain** inside `PlaywrightValidatorAdapter`:

```
1. PlaywrightMcpValidatorAdapter (if configured) → source: "playwright-mcp"
2. HTTP endpoint (LIMS_PLAYWRIGHT_VALIDATOR_URL or auto-bridge) → source: "http-bridge"
3. Local DOM heuristics (Cheerio/XPath) → source: "local-fallback"
```

If MCP validation fails (network error, subprocess crash), LIMS transparently retries
with the next fallback. The `validation.source` field in the response tells you which
path was used.

---

## Recommended Setup: npx (easiest — works on any machine, Node 20+)

No clone or build needed. Works on **Node 20 or 22**.

`~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "Playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "LIMS": {
      "command": "npx",
      "args": ["-y", "lims-mcp"],
      "env": {
        "LIMS_PLAYWRIGHT_MCP_COMMAND":      "npx",
        "LIMS_PLAYWRIGHT_MCP_ARGS":         "[\"-y\",\"@playwright/mcp@latest\"]",
        "LIMS_PLAYWRIGHT_AUTO_BRIDGE":      "false",
        "LIMS_LEARNING_ENABLED":            "true",
        "LIMS_ARTIFACTS_ENABLED":           "true",
        "LIMS_ARTIFACTS_DIR":               "/Users/<your-username>/.lims/artifacts",
        "LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS":   "10000",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
      }
    }
  }
}
```

> Replace `<your-username>` with your actual system username.

---

## Recommended Setup: Two-Process Local Build (for development)

Clone the repo, build locally, then point Cursor at the built CLI.

`~/.cursor/mcp.json`:
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
        "LIMS_PLAYWRIGHT_MCP_ARGS": "[\"--headless\",\"--isolated\"]",
        "LIMS_PLAYWRIGHT_AUTO_BRIDGE": "false",
        "LIMS_LEARNING_ENABLED": "true",
        "LIMS_ARTIFACTS_ENABLED": "true",
        "LIMS_ARTIFACTS_DIR": "/absolute/path/to/lims-mcp/.lims/artifacts",
        "LIMS_PLAYWRIGHT_MCP_TIMEOUT_MS": "10000",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
      }
    }
  }
}
```

---

## Recommended Setup: Shared HTTP Server

One playwright-mcp process serves both Cursor and LIMS.

Start once (e.g. in a terminal or service):
```bash
playwright-mcp --port 8931 --headless
```

`~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "Playwright": {
      "url": "http://localhost:8931"
    },
    "LIMS": {
      "command": "npx",
      "args": ["-y", "lims-mcp"],
      "env": {
        "LIMS_PLAYWRIGHT_MCP_URL": "http://localhost:8931",
        "LIMS_LEARNING_ENABLED": "true",
        "LIMS_ARTIFACTS_ENABLED": "true"
      }
    }
  }
}
```

**Trade-off:** Requires the playwright-mcp server to be started before Cursor opens.

---

## Framework File Code Generation

`sync_playwright_framework` writes three files using the template in
`src/domain/framework-sync/playwright-framework-codegen.ts`:

### `feature.locator.ts`
```typescript
// <lims:locator>
// Generated by LIMS. Safe to regenerate; keep custom code outside this block.
export const CheckoutLocators = {
  submitBtn: (page: Page) => page.locator('[data-testid="submit-btn"]'),
} as const
// </lims:locator>
```

### `feature.page.ts`
```typescript
// <lims:page>
// Generated by LIMS. Safe to regenerate; keep custom code outside this block.
export class CheckoutPage {
  constructor(private readonly page: Page) {}
  async open() { await this.page.goto('https://example.com/checkout') }
  get submitBtn() { return CheckoutLocators.submitBtn(this.page) }
}
// </lims:page>
```

### `feature.spec.ts`
```typescript
// <lims:spec>
// Generated by LIMS. Safe to regenerate; keep custom code outside this block.
test.describe('checkout', () => {
  test('User can complete checkout', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.open()
    await expect(checkout.submitBtn).toBeVisible()
  })
})
// </lims:spec>
```

**`mergeGeneratedBlock` rules:**
- If `<lims:*>` markers already exist in the file → replace block content only
- If markers don't exist → append block and emit a warning
- All code outside the markers is never touched

---

## Important Boundaries

- Live capture and framework sync are **web-only** today
- Android/iOS locator generation from XML snapshots is supported; **live device validation is not**
- Selenium: CSS/XPath locators are output-compatible; no live Selenium validation adapter exists
- OCR: tesseract-backed visual correlation is available when `tesseract` is installed; gracefully absent otherwise
