# 快速部署

## 交给 AI 部署

如果你用 Claude Code、Codex、ChatGPT 等可以操作服务器的 AI，把下面这个链接发给它，并说“按这个部署 RSStT Web”：

```text
https://jaaayden.github.io/rsstt-web/deploy.md
```

这是一份专门写给 AI 的说明：它会先问你需要的信息（机器人 Token、你的 Telegram ID、是否从原版迁移、是否需要域名），然后逐步安装、自检，最后告诉你访问地址、密码查看方式和回退命令。也可以自己按下面的步骤来。

## 准备

- 一台 Linux 服务器，x86_64 架构，已安装 Docker Engine 和 Compose 插件；
- 约 250 MB 可用内存、1 GB 硬盘；
- 从 [@BotFather](https://t.me/BotFather) 创建机器人，得到 **Bot Token**；
- 你自己的 **Telegram 数字 ID**（可以问 [@userinfobot](https://t.me/userinfobot)），用作机器人所有者 `MANAGER`。

::: tip 已经在用原版 RSStT？
不要新建机器人，看[从原版迁移与回退](./migration)：沿用原来的机器人和数据，不会重复推送。
:::

## 安装

```sh
mkdir -p /opt/rsstt-web && cd /opt/rsstt-web
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
curl -fsSLo .env https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/.env.console.example
chmod 600 .env
```

编辑 `.env`，至少填写这三项：

```dotenv
TOKEN=123456:你的机器人Token
MANAGER=你的Telegram数字ID
WEB_PASSWORD=至少16个字符的随机密码
```

可以用 `openssl rand -hex 24` 生成密码。`WEB_PASSWORD` 只在第一次启动时用来创建管理员（账号是 `admin`），之后请在网页“设置 → 账户与安全”里修改账号和密码。

```sh
docker compose up -d
docker compose logs -f --tail=50
```

日志里出现 `started!` 和 `RSStT web console listening` 就说明启动成功。给机器人发 `/start`，确认它有回复。

## 打开管理台

管理台只监听服务器本机的 `127.0.0.1:8730`，不会直接暴露到公网。

- **有域名**：按 [Nginx 与 HTTPS](./https) 配置反向代理，并把 `.env` 里的 `WEB_ORIGIN` 改成 `https://你的域名`。
- **先试用 / 备用入口**：在自己电脑上建 SSH 隧道，然后打开 `http://localhost:8730`：

```sh
ssh -N -L 8730:127.0.0.1:8730 user@your-server
```

## 固定版本

`compose.yaml` 默认使用 `ghcr.io/jaaayden/rsstt-web:1`（1.x 的最新版）。生产环境建议在 `.env` 里固定到具体版本，升级时再手动改：

```dotenv
RSSTT_WEB_IMAGE=ghcr.io/jaaayden/rsstt-web:1.0.0
```

所有版本见 [Releases](https://github.com/Jaaayden/rsstt-web/releases)。上游支持的其他环境变量（`API_ID`、`TELEGRAPH_TOKEN`、`MULTIUSER`、代理等）都可以直接写进 `.env`，见[配置参考](./configuration)。
