# 文档总览

RSStT Web 是 [RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) 的二开版本：机器人本身、全部 Telegram 命令、抓取与排版逻辑都和上游一致，另外内置了一个网页管理台。机器人里能做的事，网页上都能做；网页上还能做更多。

| 你想要… | 去看 |
| --- | --- |
| 第一次部署 | [快速部署](./deployment) |
| 已经在用原版 RSStT，想换过来 | [从原版迁移与回退](./migration) |
| 用自己的域名和 HTTPS 访问管理台 | [Nginx 与 HTTPS](./https) |
| 了解管理台每个页面能做什么 | [使用管理台](./console) |
| 查环境变量和运行配置 | [配置参考](./configuration) |
| 让脚本或 AI Agent 管理订阅 | [API 与 Agent](./api) |
| 升级、备份、恢复 | [升级、备份与维护](./maintenance) |
| 订阅一直失败、登录不了… | [故障排查](./troubleshooting) |

## 它是怎么工作的

- **一个进程，一个镜像。** 管理台和机器人运行在同一个 Python 进程里，镜像是 `ghcr.io/jaaayden/rsstt-web`。前端是静态文件，不需要 Node.js。
- **数据与原版兼容。** 订阅、会话、格式设置都保存在原版的 `config/db.sqlite3`（或 PostgreSQL）里，结构不变；管理台自己的数据（登录、统计、日志、通知）单独放在 `config/console.sqlite3`。
- **命令照常可用。** `/sub`、`/list`、`/set` 等命令的行为与上游一致；网页修改和命令修改的是同一份数据。

## 和原版相比多了什么

- 概览：服务中的会话、订阅、累计推送、每小时推送趋势、抓取失败最多的源。
- 会话：角色、封禁、让机器人退出、默认推送格式、操作记录。
- 订阅：筛选与批量操作、OPML 导入导出、增减接收会话、单个源的 User-Agent、最近文章与推送结果、立即抓取。
- 运行日志：每次失败的原因（HTTP 状态、超时、DNS、格式错误、Telegram 权限）。
- 设置：通知（本机器人私聊、Bark、ntfy、Webhook、另一个 Telegram 机器人）、运行配置、备份与恢复、API 令牌、网页重启。
