# RSStT Web 管理台

这是基于 RSS-to-Telegram-Bot `dev` 分支的二开版本。上游抓取、格式化、发送和 Telegram 命令继续使用原实现；新增网页和管理 API。它需要运行这个增强版本，不能直接控制另一个未修改的 RSStT 进程。

当前没有修改 FeedLantern，也没有连接或迁移任何现有生产机器人。

## 已实现的入口

| 页面 | 能力 |
| --- | --- |
| 仪表盘 | 订阅关系、独立来源、已知私聊/频道/群组、需要检查数量、累计新内容与成功推送、7/14/30 天趋势、最近管理操作 |
| 会话与频道 | 名称/用户名/ID 搜索、类型筛选、订阅数量与需检查数量、登记已有会话、手动同步、默认推送设置、OPML 导入导出、退出频道/群组并暂停订阅 |
| 全部订阅 | 分页、名称/网址/会话/状态筛选、添加、取消、暂停、恢复、本页全选与批量操作、自定义标题与标签、更新间隔、RSStT 原有推送格式选项 |
| 设置 | 默认更新间隔、最短更新间隔、订阅上限与提示、连续失败提醒阈值、连接授权、实例信息 |

会话列表来自 RSStT 的用户记录。Telegram 不允许机器人通过 `messages.getDialogs` 枚举全部对话，因此这里不声称列出机器人的所有实际成员关系。已有记录可能只有 ID，使用“同步名称与权限”后补全。登记会话会验证机器人是否能访问；将机器人加入频道/群组和授权发言仍需要在 Telegram 中完成。私聊显示“已识别”，只表示能解析用户实体；是否被用户屏蔽，需要在实际推送时才能确认。

管理台的失败阈值默认是 3。只有活动订阅的来源连续失败达到阈值，才纳入“需要检查”。成功抓取后上游将连续错误计数归零。这个阈值不替代上游的退避、自动停用策略；手动或上游自动暂停的订阅可用“已暂停”筛选查看。

## 本地开发与预览

要求 Python 3.12（开发验证版本）、Node.js 20+（仅浏览器测试使用）。生产运行无需 Node.js、前端构建器或额外前端服务。

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
read -rs 'WEB_PASSWORD?设置管理台初始密码（至少 16 字符）：'; echo
export WEB_PASSWORD
.venv/bin/python -m src.management.demo
```

打开 `http://127.0.0.1:8730`。预览使用 `.demo/` 中的独立数据库，默认显示登录页，使用首次启动时设置的私有密码登录。页面显式标注示例数据；RSS 抓取与 Telegram 操作由离线替身提供，其他 API、数据库、订阅业务与网页流程使用真实实现。演示模式仅监听回环地址，不要作为生产服务运行或通过公网反向代理发布。

```bash
.venv/bin/python -m pytest -q
npm ci
npx playwright install chromium
npm run test:e2e
```

### 用线上真实数据做离线测试

`scripts/export_console_snapshot.py` 可在服务器上通过标准输入执行，只读打开原版 RSStT 的 SQLite 数据库，使用 SQLite backup API（包含已经提交到 WAL 的内容）在内存中生成一致副本，再将压缩包传到本地。无需在服务器保存脚本或备份文件，也不需要停止、重启或修改机器人。服务器 Python 需要 3.11+。以下服务器、端口与路径按实际部署替换：

```bash
umask 077
mkdir -p .preview/source
ssh -p PORT USER@HOST 'python3 - --database /path/to/config/db.sqlite3 --session /path/to/config/bot.session' \
  < scripts/export_console_snapshot.py > .preview/snapshot.tar.gz
# 仅在 SSH 导出成功后解包。
tar -xzf .preview/snapshot.tar.gz -C .preview/source
.venv/bin/python -m src.management.preview --snapshot .preview/source --config .preview/work --port 8731
```

`--session` 可省略；提供时仅查询订阅数据库中已知会话的 ID、缓存名称与用户名，不导出电话号码、access hash、Telegram auth key 或完整 session。快照不包含 `.env` 或机器人 Token。名称可能已经过时，缺失时显示会话 ID，当前 Telegram 权限无法离线验证。原记录未明确区分频道和群组时，页面显示“群组/频道”，离线操作不会把推测类型写成已核验类型。

打开 `http://127.0.0.1:8731` 后先使用预览管理员密码登录。首次启动前通过环境变量设置 WEB_PASSWORD，具体步骤见 [认证与 Agent 接入](pr-01-auth-agent.md)。页面明确显示“真实数据离线预览”和快照时间；首次启动会从原始快照生成独立工作副本，之后重启保留本地修改。主数据库、管理台记录和连接授权均只在工作目录中写入。原始快照保持不变，`.preview/` 已排除在 Git 之外。快照含真实会话和订阅地址，应保留在本机。

可以测试分页、筛选、编辑、暂停/恢复、删除、OPML 与授权流程；新增 RSS 为离线模拟，不抓取内容、不验证网址。预览不启动监控器、调度运行器或 Telegram 客户端，并拦截 Python 的 TCP、UDP 和 DNS 外连。实时同步权限、登记快照之外的会话与退出 Telegram 会话会明确拒绝。

原版没有管理台的累计推送和每日趋势，页面将其显示为不可用，不生成示例统计或把未知值当作零。订阅状态和连续失败次数来自快照，不能代表当前线上状态。需要重置测试时，先停止本地预览，再使用新的 `--config` 目录启动同一快照；需要更新数据时，另取一份新快照并使用新工作目录。

## 接入真实机器人

保留原有 `TOKEN`、`MANAGER`、`API_ID`、`API_HASH` 和代理等部署配置，增加：

```dotenv
WEB_ENABLED=1
WEB_HOST=127.0.0.1
WEB_PORT=8730
WEB_ORIGIN=http://127.0.0.1:8730
WEB_PASSWORD=replace-with-a-long-random-password
```

`WEB_PASSWORD` 至少 16 个字符，建议随机生成。密码通过登录表单交换为 8 小时会话，保存在 HttpOnly / SameSite=Strict Cookie；HTTPS 地址会设置 Secure。API 采用同源校验，没有开放 CORS。反向代理时将 `WEB_ORIGIN` 改成浏览器实际访问的 HTTPS 源站地址，路径应为 `/`。不要把管理密码或 Telegram Token 发给集成应用。

WEB_PASSWORD 仅用于首次初始化，之后密码哈希持久化在独立 console_admin 表。更换密码请使用「设置 → 账户安全」，修改环境变量不会覆盖已有账户。重启实例或通过账户安全修改密码后，已有网页登录会话失效；连接授权不受影响。

使用原有入口启动：

```bash
.venv/bin/python telegramRSSbot.py -c ./config
```

`WEB_ENABLED` 默认为关闭。开启后管理 API 与机器人运行在同一进程与事件循环，网页写入会复用订阅内层函数并更新 `EffectiveTasks`。不要同时启动两个进程共享一个 bot session / 主数据库。

提供 `compose.console.yaml` 作为独立部署示例：填写 `.env` 后执行 `docker compose -f compose.console.yaml up -d --build`。宿主机端口仅绑定 `127.0.0.1`，容器内绑定 `0.0.0.0`。接入现有部署时应修改现有服务配置，不能在旧机器人旁再启动一份相同 Token 的机器人。

本地没有运行 Docker daemon，因此这一版尚未完成真实 Docker 构建和 Telegram 发送/退出频道验收。上线前先在独立测试机器人和测试频道验证，再停旧进程、备份并替换镜像。

## 数据与统计

原 RSStT 数据库表结构不变，原来的 Aerich 迁移机制不变。管理台新增 `config/console.sqlite3`，保存授权密钥的哈希、会话名称缓存、累计计数、每日统计和最近操作。主数据库仍可使用上游支持的 SQLite 或 PostgreSQL；管理台数据库是单实例的本地 SQLite 文件，需要持久化 config 目录。

- **新增内容**：监控器发现并保存的新条目数量。同一个来源只抓取一次，不能按订阅关系重复计算。首次订阅时建立的历史条目基线不计入。
- **成功推送**：一篇内容完整发送到一个目的地计 1 篇次；发到 3 个目的地计 3 篇次。拆分成多条 Telegram 消息仍计 1 篇次；空内容、权限拒绝、丢弃或不完整发送不计成功。
- **累计值**：独立总计记录，始终保留。删除订阅、来源或清理操作记录不改变总计。不能恢复启用统计之前的历史值。
- **趋势**：按 UTC 日期聚合，保留 90 天。日计数与累计计数在同一个 SQLite 事务提交；无需保存文章正文或逐条发送日志。
- **操作记录**：管理台最近 200 次操作，不包含 Telegram 命令的完整审计。

统计持久化失败会记录服务错误并在仪表盘显示，机器人继续运行。Telegram 发送和本地统计不能成为同一个分布式事务：进程在发送成功后、统计提交前被强杀，可能少计该次推送；同样不能将远端已接受但响应丢失的发送认定为已确认成功。累计值表示本实例已确认并成功记录的结果。

停机备份整个 config 目录，同时备份 PostgreSQL（如使用）。在线复制 SQLite 时须使用 SQLite backup API，不能只拷贝 `.sqlite3` 而忽略尚未检查点的 WAL。回退上游版本可关闭管理台，保留 `console.sqlite3` 供以后恢复使用。

## 管理 API 与未来 FeedLantern 接入

在“设置 → 连接授权”创建 `read` 或 `write` 授权，明确选择目标会话。也可显式允许全部会话（包含将来新增的会话）。授权有效期 1–365 天；完整密钥只展示一次，可随时撤销。

请求头：`Authorization: Bearer <连接密钥>`。接口位于 `/api`。机器契约为 `/api/openapi.json`；安全默认的 CLI 与错误码见 [认证与 Agent 接入](pr-01-auth-agent.md)。授权不允许读取全局仪表盘、修改实例/会话默认设置、创建新授权、登记会话或退出频道。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/session` | 检查当前授权名称、权限和会话范围 |
| GET | `/api/targets?q=&kind=&page=1&size=20` | 当前授权允许的已知目的地 |
| GET | `/api/subscriptions?target=&q=&state=&attention=&page=1&size=20` | 查询订阅；每页最多 100 条 |
| POST | `/api/subscriptions` | `{"target":"-100…","urls":["https://example.com/rss"]}`，每次最多 100 个 |
| PATCH | `/api/subscriptions/{id}` | 更新 `state`（0/1）、`title`、`tags`、`interval` 等推送选项 |
| DELETE | `/api/subscriptions/{id}` | 取消指定会话中的订阅 |
| POST | `/api/subscriptions/batch` | `{"ids":[1,2],"action":"pause"}`，支持 pause/resume/delete，最多 100 条 |
| GET | `/api/targets/{id}/opml` | 导出此目的地的 OPML |
| POST | `/api/targets/{id}/opml` | `{"opml":"<opml>…</opml>"}`，上限 512 KB / 100 个地址 |
| POST | `/api/targets/{id}/refresh` | 校验目的地访问权限并更新名称 |

所有 Telegram ID 都在 JSON 中使用字符串；不要在集成端将其转成受限整数类型。跨会话操作会拒绝，批量操作在修改前核对整个选择范围。新增返回每条 `created` / `existing` / `failed`；同一会话重复提交同一地址，不会覆盖原有标题、格式或暂停状态。网页写操作串行处理，避免同一个管理台批次重复创建或越过订阅上限。上游 Telegram 命令仍可能并发执行，数据库唯一约束继续生效。

这是可信管理员授权的 RSS 管理接口；`write` 允许机器人访问用户提交的 HTTP(S) RSS 地址，包括自建内网源。部署者需要将其视为有网络访问能力的凭证，并按实际部署配置网络出口权限。

将来 FeedLantern 只需要保存此实例地址和授权，读取可用目的地，然后把 FeedLantern 公开 RSS 地址提交到 `/api/subscriptions`。内容更新继续由 RSStT 拉取 RSS 并发送；两边不共享数据库。当前尚未实现 FeedLantern 适配、用户自助网页登录、完整 Telegram 管理员权限编辑或多实例控制。

## 验收重点

1. 同一个 RSS 重复提交，不改掉已有自定义标题、推送格式或暂停状态。
2. 同一来源被多个会话订阅：修改一个会话、取消一个会话，不影响其他接收者；抓取间隔采用所有活动订阅中的最短值。
3. 一个会话的授权无法读取或修改另一个会话；只读授权无法写入；撤销后立即失效。
4. 连续失败到阈值才显示需检查，成功抓取后消失；累计统计在重启、清理趋势和删除订阅后仍保留。
5. 真实 Telegram 验收：私聊推送、频道权限不足、退出频道、静默发送、图片/长文拆分、OPML 与现有 bot session 的兼容。

保留上游版权与 AGPL-3.0-or-later 许可证。若向网络用户提供修改版服务，应提供该修改版的对应源码；本地首版尚未发布远程仓库或镜像。
