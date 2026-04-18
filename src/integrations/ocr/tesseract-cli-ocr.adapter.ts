import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OCRAdapter, OCRToken } from '../../domain/contracts/ports.js'

const execFileAsync = promisify(execFile)

/**
 * Free/open-source OCR adapter using local Tesseract CLI.
 * If `tesseract` is not installed, returns an empty token list.
 */
export class TesseractCliOCRAdapter implements OCRAdapter {
  async extractTokens(imageBytes: Buffer): Promise<OCRToken[]> {
    const dir = await mkdtemp(join(tmpdir(), 'lims-ocr-'))
    const imgPath = join(dir, 'input.png')
    try {
      await writeFile(imgPath, imageBytes)
      const { stdout } = await execFileAsync('tesseract', [
        imgPath,
        'stdout',
        '--psm',
        '6',
        'tsv',
      ])
      return parseTsvTokens(stdout)
    } catch {
      return []
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function parseTsvTokens(tsv: string): OCRToken[] {
  const lines = tsv.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) return []
  const out: OCRToken[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    if (cols.length < 12) continue
    const level = Number(cols[0] ?? 0)
    const left = Number(cols[6] ?? 0)
    const top = Number(cols[7] ?? 0)
    const width = Number(cols[8] ?? 0)
    const height = Number(cols[9] ?? 0)
    const confidence = Number(cols[10] ?? -1)
    const text = (cols[11] ?? '').trim()
    if (level !== 5 || !text || confidence < 0) continue
    out.push({
      text,
      confidence: Math.max(0, Math.min(1, confidence / 100)),
      bbox: { x: left, y: top, width, height },
    })
  }
  return out
}
