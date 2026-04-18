import type {
  PlaywrightLanguage,
  PlaywrightLocatorBindingInput,
  PlaywrightTestCaseInput,
  PlaywrightTestStepInput,
} from '../contracts/types.js'

export interface ResolvedLocatorBinding extends PlaywrightLocatorBindingInput {
  locator: string
  methodName: string
}

export interface RenderPlaywrightFeatureFilesInput {
  feature: string
  language: PlaywrightLanguage
  pageClassName: string
  locatorObjectName: string
  pageUrl?: string
  locatorBindings: ResolvedLocatorBinding[]
  testCases: PlaywrightTestCaseInput[]
  pageImportPath: string
  locatorImportPath: string
}

export interface RenderPlaywrightFeatureFilesOutput {
  locator: string
  page: string
  spec: string
}

export function renderPlaywrightFeatureFiles(
  input: RenderPlaywrightFeatureFilesInput,
): RenderPlaywrightFeatureFilesOutput {
  return {
    locator: buildGeneratedBlock(
      'locator',
      renderLocatorModule(input),
    ),
    page: buildGeneratedBlock(
      'page',
      renderPageModule(input),
    ),
    spec: buildGeneratedBlock(
      'spec',
      renderSpecModule(input),
    ),
  }
}

export function mergeGeneratedBlock(
  existing: string | null,
  kind: 'locator' | 'page' | 'spec',
  generatedContent: string,
): { content: string; warning?: string } {
  const begin = beginMarker(kind)
  const end = endMarker(kind)
  if (!existing?.trim()) {
    return { content: generatedContent }
  }
  const start = existing.indexOf(begin)
  const finish = existing.indexOf(end)
  if (start >= 0 && finish > start) {
    return {
      content: `${existing.slice(0, start)}${generatedContent}${existing.slice(finish + end.length)}`,
    }
  }
  return {
    content: `${existing.trimEnd()}\n\n${generatedContent}\n`,
    warning: `Existing ${kind} file had no LIMS markers, so generated block was appended.`,
  }
}

function renderLocatorModule(input: RenderPlaywrightFeatureFilesInput): string {
  const lines: string[] = []
  if (input.language === 'ts') {
    lines.push(`import type { Page, Locator } from '@playwright/test'`)
  }
  lines.push(``)
  lines.push(`export const ${input.locatorObjectName} = {`)
  for (const binding of input.locatorBindings) {
    const expression = toLocatorExpression(binding.locator)
    if (input.language === 'ts') {
      lines.push(`  ${binding.methodName}: (page: Page): Locator => ${expression},`)
    } else {
      lines.push(`  ${binding.methodName}: (page) => ${expression},`)
    }
  }
  lines.push(`} as const`)
  if (input.language === 'ts') {
    lines.push(``)
    lines.push(`export type ${input.pageClassName}LocatorName = keyof typeof ${input.locatorObjectName}`)
  }
  return lines.join('\n')
}

function renderPageModule(input: RenderPlaywrightFeatureFilesInput): string {
  const lines: string[] = []
  if (input.language === 'ts') {
    lines.push(`import type { Page, Locator } from '@playwright/test'`)
  }
  lines.push(`import { ${input.locatorObjectName} } from '${input.locatorImportPath}'`)
  lines.push(``)
  lines.push(`export class ${input.pageClassName} {`)
  if (input.language === 'ts') {
    lines.push(`  constructor(private readonly page: Page) {}`)
  } else {
    lines.push(`  constructor(page) {`)
    lines.push(`    this.page = page`)
    lines.push(`  }`)
  }
  lines.push(``)
  if (input.pageUrl) {
    if (input.language === 'ts') {
      lines.push(`  async open(): Promise<void> {`)
    } else {
      lines.push(`  async open() {`)
    }
    lines.push(`    await this.page.goto(${JSON.stringify(input.pageUrl)})`)
    lines.push(`  }`)
    lines.push(``)
  }
  for (const binding of input.locatorBindings) {
    if (input.language === 'ts') {
      lines.push(`  ${binding.methodName}(): Locator {`)
    } else {
      lines.push(`  ${binding.methodName}() {`)
    }
    lines.push(`    return ${input.locatorObjectName}.${binding.methodName}(this.page)`)
    lines.push(`  }`)
    lines.push(``)
  }
  lines.push(`}`)
  return lines.join('\n')
}

function renderSpecModule(input: RenderPlaywrightFeatureFilesInput): string {
  const lines: string[] = []
  lines.push(`import { test, expect } from '@playwright/test'`)
  lines.push(`import { ${input.pageClassName} } from '${input.pageImportPath}'`)
  lines.push(``)
  lines.push(`test.describe(${JSON.stringify(input.feature)}, () => {`)
  for (const testCase of input.testCases) {
    lines.push(`  test(${JSON.stringify(testCase.name)}, async ({ page }) => {`)
    lines.push(`    const pageObject = new ${input.pageClassName}(page)`)
    if (input.pageUrl) {
      lines.push(`    await pageObject.open()`)
    } else {
      lines.push(`    // TODO: navigate to the ${input.feature} page`)
    }
    if (testCase.description) {
      lines.push(`    // ${sanitizeComment(testCase.description)}`)
    }
    if (testCase.steps?.length) {
      for (const step of testCase.steps) {
        lines.push(...renderStep(step, input.locatorBindings.map((binding) => binding.methodName)))
      }
    } else {
      lines.push(`    // TODO: implement test steps`)
      const first = input.locatorBindings[0]
      if (first) {
        lines.push(`    await expect(pageObject.${first.methodName}()).toBeVisible()`)
      }
    }
    lines.push(`  })`)
    lines.push(``)
  }
  lines.push(`})`)
  return lines.join('\n')
}

function renderStep(
  step: PlaywrightTestStepInput,
  knownLocators: string[],
): string[] {
  const methodName = toMethodName(step.locator)
  const lines: string[] = []
  if (!knownLocators.includes(methodName)) {
    lines.push(`    // TODO: unresolved locator binding "${sanitizeComment(step.locator)}"`)
    return lines
  }
  if (step.action === 'click') {
    lines.push(`    await pageObject.${methodName}().click()`)
    return lines
  }
  if (step.action === 'fill') {
    lines.push(`    await pageObject.${methodName}().fill(${JSON.stringify(step.value ?? '')})`)
    return lines
  }
  if (step.action === 'press') {
    lines.push(`    await pageObject.${methodName}().press(${JSON.stringify(step.value ?? 'Enter')})`)
    return lines
  }
  if (step.action === 'hover') {
    lines.push(`    await pageObject.${methodName}().hover()`)
    return lines
  }
  if (step.action === 'check') {
    lines.push(`    await pageObject.${methodName}().check()`)
    return lines
  }
  if (step.action === 'uncheck') {
    lines.push(`    await pageObject.${methodName}().uncheck()`)
    return lines
  }
  if (step.action === 'select') {
    lines.push(`    await pageObject.${methodName}().selectOption(${JSON.stringify(step.value ?? '')})`)
    return lines
  }
  if (step.action === 'assertText') {
    lines.push(`    await expect(pageObject.${methodName}()).toHaveText(${JSON.stringify(step.expectedText ?? step.value ?? '')})`)
    return lines
  }
  lines.push(`    await expect(pageObject.${methodName}()).toBeVisible()`)
  return lines
}

function toLocatorExpression(locator: string): string {
  const trimmed = locator.trim()
  if (trimmed.startsWith('page.')) return trimmed
  if (trimmed.startsWith('//') || trimmed.startsWith('(//')) {
    return `page.locator(${JSON.stringify(`xpath=${trimmed}`)})`
  }
  return `page.locator(${JSON.stringify(trimmed)})`
}

function beginMarker(kind: 'locator' | 'page' | 'spec'): string {
  return `// <lims:${kind}>`
}

function endMarker(kind: 'locator' | 'page' | 'spec'): string {
  return `// </lims:${kind}>`
}

function buildGeneratedBlock(
  kind: 'locator' | 'page' | 'spec',
  body: string,
): string {
  return [
    beginMarker(kind),
    `// Generated by LIMS. Safe to regenerate; keep custom code outside this block.`,
    body,
    endMarker(kind),
  ].join('\n')
}

function sanitizeComment(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim()
}

export function toMethodName(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
  if (!normalized) return 'target'
  const [first, ...rest] = normalized.split(/\s+/)
  return [first.toLowerCase(), ...rest.map(capitalize)].join('')
}

export function toPageClassName(feature: string): string {
  const name = feature
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalize)
    .join('')
  return `${name || 'Feature'}Page`
}

export function toLocatorObjectName(feature: string): string {
  return `${toMethodName(feature)}Locators`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}
