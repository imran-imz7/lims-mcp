import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { LocatorArtifactStorePort } from '../../domain/contracts/ports.js'
import type {
  LocatorArtifactOutcome,
  LocatorArtifactSummary,
  StoredLocatorArtifact,
} from '../../domain/contracts/types.js'

export class LocatorArtifactStore implements LocatorArtifactStorePort {
  private readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = resolve(process.cwd(), baseDir)
  }

  async saveArtifact(
    artifact: Omit<StoredLocatorArtifact, 'ref' | 'storedAt' | 'updatedAt'>,
  ): Promise<LocatorArtifactSummary> {
    const ref = randomUUID()
    const now = new Date().toISOString()
    const record: StoredLocatorArtifact = {
      ...artifact,
      ref,
      storedAt: now,
      updatedAt: now,
    }
    const path = this.pathForRef(ref)
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(path, JSON.stringify(record, null, 2), 'utf8')
    return {
      ref,
      storedAt: now,
      path,
    }
  }

  async getArtifact(ref: string): Promise<StoredLocatorArtifact | null> {
    try {
      const raw = await readFile(this.pathForRef(ref), 'utf8')
      return JSON.parse(raw) as StoredLocatorArtifact
    } catch {
      return null
    }
  }

  async appendOutcome(ref: string, outcome: LocatorArtifactOutcome): Promise<LocatorArtifactSummary | null> {
    const current = await this.getArtifact(ref)
    if (!current) return null
    const updatedAt = new Date().toISOString()
    const next: StoredLocatorArtifact = {
      ...current,
      updatedAt,
      outcomes: [...(current.outcomes ?? []), outcome],
    }
    const path = this.pathForRef(ref)
    await writeFile(path, JSON.stringify(next, null, 2), 'utf8')
    return {
      ref,
      storedAt: current.storedAt,
      path,
    }
  }

  private pathForRef(ref: string): string {
    return join(this.baseDir, `${ref}.json`)
  }
}
