import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { DEFAULT_BASE_URL, fetchQrCode, pollQrStatus } from './api.js'

const DEFAULT_TOKEN_DIR = path.join(os.homedir(), '.wx-acpx')
const DEFAULT_TOKEN_PATH = path.join(DEFAULT_TOKEN_DIR, 'credentials.json')
const QR_POLL_INTERVAL_MS = 2_000

export interface Credentials {
  token: string
  baseUrl: string
  accountId: string
  userId: string
}

export interface LoginOptions {
  baseUrl?: string
  tokenPath?: string
  force?: boolean
}

function resolveTokenPath(tokenPath?: string): string {
  return tokenPath ?? DEFAULT_TOKEN_PATH
}

function log(message: string): void {
  process.stderr.write(`[weixin-bot] ${message}\n`)
}

async function saveCredentials(credentials: Credentials, tokenPath?: string): Promise<void> {
  const targetPath = resolveTokenPath(tokenPath)
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
  await writeFile(targetPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  await chmod(targetPath, 0o600)
}

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.token === 'string'
    && typeof candidate.baseUrl === 'string'
    && typeof candidate.accountId === 'string'
    && typeof candidate.userId === 'string'
}

async function printQrInstructions(url: string): Promise<void> {
  log('请使用微信扫描以下二维码完成登录：\n')
  try {
    const qrcodeterminal = await import('qrcode-terminal')
    qrcodeterminal.default.generate(url, { small: true })
  } catch {
    // 如果 qrcode-terminal 加载失败，回退到打印 URL
    log('在微信中打开以下链接完成登录:')
  }
  process.stderr.write(`\nQR URL: ${url}\n`)
  log('\nWaiting for scan...')
}

export async function loadCredentials(tokenPath?: string): Promise<Credentials | undefined> {
  const targetPath = resolveTokenPath(tokenPath)

  try {
    const raw = await readFile(targetPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    if (!isCredentials(parsed)) {
      throw new Error(`Invalid credentials format in ${targetPath}`)
    }

    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

export async function clearCredentials(tokenPath?: string): Promise<void> {
  await rm(resolveTokenPath(tokenPath), { force: true })
}

export async function login(options: LoginOptions = {}): Promise<Credentials> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

  if (!options.force) {
    const existing = await loadCredentials(options.tokenPath)
    if (existing) {
      return existing
    }
  }

  for (;;) {
    const qr = await fetchQrCode(baseUrl)
    await printQrInstructions(qr.qrcode_img_content)

    let lastStatus: string | undefined

    for (;;) {
      const status = await pollQrStatus(baseUrl, qr.qrcode)

      if (status.status !== lastStatus) {
        if (status.status === 'scaned') {
          log('QR code scanned! Please confirm on your phone.')
        } else if (status.status === 'confirmed') {
          log('Login confirmed!')
        } else if (status.status === 'expired') {
          log('QR code expired. Requesting a new one...')
        }
        lastStatus = status.status
      }

      if (status.status === 'confirmed') {
        if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
          throw new Error('QR login confirmed, but the API did not return bot credentials')
        }

        const credentials: Credentials = {
          token: status.bot_token,
          baseUrl: status.baseurl ?? baseUrl,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id,
        }

        await saveCredentials(credentials, options.tokenPath)
        const targetPath = resolveTokenPath(options.tokenPath)
        log(`\nLogin successful! Credentials saved to ${targetPath}`)
        log(`Bot ID: ${credentials.accountId}\n`)
        return credentials
      }

      if (status.status === 'expired') {
        break
      }

      await delay(QR_POLL_INTERVAL_MS)
    }
  }
}

export { DEFAULT_TOKEN_PATH }
