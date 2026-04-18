export function parseImageDimensions(bytes: Buffer): { width: number; height: number } {
  if (isPng(bytes)) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    }
  }
  if (isJpeg(bytes)) {
    const dim = parseJpeg(bytes)
    if (dim) return dim
  }
  return { width: 0, height: 0 }
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function parseJpeg(bytes: Buffer): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    const size = bytes.readUInt16BE(i + 2)
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      const height = bytes.readUInt16BE(i + 5)
      const width = bytes.readUInt16BE(i + 7)
      return { width, height }
    }
    i += 2 + size
  }
  return null
}
