import { describe, it, expect } from 'vitest'
import {
  CaptureGenerateLocatorInputSchema,
  GenerateLocatorInputSchema,
  ReportLocatorResultInputSchema,
  SyncPlaywrightFrameworkInputSchema,
} from '../../src/mcp/schemas.js'

describe('GenerateLocatorInputSchema source requirements', () => {
  it('accepts screenshot-only requests', () => {
    const parsed = GenerateLocatorInputSchema.safeParse({
      screenshot: 'base64-image',
      platform: 'web',
      target: 'button:Buy',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts screenshot + dom/xml requests', () => {
    const withDom = GenerateLocatorInputSchema.safeParse({
      screenshot: 'base64-image',
      dom: '<button>Buy</button>',
      platform: 'web',
      target: 'text:Buy',
    })
    const withXml = GenerateLocatorInputSchema.safeParse({
      screenshot: 'base64-image',
      xml: '<node text="Buy" />',
      platform: 'android',
      target: 'text:Buy',
    })
    expect(withDom.success).toBe(true)
    expect(withXml.success).toBe(true)
  })

  it('accepts dom/xml-only requests', () => {
    const withDom = GenerateLocatorInputSchema.safeParse({
      dom: '<button>Buy</button>',
      platform: 'web',
      target: 'text:Buy',
    })
    const withXml = GenerateLocatorInputSchema.safeParse({
      xml: '<node text="Buy" />',
      platform: 'android',
      target: 'text:Buy',
    })
    expect(withDom.success).toBe(true)
    expect(withXml.success).toBe(true)
  })

  it('accepts file-path source requests for layman usage', () => {
    const withDomFile = GenerateLocatorInputSchema.safeParse({
      domFile: './samples/dom.txt',
      platform: 'web',
      target: 'text:Buy',
    })
    const withXmlFile = GenerateLocatorInputSchema.safeParse({
      xmlFile: './samples/ui.xml.txt',
      platform: 'android',
      target: 'text:Buy',
    })
    const withScreenshotFile = GenerateLocatorInputSchema.safeParse({
      screenshotFile: './samples/screen.png',
      platform: 'web',
      target: 'button:Buy',
    })
    expect(withDomFile.success).toBe(true)
    expect(withXmlFile.success).toBe(true)
    expect(withScreenshotFile.success).toBe(true)
  })

  it('rejects request with no source', () => {
    const parsed = GenerateLocatorInputSchema.safeParse({
      platform: 'web',
      target: 'text:Buy',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts structured target descriptors without target string', () => {
    const parsed = GenerateLocatorInputSchema.safeParse({
      dom: '<button data-testid="buy-btn">Buy</button>',
      platform: 'web',
      targetDescriptor: {
        attributes: {
          'data-testid': 'buy-btn',
        },
        text: 'Buy',
      },
      runtimeContext: {
        mode: 'live-page',
        pageUrl: 'https://example.com/app',
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts one-click capture requests for web runtime capture', () => {
    const parsed = CaptureGenerateLocatorInputSchema.safeParse({
      platform: 'web',
      targetDescriptor: {
        attributes: {
          'data-testid': 'buy-btn',
        },
        text: 'Buy',
      },
      runtimeContext: {
        useCurrentPage: true,
        waitForSelector: '[data-testid="buy-btn"]',
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts feedback requests that can drive self-healing', () => {
    const parsed = ReportLocatorResultInputSchema.safeParse({
      locator: 'page.getByTestId("buy-btn")',
      status: 'failed',
      platform: 'web',
      artifactRef: 'artifact-1',
      failureMessage: 'element not found',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts framework sync requests for playwright page/spec/locator files', () => {
    const parsed = SyncPlaywrightFrameworkInputSchema.safeParse({
      feature: 'payments',
      language: 'ts',
      outputDir: 'e2e',
      locatorBindings: [
        {
          name: 'pay now button',
          artifactRef: 'artifact-1',
        },
      ],
      testCases: [
        {
          name: 'user can submit a payment',
          steps: [
            {
              locator: 'pay now button',
              action: 'click',
            },
          ],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})
