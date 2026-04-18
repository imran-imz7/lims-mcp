export interface SnapshotComparison {
  mutationRate: number
  stableTokens: string[]
  dynamicTokens: string[]
}

/**
 * Lightweight multi-snapshot comparator for rapidly mutating UIs.
 */
export class SnapshotComparator {
  compare(snapshots: string[]): SnapshotComparison {
    if (snapshots.length <= 1) {
      return { mutationRate: 0, stableTokens: [], dynamicTokens: [] }
    }
    const tokenSets = snapshots.map((s) => tokenize(s))
    const universe = new Set<string>()
    for (const set of tokenSets) {
      for (const t of set) universe.add(t)
    }
    const stableTokens: string[] = []
    const dynamicTokens: string[] = []
    for (const token of universe) {
      let present = 0
      for (const set of tokenSets) {
        if (set.has(token)) present += 1
      }
      if (present === tokenSets.length) stableTokens.push(token)
      else dynamicTokens.push(token)
    }
    const mutationRate = universe.size ? dynamicTokens.length / universe.size : 0
    return {
      mutationRate,
      stableTokens: stableTokens.slice(0, 120),
      dynamicTokens: dynamicTokens.slice(0, 120),
    }
  }
}

function tokenize(input: string): Set<string> {
  const cleaned = input
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9_:-]+/g, ' ')
  return new Set(cleaned.split(/\s+/).filter((x) => x.length >= 3))
}
