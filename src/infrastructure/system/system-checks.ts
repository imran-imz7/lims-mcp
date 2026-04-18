import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function checkCommandAvailable(
  command: string,
  args: string[] = ['--version'],
): Promise<{ available: boolean; output?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 4000 })
    return { available: true, output: (stdout || stderr).trim() }
  } catch {
    return { available: false }
  }
}

export async function checkPlaywrightPackageInstalled(): Promise<boolean> {
  try {
    await import('playwright')
    return true
  } catch {
    return false
  }
}
