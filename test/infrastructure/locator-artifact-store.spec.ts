import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocatorArtifactStore } from '../../src/infrastructure/cache/locator-artifact-store.js'

describe('LocatorArtifactStore', () => {
  it('saves and updates stored capture artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lims-artifacts-'))
    try {
      const store = new LocatorArtifactStore(dir)
      const saved = await store.saveArtifact({
        platform: 'web',
        pageUrl: 'https://example.com/app',
        title: 'Dashboard',
        target: 'button:Buy',
        targetDescriptor: {
          tag: 'button',
          text: 'Buy',
        },
        runtimeContext: {
          mode: 'live-page',
          pageUrl: 'https://example.com/app',
        },
        captureContext: {
          feature: 'Trading',
          testCase: 'places buy order',
        },
        dom: '<button>Buy</button>',
        screenshotBase64: 'fake-image',
        interactiveElements: [],
        generation: {
          bestLocator: 'page.getByRole("button", { name: "Buy" })',
          confidence: 0.92,
          strategy: 'role',
          fallbacks: [],
        },
        outcomes: [],
      })

      const loaded = await store.getArtifact(saved.ref)
      expect(loaded?.pageUrl).toBe('https://example.com/app')
      expect(loaded?.generation?.bestLocator).toContain('Buy')

      const updated = await store.appendOutcome(saved.ref, {
        status: 'failed',
        locator: 'page.getByText("Buy")',
        failureMessage: 'timed out',
        recordedAt: '2026-04-08T01:00:00.000Z',
      })

      expect(updated?.ref).toBe(saved.ref)
      const reloaded = await store.getArtifact(saved.ref)
      expect(reloaded?.outcomes).toHaveLength(1)
      expect(reloaded?.outcomes[0]?.failureMessage).toBe('timed out')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
