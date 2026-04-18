/**
 * Ranking weights (AGENTS.md): uniqueness, stability, readability, maintainability, length.
 * Framework hints are folded into stability via `frameworkStabilityBoost`, not a separate axis.
 */
export const RANKING_WEIGHTS = {
  uniqueness: 0.35,
  attributeStability: 0.25,
  readability: 0.15,
  maintainability: 0.15,
  length: 0.1,
} as const

export const STABILITY_SCORES = {
  STABLE: 1,
  SEMI_STABLE: 0.55,
  UNSTABLE: 0,
} as const

/** Locator string length normalization target (characters). */
export const LENGTH_NORM_TARGET = 120

export const CACHE_DEFAULT_TTL_MS = 60_000
export const CACHE_DEFAULT_MAX_ENTRIES = 500
