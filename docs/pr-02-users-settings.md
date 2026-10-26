# PR02 用户角色与运行配置

## 稳定接口（供 PR1、PR6、PR7 接入）

- `PATCH /api/targets/{id}/role {"role":"banned|guest|user|admin"}`，仅管理台管理员。返回既有 target 对象，新增 `role`、`role_protected`、`lang`。`state` 保留原字段。管理员状态 100 **不**获得 MANAGER 专属 Telegram 命令权限，也不创建网页登录身份。
- `PATCH /api/targets/{id}` 新增 `lang`，接受原版语言代码和 `null` 字符串（自动语言）。既有 `sub_limit`、推送默认设置保留。
- `GET /api/runtime-config` 返回 `{items, pending_restart, deployment_only}`。每项有 `key/type/sensitive/configured/effective_configured/source/apply/pending_restart`；非敏感项另有 `value/effective_value`，整数另有 `min/max`。`effective_value` 是启动时配置输入（未显式设置时为 null），不是探测远端连接成功的结果。
- `PATCH /api/runtime-config` 请求是白名单键值对象。布尔必须 JSON bool，整数必须 JSON int；`null` 删除网页覆盖，下次启动恢复部署值。全部验证通过才原子保存。返回与 GET 相同的脱敏结构。所有字段目前 `apply=restart`，不会停止进程。
- `create_app` 参数不变；认证继续调用现有 `admin(request)`。未来 PR1 若主身份携带 `telegram_id`，角色 API 同时保护该 ID；当前密码登录没有 Telegram 身份，所有环境 MANAGER 始终受保护。不新建第二套登录。
- 角色业务：`src.command.inner.users.set_user_state(user, state, current_manager=None)`。Telegram `/user_info` 回调与 Web 共用。封禁会调用原版暂停订阅业务，解封不自动恢复；在途发送无法撤回。

## PR6 备份配置契约

独立模块 `src/runtime_config.py` 不导入 `env`、数据库或 Telegram。文件为 config 目录下 `runtime-config.json`，UTF-8 JSON：`{"version":1,"values":{...}}`。不使用额外数据库表。通过同目录临时文件、fsync、原子 replace 写入，权限 0600。禁止把真实内容写入源码或审计日志。

- `RuntimeConfig(config_dir).safe_export()` → 同版本结构，只含非敏感覆盖值；默认备份使用此方法。
- `SECRETS`：`TOKEN`, `API_HASH`, `TELEGRAPH_TOKEN`, `SOCKS_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `T_PROXY`, `R_PROXY`。代理 URL 可能含凭据，因此整项视为敏感，网页完全不回显。
- `RuntimeConfig(config_dir).save(patch)`：验证并合并指定键，未指定的键保留（包括现有凭据）；`null` 删除覆盖。备份恢复应把导出的 `values` 传入，不能用整个文件直接替换，否则会丢失保留的凭据。显式恢复凭据需由备份 PR 自己完成授权检查后传入对应键；本接口不提供明文敏感值读取。
- 如需整文件恢复，先验证版本和所有值；凭据默认保留目标实例版本；不要恢复 MANAGER、WEB_PASSWORD、数据库地址、session 或授权数据库。
- 启动顺序：原版加载 `.env` → `load_startup(config_dir, os.environ)` → 派生 `env` 常量／代理结构 → 初始化事件循环、网络客户端与调度器。优先级为网页覆盖 > 原版加载后的 `.env` > 进程环境 > 原版默认值。删除覆盖后须在新进程重新加载部署值，不能在当前进程模拟恢复。
- 损坏、未知键或未知版本启动时失败关闭，不忽略错误、不输出敏感内容。重启后的 `applied` 快照与已保存内容比较，消除待重启标识。网页读写固定使用管理数据库同目录，生产与 config 目录一致，预览使用独立工作目录。

## 原版命令 → Web/API → 生效时机盘点

来源：`src/entrypoint.py` 完整注册表、`command/administration.py`、`command/customization.py`、`command/inner/customization.py`、`db/effective_utils.py`。

| 命令或回调 | Web/API | 生效时机／边界 |
| --- | --- | --- |
| `/add`, `/sub`, 私聊或回复中的 URL | 添加订阅；POST subscriptions | 即时；复用 inner.sub.sub；检查封禁与上限 |
| `/remove`, `/unsub` | DELETE subscriptions/{id} | 即时；复用 inner.sub.unsub |
| `/remove_all`, `/unsub_all` | 订阅批量删除；POST subscriptions/batch | 即时；分页选择，每批最多 100 |
| `/list`、翻页回调 | GET subscriptions | 当前数据库；筛选／分页 |
| `/import`、上传 OPML | POST targets/{id}/opml | 即时；解析后同添加业务 |
| `/export` | GET targets/{id}/opml | 当前数据库生成 |
| `/set`、set 回调 | PATCH subscriptions/{id} | 即时；interval/state 更新共享调度 |
| `/set_default`、set_default 回调 | PATCH targets/{id} | 即时；只影响继承默认值的订阅 |
| `/set_title`、del_subs_title 回调 | PATCH subscriptions/{id} title（null 清除） | 即时 |
| `/set_hashtags` | PATCH subscriptions/{id} tags | 下次格式化 |
| `/set_interval` | PATCH subscriptions/{id} 或 targets/{id} interval | 即时更新共享来源最短间隔 |
| `/activate_subs`、activate_sub/all_subs 回调 | 订阅恢复／批量 resume | 即时；封禁者不可恢复 |
| `/deactivate_subs`、deactivate_sub/all_subs 回调 | 订阅暂停／批量 pause | 即时 |
| reset、reset_all/confirm 回调 | 将格式字段设为 -100、interval=null；按订阅 PATCH | 即时；不清除标题、标签、状态 |
| `/lang`、set_lang 回调 | 会话默认表单 lang | 下次 Bot 文案输出 |
| `/user_info`、set_user 回调 | 会话列表／role API | 即时；MANAGER 禁止修改，类型与角色分离 |
| `/set_sub_limit`、reset_sub_limit 回调 | 会话 sub_limit；null 恢复默认 | 下次添加订阅检查 |
| `/set_option` | GET/PATCH settings | default_interval 即时重算；其余下次业务检查 |
| `/start`, `/help`、help 回调 | 管理台导航、说明与本矩阵 | 无持久化配置 |
| `/version` | GET settings 的 version | 启动版本 |
| `/test` | 保留 Telegram 原命令，无新增 Web 发送测试端点 | 会真实发送消息，不属于配置；本 PR 不连接 Telegram |
| del_buttons、null 回调、inline query | Telegram 原交互 | 无可持久化设置 |

### 单会话默认／单订阅字段逐项映射

以下共同字段在会话默认表单和订阅编辑表单中均已有输入，分别使用 PATCH targets/{id} 与 PATCH subscriptions/{id}。订阅格式字段 `-100` 表示继承会话默认；interval 使用 null 继承。会话默认不能使用 -100。

| 字段 | 原版值 | 生效 |
| --- | --- | --- |
| notify | 1,0 | 下次推送 |
| send_mode | 0,1,2,-1 | 下次格式化 |
| link_preview | 0,1,-1 | 下次推送 |
| display_media | 0,1,-1 | 下次格式化 |
| display_author | 0,1,-1 | 下次格式化 |
| display_via | 0,1,-3,-1,-4,-2 | 下次格式化 |
| display_title | 0,1,-1 | 下次格式化 |
| display_entry_tags | 1,-1 | 下次格式化 |
| style | 0,1 | 下次格式化 |
| length_limit | 0..4096；订阅另支持 -100 | 下次格式化 |
| interval | null 或 minimal_interval..32767 分钟 | 即时重算来源调度 |
| title / tags | 仅单订阅，null 清除 | 下次格式化 |
| state | 仅单订阅 0/1 | 即时暂停／恢复 |
| sub_limit | 仅会话，null/-1/0..32767 | 下次添加检查 |
| lang | 仅会话，语言代码／null 字符串 | 下次命令响应 |

全局 Option 全量：default_interval、minimal_interval、user_sub_limit、channel_or_group_sub_limit、sub_limit_reached_message。管理台 attention_threshold 为独立管理设置。

## env.py／Compose 全量配置分类

白名单字段均在“设置 → 运行配置”生成表单；明确重启生效。HTTP 并发 0 保留原版“不限”语义，HTTP 超时和缓冲大小作有界校验。保存不代表远端凭据或网络连接已验证。

| 配置（同一行各键使用相同策略） | Web 映射／生效 |
| --- | --- |
| TOKEN、API_ID、API_HASH、TELEGRAPH_TOKEN | runtime-config；敏感值不回显；重启重新初始化客户端 |
| MULTIUSER、ERROR_LOGGING_CHAT、CRON_SECOND | runtime-config；重启 |
| SOCKS_PROXY、HTTP_PROXY、HTTPS_PROXY、T_PROXY、R_PROXY | runtime-config；重启重新创建代理；整值敏感；空字符串沿用原版空值回退规则，null 恢复部署来源 |
| socks_proxy、http_proxy、https_proxy | 原版小写部署别名继续保留；网页只暴露大写白名单 |
| PROXY_BYPASS_PRIVATE、PROXY_BYPASS_DOMAINS、USER_AGENT、IPV6_PRIOR、VERIFY_TLS | runtime-config；重启 |
| HTTP_TIMEOUT、HTTP_CONCURRENCY、HTTP_CONCURRENCY_PER_HOST、HTTP_MAX_LINE_SIZE、HTTP_MAX_FIELD_SIZE | runtime-config；重启重新建立 HTTP 对象 |
| IMG_RELAY_SERVER、IMAGES_WESERV_NL | runtime-config；完整 HTTP(S) URL；重启 |
| TABLE_TO_IMAGE、TRAFFIC_SAVING、LAZY_MEDIA_VALIDATION | runtime-config；重启 |
| MANAGER、CHATID（旧别名）、MANAGER_PRIVILEGED | 仅部署；不允许网页变更最终权限根 |
| DATABASE_URL、DATABASE_PRIVATE_URL、DATABASE_PUBLIC_URL | 仅部署；数据库迁移不能冒充普通设置 |
| WEB_ENABLED、WEB_HOST、WEB_PORT、WEB_ORIGIN、WEB_PASSWORD | 仅部署／PR1 专用认证接口；不通过运行配置编辑 |
| NO_UVLOOP、MULTIPROCESSING、EXECUTOR_NICENESS_INCREMENT、DEBUG | 仅部署；进程模型、资源与诊断策略 |
| PORT、RAILWAY_STATIC_URL | 仅部署；平台网络配置 |
| DELAY、REDISHOST、REDISUSER、REDISPASSWORD、REDISPORT、REDIS_NUM | 已废弃，仅保留上游警告，不提供网页表单 |
| Compose image/build/container_name/restart/ports/volumes、config 路径 | 部署基础设施，不是应用运行配置 |

## 验收与限制

测试使用临时 SQLite、离线 gateway 和禁止 RSS 外连的替身，不读取真实快照或 bot.session，不发送真实通知。角色测试核对 MANAGER、负数 ID 禁止 admin、普通连接令牌越权、封禁暂停／恢复拒绝、语言代码。配置测试核对类型、整批验证、优先级、删除覆盖、启动读取、0600、脱敏响应与脱敏审计。实际执行结果：

- `.venv/bin/python -m pytest -q`：42 passed；仅既有 uvloop.install 弃用警告。
- `node_modules/.bin/playwright test -c playwright.pr02.config.js`：6 passed，包括原有 5 项与新增角色／运行配置表单测试。固定 8742、`.demo/pr02` 独立数据库、不复用已有服务；首次沙箱运行被 Chromium Mach 端口权限阻止，允许在沙箱外运行后通过。
- `node --check src/management/static/app.js`、`git diff --check`：通过。
- 其中独立 Python 子进程启动验证覆盖优先于部署输入，实际 env.HTTP_TIMEOUT、MULTIUSER、TELEGRAM_PROXY_DICT 均在初始化前应用。
- 未执行真实 Telegram、Docker、线上部署或远端凭据有效性验证。

管理者 100 状态继承原版模型语义；原版只允许环境 MANAGER 使用管理者命令。本 PR 不把 100 提升为网页登录权限。负数 ID 未核验时应显示“群组/频道”，不得仅依据 state=1/-1 断言类型。总体 UI 重设计交给 PR7。
