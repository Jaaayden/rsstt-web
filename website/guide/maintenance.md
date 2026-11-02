# 升级、备份与维护

## 升级

```sh
cd /opt/rsstt-web
# 固定版本时，先改 .env 里的 RSSTT_WEB_IMAGE
docker compose pull && docker compose up -d
```

重启约 10 秒，期间暂停推送，之后继续，不会丢订阅、不会重复推送。版本说明见 [Releases](https://github.com/Jaaayden/rsstt-web/releases)。

## 重启

运行配置等需要重启的修改，可以在网页“设置 → 账户与安全 → 立即重启”完成：机器人正常退出后由 Docker 的 `restart: unless-stopped` 自动拉起，页面会自动等待并刷新。也可以在服务器上 `docker compose restart`。

## 备份

- **网页备份**：“设置 → 备份与恢复”导出 JSON，包含订阅、会话、格式设置和管理台数据；机器人 Token 和 Telegram 登录会话永远不导出。恢复时先预检，再暂存，下次重启时应用。
- **完整备份**：备份整个 `config/` 目录（`db.sqlite3`、`console.sqlite3`、`bot.session`）。运行中备份 SQLite 请用在线备份，例如：

```sh
python3 - <<'PY'
import sqlite3
for name in ('db.sqlite3', 'console.sqlite3'):
    src = sqlite3.connect(f'file:/opt/rsstt-web/config/{name}?mode=ro', uri=True)
    dst = sqlite3.connect(f'/root/backup-{name}')
    src.backup(dst)
PY
```

可以用 crontab 每天执行一次，并保留最近两周。

## 资源占用

以 429 个订阅源（301 个启用）的真实数据实测，稳定运行时比原版多约 5 MB 内存、0.3 个百分点 CPU；镜像约 450 MB，与原版官方镜像基本相同。
