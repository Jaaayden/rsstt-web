# PR 01：管理台认证与 Agent 接入

## 接入契约

- `create_app(store, password, origin, gateway=None, demo=False, snapshot=None)` 保持调用兼容。
- 新增独立 `console_admin` 表，仅存单个 Web 管理员的名称、随机 salt、scrypt 哈希；不存入 `meta`，不通过 `/api/settings` 泄露。生产账户名称为 `admin`，新建预览库为 `preview-admin`。这不是 Telegram `MANAGER`，不影响机器人管理员角色。
- `WEB_PASSWORD` 仅在表为空时初始化，要求 16–512 字符；已有账户以数据库为准，改变环境变量不会覆盖已修改密码。无已存凭据且未设置有效初始密码时启动失败，绝不开无认证服务。迁移旧实例时现有 `WEB_PASSWORD` 自动初始化一次。
- `GET /api/public` 保留 `demo/snapshot` 用于标注环境；二者均不授权，不返回密码，不启用自动登录。
- `POST /api/login` 保留 `{password}`，可选 `username`；成功返回 `{ok:true}`，8 小时 HttpOnly/SameSite=Strict Cookie；HTTPS 设置 Secure。预览 Cookie 为 `rsstt_session_<port>`，生产沿用 `rsstt_session`。
- `GET /api/session` 保留 `name/permission/targets/demo`；新增 `account_type`（`console_admin/preview_admin/agent`）、`expires_at`（Unix 秒）、`capabilities`。
- `GET /api/auth/account` → `{username,account_type}`；只允许浏览器管理员。
- `POST /api/auth/password` → `{current_password,new_password}`；成功后原子更新密码哈希并撤销全部浏览器会话，返回 `{ok:true}`。Agent 令牌保持有效。
- `GET /api/auth/sessions` → `{items:[{id,name,created_at,expires_at}]}`；`DELETE /api/auth/sessions` 撤销全部网页登录会话（包括当前会话）。两者仅管理员。
- 每个地址 5 分钟最多 10 次失败登录尝试，内存最多保留 1024 个地址；并发 scrypt 最多 2 个。重启清空限速状态并撤销浏览器会话，连接令牌继续有效。反向代理按 socket 对端限速，不信任可伪造的 X-Forwarded-For。

## Agent 权限扩展：其他 PR 必须遵守

入口在 `src/management/agent_contract.py` 的 `AGENT_ROUTES` / `authorize_agent`。新路由默认不允许 Agent，即使持有 write 令牌。原 `read/write` 字段和按会话 `targets` 范围保持兼容；当前 capability 只有 `subscriptions:read`、`subscriptions:write`。写令牌包括读取能力，不包含角色、设置、密钥、备份、创建令牌、登记或退出会话的能力。

其他 PR 若需要新增 Agent 可访问路由，必须显式登记 `(HTTP method, aiohttp resource canonical path) -> capability`，并在 handler 内核对所有涉及会话。`admin(request)` 同时检查 `kind=session` 和 `permission=admin`，不能单靠 permission 字段授权。管理能力未来须另设独立显式范围和签发流程，不能把任意新管理接口放进现有 write 范围。

`GET /api/openapi.json` 是需认证的 OpenAPI 3.1 机器契约，列出现有 Agent 路由、能力和输入。`/api/session` 可探测令牌范围及到期时间。令牌签发、过期、撤销继续使用原有 `/api/tokens`，原始密钥只在创建时展示一次，数据库只存 SHA-256。

所有 API 错误保留可读 `error` 并新增稳定 `code`：`INVALID_REQUEST`、`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`UNSUPPORTED_MEDIA_TYPE`、`RATE_LIMITED`、`PAYLOAD_TOO_LARGE`、`INVALID_ROUTE`、`REQUEST_FAILED`、`INTERNAL_ERROR`。这些是错误类别，客户端不解析中文文本。Agent 已认证请求（含拒绝）记录令牌 ID、方法、路由模板和状态码，不记录原始密钥或请求正文；沿用最近 200 条管理审计保留策略。

## UI 接入

现有登录页保留密码表单，默认显示；没有公开固定密码或自动登录开关。设置新增「账户安全」用于修改密码、撤销全部会话；「连接授权」继续签发/撤销令牌。PR7 可重做界面，调用上述路由即可；修改密码成功后清空前端 session 并显示登录页。

## 本地启动（主会话可直接使用）

在本 PR 工作目录运行，zsh 下输入私有密码，不会出现在 shell 历史或命令参数：

```zsh
read -rs 'WEB_PASSWORD?设置预览管理员密码（至少 16 字符）：'; echo
export WEB_PASSWORD
WEB_PORT=8741 WEB_DEMO_CONFIG="$PWD/.preview/auth-demo" .venv/bin/python -m src.management.demo
unset WEB_PASSWORD
```

打开 `http://127.0.0.1:8741`，用刚设置的密码登录。目录首次初始化后可不再提供 WEB_PASSWORD；账户持久化在该目录 console.sqlite3。真实快照预览沿用 `preview --snapshot ... --config ... --port 8741`，首次启动同样从环境变量初始化密码。不要在不同预览进程共享数据库。

## Agent CLI

只依赖 Python 标准库，生产无需 Node.js。不提供 stdio MCP；API 与 CLI 为当前接入范围。

```zsh
export RSSTT_URL=http://127.0.0.1:8741
# 将网页创建的密钥保存到私有文件；不要把密钥写在命令行。
umask 077
read -rs 'agent_secret?输入连接密钥：'; echo
printf '%s' "$agent_secret" > .preview/agent-token
unset agent_secret
.venv/bin/python -m src.management.agent_cli --token-file .preview/agent-token /api/session
.venv/bin/python -m src.management.agent_cli --token-file .preview/agent-token '/api/subscriptions?target=-1001'
printf '%s' '{"state":0}' > .preview/change.json
.venv/bin/python -m src.management.agent_cli --token-file .preview/agent-token --method PATCH --data .preview/change.json /api/subscriptions/1
# 上一条只打印本地 dry-run 计划，不请求服务器、不宣称服务器已验证。
# 加 --apply 才写入；DELETE 或 batch delete 还必须加 --confirm-delete。
```

凭据还可走 `RSSTT_TOKEN` 或 `--token-stdin`；文件必须由当前用户拥有且权限为 0600。不接受裸 token 参数。CLI 禁止远端明文 HTTP、禁用代理和重定向避免泄露凭据，返回非零退出码表示失败。dry-run 是本地计划，实际业务验证、范围检查和可能的网络读取只发生在 `--apply` 时。API 保留原有写入语义，不自动要求 CLI 参数。

## 验收与限制

后端使用独立临时数据库与拒绝外连的替身；浏览器测试使用随机私有密码、独立 `.test-data/browser-*` 库和 8741 端口，不复用 8730/8731。没有操作真实 Telegram、线上服务或真实快照。

实际验证：

- `.venv/bin/python -m pytest -q`：39 passed，仅既有 uvloop deprecation warning。
- `npm run test:e2e`：原有 5 项浏览器流程全部通过；新增账户安全测试首次因重复切换当前栏目造成测试表单重绘竞态失败，消除重复导航后以 `npm run test:e2e -- --grep 'account security'` 单独验证通过。
- `python -m compileall -q src/management`、`node --check src/management/static/app.js`、`git diff --check` 通过。
- 首轮 Chromium 被 macOS 沙箱 IPC 限制阻止启动，后续已使用批准的非沙箱浏览器测试；未改变测试对象或连接真实服务。

账户为单管理员设计；没有用户名管理/多管理员登录、密码找回服务、跨进程登录限速或长期不可篡改审计。部署时需保护管理库文件与备份；备份 PR 应将 `console_admin` 视为认证凭据，默认恢复时保留当前表，不向 Agent 导出。


## 备份分支的数据恢复钩子

`src.management.auth.AUTH_TABLES = frozenset({'console_admin', 'credentials'})` 提供认证表边界，供备份导出脱敏/默认恢复保留使用。`await src.management.auth.revoke_browser_sessions(store)` 可在恢复事务完成后撤销所有浏览器会话；不要在持有 `store.lock` 时调用（内部取得该锁）。认证表不包含 Telegram Token 或 session 文件，不能因此把机器人 session 纳入导出。

默认恢复：保留当前两张认证表，再调用撤销函数；现有 Agent 令牌仍受原范围和有效期约束。显式覆盖认证：仅允许已验证的浏览器管理员，恢复后必须重启 Web 应用再接受登录，因为当前进程持有管理员 scrypt 哈希。`create_app` 重建时读取持久化哈希并清除浏览器会话。没有提供可把凭据直接返回给 Agent 的导出接口，也没有默认管理 capability。

## 并行 PR 的待接入路由（草案，尚未在本 PR 实现）

| 路由 | 预期权限与约束 | 本 PR 当前行为 |
| --- | --- | --- |
| `GET /api/feeds/{id}/recipients` | `subscriptions:read`，仅显示授权范围内关系 | Agent 默认拒绝，待 PR3 实现及范围验收后登记 |
| `PUT /api/feeds/{id}/recipients` | `subscriptions:write`，append/replace，范围外关系必须保留 | Agent 默认拒绝，待 PR3 实现及范围验收后登记 |
| `GET /api/subscriptions/opml` | `subscriptions:read`，导出仅限授权范围 | Agent 默认拒绝，待 PR3 实现后登记 |
| `GET/PATCH /api/feeds/{id}/fetch-options` | 浏览器管理员；共享来源 UA 会影响多个接收者 | 不加入订阅 write 范围 |
| `GET /api/statistics` | 浏览器管理员；hour/day、start/end | 不加入订阅读取范围 |
| `POST /api/backups/export`、`/preflight`、`/restore` | 浏览器管理员；若未来开放机器管理，必须独立显式 capability | 所有当前机器令牌拒绝 |

注册 PR3 路由时更新 `AGENT_ROUTES` 和 `openapi()` 的输入/响应定义，`PUT` 与 `PATCH` 同为写入，不能只判断 POST。后端 handler 仍需在任何修改前一次验证完整会话选择；路由级 capability 无法替代对象级范围检查。以上草案不会出现在已实现路由的 OpenAPI paths 中，避免机器客户端误认为已经可调用。
