import { basename, join, relative, sep } from 'node:path'
import type { LoggerPort } from '../infrastructure/logging/logger.port.js'
import type { TextFileRepositoryPort } from '../domain/contracts/ports.js'
import type { PluginRegistry } from '../domain/plugin/plugin-registry.js'
import type {
  PlaywrightLanguage,
  PlaywrightLocatorBindingInput,
  PlaywrightTestCaseInput,
  StoredLocatorArtifact,
  SyncPlaywrightFrameworkRequest,
  SyncPlaywrightFrameworkResponse,
} from '../domain/contracts/types.js'
import { DomainError } from '../utils/errors.js'
import {
  mergeGeneratedBlock,
  renderPlaywrightFeatureFiles,
  toLocatorObjectName,
  toMethodName,
  toPageClassName,
  type ResolvedLocatorBinding,
} from '../domain/framework-sync/playwright-framework-codegen.js'

export class PlaywrightFrameworkSyncService {
  constructor(
    private readonly files: TextFileRepositoryPort,
    private readonly log: LoggerPort,
    private readonly plugins: PluginRegistry,
  ) {}

  async sync(params: SyncPlaywrightFrameworkRequest): Promise<SyncPlaywrightFrameworkResponse> {
    if (!params.feature.trim()) {
      throw new DomainError('feature is required', 'FEATURE_REQUIRED')
    }
    if (!params.locatorBindings.length) {
      throw new DomainError('Provide at least one locator binding', 'LOCATOR_BINDINGS_REQUIRED')
    }

    const featureBase = toFeatureBaseName(params.feature)
    const language = await this.resolveLanguage(params, featureBase)
    const locatorPath = await this.resolveFilePath('locator', params, featureBase, language)
    const pagePath = await this.resolveFilePath('page', params, featureBase, language)
    const specPath = await this.resolveFilePath('spec', params, featureBase, language)
    const warnings: string[] = []

    const resolvedBindings = await this.resolveBindings(params.locatorBindings, warnings)
    const pageUrl = params.pageUrl ?? resolvedBindings.find((binding) => binding.artifact?.pageUrl)?.artifact?.pageUrl
    const testCases = normalizeTestCases(params.testCases, params.feature)
    const pageClassName = toPageClassName(params.feature)
    const locatorObjectName = toLocatorObjectName(params.feature)
    const rendered = renderPlaywrightFeatureFiles({
      feature: params.feature,
      language,
      pageClassName,
      locatorObjectName,
      pageUrl,
      locatorBindings: resolvedBindings.map(({ artifact: _artifact, ...binding }) => binding),
      testCases,
      pageImportPath: toImportPath(specPath, pagePath),
      locatorImportPath: toImportPath(pagePath, locatorPath),
    })

    const existingLocator = await this.files.read(locatorPath)
    const existingPage = await this.files.read(pagePath)
    const existingSpec = await this.files.read(specPath)
    const nextLocator = mergeGeneratedBlock(existingLocator, 'locator', rendered.locator)
    const nextPage = mergeGeneratedBlock(existingPage, 'page', rendered.page)
    const nextSpec = mergeGeneratedBlock(existingSpec, 'spec', rendered.spec)
    warnings.push(...[nextLocator.warning, nextPage.warning, nextSpec.warning].filter(Boolean) as string[])

    await this.files.write(locatorPath, nextLocator.content)
    await this.files.write(pagePath, nextPage.content)
    await this.files.write(specPath, nextSpec.content)

    this.log.info(
      {
        feature: params.feature,
        language,
        locatorPath,
        pagePath,
        specPath,
        locatorCount: resolvedBindings.length,
      },
      'sync_playwright_framework',
    )

    return {
      feature: params.feature,
      language,
      files: {
        spec: specPath,
        page: pagePath,
        locator: locatorPath,
      },
      locatorNames: resolvedBindings.map((binding) => binding.methodName),
      pageClassName,
      written: [locatorPath, pagePath, specPath],
      warnings,
    }
  }

  private async resolveLanguage(
    params: SyncPlaywrightFrameworkRequest,
    featureBase: string,
  ): Promise<PlaywrightLanguage> {
    if (params.language) return params.language
    const candidates = await Promise.all([
      this.resolveExistingLanguageCandidate(params.outputDir, params.specDir, featureBase, 'spec'),
      this.resolveExistingLanguageCandidate(params.outputDir, params.pageDir, featureBase, 'page'),
      this.resolveExistingLanguageCandidate(params.outputDir, params.locatorDir, featureBase, 'locator'),
    ])
    return candidates.find(Boolean) ?? 'ts'
  }

  private async resolveExistingLanguageCandidate(
    outputDir: string | undefined,
    subdir: string | undefined,
    featureBase: string,
    kind: 'spec' | 'page' | 'locator',
  ): Promise<PlaywrightLanguage | null> {
    for (const language of ['ts', 'js'] as const) {
      const filePath = join(outputDir ?? '.', subdir ?? '.', `${featureBase}.${kind}.${language}`)
      if (await this.files.read(filePath)) return language
    }
    return null
  }

  private async resolveFilePath(
    kind: 'spec' | 'page' | 'locator',
    params: SyncPlaywrightFrameworkRequest,
    featureBase: string,
    language: PlaywrightLanguage,
  ): Promise<string> {
    const outputDir = params.outputDir ?? '.'
    const subdir = kind === 'spec'
      ? params.specDir
      : kind === 'page'
        ? params.pageDir
        : params.locatorDir
    const preferred = join(outputDir, subdir ?? '.', `${featureBase}.${kind}.${language}`)
    if (await this.files.read(preferred)) return preferred
    const alternateLanguage: PlaywrightLanguage = language === 'ts' ? 'js' : 'ts'
    const alternate = join(outputDir, subdir ?? '.', `${featureBase}.${kind}.${alternateLanguage}`)
    if (await this.files.read(alternate)) return alternate
    return preferred
  }

  private async resolveBindings(
    bindings: PlaywrightLocatorBindingInput[],
    warnings: string[],
  ): Promise<Array<ResolvedLocatorBinding & { artifact?: StoredLocatorArtifact }>> {
    const seen = new Set<string>()
    const resolved: Array<ResolvedLocatorBinding & { artifact?: StoredLocatorArtifact }> = []
    for (const binding of bindings) {
      const artifact = binding.artifactRef && this.plugins.artifactStore
        ? await this.plugins.artifactStore.getArtifact(binding.artifactRef)
        : null
      if (binding.artifactRef && !artifact) {
        throw new DomainError(`Artifact not found: ${binding.artifactRef}`, 'ARTIFACT_NOT_FOUND')
      }
      const locator = binding.locator ?? resolveLocatorFromArtifact(artifact)
      if (!locator) {
        throw new DomainError(
          `locator missing for binding "${binding.name}". Provide locator or artifactRef with generated locator.`,
          'FRAMEWORK_LOCATOR_REQUIRED',
        )
      }
      let methodName = toMethodName(binding.name)
      if (seen.has(methodName)) {
        let suffix = 2
        while (seen.has(`${methodName}${suffix}`)) suffix += 1
        warnings.push(`Duplicate locator binding name "${binding.name}" renamed to "${methodName}${suffix}".`)
        methodName = `${methodName}${suffix}`
      }
      seen.add(methodName)
      resolved.push({
        ...binding,
        locator,
        methodName,
        artifact: artifact ?? undefined,
      })
    }
    return resolved
  }
}

function normalizeTestCases(
  input: SyncPlaywrightFrameworkRequest['testCases'],
  feature: string,
): PlaywrightTestCaseInput[] {
  if (!input?.length) {
    return [{
      name: `${feature} smoke flow`,
      description: `Auto-generated placeholder test for ${feature}.`,
    }]
  }
  return input.map((testCase) => {
    if (typeof testCase === 'string') {
      return {
        name: testCase,
        description: `Auto-generated from user provided test case: ${testCase}`,
      }
    }
    return testCase
  })
}

function resolveLocatorFromArtifact(artifact: StoredLocatorArtifact | null): string | undefined {
  if (!artifact) return undefined
  const healed = [...artifact.outcomes]
    .reverse()
    .find((outcome) => outcome.status === 'healed' && outcome.improvedLocator)
  return healed?.improvedLocator ?? artifact.generation?.bestLocator
}

function toFeatureBaseName(feature: string): string {
  return feature
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'feature'
}

function toImportPath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split(sep).slice(0, -1).join(sep) || '.'
  const raw = relative(fromDir, toFile)
    .replace(/\.(ts|js)$/i, '')
    .split(sep)
    .join('/')
  if (!raw || basename(raw) === raw && !raw.startsWith('.')) return `./${raw || basename(toFile)}`
  return raw.startsWith('.') ? raw : `./${raw}`
}
