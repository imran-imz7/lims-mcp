export type ParsedPlaywrightLocator =
  | { kind: 'text'; text: string }
  | { kind: 'role'; role: string; name?: string }
  | { kind: 'label'; text: string }
  | { kind: 'placeholder'; text: string }
  | { kind: 'test-id'; text: string }
  | { kind: 'alt'; text: string }
  | { kind: 'title'; text: string }
  | { kind: 'css'; selector: string }
  | { kind: 'xpath'; selector: string }
  | { kind: 'contextual-attribute'; anchorText: string; attribute: string; value: string }

export function parsePlaywrightLocator(locator: string): ParsedPlaywrightLocator | null {
  const input = locator.trim()
  if (!input) return null

  const contextual = input.match(
    /getByText\((['"`])([\s\S]+?)\1\)\.locator\(['"`]\.\.['"`]\)\.locator\((['"`])\[(.+?)=(['"`])([\s\S]+?)\5\]\3\)/,
  )
  if (contextual) {
    return {
      kind: 'contextual-attribute',
      anchorText: contextual[2] ?? '',
      attribute: contextual[4] ?? '',
      value: contextual[6] ?? '',
    }
  }

  const byText = extractStringArgument(input, 'getByText')
  if (byText) return { kind: 'text', text: byText }

  const byLabel = extractStringArgument(input, 'getByLabel')
  if (byLabel) return { kind: 'label', text: byLabel }

  const byPlaceholder = extractStringArgument(input, 'getByPlaceholder')
  if (byPlaceholder) return { kind: 'placeholder', text: byPlaceholder }

  const byTestId = extractStringArgument(input, 'getByTestId')
  if (byTestId) return { kind: 'test-id', text: byTestId }

  const byAlt = extractStringArgument(input, 'getByAltText')
  if (byAlt) return { kind: 'alt', text: byAlt }

  const byTitle = extractStringArgument(input, 'getByTitle')
  if (byTitle) return { kind: 'title', text: byTitle }

  const byRole = input.match(/getByRole\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*\{\s*name:\s*(['"`])([\s\S]+?)\3\s*\})?\s*\)/)
  if (byRole?.[2]) {
    return {
      kind: 'role',
      role: byRole[2],
      name: byRole[4]?.trim() || undefined,
    }
  }

  const locatorSelector = extractStringArgument(input, 'locator')
  if (locatorSelector) {
    if (locatorSelector.startsWith('xpath=')) {
      return { kind: 'xpath', selector: locatorSelector.slice(6) }
    }
    return { kind: 'css', selector: locatorSelector }
  }

  return null
}

/**
 * Extracts visible text literal from Playwright `page.getByText(...)` for DOM uniqueness checks.
 */
export function extractGetByTextLiteral(locator: string): string | null {
  const parsed = parsePlaywrightLocator(locator)
  return parsed?.kind === 'text' ? parsed.text : null
}

function extractStringArgument(locator: string, fnName: string): string | null {
  const jsonMatch = locator.match(
    new RegExp(`${escapeRegex(fnName)}\\(\\s*("[^"\\\\]*(?:\\\\.[^"\\\\]*)*")\\s*\\)`),
  )
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1]) as string
    } catch {
      /* fall through */
    }
  }

  const manual = locator.match(
    new RegExp(`${escapeRegex(fnName)}\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`),
  )
  return manual?.[2]?.replace(/\\(.)/g, '$1') ?? null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
