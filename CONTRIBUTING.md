# Contributing

Thanks for contributing to LIMS.

## What This Project Is

LIMS is an MCP server for locator intelligence with a strong `Playwright web` workflow:
- capture live web pages
- generate and validate locators
- heal broken locators
- store artifacts and learning history
- sync locators into Playwright `spec/page/locator` files

The project also accepts Android/iOS snapshots for generation and healing, but native mobile runtime support is not the main path today.

## Setup

Use either npm or pnpm.

```bash
npm install
npm run build
npm test
```

Equivalent pnpm commands also work.

## Architecture Rules

- keep MCP transport-only
- keep business logic in `src/domain` and orchestration in `src/application`
- keep IO and adapters in `src/infrastructure` or `src/integrations`
- avoid mixing runtime-specific code into core domain modules

## Current Product Priorities

Changes are most valuable when they improve:
- Playwright web capture
- locator quality and healing
- artifact and feedback workflows
- framework sync for Playwright projects
- reliability on dynamic and chart-heavy UIs

## Contribution Expectations

- preserve existing MCP tool contracts unless there is a strong reason to change them
- add tests for new behavior
- update docs when the tool surface or workflow changes
- do not leave stale samples or historical docs behind

## Before Opening A PR

Make sure these pass:

```bash
npm run build
npm test
```

## Good Areas To Extend

- better Playwright MCP capture and runtime validation
- stronger chart/trading UI handling
- better artifact diffing and healing quality
- future native Android/iOS adapters built as separate runtime integrations
