import type { Platform } from '../contracts/types.js'

export interface CodegenSnippets {
  playwright?: string
  seleniumJava?: string
  appium?: string
}

/**
 * Emits framework-specific locator API strings for documentation / copy-paste.
 */
export function emitPlatformSnippets(params: {
  platform: Platform
  kind: 'css' | 'xpath' | 'role' | 'text' | 'accessibility' | 'appium' | 'playwright'
  locator: string
  role?: string
  name?: string
  accessibilityId?: string
}): CodegenSnippets {
  if (params.platform === 'android' || params.platform === 'ios') {
    if (params.accessibilityId) {
      return {
        appium: `driver.findElement(AppiumBy.accessibilityId(${javaQuote(params.accessibilityId)}))`,
      }
    }
    return {
      appium: `driver.findElement(AppiumBy.xpath(${javaQuote(params.locator)}))`,
    }
  }

  if (params.kind === 'role' && params.role) {
    return {
      playwright: `page.getByRole('${escapeJs(params.role)}'${params.name ? `, { name: ${jsQuote(params.name)} }` : ''})`,
      seleniumJava: `driver.findElement(By.xpath(${javaQuote(params.locator)}))`,
    }
  }

  if (params.kind === 'xpath') {
    return {
      playwright: `page.locator('xpath=${escapeJs(params.locator)}')`,
      seleniumJava: `driver.findElement(By.xpath(${javaQuote(params.locator)}))`,
    }
  }

  if (params.kind === 'playwright') {
    return { playwright: params.locator }
  }

  return {
    playwright: `page.locator(${jsQuote(params.locator)})`,
    seleniumJava: `driver.findElement(By.cssSelector(${javaQuote(params.locator)}))`,
  }
}

function jsQuote(s: string): string {
  return JSON.stringify(s)
}

function javaQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function escapeJs(s: string): string {
  return s.replace(/'/g, "\\'")
}
