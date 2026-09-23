import z from '@deepseek-ai/schemastery'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

export const name = 'dsh-chatgpt-oauth'
export const inject = ['authorization', 'credentials', 'settings']

export const Config = z.object({
  routePrefix: z.string().default('/_dsh/dsh-chatgpt-oauth'),
  providerDisplayName: z.string().default('ChatGPT'),
})

export const OPENAI_CODEX_CREDENTIAL_KEY = 'llm-pi-ai/openai-codex'
export const OPENAI_CODEX_PROVIDER = 'openai-codex'

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const OAUTH_SCOPE = 'openid profile email offline_access'
const JWT_AUTH_CLAIM = 'https://api.openai.com/auth'
const OPENAI_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const MAX_USAGE_RESPONSE_BYTES = 64 * 1024
const USAGE_CACHE_MS = 60 * 1000

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function renderCallbackPage({ ok, message, details } = {}) {
  const title = ok ? 'ChatGPT 登录成功' : 'ChatGPT 登录失败'
  const description = message ?? (ok ? '账号授权已完成，可以关闭此页面并返回 DSH。' : '授权未完成，请返回 DSH 后重试。')
  const color = ok ? '#10a37f' : '#d92d20'
  const symbol = ok ? '✓' : '!'
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DSH · ${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#f7f7f8;color:#202123;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;min-height:100vh;place-items:center">
  <main style="box-sizing:border-box;width:min(460px,calc(100vw - 32px));padding:36px;border:1px solid #e5e5e5;border-radius:18px;background:#fff;text-align:center;box-shadow:0 12px 36px rgba(0,0,0,.08)">
    <div style="display:grid;width:52px;height:52px;margin:0 auto 20px;border-radius:50%;place-items:center;background:${color};color:#fff;font-size:30px;font-weight:700">${symbol}</div>
    <div style="margin-bottom:8px;color:#6b6c70;font-size:13px;letter-spacing:.08em">DSH</div>
    <h1 style="margin:0 0 12px;font-size:24px">${escapeHtml(title)}</h1>
    <p style="margin:0;color:#565869;line-height:1.65">${escapeHtml(description)}</p>
    ${details ? `<p style="margin:18px 0 0;color:#8e8f97;font-size:12px">${escapeHtml(details)}</p>` : ''}
  </main>
</body>
</html>`
}

function respondCallback(res, status, options) {
  res.statusCode = status
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(renderCallbackPage(options))
}

function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function buildAuthorizeUrl(state, challenge) {
  const url = new URL(OAUTH_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', OAUTH_CLIENT_ID)
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI)
  url.searchParams.set('scope', OAUTH_SCOPE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'pi')
  return url.toString()
}

function parseAuthorizationInput(input) {
  const value = String(input ?? '').trim()
  if (!value) return {}
  try {
    const url = new URL(value)
    return { code: url.searchParams.get('code') ?? undefined, state: url.searchParams.get('state') ?? undefined }
  } catch {}
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2)
    return { code, state }
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value)
    return { code: params.get('code') ?? undefined, state: params.get('state') ?? undefined }
  }
  return { code: value }
}

function accountIdFromAccessToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const accountId = payload?.[JWT_AUTH_CLAIM]?.chatgpt_account_id
    return typeof accountId === 'string' && accountId ? accountId : null
  } catch {
    return null
  }
}

async function exchangeAuthorizationCode(code, verifier, signal) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
    signal,
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw Object.assign(new Error(`OpenAI token exchange failed (${response.status})${body ? `: ${body}` : ''}`), { code: 'TOKEN_EXCHANGE_FAILED' })
  }
  const token = await response.json()
  if (!token?.access_token || !token.refresh_token || typeof token.expires_in !== 'number') {
    throw Object.assign(new Error('OpenAI token response is missing required fields.'), { code: 'INVALID_TOKEN_RESPONSE' })
  }
  const accountId = accountIdFromAccessToken(token.access_token)
  if (!accountId) throw Object.assign(new Error('无法从 OpenAI 访问令牌中读取 ChatGPT account id。'), { code: 'MISSING_ACCOUNT_ID' })
  return {
    type: 'oauth',
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    accountId,
  }
}

async function refreshCredential(credential, signal) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh,
      client_id: OAUTH_CLIENT_ID,
    }),
    signal,
  })
  if (!response.ok) {
    throw Object.assign(new Error(`OpenAI token refresh failed (${response.status}).`), { code: 'TOKEN_REFRESH_FAILED' })
  }
  const token = await response.json()
  if (!token?.access_token || !token.refresh_token || typeof token.expires_in !== 'number') {
    throw Object.assign(new Error('OpenAI token refresh response is missing required fields.'), { code: 'INVALID_REFRESH_RESPONSE' })
  }
  const accountId = accountIdFromAccessToken(token.access_token) ?? credential.accountId
  return {
    ...credential,
    type: 'oauth',
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    ...(accountId ? { accountId } : {}),
  }
}

function objectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function cleanLabel(value) {
  if (typeof value !== 'string') return undefined
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 80) || undefined
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value))
}

function windowLabel(seconds) {
  if (!seconds || seconds <= 0) return 'Limit'
  const minutes = Math.ceil(seconds / 60)
  if (minutes >= 10080) return 'Weekly'
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`
  return `${minutes}m`
}

export function parseCodexUsage(payload, capturedAt = Date.now()) {
  const source = objectValue(payload)
  if (!source) throw new Error('Codex usage response was not an object.')
  const buckets = []
  const appendWindows = (limit, groupLabel, groupId) => {
    for (const [windowId, rawWindow] of [['primary', limit.primary_window], ['secondary', limit.secondary_window]]) {
      const window = objectValue(rawWindow)
      const rawUsed = numberValue(window?.used_percent)
      if (rawUsed === undefined) continue
      const seconds = numberValue(window?.limit_window_seconds)
      const used = clampPercent(rawUsed)
      const reset = numberValue(window?.reset_at)
      buckets.push({
        id: `${groupId}:${windowId}`,
        label: windowLabel(seconds),
        ...(groupId === 'codex' ? {} : { groupLabel }),
        used,
        remaining: 100 - used,
        limit: 100,
        unit: 'percent',
        ...(seconds && seconds > 0 ? { windowMinutes: Math.ceil(seconds / 60) } : {}),
        ...(reset !== undefined ? { resetsAt: reset } : {}),
      })
    }
  }

  const mainLimit = objectValue(source.rate_limit)
  if (mainLimit) appendWindows(mainLimit, 'Codex', 'codex')
  const extraLimits = Array.isArray(source.additional_rate_limits) ? source.additional_rate_limits : []
  extraLimits.forEach((raw, index) => {
    const entry = objectValue(raw)
    const limit = objectValue(entry?.rate_limit)
    if (!limit) return
    appendWindows(
      limit,
      cleanLabel(entry?.limit_name) ?? `Limit ${index + 1}`,
      cleanLabel(entry?.metered_feature) ?? `additional-${index}`,
    )
  })

  const metrics = []
  const credits = objectValue(source.credits)
  if (credits?.unlimited === true) {
    metrics.push({ id: 'credits', label: 'Credits', value: 'Unlimited' })
  } else {
    const balance = numberValue(credits?.balance)
    if (balance !== undefined) metrics.push({ id: 'credits', label: 'Credits', value: balance, unit: 'count' })
  }
  if (!buckets.length && !metrics.length) throw new Error('Codex returned no usage data.')
  return {
    providerId: OPENAI_CODEX_PROVIDER,
    providerName: 'OpenAI Codex',
    capturedAt,
    buckets,
    metrics,
  }
}

function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let settleCode
    const waitForCode = new Promise((resolveCode) => { settleCode = resolveCode })
    const server = createServer((req, res) => {
      let url
      try {
        url = new URL(req.url ?? '/', 'http://localhost')
      } catch {
        respondCallback(res, 400, { ok: false, message: '回调地址无效。' })
        return
      }
      if (url.pathname !== '/auth/callback') {
        respondCallback(res, 404, { ok: false, message: '回调路径不存在。' })
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        respondCallback(res, 400, { ok: false, message: '授权状态校验失败，请返回 DSH 后重试。' })
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        respondCallback(res, 400, { ok: false, message: 'OpenAI 回调中缺少授权码。' })
        return
      }
      respondCallback(res, 200, { ok: true })
      settleCode(code)
    })
    server.once('error', (error) => {
      reject(Object.assign(new Error(error?.code === 'EADDRINUSE' ? 'OAuth 回调端口 1455 已被占用，请关闭其他登录流程后重试。' : `OAuth 回调服务器启动失败：${error.message}`), { code: error?.code ?? 'CALLBACK_SERVER_FAILED' }))
    })
    server.listen(1455, '127.0.0.1', () => {
      resolve({
        waitForCode: () => waitForCode,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function safeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function selectPiLoginOption(prompt, mode) {
  if (prompt?.kind !== 'select' || !Array.isArray(prompt.options)) return undefined
  const wanted = mode === 'device_code' ? 'device' : 'browser'
  const option = prompt.options.find((entry) => {
    const haystack = `${entry?.id ?? ''} ${entry?.label ?? ''}`.toLowerCase()
    return haystack.includes(wanted)
  })
  return option?.id ?? prompt.options[0]?.id
}

export function routeState(settings) {
  const provider = settings?.providers?.[OPENAI_CODEX_PROVIDER]
  const catalogCompatFields = new Set([
    'supportsOpenAIGrammarTools',
    'supportsAdditionalTools',
    'supportsToolSearch',
  ])
  const findCatalogCompat = (compat) => Object.keys(compat ?? {}).find((field) => catalogCompatFields.has(field))
  const routeField = findCatalogCompat(provider?.compat)
  const model = provider?.models?.find((entry) => findCatalogCompat(entry.compat))
  const modelField = model && findCatalogCompat(model.compat)
  const issue = routeField
    ? `openai-codex 路由配置了 ${routeField}；请删除该 compat 字段，由 pi-ai 内置模型目录提供。`
    : modelField
      ? `模型 ${model.id} 配置了 ${modelField}；请删除该 compat 字段，由 pi-ai 内置模型目录提供。`
      : undefined
  return {
    configured: provider !== undefined,
    compatible: (provider === undefined || provider.apiKeyEnv === undefined) && issue === undefined,
    provider,
    ...(issue === undefined ? {} : { issue }),
  }
}

function sameOrigin(req) {
  const origin = req.headers?.origin ?? ''
  const host = req.headers?.host ?? ''
  const fetchSite = req.headers?.['sec-fetch-site'] ?? ''
  if (origin) return Boolean(host) && (origin === `http://${host}` || origin === `https://${host}`)
  return fetchSite === 'same-origin' || fetchSite === 'none'
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function respond(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export function apply(ctx, config) {
  let disposed = false
  let pendingPrompt
  let browserController
  let browserServer
  let usageCache
  let attempt = {
    inFlight: false,
    mode: null,
    notice: null,
    prompt: null,
    outcome: null,
    error: null,
  }

  function clearPrompt(error) {
    const current = pendingPrompt
    pendingPrompt = undefined
    attempt.prompt = null
    if (current && error) current.reject(error)
  }

  async function ensureRoute() {
    const section = ctx.settings.get('llm-pi-ai') ?? {}
    const state = routeState(section)
    if (state.issue) {
      throw Object.assign(new Error(state.issue), { code: 'ROUTE_CONFLICT' })
    }
    if (!state.compatible) {
      throw Object.assign(new Error('openai-codex 路由仍配置了 apiKeyEnv；请先移除该字段，避免它覆盖账号 OAuth 凭据。'), { code: 'ROUTE_CONFLICT' })
    }
    if (state.configured) return false
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set',
      path: ['providers', OPENAI_CODEX_PROVIDER],
      value: { displayName: config.providerDisplayName },
    }])
    return true
  }

  function promptHuman(prompt, mode) {
    const selected = selectPiLoginOption(prompt, mode)
    if (selected !== undefined) return Promise.resolve(selected)

    clearPrompt(new Error('prompt replaced'))
    attempt.prompt = {
      kind: prompt.kind,
      message: prompt.message,
      placeholder: prompt.placeholder ?? null,
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (pendingPrompt?.reject === reject) {
          pendingPrompt = undefined
          attempt.prompt = null
        }
        reject(new Error('prompt withdrawn'))
      }
      prompt.signal?.addEventListener('abort', onAbort, { once: true })
      pendingPrompt = {
        resolve(value) {
          prompt.signal?.removeEventListener('abort', onAbort)
          pendingPrompt = undefined
          attempt.prompt = null
          resolve(value)
        },
        reject(error) {
          prompt.signal?.removeEventListener('abort', onAbort)
          pendingPrompt = undefined
          attempt.prompt = null
          reject(error)
        },
      }
    })
  }

  async function runBrowserLogin() {
    const controller = new AbortController()
    browserController = controller
    const state = randomBytes(16).toString('hex')
    const pkce = createPkce()
    try {
      browserServer = await startCallbackServer(state)
      const authorizeUrl = buildAuthorizeUrl(state, pkce.challenge)
      attempt.notice = {
        message: '请在 OpenAI 页面完成 ChatGPT 账号授权。',
        url: authorizeUrl,
        code: null,
      }
      const manualInput = promptHuman({
        kind: 'text',
        message: '完成浏览器登录；如果回调页无法自动连接，也可以粘贴授权码或完整回调地址：',
        placeholder: OAUTH_REDIRECT_URI,
        signal: controller.signal,
      }, 'browser').then((input) => ({ kind: 'manual', input }))
      const callbackCode = browserServer.waitForCode().then((code) => ({ kind: 'callback', code }))
      const result = await Promise.race([callbackCode, manualInput])
      controller.signal.throwIfAborted()

      let code
      if (result.kind === 'callback') {
        code = result.code
        clearPrompt(new Error('callback received'))
      } else {
        const parsed = parseAuthorizationInput(result.input)
        if (parsed.state && parsed.state !== state) {
          throw Object.assign(new Error('OAuth state 不匹配，请重新登录。'), { code: 'STATE_MISMATCH' })
        }
        code = parsed.code
      }
      if (!code) throw Object.assign(new Error('缺少 OpenAI 授权码。'), { code: 'MISSING_CODE' })

      attempt.notice = { message: '正在完成 ChatGPT 登录…', url: null, code: null }
      const credential = await exchangeAuthorizationCode(code, pkce.verifier, controller.signal)
      await ctx.credentials.modifyRecord(OPENAI_CODEX_CREDENTIAL_KEY, async () => ({
        kind: 'grant',
        payload: credential,
      }))
      attempt.inFlight = false
      attempt.outcome = 'authorized'
      attempt.notice = { message: 'ChatGPT 账号登录成功。' }
      clearPrompt()
    } catch (error) {
      attempt.inFlight = false
      if (controller.signal.aborted) {
        attempt.outcome = 'cancelled'
        attempt.notice = { message: '登录已取消。' }
      } else {
        attempt.error = safeError(error)
        attempt.notice = { message: 'ChatGPT 登录失败。' }
      }
      clearPrompt()
    } finally {
      const server = browserServer
      browserServer = undefined
      browserController = undefined
      if (server) await server.close().catch(() => {})
    }
  }

  async function status() {
    const record = await ctx.credentials.describeRecord(OPENAI_CODEX_CREDENTIAL_KEY)
    const route = routeState(ctx.settings.get('llm-pi-ai') ?? {})
    const flow = ctx.authorization.describe(OPENAI_CODEX_CREDENTIAL_KEY)
    return {
      available: flow !== undefined,
      methods: flow?.methods ?? [],
      bound: record.configured,
      writable: record.writable,
      routeConfigured: route.configured,
      routeCompatible: route.compatible,
      ...attempt,
    }
  }

  async function usage(args) {
    const force = args?.force === true
    if (!force && usageCache && Date.now() - usageCache.at < USAGE_CACHE_MS) return usageCache.value

    let credential
    try {
      const record = await ctx.credentials.modifyRecord(OPENAI_CODEX_CREDENTIAL_KEY, async (current) => {
        if (current?.kind !== 'grant' || current.payload?.type !== 'oauth') return undefined
        const currentCredential = current.payload
        if (typeof currentCredential.access !== 'string' || typeof currentCredential.refresh !== 'string') return undefined
        if ((numberValue(currentCredential.expires) ?? 0) > Date.now() + 5 * 60 * 1000) return undefined
        const next = await refreshCredential(currentCredential, AbortSignal.timeout(15000))
        return { kind: 'grant', payload: next }
      })
      if (record?.kind === 'grant' && record.payload?.type === 'oauth') credential = record.payload
    } catch (error) {
      return { providerId: OPENAI_CODEX_PROVIDER, status: 'auth-unavailable', message: safeError(error).message }
    }

    if (!credential || typeof credential.access !== 'string' || !credential.access) {
      return { providerId: OPENAI_CODEX_PROVIDER, status: 'auth-unavailable', message: '请先登录 ChatGPT 账号。' }
    }

    try {
      const response = await fetch(OPENAI_CODEX_USAGE_URL, {
        headers: { Authorization: `Bearer ${credential.access}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      const body = await response.text()
      if (body.length > MAX_USAGE_RESPONSE_BYTES) throw new Error('Usage response was too large.')
      if (!response.ok) throw new Error(`Usage endpoint returned ${response.status}.`)
      const value = { providerId: OPENAI_CODEX_PROVIDER, status: 'ready', report: parseCodexUsage(JSON.parse(body)) }
      usageCache = { at: Date.now(), value }
      return value
    } catch (error) {
      return { providerId: OPENAI_CODEX_PROVIDER, status: 'query-failed', message: safeError(error).message }
    }
  }

  async function start(args) {
    if (attempt.inFlight || ctx.authorization.describe(OPENAI_CODEX_CREDENTIAL_KEY)?.inFlight) {
      return { ok: false, error: { code: 'ALREADY_IN_FLIGHT', message: '已有 ChatGPT 登录正在进行。' } }
    }
    const mode = args?.mode === 'device_code' ? 'device_code' : 'browser'
    try {
      await ensureRoute()
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }

    attempt = {
      inFlight: true,
      mode,
      notice: { message: '正在启动 ChatGPT 登录…' },
      prompt: null,
      outcome: null,
      error: null,
    }

    if (mode === 'browser') {
      void runBrowserLogin()
      return { ok: true, mode }
    }

    void ctx.authorization.begin({
      key: OPENAI_CODEX_CREDENTIAL_KEY,
      method: 'oauth',
      interaction: {
        notify(notice) {
          attempt.notice = {
            message: notice.message,
            url: notice.url ?? null,
            code: notice.code ?? null,
          }
        },
        prompt(prompt) {
          return promptHuman(prompt, mode)
        },
      },
    }).then((outcome) => {
      attempt.inFlight = false
      attempt.outcome = outcome.status
      attempt.notice = { message: outcome.status === 'authorized' ? 'ChatGPT 账号登录成功。' : '登录已取消。' }
      clearPrompt()
    }).catch((error) => {
      attempt.inFlight = false
      attempt.error = safeError(error)
      attempt.notice = { message: 'ChatGPT 登录失败。' }
      clearPrompt()
    })

    return { ok: true, mode }
  }

  function answer(args) {
    if (!pendingPrompt) return { ok: false, error: { code: 'NO_PROMPT', message: '当前没有等待输入的登录问题。' } }
    const value = typeof args?.value === 'string' ? args.value.trim() : ''
    if (!value) return { ok: false, error: { code: 'EMPTY_ANSWER', message: '请输入授权码或回调地址。' } }
    pendingPrompt.resolve(value)
    return { ok: true }
  }

  function cancel() {
    browserController?.abort()
    ctx.authorization.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    clearPrompt(new Error('authorization cancelled'))
    return { ok: true }
  }

  async function logout() {
    browserController?.abort()
    ctx.authorization.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    clearPrompt(new Error('authorization cancelled'))
    await ctx.credentials.deleteRecord(OPENAI_CODEX_CREDENTIAL_KEY)
    usageCache = undefined
    attempt = {
      inFlight: false,
      mode: null,
      notice: { message: '已退出 ChatGPT 账号。' },
      prompt: null,
      outcome: 'logged_out',
      error: null,
    }
    return { ok: true }
  }

  const handlers = { status, usage, start, answer, cancel, logout }
  const mutating = new Set(['usage', 'start', 'answer', 'cancel', 'logout'])

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: config.routePrefix,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (!url.pathname.startsWith(`${config.routePrefix}/`)) return respond(res, 404, { error: 'not found' })
          const method = decodeURIComponent(url.pathname.slice(config.routePrefix.length + 1))
          if (!Object.hasOwn(handlers, method)) return respond(res, 404, { error: 'unknown method' })
          if (mutating.has(method)) {
            if (req.method !== 'POST') return respond(res, 405, { error: 'POST required' })
            if (!sameOrigin(req)) return respond(res, 403, { error: 'cross-origin request rejected' })
          }
          const args = req.method === 'POST' ? await readJsonBody(req) : {}
          const result = await handlers[method](args)
          respond(res, 200, result)
        } catch (error) {
          respond(res, error?.status ?? 500, { error: safeError(error).message })
        }
      },
    }), 'dsh-chatgpt-oauth: web routes')
  }, 'dsh-chatgpt-oauth: web routes')

  ctx.effect(() => () => {
    disposed = true
    browserController?.abort()
    if (attempt.inFlight) ctx.authorization.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    clearPrompt(new Error('plugin disposed'))
  }, 'dsh-chatgpt-oauth: cleanup')

  return () => {
    if (disposed) return
    disposed = true
    browserController?.abort()
    if (attempt.inFlight) ctx.authorization.cancel(OPENAI_CODEX_CREDENTIAL_KEY)
    clearPrompt(new Error('plugin disposed'))
  }
}
