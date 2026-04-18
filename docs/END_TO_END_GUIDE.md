# LIMS End-to-End Guide

**Locator Intelligence MCP Server** — how it works, what happens behind the scenes, and what you get at every step.

---

## What This System Solves

Writing UI automation code in Playwright, Selenium, or Appium has one recurring pain point: finding stable, reliable locators that do not break when the UI changes. LIMS eliminates that manually by:

- capturing the live page automatically
- generating ranked locators ordered by stability
- enforcing that every locator matches exactly one element
- writing your Page Object Model files for you
- healing broken locators automatically when the UI changes
- learning from pass/fail outcomes to improve future suggestions

LIMS runs as an MCP server inside Cursor. The AI agent in Cursor calls LIMS tools on your behalf — you just describe the test case in plain language.

---

## One-Time Setup

### 1. Build the server

```bash
cd /Users/mdimran/locator_mcp
npm install
npm run build
```

### 2. Connect to Cursor

Add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lims": {
      "command": "node",
      "args": ["/Users/mdimran/locator_mcp/dist/cli.js"],
      "env": {
        "LIMS_LEARNING_ENABLED": "true",
        "LIMS_ARTIFACTS_ENABLED": "true",
        "LIMS_ARTIFACTS_DIR": "/Users/mdimran/locator_mcp/.lims/artifacts"
      }
    }
  }
}
```

Restart Cursor. All seven LIMS tools are now available to the Cursor AI agent.

### 3. Optional: install Tesseract for screenshot OCR

```bash
brew install tesseract
```

---

## The Seven MCP Tools

| Tool | What it does |
|---|---|
| `capture_generate_locator` | Opens the page, captures DOM + screenshot, generates ranked locators |
| `generate_locator` | Generates locators from a DOM/XML snapshot you provide manually |
| `heal_locator` | Recovers a broken locator after a UI change |
| `report_locator_result` | Tells LIMS whether a locator passed or failed — LIMS learns from this |
| `sync_playwright_framework` | Writes `feature.spec.ts`, `feature.page.ts`, `feature.locator.ts` to disk |
| `analyze_dom` | Inspects a DOM snapshot and reports stability, framework, and recommended attributes |
| `health_check` | Verifies that Playwright, Tesseract, and all integrations are working |

---

## Full End-to-End Example: Login Page Automation

**Scenario:** Automate a login test — enter email, enter password, click Login, verify Dashboard loads.

---

### Step 1 — You Describe the Test in Cursor

**What you type:**

```
I need to automate a login test for https://myapp.com/login

Steps:
1. Enter "user@test.com" in the email field
2. Enter "password123" in the password field
3. Click the Login button
4. Verify the URL contains /dashboard

Generate Playwright locators and create the test file.
```

**What Cursor AI does:**

Reads your intent and calls `capture_generate_locator` for each UI element.

---

### Step 2 — LIMS Captures the Live Page

**Cursor AI calls LIMS:**

```json
capture_generate_locator({
  "platform": "web",
  "pageUrl": "https://myapp.com/login",
  "target": "email input field",
  "runtimeContext": { "useCurrentPage": true }
})
```

**What happens inside LIMS — capture phase:**

```
PlaywrightWebCaptureAdapter
  → launches headless Chromium
  → navigates to https://myapp.com/login
  → takes full DOM snapshot (complete HTML source)
  → takes screenshot (base64 encoded)
  → collects list of all interactive elements on page
  → passes DOM + screenshot to LocatorGenerationService
```

**What happens inside LIMS — generation phase:**

```
FrameworkDetector
  → scans DOM for React, Angular, Vue, or plain HTML signals
  → result: "React detected"

LocatorEngine runs through priority tiers (strict order):

  Tier 1 — test attributes (most stable)
    data-testid="email-input"     → FOUND → confidence: 0.98

  Tier 2 — accessibility attributes
    aria-label="Email address"    → FOUND → confidence: 0.91

  Tier 3 — structural attributes
    id="email"                    → FOUND → confidence: 0.85
    name="email"                  → FOUND → confidence: 0.79

  Tier 4 — visible text (classified before use)
    label text "Email"            → classified as STATIC → confidence: 0.65
    (if classified HIGHLY_DYNAMIC → skipped automatically)

  Tier 5 — XPath fallback
    //input[@type='email']        → confidence: 0.40

UniquenessEngine
  → for each candidate: count how many elements it matches in the DOM
  → any candidate matching more than 1 element is refined or rejected
  → result: data-testid="email-input" matches exactly 1 element ✓

RankingEngine
  → scores all passing candidates by:
      uniqueness (hard gate — must be 1)
      attribute/temporal stability
      readability
      length (shorter preferred)
      maintainability
  → sorts into final ranked list
```

**What happens inside LIMS — runtime validation phase:**

```
PlaywrightValidatorAdapter
  → runs against the live browser page:
      page.locator('[data-testid="email-input"]').count()  → 1
      element.isVisible()                                  → true
      element.isEnabled()                                  → true
  → locator passes runtime gate
```

**What happens inside LIMS — artifact storage:**

```
LocatorArtifactStore.saveArtifact()
  → saves to .lims/artifacts/abc-123.json
  → artifact contains:
      original DOM snapshot
      screenshot
      element fingerprint (tag, type, placeholder, surrounding structure)
      generated locators
      runtime validation result
```

**What you get back in Cursor:**

```json
{
  "bestLocator": {
    "kind": "playwright",
    "locator": "page.getByTestId('email-input')",
    "confidence": 0.98
  },
  "fallbacks": [
    { "locator": "page.getByLabel('Email address')",         "confidence": 0.91 },
    { "locator": "page.locator('#email')",                   "confidence": 0.85 },
    { "locator": "page.locator('[name=\"email\"]')",         "confidence": 0.79 }
  ],
  "automation": {
    "playwright": "await page.getByTestId('email-input').fill('user@test.com')"
  },
  "capture": {
    "artifact": { "ref": "abc-123" }
  }
}
```

This repeats for the password field (`artifactRef: abc-124`) and login button (`artifactRef: abc-125`).

---

### Step 3 — LIMS Writes Your Test Files

**Cursor AI calls LIMS:**

```json
sync_playwright_framework({
  "feature": "login",
  "language": "ts",
  "locatorBindings": [
    { "name": "emailInput",    "artifactRef": "abc-123" },
    { "name": "passwordInput", "artifactRef": "abc-124" },
    { "name": "loginButton",   "artifactRef": "abc-125" }
  ],
  "testCases": [
    {
      "name": "User can log in with valid credentials",
      "steps": [
        "Fill email input with user@test.com",
        "Fill password input with password123",
        "Click login button",
        "Expect URL to contain /dashboard"
      ]
    }
  ]
})
```

**What happens inside LIMS:**

```
PlaywrightFrameworkSyncService
  → loads each artifact from .lims/artifacts/ using the artifactRef
  → extracts bestLocator from each artifact

PlaywrightFrameworkCodegen renders three files:
  login.locator.ts  — locator constants, one per element
  login.page.ts     — Page Object class with typed action methods
  login.spec.ts     — Playwright test spec with your described steps

TextFileRepository.write()
  → writes all three files to disk in your project directory
```

**What gets created on disk:**

`login.locator.ts`
```typescript
import { Page } from '@playwright/test'

export const LoginLocators = {
  emailInput:    (page: Page) => page.getByTestId('email-input'),
  passwordInput: (page: Page) => page.getByTestId('password-input'),
  loginButton:   (page: Page) => page.getByRole('button', { name: 'Login' }),
}
```

`login.page.ts`
```typescript
import { Page } from '@playwright/test'
import { LoginLocators } from './login.locator'

export class LoginPage {
  constructor(private page: Page) {}

  async fillEmail(value: string) {
    await LoginLocators.emailInput(this.page).fill(value)
  }

  async fillPassword(value: string) {
    await LoginLocators.passwordInput(this.page).fill(value)
  }

  async clickLogin() {
    await LoginLocators.loginButton(this.page).click()
  }
}
```

`login.spec.ts`
```typescript
import { test, expect } from '@playwright/test'
import { LoginPage } from './login.page'

test('User can log in with valid credentials', async ({ page }) => {
  const login = new LoginPage(page)

  await page.goto('https://myapp.com/login')
  await login.fillEmail('user@test.com')
  await login.fillPassword('password123')
  await login.clickLogin()

  await expect(page).toHaveURL(/dashboard/)
})
```

**Cursor responds to you:**

```
Three files written:
- login.locator.ts
- login.page.ts
- login.spec.ts

Run: npx playwright test login.spec.ts
```

---

### Step 4 — You Run the Test

```bash
npx playwright test login.spec.ts
```

The test either passes or fails. Both outcomes feed back into LIMS.

---

### Step 5A — Test Passed: LIMS Learns

**Cursor AI calls LIMS:**

```json
report_locator_result({
  "locator": "page.getByTestId('email-input')",
  "status": "passed",
  "platform": "web",
  "artifactRef": "abc-123"
})
```

**What happens inside LIMS:**

```
LocatorFeedbackService
  → LocatorLearningStore.recordOutcome()
  → writes to .lims/locator-learning.json:
    {
      "locator": "page.getByTestId('email-input')",
      "passCount": 1,
      "failCount": 0,
      "biasBoost": +0.1
    }
  → next time a locator with data-testid is generated for this element,
    it gets a ranking boost from the learning store
```

**What you get back:**

```json
{
  "learned": true,
  "message": "Locator marked as successful. Ranking bias updated."
}
```

---

### Step 5B — Test Failed: LIMS Self-Heals

**What happened:** A developer changed `data-testid="email-input"` to `data-testid="login-email"`. The test breaks.

**Cursor AI calls LIMS:**

```json
report_locator_result({
  "locator": "page.getByTestId('email-input')",
  "status": "failed",
  "platform": "web",
  "artifactRef": "abc-123",
  "pageUrl": "https://myapp.com/login"
})
```

**What happens inside LIMS — healing phase:**

```
LocatorFeedbackService detects status: "failed"
  → loads artifact abc-123 from .lims/artifacts/
  → extracts stored element fingerprint:
      { tag: "input", type: "email", placeholder: "Enter email", surroundingLabel: "Email" }

LocatorHealingService.heal()
  → captures fresh DOM from the current page
  → SimilarityEngine scans new DOM for closest structural match to the fingerprint
  → finds: <input data-testid="login-email" type="email" placeholder="Enter email">
  → structural match score: 0.96 (same tag, same type, same placeholder)

LocatorEngine re-runs on the matched element
  → generates new ranked candidates for data-testid="login-email"

PlaywrightValidatorAdapter
  → validates: page.getByTestId('login-email').count() → 1 ✓

LocatorArtifactStore.appendOutcome()
  → saves healed mapping to artifact abc-123
  → records: old locator → new locator, confidence, explanation
```

**What you get back:**

```json
{
  "healedLocator": {
    "kind": "playwright",
    "locator": "page.getByTestId('login-email')",
    "confidence": 0.96
  },
  "explanation": "Original data-testid 'email-input' not found. Matched by structural fingerprint (input[type=email], same placeholder text). Healed to 'login-email'.",
  "diff": {
    "old": "page.getByTestId('email-input')",
    "new": "page.getByTestId('login-email')"
  }
}
```

**Cursor AI then calls `sync_playwright_framework` automatically** — your `login.locator.ts` is updated with the healed locator. No manual fix required.

---

## What the Locator Priority Strategy Looks Like

LIMS always follows this order. It never skips a tier unless nothing is found there.

```
Priority 1 — Test attributes          data-testid, data-test, data-qa
Priority 2 — Accessibility            aria-label, role, getByRole
Priority 3 — Structural anchors       id, name (only if not dynamic/hash-based)
Priority 4 — Relative locators        near(), above(), below(), left-of(), right-of()
Priority 5 — Stable visible text      only if classified as STATIC or SEMI_DYNAMIC
Priority 6 — CSS class                only low-confidence, not utility classes
Priority 7 — XPath fallback           last resort, constrained to avoid long brittle paths
```

Dynamic IDs (containing random hashes, timestamps, or counters) are detected and rejected automatically.

Live values like prices, countdown timers, or streaming counters are classified as `HIGHLY_DYNAMIC` and are never used as locator signals.

---

## Where Data Is Stored

```
.lims/
  artifacts/
    abc-123.json    ← DOM snapshot, screenshot, fingerprint, locators for one element
    abc-124.json
    abc-125.json
  locator-learning.json   ← pass/fail history and ranking bias per locator
```

These files are used by the healing engine to recover broken locators without needing to re-inspect the page manually.

---

## Complete Flow at a Glance

```
YOU                        CURSOR AI                  LIMS                        DISK
────────────────────────────────────────────────────────────────────────────────────────
Describe test case    →    capture_generate_locator →  capture page (Playwright)
                                                        run LocatorEngine
                                                        enforce uniqueness
                                                        rank by stability
                                                        validate runtime
                                                        save artifact          .lims/artifacts/

                      →    sync_playwright_framework → load artifacts
                                                        render 3 files         login.locator.ts
                                                                               login.page.ts
                                                                               login.spec.ts

npx playwright test   →    (test runs in browser via Playwright)

Test result           →    report_locator_result    →  if passed: learn       .lims/learning.json
                                                        if failed: heal
                                                          fingerprint match
                                                          re-rank locators
                                                          validate healed
                                                          re-sync files        login.locator.ts (updated)
```

---

## What You Never Have to Do Manually

| Without LIMS | With LIMS |
|---|---|
| Open DevTools, inspect element, copy selector | AI captures the page and generates locators |
| Guess which selector is stable enough | Engine enforces uniqueness and ranks by stability |
| Write Page Object class boilerplate | `sync_playwright_framework` writes all three files |
| Fix broken locators when the UI changes | `heal_locator` auto-fixes and re-syncs |
| Remember which selectors were fragile | Learning store records history and adjusts future ranking |
| Avoid dynamic values in selectors | Dynamic text classifier blocks them automatically |

---

## Platform Support Summary

| Platform | Locator Generation | Self-Healing | Live Capture | Framework Sync |
|---|---|---|---|---|
| Playwright (web) | Full | Full | Full (Chromium) | Full (spec + page + locator files) |
| Selenium (web) | Full (CSS/XPath output) | Full | Snapshot-based | Manual wiring |
| Appium Android | Full (from UIAutomator XML) | Full (snapshot) | Snapshot-based | Not yet |
| Appium iOS | Full (from XCUI XML) | Full (snapshot) | Snapshot-based | Not yet |

---

---

## Common Questions

---

### Does LIMS need Playwright MCP installed?

No. Playwright MCP is not required. LIMS has three runtime modes and falls through them automatically:

```
Mode 1 — Playwright MCP subprocess   (LIMS_PLAYWRIGHT_MCP_COMMAND is set)
  LIMS spawns its own playwright-mcp process.
  Validates locators in a real headless browser.
  Most accurate. Requires playwright-mcp installed globally.

Mode 2 — Shared HTTP server           (LIMS_PLAYWRIGHT_MCP_URL is set)
  LIMS connects to a playwright-mcp server already running on a port.
  Both Cursor and LIMS share one browser instance.
  Requires: playwright-mcp --headless --port 8931

Mode 3 — Standalone                   (neither is set)
  LIMS uses local DOM heuristics via Cheerio and XPath.
  No browser, no external dependency. Works offline and in CI.
  Less accurate on JavaScript-rendered or lazy-loaded elements.
```

If a connection to playwright-mcp fails for any reason, LIMS catches the error silently and falls back to Mode 3. It never crashes.

**Minimum working config — no Playwright MCP needed:**

```json
{
  "mcpServers": {
    "LIMS": {
      "command": "node",
      "args": ["/Users/mdimran/locator_mcp/dist/cli.js"],
      "env": {
        "LIMS_LEARNING_ENABLED": "true",
        "LIMS_ARTIFACTS_ENABLED": "true",
        "LIMS_ARTIFACTS_DIR": "/Users/mdimran/locator_mcp/.lims/artifacts"
      }
    }
  }
}
```

All seven LIMS tools work in this config. Locator generation, healing, analysis, framework sync, and feedback all function. The only difference is validation runs against the static DOM instead of a live browser.

---

### Why does LIMS spawn its own playwright-mcp subprocess if Playwright MCP is already in Cursor?

This is the most important architectural question.

**The MCP isolation rule:** Every MCP server in Cursor runs as a completely separate, isolated process. One MCP server cannot call another MCP server's tools. Only the Cursor AI agent can call MCP tools. There is no direct pipe between LIMS and Cursor's Playwright MCP.

```
Cursor AI Agent
    │
    ├── talks to → Playwright MCP   (separate process, agent's browser control)
    │
    └── talks to → LIMS             (separate process, locator intelligence)
                       │
                       └── LIMS cannot reach Playwright MCP
                           The connection does not exist
```

LIMS needs to validate locators against a real browser from inside its own process — during `generate_locator` and `heal_locator`, automatically, without the agent being involved. To do that, it must have its own browser connection. That is why it spawns its own subprocess.

**What LIMS's subprocess actually does:**

When LIMS generates 5 locator candidates, it sends each one to its subprocess via `browser_run_code`:

```javascript
async (page) => {
  await page.goto('https://myapp.com/login')

  const locator = page.getByTestId('login-btn')
  const count   = await locator.count()              // must be exactly 1
  const visible = await locator.isVisible()          // must be true
  await locator.click({ trial: true })               // must not throw

  return { unique: count === 1, visible, interactable: true }
}
```

This runs in a real Chromium browser and the result feeds directly into LIMS's ranking engine to produce confidence scores. The Cursor agent never sees this — it is an internal LIMS operation.

---

### What is the actual role of Playwright MCP in a LIMS workflow?

Playwright MCP does not help LIMS internally. It helps the **Cursor AI agent**.

```
┌─────────────────────────────────────────────────────────┐
│                    CURSOR AI AGENT                       │
│                                                          │
│  You: "Automate the login page at myapp.com"            │
│                                                          │
│  Agent:                                                  │
│  1. I need to see the page first                        │
│  2. Then generate locators for each element             │
│  3. Then write the test files                           │
└──────────────┬───────────────────────┬───────────────────┘
               │                       │
               ▼                       ▼
    ┌─────────────────┐     ┌─────────────────────┐
    │  Playwright MCP │     │        LIMS          │
    │                 │     │                      │
    │  browser_       │     │  generate_locator    │
    │    navigate     │     │  heal_locator        │
    │  browser_       │     │  sync_playwright_    │
    │    snapshot     │     │    framework         │
    │  browser_       │     │  analyze_dom         │
    │    screenshot   │     │                      │
    └─────────────────┘     └─────────────────────┘
      BROWSER CONTROL         LOCATOR INTELLIGENCE
```

**Playwright MCP** is the agent's hands and eyes — it opens browsers, navigates, clicks, reads pages.

**LIMS** is the locator brain — it takes what Playwright MCP captured and generates the most stable selector for each element.

**The collaboration flow:**

```
Agent calls Playwright MCP:
  browser_navigate("https://myapp.com/login")
  browser_snapshot()
  → returns: full DOM and accessibility tree

Agent calls LIMS:
  generate_locator(dom: <that DOM>, target: "email input")
  → returns: page.getByTestId('email-input')  confidence: 0.98

Agent calls LIMS:
  sync_playwright_framework(feature: "login", locators: [...])
  → writes: login.locator.ts, login.page.ts, login.spec.ts
```

Playwright MCP feeds raw page evidence to the agent. LIMS converts that evidence into stable, ranked, validated locators and writes the automation code. They never talk directly — the agent bridges them.

**If you removed Playwright MCP from your config today**, LIMS would still work. Locator generation, live validation (via its own subprocess), healing, learning, and framework sync all continue. The only thing you would lose is the agent's ability to automatically navigate to a page and hand the live DOM to LIMS. You compensate by passing `pageUrl` directly to `capture_generate_locator`, which uses LIMS's own built-in capture adapter.

---

### Summary: which piece does what

| Piece | Controls | Used by | Required |
|---|---|---|---|
| Cursor AI Agent | Orchestrates everything | You (via chat) | Yes |
| Playwright MCP (Cursor's) | Browser navigation, clicks, screenshots | Cursor agent only | No |
| LIMS | Locator generation, ranking, healing, framework sync | Cursor agent (via MCP tools) | Yes |
| LIMS's internal playwright-mcp subprocess | Live locator validation in real Chromium | LIMS internally | No (falls back to DOM mode) |

---

## Related Documents

- [API Spec](API_SPEC.md) — input and output fields for every MCP tool
- [Architecture](ARCHITECTURE.md) — layer responsibilities and boundaries
- [Playwright Integration](PLAYWRIGHT_INTEGRATION.md) — Playwright MCP configuration details
- [Working Guide](MCP_WORKING_GUIDE.md) — quick reference for daily use
- [Workflow Diagram](WORKFLOW_DIAGRAM.md) — Mermaid sequence diagrams of the same flow
