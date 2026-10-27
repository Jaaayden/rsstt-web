# PR 03：订阅筛选、接收会话、OPML 与来源 UA

本 PR 基于 `845ef62`，目标分支 `feat/web-console`。保留原版数据库迁移、AGPL、Bot 命令和共享 Feed 模型。不连接真实 Telegram、不运行生产监控；测试使用合成数据和替身。

## API 契约

原有订阅 JSON 增加 `feed_id`，其余字段保持兼容。

| 方法 | 路由 | 参数 / 返回 |
| --- | --- | --- |
| GET | `/api/feeds/{id}/recipients` | 返回 `{feed_id,scope,items}`；items 为授权范围内订阅，scope 为 `all` 或 `authorized_targets` |
| PUT | `/api/feeds/{id}/recipients` | `{mode:"append"或"replace",targets:["会话ID",…]}`；返回同 GET |
| GET | `/api/subscriptions/opml` | `target,q,state,attention` 同列表；可加 `ids=1,2`，返回 XML 下载 |
| GET/PATCH | `/api/feeds/{id}/fetch-options` | 管理员专用；PATCH `{user_agent:"Reader/1"}`，返回 `{feed_id,user_agent,inherits_global}` |

`append` 仅增加缺失关系；`replace` 把**授权范围内**接收者替换为所选集合，范围外关系不变。空集合允许清空授权范围内关系。最多提交 100 个目的地，重复 ID 去重；未知目标、越权、禁用、权限检查失败、订阅上限都在删除前拒绝。源必须至少有一个当前授权可见的订阅。只读令牌不能写；共享 UA 仅管理员可读写，避免 scoped write 影响其他会话。

新增接收者复用同一 Feed，继承各自会话默认推送设置。保留关系的 ID、标题、标签、格式、间隔、暂停状态都不修改。所有外部权限检查在数据库事务之前完成；事务内锁来源及按 ID 排序的目标行，再核验封禁、上限、增删关系和重算来源间隔。SQLite 使用自身事务序列化。`inner.utils.update_interval(..., update_tasks=False)` 新增可选参数只更新持久状态；默认 True 保留上游调用行为。仅在事务成功提交之后同步发布内存 EffectiveTasks，失败回滚并重新计算调度。无接收者时沿用原版删除 Feed 行行为。

OPML 导出覆盖整个筛选结果（忽略分页），所选 ID 上限 100，逐一核验范围，跨范围 ID 整体拒绝。`ids` 与其他筛选取交集。共享来源去重，使用按订阅 ID 排序后的首个匹配关系标题；不会把目的地或其他会话设置编码进 OPML。

## UA 存储与生命周期

新增独立管理表 `feed_fetch_options(url PRIMARY KEY,user_agent)`，不改原版 schema 或 Aerich 迁移。UA 只接受最多 512 个可打印 ASCII 字符，拒绝 CR/LF、控制字符和非字符串；null、空字符串或空白恢复继承。

`management.feed_options.headers(url)` 返回自定义 UA 请求头或空字典。`server.start()` 在管理服务启动成功后绑定 Store，`stop()` 先解绑再关闭连接。监控器在 `web.feed_get` 前合并该头，上游请求层继续继承其余默认 headers。每次抓取查询，没有缓存，保存后下一次抓取生效；无覆盖时使用 `env.USER_AGENT`。同一来源多个接收会话仍只有一次来源抓取。Web 关闭时该可选入口返回空字典，保持原版行为。

UA 按 URL 持久化，因此删除后再次订阅相同 URL 会保留覆盖值；来源迁移为不同 URL 时新 URL 默认继承全局配置。没有自动迁移旧 URL 的 UA。此设置供监控抓取使用，不改变首次添加未知 RSS 的探测请求。

## UI 接入点

- `#subscriptions?target=...&q=...&state=...&attention=1&page=...` 可复制、刷新恢复；从会话列表进入显式携带 target，侧栏“全部订阅”重置为无筛选。
- 全部订阅提供“选择会话筛选”和当前目的地提示；空结果仍显示 ID，避免丢失过滤条件。
- 每行“接收会话”打开多选：`append` 与授权范围 `replace` 文字明确；保留搜索前已选择的目的地。
- 每行“来源 UA”编辑共享 UA；筛选结果与选中项各有 OPML 下载入口。
- PR7 可直接复用以上 API，现有页面仅提供最小接入，无需新增生产 Node.js 依赖。

## 验收与证据

- `.venv/bin/python -m pytest -q`：49 项通过（1 条既有 uvloop 弃用警告）。新增覆盖共享来源/重复接收者、保留原设置、最短有效间隔、scoped replace、只读/越权、上限/封禁/退出/权限失败、事务失败恢复、提交后发布调度、OPML 范围/去重、UA 验证和监控实际传参。
- `node --check src/management/static/app.js` 与 `git diff --check`。
- `npx playwright test --config playwright.pr03.config.js`：6 项浏览器检查（原有 5 项与新订阅流程）。独立端口 8743；`.test-data/pr03` 合成数据库。第一次沙箱运行 Chromium 因 macOS MachPort 权限失败，获执行权限后 6 项通过。
- 演示新增可选环境变量 `RSSTT_DEMO_PORT`、`RSSTT_DEMO_CONFIG`，默认仍为 8730 和 `.demo`；生产入口不依赖这些变量。

手动复验：从任一会话点击查看订阅，刷新并检查 URL；搜索目标后追加另一会话，再替换集合；检查旧关系设置不变，筛选/选择导出 XML 仅包含目标源；保存和清空 UA 后回读。离线预览不能验证 Telegram 当前权限或真实网络投递。

现有 Web mutation 锁仅序列化同进程 Web 写入；Telegram 原版命令不参与这个锁，其并发限制仍沿用上游检查和唯一约束。本 PR 没有对全项目引入跨入口锁，也未执行 PostgreSQL 或真实 Telegram 验收。没有其他功能 PR 依赖；只依赖基础管理台。
