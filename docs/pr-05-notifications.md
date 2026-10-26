# PR 05：管理员通知

本 PR 以 `feat/web-console` 为 base。参考 FeedLantern `src/server/notify.ts` 的渠道划分、配置摘要和发送隔离；不读取其私有配置，不修改 FeedLantern。保留上游 AGPL 与机器人行为，生产无新增 Node.js 依赖。

## 接入契约

独立模块 `src.management.notifications`：

- `await fetch_result(feed_id, error_count)`：实际监控器保存抓取结果后调用，覆盖失败、成功和 HTTP 304。不会发送网络请求，不占用 PR4 的统计语义。
- `await user_seen(user_id)`：Bot 命令通过用户与会话权限检查、开始执行时调用；订阅内层业务创建订阅后也调用。ID 持久化去重。
- `Notifications(store, offline=False, sender=None)`：可注入替身发送器。`open()` 建表，`baseline()` 登记已有用户，`start()/close()` 管理唯一 worker，`drain_once()` 供确定性测试使用。
- `active` 仅在真实管理服务启动并完成用户基线后赋值；停止服务先清空。`WEB_ENABLED=0` 不启用服务、worker 或事件写入；Bot 原始抓取/命令逻辑继续运行。
- `create_app` 参数保持兼容。aiohttp startup/cleanup 管理 worker；demo 或 snapshot 强制 `offline=True`，业务钩子不启用，显式测试也仅生成 `simulated` 历史。

所有接口沿用现有同源校验与管理员权限。普通 read/write 连接授权均不可用：

| 方法 | 路由 | 请求/返回 |
| --- | --- | --- |
| GET | `/api/notifications` | `{policy, channels, offline, degraded}`；每个渠道仅 `{enabled, configured}` |
| PATCH | `/api/notifications` | 局部更新 `{policy?, channels?}`，返回同上；保存不发送测试 |
| GET | `/api/notifications/history` | `{items:[{id,channel,event,subject,status,attempts,due,created}]}`，倒序最多 200 条 |
| POST | `/api/notifications/test` | `{channel:"bark"|"telegram"|"webhook"|"ntfy"}`，返回 `{ok,simulated,message}`；仅显式调用入队 |

策略：`enabled` 默认 false，`threshold` 默认 3（1–100），`cooldown` 默认 3600 秒（1–604800），`new_users` 默认 true。通知阈值独立于管理台 `attention_threshold`，不会改变原版退避和自动停用策略。

渠道字段（均需 `enabled`）：

- Bark：`url`（完整推送地址），可选 `headers`；POST JSON `{title,body}`，检查响应 code=200。
- Telegram：独立 `token`、`chat_id`；Bot API sendMessage，检查 ok=true。不会自动读取原机器人 Token。
- Webhook：`url`、可选 `headers` 对象；POST JSON `{event,title,body,event_id}`。接收端可按稳定 `event_id` 去重。
- ntfy：`url`（服务发布入口）、`topic`、可选 `token`；POST JSON，Token 置于 Authorization Bearer。

渠道局部更新时省略字段保留原值；`channels: {webhook: null}` 删除该渠道。禁用/删除的渠道剩余任务取消，历史保留。待发送任务使用发送时最新配置。URL、Token、headers 从不通过读取接口返回；清空 ntfy Token 使用 `token:""`。

## 事件规则和持久化

“首次出现”指启用此功能后第一次经 Bot 命令通过用户与会话权限检查、开始执行，或者此前尚未登记的目的地第一次创建订阅。被权限检查拒绝的命令不会触发通知；若同一次运行中随后获得权限，首次允许执行时仍可触发。发送者和频道/群组是独立 ID，可能各有一条通知，不推测频道和群组类型。

每次服务启动只把所有已有 User 登记为基线，绝不启动补发。已出现 ID 即使取消全部订阅、暂停、重新活跃或删除后再出现，也不重复发送首次通知；跨重启保留此规则。

连续失败达到阈值时锁存一次，后续失败不重复。成功/304 清除锁存；冷却结束后下一轮达到阈值可再次通知。若一轮在冷却期内达到阈值，该轮整体抑制，不在冷却到期后迟发。首次观测已经高于阈值的来源可发一次通知。关闭策略时仍维护去重状态，重新启用不补发关闭期间事件。保存新渠道只保存配置，不产生测试或历史事件补发。

新增 `notify_config`、`notify_seen`、`notify_jobs` 三张管理表，不改上游数据库。事件状态和队列写入在同一 SQLite 事务提交。一个 worker 串行发送，每次最长 10 秒，失败最多 3 次，重试间隔 30/60 秒；重启继续待处理任务。队列和历史合计只保留最新 200 条，超载丢弃最老任务（包括未发送任务），不会无限增长。`notify_seen` 每个来源/用户一条小状态记录；首次用户标记永久保留以维持幂等。

业务钩子仅等待本地短事务，不等待网络；存储异常被隔离并通过 `degraded` 暴露，不记录可能带敏感地址的异常。进程恰好在远端接受而本地状态未提交时退出，可能重发；不声称跨网络 exactly-once，Webhook 可用 event_id 二次去重。

主库及现有 WAL/SHM 设为 0600，后续 SQLite sidecar 继承主库权限。凭据存放在受控管理库中，未做应用层加密；备份管理库等同备份凭据，应按私密配置保护。消息只含事件类别与对象 ID，不带源站 URL、错误原文、标题或凭据。发送禁用重定向，设置响应上限/超时，不把响应正文或网络异常写入历史/日志。渠道地址由可信管理员显式配置，支持自建内网服务。

## UI 接入与验收

设置左侧新增“管理员通知”：策略表单、四种渠道配置、启用状态、单独测试按钮及最近历史。凭据输入框不回填；Webhook 自定义 headers 可通过 API 配置。UI PR 可复用上述接口，`offline` 为 true 时测试必须标明“模拟”。历史状态为 pending/sent/failed/simulated/cancelled。

独立预览端口 8745；不使用 8730/8731。`DEMO_PORT` 新增可选环境变量，默认仍为 8730，测试数据在本工作目录 `.demo/`，没有复制真实快照或 bot.session。

```sh
.venv/bin/python -m pytest -q
node --check src/management/static/app.js
npx playwright test -c playwright.notifications.config.cjs
```

后端测试覆盖真实 monitor 失败/304 恢复路径、真实订阅内层首次事件、已有用户基线、并发去重/冷却、重启持久化、最多三次重试、200 条上限、存储失败不阻断、权限与脱敏、离线禁止发送器调用，以及四渠道替身请求。浏览器测试检查保存策略/渠道不回显凭据和显式模拟测试。

本 PR 不部署、不合并、不发送真实通知，不代表真实 Telegram/Bark/ntfy 服务验收。无其他功能 PR 前置依赖，集成时保留 PR1 的管理员权限强化和 PR7 的设置 UI 入口。

## 本次验证结果

- `.venv/bin/python -m pytest -q`：51 passed；只有既有 uvloop.install 弃用警告。
- `node --check src/management/static/app.js` 与 `git diff --check`：通过。
- `npx playwright test -c playwright.notifications.config.cjs`：1 passed，使用本目录示例数据库和 8745 端口。首次 Chromium 启动受 macOS 沙箱限制，授权后启动成功；测试补充等待保存后的表单替换后通过。
- 额外覆盖发送中关闭 worker 后任务可恢复、事件入队异常时事务回滚不消耗阈值，以及真实 Bot gatekeeper 拒绝命令不通知、允许命令首次通知与重复去重。
- 所有通知请求均为替身或离线模拟；未运行真实 Telegram 或其他渠道发送，未做部署验收。
