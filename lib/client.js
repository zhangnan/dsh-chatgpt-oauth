window.__ModuleLoader__.load({ id: 'dsh-chatgpt-oauth', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')

  function h(tag, props) {
    const args = [tag, props]
    for (let i = 2; i < arguments.length; i += 1) args.push(arguments[i])
    return React.createElement.apply(React, args)
  }

  const PREFIX = '/_dsh/dsh-chatgpt-oauth'
  const colors = {
    muted: 'var(--dsw-alias-label-secondary)',
    faint: 'var(--dsw-alias-label-tertiary)',
    border: 'var(--dsw-alias-border-l2)',
    panel: 'var(--dsw-alias-bg-layer-1)',
    success: 'var(--dsw-alias-state-success-primary)',
    error: 'var(--dsw-alias-state-error-primary)',
    link: 'var(--dsw-alias-link-primary)',
  }

  async function rpc(method, args) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(`${PREFIX}/${method}`, {
        method: args === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: args === undefined ? undefined : JSON.stringify(args),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function resetText(unixSeconds) {
    if (!Number.isFinite(unixSeconds)) return null
    const at = new Date(unixSeconds * 1000)
    if (Number.isNaN(at.getTime())) return null
    const diff = at.getTime() - Date.now()
    if (diff <= 0) return '即将重置'
    const minutes = Math.ceil(diff / 60000)
    const relative = minutes >= 1440
      ? `${Math.floor(minutes / 1440)}天${Math.ceil((minutes % 1440) / 60)}小时后重置`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}小时${minutes % 60}分钟后重置`
        : `${minutes}分钟后重置`
    return `${relative} · ${at.toLocaleString()}`
  }

  function UsageBucket({ bucket }) {
    const used = Math.max(0, Math.min(100, Number(bucket.used) || 0))
    const remaining = Math.max(0, 100 - used)
    return h('div', { style: { marginTop: 12 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 6 } },
        h('span', null, bucket.groupLabel ? `${bucket.groupLabel} · ${bucket.label}` : bucket.label),
        h('span', { style: { color: colors.muted, whiteSpace: 'nowrap' } }, `已用 ${used.toFixed(used % 1 ? 1 : 0)}% · 剩余 ${remaining.toFixed(remaining % 1 ? 1 : 0)}%`)
      ),
      h('div', { style: { height: 7, overflow: 'hidden', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2)' } },
        h('div', { style: { width: `${used}%`, height: '100%', borderRadius: 999, background: used >= 90 ? colors.error : used >= 70 ? '#f59e0b' : '#10a37f', transition: 'width .2s ease' } })
      ),
      bucket.resetsAt ? h('div', { style: { marginTop: 5, color: colors.faint, fontSize: 11 } }, resetText(bucket.resetsAt)) : null
    )
  }

  function UsageView({ value, loading, onRefresh }) {
    const secondary = { border: `1px solid ${colors.border}`, borderRadius: 18, height: 32, padding: '0 13px', cursor: 'pointer', background: 'transparent', color: 'var(--dsw-alias-label-primary)' }
    if (loading && !value) return h('p', { style: { color: colors.muted, fontSize: 13, margin: '12px 0 0' } }, '正在读取 ChatGPT 用量…')
    if (!value) return null
    if (value.status !== 'ready') return h('div', { style: { marginTop: 14 } },
      h('div', { style: { color: colors.error, fontSize: 13 } }, value.message || '暂时无法读取 ChatGPT 用量。'),
      h('button', { style: { ...secondary, marginTop: 9 }, disabled: loading, onClick: onRefresh }, loading ? '刷新中…' : '重试')
    )
    const report = value.report
    return h('div', { style: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
        h('strong', { style: { fontSize: 14 } }, 'ChatGPT 用量'),
        h('button', { style: secondary, disabled: loading, onClick: onRefresh }, loading ? '刷新中…' : '刷新')
      ),
      report.buckets.map((bucket) => h(UsageBucket, { key: bucket.id, bucket })),
      report.metrics.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 13 } },
        report.metrics.map((metric) => h('div', { key: metric.id, style: { padding: '7px 10px', border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 } }, `${metric.label}: ${metric.value}`))
      ) : null,
      h('div', { style: { marginTop: 9, color: colors.faint, fontSize: 11 } }, `更新时间：${new Date(report.capturedAt).toLocaleString()}`)
    )
  }

  function ChatGptProviderPanel(props) {
    if (props.provider?.provider !== 'openai-codex') return null
    const [status, setStatus] = React.useState(null)
    const [usage, setUsage] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [usageBusy, setUsageBusy] = React.useState(false)
    const [answer, setAnswer] = React.useState('')

    const loadStatus = React.useCallback(async () => {
      try {
        const next = await rpc('status')
        setStatus(next)
        return next
      } catch (error) {
        const next = { available: false, bound: false, error: { message: error.message } }
        setStatus(next)
        return next
      }
    }, [])

    const loadUsage = React.useCallback(async (force) => {
      setUsageBusy(true)
      try {
        setUsage(await rpc('usage', { force: force === true }))
      } catch (error) {
        setUsage({ status: 'query-failed', message: error.message })
      } finally {
        setUsageBusy(false)
      }
    }, [])

    React.useEffect(() => {
      let active = true
      loadStatus().then((next) => {
        if (active && next.bound) loadUsage(false)
      })
      return () => { active = false }
    }, [loadStatus, loadUsage])

    React.useEffect(() => {
      if (!status?.inFlight) return undefined
      const timer = window.setInterval(async () => {
        const next = await loadStatus()
        if (next.bound && !next.inFlight) loadUsage(true)
      }, 1500)
      return () => window.clearInterval(timer)
    }, [status?.inFlight, loadStatus, loadUsage])

    async function act(fn) {
      setBusy(true)
      try {
        await fn()
        const next = await loadStatus()
        if (next.bound) await loadUsage(true)
        else setUsage(null)
      } catch (error) {
        window.alert(error.message)
      } finally {
        setBusy(false)
      }
    }

    const box = { marginTop: 12, padding: '14px 15px', border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.panel }
    const primary = { border: 0, borderRadius: 18, height: 34, padding: '0 16px', cursor: 'pointer', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)' }
    const secondary = { border: `1px solid ${colors.border}`, borderRadius: 18, height: 34, padding: '0 14px', cursor: 'pointer', background: 'transparent', color: 'var(--dsw-alias-label-primary)' }
    const danger = { ...secondary, color: colors.error, borderColor: colors.error }

    if (!status) return h('div', { style: box }, h('span', { style: { color: colors.muted, fontSize: 13 } }, '正在读取 ChatGPT 登录状态…'))
    const notice = status.notice || {}
    const error = status.error?.message

    return h('div', { style: box },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { width: 9, height: 9, borderRadius: '50%', background: status.bound ? colors.success : colors.faint } }),
        h('strong', { style: { fontSize: 14 } }, status.bound ? 'ChatGPT 账号已登录' : '登录 ChatGPT 账号')
      ),
      h('p', { style: { margin: '8px 0 0', color: colors.muted, fontSize: 12, lineHeight: 1.55 } }, '使用 PI Agent 同款 OpenAI Codex OAuth。令牌只保存在 DSH 凭据库中。'),
      !status.available ? h('p', { style: { color: colors.error, fontSize: 12 } }, 'DSH 原生授权服务尚未就绪，请重启 web profile。') : null,
      !status.routeCompatible ? h('p', { style: { color: colors.error, fontSize: 12 } }, '当前 apiKeyEnv 会覆盖账号 OAuth，请先移除该字段。') : null,
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 } },
        !status.bound ? h('button', { style: primary, disabled: busy || status.inFlight || !status.available, onClick: () => act(() => rpc('start', { mode: 'browser' })) }, status.inFlight && status.mode === 'browser' ? '浏览器登录中…' : '浏览器登录') : null,
        !status.bound ? h('button', { style: secondary, disabled: busy || status.inFlight || !status.available, onClick: () => act(() => rpc('start', { mode: 'device_code' })) }, status.inFlight && status.mode === 'device_code' ? '设备码登录中…' : '设备码登录') : null,
        status.inFlight ? h('button', { style: danger, disabled: busy, onClick: () => act(() => rpc('cancel', {})) }, '取消登录') : null,
        status.bound ? h('button', { style: danger, disabled: busy || status.inFlight, onClick: () => { if (window.confirm('确定退出 ChatGPT 账号吗？')) act(() => rpc('logout', {})) } }, '退出账号') : null
      ),
      notice.message || error || notice.url || notice.code ? h('div', { style: { marginTop: 12, fontSize: 12 } },
        notice.message ? h('div', null, notice.message) : null,
        notice.url ? h('div', { style: { marginTop: 6 } }, h('a', { href: notice.url, target: '_blank', rel: 'noreferrer', style: { color: colors.link } }, '打开 OpenAI 授权页面')) : null,
        notice.code ? h('div', { style: { display: 'inline-block', marginTop: 7, padding: '7px 10px', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-2)', fontFamily: 'ui-monospace, monospace', fontSize: 20, letterSpacing: 3 } }, notice.code) : null,
        error ? h('div', { style: { marginTop: 6, color: colors.error } }, error) : null
      ) : null,
      status.prompt ? h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
        h('input', { value: answer, placeholder: status.prompt.placeholder || '粘贴授权码或回调地址', onChange: (event) => setAnswer(event.target.value), style: { flex: 1, minWidth: 0, height: 34, borderRadius: 8, border: `1px solid ${colors.border}`, padding: '0 10px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' } }),
        h('button', { style: primary, disabled: busy || !answer.trim(), onClick: () => act(async () => { await rpc('answer', { value: answer }); setAnswer('') }) }, '提交')
      ) : null,
      status.bound ? h(UsageView, { value: usage, loading: usageBusy, onRefresh: () => loadUsage(true) }) : null
    )
  }

  module.exports = {
    inject: ['slots'],
    async apply(ctx) {
      let slots = ctx.slots || ctx.get('slots')
      for (let i = 0; slots === undefined && i < 60; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 300))
        slots = ctx.slots || ctx.get('slots')
      }
      if (slots === undefined) return
      return slots.inject('settings.models.provider-card', () => slots.register({
        name: 'settings.models.provider-card',
        key: 'llm-pi-ai',
      }, ChatGptProviderPanel))
    },
  }

  return module.exports
} })
