# 配置参考

配置分两类：**部署配置**写在 `.env` 里，只能在服务器上改；**运行配置**既可以写在 `.env` 里，也可以在网页“设置 → 运行配置”里改（网页的值优先，保存后重启生效）。

## 部署配置（`.env`）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `TOKEN` | 是 | 机器人 Token（@BotFather）。 |
| `MANAGER` | 是 | 机器人所有者的 Telegram 数字 ID，多个用 `;` 分隔。 |
| `WEB_PASSWORD` | 是 | 管理台初始密码，16–512 个字符。只在第一次启动时使用。 |
| `WEB_ORIGIN` | 否 | 浏览器访问管理台的完整地址，如 `https://rss.example.com`。默认 `http://127.0.0.1:8730`。 |
| `RSSTT_WEB_IMAGE` | 否 | 镜像版本，默认 `ghcr.io/jaaayden/rsstt-web:1`。生产建议固定如 `:1.0.0`。 |
| `WEB_PUBLISH_PORT` | 否 | 宿主机本机端口，默认 `8730`。 |
| `DATABASE_URL` | 否 | 使用 PostgreSQL 时填写；默认用 `config/db.sqlite3`。 |
| `MULTIPROCESSING` 等 | 否 | 上游的进程与调试类选项，见[上游高级设置](https://github.com/Rongronggg9/RSS-to-Telegram-Bot/blob/dev/docs/advanced-settings.md)。 |

## 运行配置

网页上每一项都会显示**当前实际生效的值**和来源（网页设置 / 部署环境 / 默认值）。开关类选项有三个选择：沿用部署或默认值、开启、关闭。

| 分组 | 变量 | 作用 |
| --- | --- | --- |
| Telegram 连接 | `MULTIUSER` | 是否允许其他人使用机器人（默认开启）。 |
| | `API_ID` / `API_HASH` | 自己的 Telegram 应用凭据（my.telegram.org），比内置公共凭据更稳定。 |
| | `ERROR_LOGGING_CHAT` | 错误报告发到哪个会话，默认所有者。 |
| 网络与代理 | `T_PROXY` / `R_PROXY` | 连接 Telegram / 抓取 RSS 用的代理，如 `socks5://127.0.0.1:1080`。 |
| | `PROXY_BYPASS_PRIVATE` / `PROXY_BYPASS_DOMAINS` | 内网地址或指定域名不走代理。 |
| | `IPV6_PRIOR` / `VERIFY_TLS` | 优先 IPv6；校验 HTTPS 证书（建议保持开启）。 |
| 抓取 | `USER_AGENT` | 全局 User-Agent；单个源可在订阅详情里覆盖。 |
| | `HTTP_TIMEOUT` | 单次请求超时，默认 12 秒。 |
| | `HTTP_CONCURRENCY` / `HTTP_CONCURRENCY_PER_HOST` | 并发数，默认 1024 / 16。 |
| 内容处理 | `TELEGRAPH_TOKEN` | 长文发布到 Telegraph 用，可在网页一键获取。 |
| | `TABLE_TO_IMAGE` / `TRAFFIC_SAVING` / `LAZY_MEDIA_VALIDATION` | 表格转图片、省流量、跳过媒体预检查。 |
| | `IMG_RELAY_SERVER` / `IMAGES_WESERV_NL` | 图片中转与压缩服务。 |

机器人 Token 也可以在网页上更换，但只用于在 @BotFather 重新生成 Token 之后更新；重启或升级本身不会改变机器人身份。

## 订阅规则

“设置 → 订阅规则”对应机器人的 `/set_option`：默认检查间隔、最短检查间隔、用户与频道/群组的订阅上限、达到上限时的提示，以及网页上“抓取异常”的判定阈值。立即生效。
