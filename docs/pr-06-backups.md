# PR 06：网页备份与受控启动恢复

## 交付范围

SQLite 主订阅库和独立管理库使用逻辑 JSON 备份。网页完成下载、预检、选择覆盖范围与提交；提交只生成待恢复任务，**正常重启时自动应用**，无需手工维护命令。恢复不会触发重启、真实 Telegram 登录或通知发送。维护 CLI 另保留给停机操作。

备份包含 user/feed/sub/option 全字段，以及 targets、meta 白名单、metrics、activity；包含条目哈希、抓取失败状态、订阅推送设置，不重新抓取 RSS。默认不包含账号密码哈希、Agent 令牌、通知渠道密钥。部署环境、主机器人 Token 和 Telethon session 永远不读取、不复制、不导出。网页登录会话永不进入逻辑包，恢复时同时撤销目标现有浏览器会话。

包中会话、RSS 地址和操作记录可能是私密数据；不加密，管理员须保护下载文件。SHA256 用于完整性检测，不是签名或来源认证。只接受可信管理员选择的备份。

## API 与 UI 接入

全部路由只允许 `kind=session, permission=admin`；Agent 即使携带 admin 字段也拒绝。沿用同源校验和现有错误边界（PR1 集成后有稳定 code）。不修改 create_app 位置参数。

| 方法 | 路由 | 输入／结果 |
| --- | --- | --- |
| GET | `/api/backups` | `{format_version,max_bytes,sqlite,mode,components,restore,never_included}`；mode=`apply_on_restart`；components 仅列目标实际存在的组件 |
| POST | `/api/backups/export` | JSON 布尔选项；返回下载 `rsstt-backup.json` |
| POST | `/api/backups/preflight` | 原始 JSON 备份作为 body；覆盖选项使用 query；返回 SHA256、时间、各表行数、included、overwrite、认证策略 |
| POST | `/api/backups/restore` | 同一备份和 query，增加 `X-Backup-SHA256` 为预检返回值；再次完整预检，返回 202、`status=pending_restart,applied=false` |
| DELETE | `/api/backups/pending` | 取消尚未开始的任务；不回滚已经完成的恢复 |

四个显式布尔选项：`agent_tokens`、`admin_credentials`、`runtime_config`、`notification_secrets`。导出需明确选择包含，恢复需再次明确选择覆盖；默认全部 false。未选择的目标凭据保留。字段值必须是真实布尔值；query 必须是 `true/false`，未知键拒绝。未安装对应组件时，UI 禁用选项，API 拒绝启用。

设置新增“备份与恢复”最小 UI。先下载或选择 JSON 文件，再预检显示时间与行数，最后确认提交；明确提示待重启。状态为 none/pending_restart/applying/succeeded/failed，恢复后重新登录读取结果。应用阶段 HTTP 服务尚未启动，因此 UI 不假装能持续轮询离线进程。

只保留一个 `.restore-pending.json`，再次提交拒绝；取消后可重新提交。文件含原包文本、原始 SHA256 和覆盖选项，0600，写入并 fsync。成功后删除，失败后移动到 `.restore-failed.json`（新失败替换上一次失败包）。`.restore-result.json` 保存结果。所有路径固定且来自目标配置目录，不接受上传文件名作为路径。

## 格式、边界与预检

版本 1：`{manifest:{format:"rsstt-logical-backup",version:1,database:"sqlite",created_at,included,extensions,sha256,excluded,consistency},data:{"main.user":{columns,rows},...}}`。

- SHA256 覆盖规范化 data；恢复确认另计算原文件 SHA256。
- 上限 32 MiB、单表 100000 行、最多 128 列；无压缩包、无解压路径、无上传 SQL。
- 重复 JSON key、未知组件、未知版本、坏 checksum、错误类型、路径穿越式组件名、超限文件拒绝。
- 上传表名必须在代码白名单，列与目标表结构完全相同；不执行上传的 DDL。二进制密码哈希仅允许 `{blob:base64}` 编码，校验管理员 salt/hash 长度。
- 完整预检复制目标两库到私有临时目录，在副本上实际执行全部提供组件的恢复、唯一约束与外键检查、quick_check。即使本次不覆盖某敏感组件，该组件也要通过检查。
- 未知扩展不会静默恢复；schema 不匹配应先使用相同应用版本。校验是结构、约束与格式校验，不声称校验远端 RSS、Telegram 账号或通知端点。
- 备份导出使用同一 SQLite 连接 ATTACH 管理库后 BEGIN IMMEDIATE，在读取期间阻塞两库写者并保持一致数据库视图；读者可继续。文件配置通过 PR2 原子文件接口读取，属于独立配置快照。

## 恢复生命周期与原子性

`early_startup(database_url, config_dir)` 在 `.env` 加载后、PR2 `load_startup` **之前**执行。早于 env 派生代理／客户端、ORM、调度和 Telegram 登录。仅存在待恢复或恢复日志时进入维护流程；取得主库独占维护锁，主库锁延续到 db.close。

`db.init()` 复用该锁，普通启动也取得主库锁；`Store.open()/close()` 持有管理库锁。恢复 CLI 要同时取得两锁，否则拒绝。原版旧程序不认识新锁，部署者必须先停止旧版本和其他直接访问数据库的工具；这不是跨主机分布式锁。

顺序：恢复中断日志（如有）→ 校验待恢复任务 → 完整副本预检 → 将两库切换 DELETE/FULL 日志 → 使用 SQLite backup API 生成 `rollback-*` 私有目录 → 写入 fsync 的恢复日志 → 同一 ATTACH 事务替换选定行 → 可选运行配置 save → 删除恢复日志 → 写成功状态 → 正常启动，重新创建连接、加载 EffectiveOptions、初始化 EffectiveTasks。

不替换运行中的 SQLite 文件，也不留下旧 ORM 连接。DELETE journal 是 SQLite 跨 ATTACH 数据库原子提交的必要条件；WAL 不能提供这一点。业务启动可按原有配置重新启用 WAL。

文件配置不可能参与 SQLite 事务，因此 `.restore-recovery.json` 与恢复前的两库、原始运行配置共同组成持久回退记录。SQL或配置保存失败会用 SQLite backup API 回退两库与文件；若进程中断，下一次 env 初始化先回退，再处理待恢复任务。未完成回退禁止继续启动。回退目录包含目标当时完整认证资料，只保留本机 0700/0600，不提供网页下载。

正常异常会保留失败包并中止本次启动；第二次启动可使用原库。若数据库已提交而结果文件写入失败，结果中的 applied 不会伪称 false；启动仍中止，需要查看本地结果／恢复日志。成功状态只在数据库和选定配置完成后写入。

## 与其它 PR 的组件契约

`backups.COMPONENTS` 是可信代码注册表（不是用户输入）：普通 data 表默认包含；敏感组在导出和恢复各自 opt-in。`EXTENSION_DATA` 为存在才纳入 manifest 的可选非敏感表白名单；`META_KEYS` 为可导出管理键白名单。新增扩展需声明敏感边界和测试，不能把任意 sqlite_master 表全部打包。

- PR1：`console_admin` 在 `admin_credentials` 组，默认原样保留。按真实 schema 测试 username、16 字节 salt、64 字节 scrypt hash 的往返；不把它混到 meta。credentials 仅导出 kind=token；覆盖只替换令牌，永不导入 session。恢复在创建 Auth 之前完成，所以不会沿用旧内存哈希。
- PR2：`backup_runtime.py` 可选导入 `src.runtime_config`，使用 `safe_export()`、`validate()`、`SECRETS`、`save()`。只有非敏感配置；原部署密钥和目标配置中未指定的值保持原样。runtime_config 默认为不包含／不覆盖，UI 明确选择。**集成 env.py 时须保证 early_startup 在 load_startup 之前**，db.init 仅持锁并拒绝初始化期间新出现的任务，不能在那里晚恢复运行配置。此 PR 不复制 PR2 模块、不混入其它 PR 提交。
- PR3：可选 `feed_fetch_options` 表，保留来源 UA。
- PR4：可选 `metrics_hourly` 和 `hourly_started_at`，与累计、日计数同包。
- PR5：可选 `notify_seen`；`notify_config` 属 `notification_secrets`，勾选意味着包含并覆盖整个通知渠道配置（可能包含独立通知机器人的 Token、Bark/Webhook 密钥）。主机器人部署 Token 仍排除。`notify_jobs` 永不导出，恢复清空目标待发队列，避免旧任务被重放；新进程由通知模块建立当前状态。

PR1/PR2/PR3/PR4/PR5 的组合应用仍需主会话在集成分支验证；本分支用相同表结构和适配器替身验证边界，不称为完整组合验收。

## PostgreSQL 支持边界和可执行维护方案

本 PR 的网页逻辑导出／自动恢复只支持文件 SQLite，PostgreSQL 会明确拒绝。Tortoise 模型可以导出 PostgreSQL 行，但不能把 PostgreSQL 和本地 console.sqlite3 放入同一个原子事务；本版不以跨库逐表写入冒充完整恢复。PostgreSQL 应在独立维护窗口使用官方工具，与停机管理库快照一起恢复；不支持跨 SQLite/PostgreSQL 格式转换。

以下命令只示例，不由网页执行。连接串通过环境或 pgpass 提供，不写入仓库；先停止服务。凭据保留策略和 PostgreSQL 的角色/数据库属主由部署者明确选择。

```sh
umask 077
mkdir -p private-backup
pg_dump --format=custom --no-owner --no-acl --file=private-backup/main.dump "$DATABASE_URL"
# 在服务已停止时，用 sqlite3 backup 命令捕获管理库；不要复制运行中的 WAL 主文件。
sqlite3 config/console.sqlite3 '.backup private-backup/console.sqlite3'
# 在隔离的恢复数据库上先验证归档；预先创建目标空数据库。
pg_restore --single-transaction --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" private-backup/main.dump
# 先验证隔离实例，停止目标服务并备份当前主库/管理库，再切换目标部署连接。
# console.sqlite3 中 console_admin 和 credentials 为认证表；默认保留目标表，且删除 kind=session。
```

此方案需要运维完成跨后端维护，不属于已实现的网页恢复；没有运行 PostgreSQL 实例或 pg_dump/pg_restore 测试。不要导出整个 config 目录，其中可能有 bot.session 或部署凭据。

## 独立验收

```sh
.venv/bin/python -m pytest -q
npx playwright test --config playwright.backups.config.js
WEB_PORT=8746 WEB_DEMO_CONFIG=.test-data/backups-manual .venv/bin/python -m src.management.demo
```

浏览器配置固定 8746，拒绝复用已有服务，数据位于本工作目录 `.test-data/`；没有触碰 8730/8731、共享依赖、真实快照或线上服务。预览只使用示例数据。

手工：下载备份 → 修改一个订阅与统计 → 上传原包预检 → 提交 → 页面保持待重启 → 停止并用同命令启动 → 重新登录 → 检查订阅／统计、restore.status=succeeded、旧 session 无效。回退使用恢复结果中 rollback 目录；保持实例停止并先保留当前状态。

实际检查结果在提交前追加。未部署、未合并、未连接真实 Telegram、未验证真实通知发送。

### 本分支实际验证结果

- `.venv/bin/python -m pytest -q`：45 passed（仅现有 uvloop deprecation warning）。
- 最后调整启动竞态后，单独重跑备份与真实离线子进程重启测试：11 passed。
- `npx playwright test --config playwright.backups.config.js`：1 passed；首次 Chromium 被 macOS 沙箱 IPC 限制阻止，批准的沙箱外本地重试及最终回归通过。
- `node --check src/management/static/app.js`、新增模块 compileall、`git diff --check` 通过。
- 覆盖：逻辑往返、认证／令牌默认保留与显式覆盖、BLOB 哈希、源会话排除、目标会话失效、小时统计、通知队列不重放、坏 JSON／checksum／FK／路径攻击／符号链接、锁冲突、双库写入后注入异常回滚、配置文件保存失败回滚、模拟中断日志恢复、ORM重新读取与 EffectiveTasks 重建。
- 实际启动两次离线演示子进程：HTTP 下载→更改标题／阈值→预检→暂存→停止→重启→旧 Cookie 401→重新登录→恢复状态成功、标题和阈值恢复。端口 8746，临时数据库自动清理，无真实数据。
- 最终补充凭据防升级校验后，备份与重启专用检查为 12 passed：导入的 token 权限只允许 read/write，拒绝伪造 admin 权限；显式覆盖管理员时必须恰好一个完整账户。

### 基础 CI 合入（2026-10-26）

已合入 feat/web-console 的 `2fb6c46`，未修改主会话管理的 CI、Docker 忽略规则或 ci_* 脚本。合入后全量后端 46 passed，本机 Bot 脚本／模块入口及 Aerich history/heads/upgrade smoke 通过，JS 语法和 diff check 通过。

新矩阵覆盖 Windows，因此实例锁补充 `msvcrt` 非阻塞字节锁，POSIX 保持 flock；避免 Web 关闭时破坏 Windows Bot 启动。Windows 支持正常启动和备份导出，自动恢复明确禁用（API 暴露 restore_supported，UI 禁用预检），因为当前持久目录日志恢复只验证了 POSIX fsync 语义。Windows 与其它 Python 版本的实际结果由 Actions 验证，本机不冒称完成跨平台实测。

### 组合验收 fixture 修正（2026-10-26）

- 小时统计 fixture 使用真实 metrics_hourly 的 NOT NULL/DEFAULT schema 和 CREATE TABLE IF NOT EXISTS，先清理测试行再注入；通知队列 fixture 同样使用真实 schema 和命名列插入，不与已安装模块重复建表冲突。
- 重启测试为每次运行生成专用随机 WEB_PASSWORD，并明确验证未登录 401、错误密码 401、成功登录获得 rsstt_session_8746，以及恢复后的旧 Cookie 401；不依赖浏览器自动登录。
- 子进程 stderr 持续排空到有界环形缓冲区，启动失败显示最后最多 8192 字符并遮蔽测试密码；超时后清理子进程。端口检查允许 TIME_WAIT，不复用已有监听服务。
- 基础版 demo 增加显式 WEB_PASSWORD 覆盖以支持同一测试。与 PR1 组合时保留 PR1 的 `os.environ.get('WEB_PASSWORD', '')`，不能重新引入旧版固定密码默认值。
- 本分支备份专项 12 passed；从集成树 HEAD 只读 git archive 到本分支忽略目录、仅覆盖这两个测试文件后，真实认证／统计组合的相同 12 项亦全部通过。未修改集成树、未弱化生产 InstanceLock。
