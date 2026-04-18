export function splitStablePattern(value: string): { prefix: string; suffix: string } | null {
  const raw = value.trim()
  if (raw.length < 6) return null
  const dynamicMiddle = raw.match(/^([a-zA-Z_-]{2,}[-_])(?:[a-zA-Z0-9]{3,}|[0-9]{2,})([-_][a-zA-Z_-]{2,})$/)
  if (dynamicMiddle) {
    return {
      prefix: dynamicMiddle[1] ?? '',
      suffix: dynamicMiddle[2] ?? '',
    }
  }
  const parts = raw.split(/[-_]/).filter(Boolean)
  if (parts.length >= 3) {
    const first = parts[0] ?? ''
    const last = parts[parts.length - 1] ?? ''
    if (first.length >= 2 && last.length >= 2 && !/\d{3,}/.test(first + last)) {
      return { prefix: `${first}-`, suffix: `-${last}` }
    }
  }
  return null
}

export function stableTextTokens(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .filter((t) => !/^\d+([.,]\d+)?$/.test(t))
    .filter((t) => !/[₹$€£¥]/.test(t))
}

export function safeXPathLiteral(raw: string): string {
  if (!raw.includes("'")) return `'${raw}'`
  if (!raw.includes('"')) return `"${raw}"`
  const chunks = raw.split("'")
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]) parts.push(`'${chunks[i]}'`)
    if (i < chunks.length - 1) parts.push(`"'"`)
  }
  return `concat(${parts.join(', ')})`
}
