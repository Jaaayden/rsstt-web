# PR 07 · 紧凑管理台、中英文与功能集成

## 实现

保留四个核心入口与原生 JavaScript。紧凑桌面侧栏、手机折叠导航、统一文字动作、设置左栏分类和右栏详情。会话列表用「管理订阅」「会话设置」区分导航与编辑；订阅行用文字标注暂停、恢复、编辑和取消。

主要能力：

- 简体中文／英文覆盖登录、四个页面、对话框、表单、提示、分页、错误类别和新增设置面板。语言持久化；系统／浅色／深色外观独立持久化。
- URL 保存目的地、搜索、状态、需检查、页码和设置分类；刷新恢复，侧栏「全部订阅」明确清除上下文。目的地选择器搜索时保留已经选择的项。
- 可见文字操作、键盘焦点、手机长名称与表格局部滚动、减少动态效果；手机仍保留设置左栏和右侧详情。
- 默认显示登录页，前端不再内置预览自动登录凭据。`account_type` 为浏览器管理员时显示账户安全，修改密码／退出全部会话后回到登录。
- 新能力按真实路由或数据字段启用：多目的地 append/replace、筛选与所选 OPML 导出、来源 UA；活跃目的地与小时／日统计；角色与 Bot 语言；运行配置、通知、备份与恢复。
- 不把历史未知计为零，不按负数 ID 猜频道类别；运行配置明确待重启，恢复明确预检／暂存／应用状态；离线通知标注模拟。

生产不需要 Node.js，不依赖外部字体/CDN或前端框架。Bot 原有多语言资源不变。

## 组件与国际化边界

- `static/app.js`：壳层、列表、分页、表单、对话框和业务编排；`featureSettings()` 管理运行配置／通知／备份面板；`trendChart()` 按可用性绘图，空心点表示部分时段，提供可展开数据表。
- `static/i18n.js`：`tr()`、`html` 静态模板标签、`count()` 复数、`message()` 参数化文本、主题／语言、API 错误 fallback。
- `static/messages.js`：集中英文界面文案，中文作为源键；修改静态文案时同步这里。新整句优先完整键，带数量使用 `count/message`，避免拼接产生语序问题。
- 静态模板翻译仅处理字面片段；插值（会话名称、订阅标题、网址、用户输入、服务端内容）保持原样。不得把整段动态 HTML 交给翻译器。参数先按原有 `esc()` 安全输出。
- 数字使用 Intl.NumberFormat，计数使用 Intl.PluralRules；记录时间包含年份和浏览器时区，统计查询按 UTC 桶对齐，小时图／明细转为本地时间；日图明确按 UTC 日聚合，日期标签和明细使用 UTC 日期。旧版日统计保留 UTC 标识。
- API 错误识别 PR1 的稳定大写 `code`，兼容无 code 时的 `http_<status>`。未知类别保留安全错误码与本地化通用提示，不回显未知服务端异常正文。

## 可选功能发现与后端契约

`GET /api/public` 保留 `demo/snapshot`，新增 `features` 布尔映射：

| 字段 | 依据已注册路径 |
| --- | --- |
| security | `/api/auth/account` |
| runtime | `/api/runtime-config` |
| notifications | `/api/notifications` |
| backups | `/api/backups` |
| recipients | `/api/feeds/{id}/recipients` |
| statistics | `/api/statistics` |

该字段只是功能存在性，不授予权限，也不暴露配置值。它在请求时读取 aiohttp 路由表，独立功能模块无需改注册方式。旧后端缺少字段时不显示未就绪的设置入口。`create_app` 参数不变。server.py 其余改动只为静态模块白名单增加 `i18n.js/messages.js`。

| 依赖 | UI 接入与语义 |
| --- | --- |
| PR1 | `/api/auth/account`、`/api/auth/sessions` GET/DELETE、`/api/auth/password` POST；密码变更后退出，机器授权保持有效；现有 tokens UI 保留 |
| PR2 | target 的 `role/role_protected/lang`；角色 PATCH 独立提交，保护 MANAGER，区分 Bot 管理员与网页登录权限；`runtime-config` 全量白名单表、逐项编辑、敏感值不回显、null 恢复部署值、待重启状态 |
| PR3 | 订阅 `feed_id`；GET/PUT recipients `{mode,targets}`，默认 append；replace 文案明确仅当前授权范围；GET/PATCH fetch-options，空值以 null 恢复全局；OPML 沿用完整筛选，可带选中 ids，忽略页码 |
| PR4 | `dashboard.usage` 触发统计接口；24 小时／7 天／30 天，UTC 对齐；known/active/unknown 分类；`unavailable` 保持空值、`partial` 空心点、不跨未知区间连线 |
| PR5 | notifications GET/PATCH、history GET、test POST；渠道凭据不回填；保存不发送测试，测试单独确认；返回 simulated 时明确只模拟；degraded 显示存储异常 |
| PR6 | backups GET、export POST、preflight POST、restore POST、pending DELETE；原始 JSON 文本往返、预检 SHA 确认；四个覆盖项默认 false，不可用组件禁用；提交后仅暂存，不重启、不声称已应用；重新登录可读成功／失败结果 |

Bark/Webhook 自定义 headers 仍通过 API 配置；UI 提供渠道 URL、Telegram token/chat_id、ntfy url/topic/token。未实现秘密字段的明文回显。角色权限、恢复完整性和授权范围最终由对应后端验证，界面隐藏不能代替后端权限检查。

## 集成顺序与冲突处理

功能分支的最小 app.js 页面会与本 PR 冲突；组合时以本 PR 的 app.js、app.css、语言模块为最终 UI，保留其它分支的后端模块／路由／生命周期，再跑组合验收。不可用某个后端时 UI 仍兼容基础版。

认证 PR 改了 demo 的初始化密码与环境变量，组合时保留认证 PR 的私有密码初始化；本 PR 的 `RSSTT_DEMO_PORT/RSSTT_DEMO_CONFIG` 仅用于独立验收。基础版 demo 固定密码只在测试 setup 中使用，前端已移除；不要用基础 demo 代替 PR1 的安全预览入口。

## 实际验证

- `.venv/bin/python -m pytest -q`：34 passed，1 条既有 uvloop 弃用提示。没有将其它 PR 的后端测试计入本分支结果。
- `npm run test:e2e`：16 passed。5 个既有流程（含真实本地 API 写入）＋中英文／持久化／分页／安全错误／手机长名称／对比度检查＋各新增功能 UI 契约测试。契约测试明确使用路由替身，不代表组合后端通过。
- `node --check src/management/static/app.js`、`git diff --check` 通过。资源由 aiohttp 静态白名单实际加载。
- 真实快照只复制 `db.sqlite3` 与 `metadata.json` 到本分支 Git 忽略的 `.preview/pr07-source`，再创建独立工作副本；没有读取／复制 bot.session。433 条订阅的只读浏览器验收：第二页刷新恢复，中英文切换，1440/820/390/320 宽度无页面横向溢出，脚本错误 0，历史显示不可用。原始主库与源副本逐字节一致。
- 合成数据截图已人工查看桌面、手机、深色、英文设置和统计图；截图及真实数据均不提交。

预览命令：`RSSTT_DEMO_PORT=8747 RSSTT_DEMO_CONFIG=.demo/pr07 .venv/bin/python -m src.management.demo`。Playwright 固定 8747，拒绝复用已有服务。不使用 8730/8731、不修改共享依赖。

## 尚待主会话完成的组合验收

PR1–6 实际后端尚未合入本工作分支；新增功能现阶段通过 UI 契约测试，必须在组合分支再跑真实 API 验证，特别是修改密码撤销会话、角色封禁、来源事务、小时持久化、通知队列与启动恢复。已有 PR 的模拟／离线结果不应称为真实 Telegram 或真实通知验证。

未合并、未部署、未操作线上服务、未发送真实消息。保留上游 AGPL 与原版 Bot 行为。


## 组合验收反馈修正

- 表格仅在实际横向溢出时显示轻量滚动提示；会话／订阅提示明确右侧管理操作，滚动区域可获得键盘焦点。ResizeObserver 在屏幕变化后更新，无溢出时隐藏。
- 最近操作只翻译已知动作码及动作限定的固定结果码：login/success、password_changed、sessions_revoked；其它详情（包括授权名等用户输入）保留原文。
- 新增四个真实后端浏览器用例：subscriptions、users-settings、notifications、backups。共用 support/live.js，从 WEB_PASSWORD 显式登录；仅当 public.features 缺少对应能力时明确 skip。要求离线演示且不是 snapshot，防止把写入测试用于真实数据副本。组合版能力齐全时四项都必须执行；未用路由 mock 代替。
- i18n 的导出断言按 recipients 能力选择完整筛选导出或旧版会话导出。既有 features.spec.js 仍为独立契约替身测试，不能混称为实连验证。
- 本次基础分支浏览器结果：18 passed、4 skipped；4 项均因对应后端未安装明确跳过。手机提示、已知审计码／用户输入隔离、UTC 日标签和按能力导出断言通过。四项实连结果等待组合版执行，不能将 skip 计为通过。
