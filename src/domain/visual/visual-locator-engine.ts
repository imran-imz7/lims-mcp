import type { VisualMatch } from '../contracts/types.js'

/**
 * Produces visual-anchor fallback locators from OCR/visual match.
 */
export class VisualLocatorEngine {
  generateFallbacks(match: VisualMatch): string[] {
    if (!match.matchedText) return []
    const t = match.matchedText.replace(/\s+/g, ' ').trim()
    if (!t) return []
    return [
      `page.getByText(${JSON.stringify(t)})`,
      `//*[contains(normalize-space(.), ${toXPathLiteral(t)})]`,
    ]
  }
}

function toXPathLiteral(v: string): string {
  if (!v.includes("'")) return `'${v}'`
  if (!v.includes('"')) return `"${v}"`
  return `concat(${v
    .split("'")
    .map((p) => `'${p}'`)
    .join(`, "\"'", `)})`
}
