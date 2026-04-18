/**
 * Lightweight syntax validation for CSS/XPath to avoid obvious engine errors.
 */

export class SelectorValidator {
  validateCss(selector: string): { ok: boolean; reason?: string } {
    if (!selector.trim()) return { ok: false, reason: 'empty css selector' };
    try {
      /* Structural checks only — cheerio will throw on parse for many cases when used */
      if (/[\n\r]/.test(selector)) return { ok: false, reason: 'multiline css' };
      return { ok: true };
    } catch {
      return { ok: false, reason: 'css validation failed' };
    }
  }

  validateXPath(expression: string): { ok: boolean; reason?: string } {
    if (!expression.trim()) return { ok: false, reason: 'empty xpath' };
    if (!expression.includes('/')) return { ok: false, reason: 'xpath missing path axes' };
    return { ok: true };
  }
}
