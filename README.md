# dsh-chatgpt-oauth

在 [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) 的 Web 模型设置中登录 ChatGPT 账号，并查看 OpenAI Codex 用量。

> 非 OpenAI 或 DeepSeek 官方插件。使用的是 ChatGPT 账号的 Codex OAuth 授权，不是 OpenAI API Key；可用模型及限额由你的账号和服务端决定。

## 功能

- 在“设置 → 模型 → ChatGPT（openai-codex）”详情卡片中进行浏览器或设备码登录，无额外设置标签。
- 浏览器 OAuth 使用 PKCE 与本机 `localhost:1455/auth/callback` 回调；回调成功页使用 DSH 文案。
- OAuth grant 存入 DSH 凭据记录 `llm-pi-ai/openai-codex`，过期时在服务端串行刷新。
- 参考 pi-web 的解析方式，从 ChatGPT 用量接口展示 5 小时、每周及附加限额、重置时间和 Credits。
- 页面只接收登录状态和解析后的用量，不接收 access/refresh token。

## 安装

要求：Node.js 22.19+、已安装 DSH，并使用带“模型设置”页面的 `web` profile。本插件在 DSH `0.1.6-alpha.2` 上验证过。

目前可从 GitHub Release 安装：

```sh
dsh plugin --profile web add -w 'github:zhangnan/dsh-chatgpt-oauth#v0.1.0'
```

安装后重启 `dsh web`，打开“设置 → 模型 → ChatGPT”。此包是 DSH Profile Bundle：安装时自动添加 `authorization` 服务与本插件，无需手工修改 `cordis.patch.yml`。

如果 profile 中已有手工添加的 `authorization` 或 `dsh-chatgpt-oauth` 条目，先移除旧条目再安装，避免重复挂载；已保存的账号凭据不需要删除。

## 使用

1. 打开 DSH Web 的“设置 → 模型”，找到 ChatGPT（`openai-codex`）卡片。
2. 点击“浏览器登录”，在 OpenAI 页面完成授权；本机回调端口需可用。无法使用回调时，可在卡片中粘贴授权码或完整回调地址。无浏览器环境可选“设备码登录”。
3. 登录完成后，卡片会读取用量；点击“刷新”可手动重新查询。退出账号只删除本插件使用的 DSH 凭据记录。

如果账号授权成功但模型不可用，先检查 `openai-codex` 路由是否配置了 `apiKeyEnv`：该字段会覆盖账号 OAuth 凭据，需要移除。端口 1455 已被其他应用占用时，关闭其他登录流程后重试。

## 安全与限制

用量由插件服务端请求 `https://chatgpt.com/backend-api/wham/usage`，访问令牌不会返回给浏览器。用量接口或字段可能变化；查询失败不会影响已保存的登录凭据。插件不会替你购买订阅，也不能绕过账号权限或配额。

本插件复用了 PI Agent/pi-ai 的授权格式和 DSH 原生凭据服务；设备码登录交给 DSH 的授权 flow，浏览器登录由插件提供回调页。请只在你信任的本机 DSH 服务上使用，并勿把 DSH 凭据文件或授权回调 URL 提交到公开仓库。

## 开发

```sh
npm test
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```

源码入口：`lib/index.js`（服务端登录、凭据和用量接口），`lib/client.js`（模型卡片 UI），`cordis.patch.yml`（Bundle 自动挂载）。

## License

MIT
