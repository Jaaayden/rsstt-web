# PR 04：活跃使用量与小时统计

## 范围与定义

活跃目的地：至少有一个 `Sub.state=1 AND Feed.state=1` 的订阅，且 `User.state!=-1`。这是数据库当前配置下的使用量，不承诺 Telegram 当前可达或在线。已知会话数仍包含无订阅、暂停和封禁记录。私聊为正 ID；负 ID 仅在原表明确 `state=50/51` 时分类为频道/群组，其余独立计为 `unknown`，不按 ID 前缀猜测。被封禁后丢失类型的负 ID 同样保持 unknown。活跃订阅使用同一条件；旧 `counts.active` 保持仅订阅启用的旧定义。

新增内容和成功推送沿用基础版入口：来源保存新条目后计新内容；一篇内容完整发送到一个目的地后计成功。多消息拆分不重复计数，部分发送、取消和权限失败不计成功。没有改动抓取器、调度器或 Telegram 发送实现。

## Dashboard 契约

`GET /api/dashboard` 仍要求管理员权限，保留原字段，新增：

```json
{
  "usage": {
    "known": {"private": 8, "channel": 2, "group": 1, "unknown": 3, "total": 14},
    "active": {"private": 3, "channel": 1, "group": 0, "unknown": 1, "total": 5},
    "active_subscriptions": 18,
    "definition": "subscription.state=1 AND feed.state=1 AND user.state!=-1",
    "unknown_type": "未核验类型的群组/频道；不按 ID 推测具体类型"
  }
}
```

示例仅说明形状，不代表真实数据。旧 `counts.groups` 现在仅计明确群组，新增 `counts.unknown`；需要已知总数的客户端应使用 `usage.known.total`。旧 `statistics.totals/daily` 保留兼容，新的图表必须使用下面的接口以区分未知历史。

## 趋势 API

`GET /api/statistics?granularity=hour&start=2026-10-25T00:00:00Z&end=2026-10-26T00:00:00Z`

- 管理员权限，与 dashboard 相同。普通 read/write 连接令牌不可读取全局统计。
- `granularity=hour|day`，默认 hour。`start/end` 须带时区，接受 ISO 8601 偏移；转换 UTC 后必须对齐整小时/零点。区间为 `[start,end)`。
- 默认结束为当前桶的下一个边界，默认 24 个小时桶或 30 个日桶；单独提供 end 时向前取默认数量。
- 最多 744 个桶；错误粒度、无时区、未对齐、倒置、超限返回 HTTP 400。范围可以覆盖保留期外或未来，相关桶明确 unavailable。
- `timezone: "UTC"`、`start/end`、`recorded_since`、`retained_since` 均带 UTC 时区。客户端可本地化标签，但不得把 UTC 日桶说成本地日聚合。
- `totals: {fetched, delivered, failed}` 是独立累计；`totals_since` 标注统计开始时间，`history_before_recording: "unavailable"`，不声称覆盖原机器人全历史。
- `retention_days: {hour:31,day:90}`、`max_buckets:744`。
- `buckets: [{start,end,availability,fetched,delivered,failed}]`：覆盖完整已结束桶为 `available`；开始记录所在桶和当前未结束桶为 `partial`；开始前、保留期外、未来、原版离线快照为 `unavailable`。不可用桶三个值为 null，已记录空桶为 0。partial 数值仅覆盖已记录部分，不外推完整桶。
- 原版离线快照还返回 `available:false`、`totals` 全 null、`totals_since/recorded_since:null`；没有生成历史统计。

`available:true` 表示当前存储支持统计，不能替代逐桶 `availability`。计数表示本实例已确认并成功持久化的结果；停机时段、开始统计前的历史、写入失败或远端发送响应丢失不能还原。已有 `metrics_error` 继续揭示当前写入故障。

## 持久化与接入点

- 新模块 `src/management/statistics.py`：`usage()`、`query()`、`increment()`、`initialize()`，无新增第三方依赖。
- `Store.statistics_window(granularity='hour', start=None, end=None, unavailable=False)` 是公共查询包装；原 `Store.increment(..., day=None)` 保持兼容，新增可选 `at`（带时区 datetime 或字符串），供确定时间的测试/事件使用。day 与 at 不能同时指定。负数、非整数、未来时间被拒绝。
- 新 `metrics_hourly(bucket TEXT PRIMARY KEY, fetched, delivered, failed)`；沿用 `metrics(day PRIMARY KEY,...)`，其中 total 行永远不清理。主键为窗口查询、冲突更新及清理提供索引。
- `Store.open()` 自动建表及写入 `meta.hourly_started_at`；旧每日累计原样保留，不按每日数据拆造小时数。day-only 导入只影响每日和累计，不伪造小时分配。
- 每次增量在同一 `BEGIN IMMEDIATE` 事务内更新累计、日、小时并清理；失败/取消回滚。启动和趋势读取也清理，停止产生事件时访问趋势仍不会返回过期数据。小时最多当前及前 743 桶，日最多当前及前 89 桶；累计永不删除。
- 统计时间由服务器 UTC 决定。旧 `started_at` 沿用基础版统计启用时间，小时覆盖从升级时间开始。没有修改上游主库 schema 或 Aerich 迁移。
- 计数与 Telegram 远端发送不构成分布式事务；进程在发送成功、统计落盘前被强杀仍可能少计，不能保证跨系统 exactly-once。

## UI 接入与 PR 07

仪表盘新增活跃会话卡片，细分私聊/频道/群组/未核验类型，附已知总数和活跃定义。订阅卡片显示活跃订阅数。默认 24 小时趋势，可切换 7/14/30 天。请求并发读取 dashboard 与统计窗口；图表标签为浏览器时区，并同时标注 UTC 分桶；未知区段断开，当前/起始桶提示部分覆盖。累计继续显示独立 total。

PR 07 可保留 API 和语义并自由替换控件。没有新配置项、后台任务或需要接入的 shutdown 钩子；继续使用现有 Store 生命周期。服务器变动仅新增路由、usage 和 counts 分类；与角色分支集成时须保留 `User.state==-1` 封禁含义或同步更新谓词。

## 验证

- `.venv/bin/python -m pytest -q`：50 项通过（新增 16 项测试，含参数化）。仅有既有 uvloop 弃用警告。
- 覆盖 UTC 跨小时/天、偏移时间归一化、空桶、部分桶、未来未知桶、40 次并发一致性、双 SQLite 连接并发、事务取消回滚、取消发送不计成功、100 天保留边界、读取清理、重启、旧库总计保留且不补造小时、源停用/订阅暂停/封禁/未知类型、目的地去重、删除订阅不改累计、744 桶大小上限、错误参数和权限、事务失败全回滚。
- 原成功发送/部分失败计数回归测试保留运行；所有网络接口使用离线替身。
- 浏览器 6 项全部通过（首次沙箱内 Chromium 启动受 macOS 限制，获准在沙箱外运行后通过）；只在本工作目录 `.test-data/` 独立数据库和端口 8744 运行，未使用 8730/8731、真实快照或真实 Telegram。
- 原版快照 API 测试新增对 `/api/statistics` 全 null 的验证。

验收：打开独立离线预览，检查活跃/已知数，切换小时和日范围；通过合成库在开始记录前的窗口检查 unknown，升级仅有每日/total 的合成旧库确认小时不回填；删除订阅及清理趋势后核对累计不变。浏览器测试覆盖小时控件、日切换与 API 桶数。生产无需 Node.js。未部署、未执行真实 Telegram 验证。
