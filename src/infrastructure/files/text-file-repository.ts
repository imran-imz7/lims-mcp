import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { TextFileRepositoryPort } from '../../domain/contracts/ports.js'

export class TextFileRepository implements TextFileRepositoryPort {
  async read(path: string): Promise<string | null> {
    try {
      return await readFile(resolve(process.cwd(), path), 'utf8')
    } catch {
      return null
    }
  }

  async write(path: string, content: string): Promise<void> {
    const absolutePath = resolve(process.cwd(), path)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }
}
