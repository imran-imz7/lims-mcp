/**
 * Locator strategy priority tiers (AGENTS.md — lower number = higher preference).
 *
 * 1. data-testid, data-test, data-qa
 * 2. aria-label, accessibility id
 * 3. stable id (non-dynamic)
 * 4. name (and closely related form hints)
 * 5. visible text
 * 6. relative locators
 * 7. XPath / structural fallback
 */

export const LOCATOR_PRIORITY_TIERS = {
  TEST_ATTRIBUTE: 1,
  ACCESSIBILITY: 2,
  STRUCTURAL_ANCHOR: 3,
  STABLE_ID: 3,
  NAME_OR_FORM_HINT: 4,
  VISIBLE_TEXT: 5,
  RELATIVE: 6,
  XPATH_FALLBACK: 7,
  CLASS_LOW: 8,
} as const

/** Boost stability when attribute aligns with framework recommendations (folds "framework alignment" into stability per ARCHITECTURE). */
export function frameworkStabilityBoost(
  base: number,
  attrName: string,
  recommended: readonly string[],
): number {
  const low = attrName.toLowerCase()
  for (const r of recommended) {
    if (low === r.toLowerCase()) {
      return Math.min(1, base + 0.12)
    }
  }
  return base
}
