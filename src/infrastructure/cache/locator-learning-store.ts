import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  LocatorLearningEvent,
  LocatorLearningInsights,
  LocatorLearningPort,
  LocatorLearningQuery,
} from '../../domain/contracts/ports.js'

interface LearningRecord extends LocatorLearningEvent {
  id: string
  fingerprintKey?: string
  targetHintNormalized?: string
  pageUrlNormalized?: string
}

interface LearningFile {
  version: 1
  records: LearningRecord[]
}

const DEFAULT_FILE: LearningFile = {
  version: 1,
  records: [],
}

export class LocatorLearningStore implements LocatorLearningPort {
  private readonly filePath: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = resolve(process.cwd(), filePath)
  }

  async getInsights(query: LocatorLearningQuery): Promise<LocatorLearningInsights> {
    const file = await this.readFileSafe()
    const matches = file.records.filter((record) => matchesQuery(record, query))

    const preferredCounts = new Map<string, number>()
    const failedCounts = new Map<string, number>()
    const healedPairs: Array<{ from: string; to: string }> = []

    for (const record of matches) {
      if (record.status === 'success') {
        preferredCounts.set(record.locator, (preferredCounts.get(record.locator) ?? 0) + 1)
      } else if (record.status === 'failure') {
        failedCounts.set(record.locator, (failedCounts.get(record.locator) ?? 0) + 1)
      } else if (record.status === 'healed' && record.replacementLocator) {
        preferredCounts.set(
          record.replacementLocator,
          (preferredCounts.get(record.replacementLocator) ?? 0) + 1,
        )
        failedCounts.set(record.locator, (failedCounts.get(record.locator) ?? 0) + 1)
        healedPairs.push({ from: record.locator, to: record.replacementLocator })
      }
    }

    return {
      preferredLocators: sortByCount(preferredCounts),
      failedLocators: sortByCount(failedCounts),
      healedPairs,
    }
  }

  async recordOutcome(event: LocatorLearningEvent): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const file = await this.readFileSafe()
      const record: LearningRecord = {
        ...event,
        id: buildRecordId(event),
        recordedAt: event.recordedAt ?? new Date().toISOString(),
        fingerprintKey: fingerprintKey(event.fingerprint),
        pageUrlNormalized: normalizeText(event.pageUrl),
        targetHintNormalized: normalizeText(event.targetHint),
      }
      file.records.push(record)
      const trimmed = file.records.slice(-1000)
      await this.writeFileSafe({
        version: 1,
        records: trimmed,
      })
    })
    return this.writeChain
  }

  private async readFileSafe(): Promise<LearningFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<LearningFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) return DEFAULT_FILE
      return {
        version: 1,
        records: parsed.records.filter(isLearningRecord),
      }
    } catch {
      return DEFAULT_FILE
    }
  }

  private async writeFileSafe(file: LearningFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8')
  }
}

function matchesQuery(record: LearningRecord, query: LocatorLearningQuery): boolean {
  const pageMatch = normalizeText(query.pageUrl)
  const hintMatch = normalizeText(query.targetHint)
  const fpMatch = fingerprintKey(query.fingerprint)

  if (pageMatch && record.pageUrlNormalized && pageMatch !== record.pageUrlNormalized) return false
  if (fpMatch && record.fingerprintKey && fpMatch === record.fingerprintKey) return true
  if (hintMatch && record.targetHintNormalized && hintMatch === record.targetHintNormalized) return true
  if (pageMatch && record.pageUrlNormalized === pageMatch) return true
  return !pageMatch && !hintMatch && !fpMatch
}

function sortByCount(values: Map<string, number>): string[] {
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([locator]) => locator)
}

function fingerprintKey(fingerprint: Record<string, unknown> | null | undefined): string | undefined {
  if (!fingerprint) return undefined
  const entries = Object.keys(fingerprint)
    .sort()
    .map((key) => [key, normalizeFingerprintValue(fingerprint[key])])
  return JSON.stringify(entries)
}

function normalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalizeFingerprintValue((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function normalizeText(value: string | undefined): string | undefined {
  const next = value?.trim().toLowerCase()
  return next || undefined
}

function buildRecordId(event: LocatorLearningEvent): string {
  return [
    normalizeText(event.pageUrl) ?? 'no-page',
    normalizeText(event.targetHint) ?? 'no-target',
    event.locator,
    event.status,
    event.recordedAt ?? new Date().toISOString(),
  ].join('::')
}

function isLearningRecord(value: unknown): value is LearningRecord {
  return Boolean(value) && typeof value === 'object' && 'locator' in (value as Record<string, unknown>)
}
