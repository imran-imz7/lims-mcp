import type { Platform } from '../contracts/types.js'

export interface TradingHint {
  key: string
  value: string
  confidence: number
}

const TRADING_CONTAINER_HINTS = [
  'watchlist',
  'orderbook',
  'chart',
  'depth',
  'positions',
  'portfolio',
  'holdings',
  'market',
  'ticker',
  'price',
] as const

const TRADING_WEB_ATTRIBUTE_HINTS = [
  'data-symbol',
  'data-scrip',
  'data-security-id',
  'data-token',
  'data-instrument-token',
  'data-segment',
  'data-exchange',
  'data-product',
  'data-order-id',
  'data-side',
  'data-action',
  'data-strike',
  'data-expiry',
  'data-option-type',
  'data-series',
] as const

const TRADING_PLATFORM_MARKERS = [
  'paytm money',
  'paytmmoney',
  'groww',
  'angel one',
  'angelone',
  'smartapi',
  'upstox',
  'zerodha',
  'kite',
] as const

export function isHighlyDynamicTradingText(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return true
  if (/\b\d{1,3}(,\d{3})*(\.\d+)?\b/.test(t) && /\b(usd|inr|usdt|btc|eth|ltp|last|chg|change)\b/.test(t)) {
    return true
  }
  if (/^-?\d+(\.\d+)?%$/.test(t)) return true
  if (/\b\d{2}:\d{2}(:\d{2})?\b/.test(t)) return true
  return false
}

export function collectTradingHints(attrs: Record<string, string>, text: string): TradingHint[] {
  const hints: TradingHint[] = []
  const lowText = text.toLowerCase()
  for (const [k, v] of Object.entries(attrs)) {
    const lv = String(v).toLowerCase()
    if (TRADING_CONTAINER_HINTS.some((h) => lv.includes(h))) {
      hints.push({ key: k, value: String(v), confidence: 0.8 })
    }
  }
  if (TRADING_CONTAINER_HINTS.some((h) => lowText.includes(h))) {
    hints.push({ key: 'text', value: text, confidence: 0.65 })
  }
  for (const attr of TRADING_WEB_ATTRIBUTE_HINTS) {
    if (typeof attrs[attr] === 'string' && attrs[attr].trim()) {
      hints.push({ key: attr, value: String(attrs[attr]), confidence: 0.86 })
    }
  }
  return hints
}

export function mobileTradingAttributes(platform: Platform): string[] {
  if (platform === 'android') {
    return ['resource-id', 'content-desc', 'text', 'class', 'package']
  }
  if (platform === 'ios') {
    return ['name', 'label', 'value', 'type', 'accessibility-id']
  }
  return [
    'data-testid',
    'data-test',
    'data-qa',
    'aria-label',
    'id',
    'name',
    ...TRADING_WEB_ATTRIBUTE_HINTS,
  ]
}

export function isLikelyTradingSymbol(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return (
    /\b[A-Z]{2,8}\/[A-Z]{2,8}\b/.test(t) ||
    /\b[A-Z]{2,8}(?:-EQ|-BE|-FUT|-CE|-PE)\b/.test(t) ||
    /\b(?:NIFTY|BANKNIFTY|FINNIFTY|SENSEX)\b/.test(t)
  )
}

export function isLikelyTradingPlatformText(text: string): boolean {
  const low = text.toLowerCase()
  return TRADING_PLATFORM_MARKERS.some((m) => low.includes(m))
}

export function isTradingWebAttribute(attrName: string): boolean {
  const low = attrName.toLowerCase()
  return TRADING_WEB_ATTRIBUTE_HINTS.includes(low as (typeof TRADING_WEB_ATTRIBUTE_HINTS)[number])
}
