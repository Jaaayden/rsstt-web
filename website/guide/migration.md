# 从原版迁移与回退

RSStT Web 和原版使用同一种数据库结构，迁移就是**用同一份数据目录换一个镜像启动**：订阅、会话、格式设置，以及“哪些文章已经推送过”的记录都会保留，所以**不会重复推送**。管理台的数据单独放在 `config/console.sqlite3`，原版会忽略它，因此随时可以换回原版。

::: warning 只能同时运行一个
同一个数据目录、同一个机器人 Token，任何时候只能有一个进程在运行。一定要先完全停止原版，再启动 RSStT Web。
:::

## 1. 找到原版的数据目录和设置

```sh
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i rss          # 原版容器名，例如 rsstt
docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' rsstt
```

挂载到 `/app/config` 的那个目录就是数据目录（下面记作 `/root/rsstt/config`），里面应该有 `db.sqlite3` 和 `bot.session`。

## 2. 准备 RSStT Web 的配置

把原版容器的环境变量原样复制过来，这样 Token、`MANAGER`、`TELEGRAPH_TOKEN`、`MULTIUSER`、代理等设置都会保留：

```sh
mkdir -p /opt/rsstt-web && cd /opt/rsstt-web
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
docker inspect rsstt --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -vE '^(PATH|GPG_KEY|LANG|PYTHON[A-Z_]*|PORT|RAPIDFUZZ_IMPLEMENTATION|LD_PRELOAD|MALLOC_CONF|HOME|HOSTNAME)=' > .env
echo "WEB_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "WEB_ORIGIN=http://127.0.0.1:8730" >> .env
chmod 600 .env
sed -i 's#- ./config:/app/config#- /root/rsstt/config:/app/config#' compose.yaml
docker compose pull
```

## 3. 停止原版、备份、启动新版

```sh
docker stop rsstt
tar -czf ~/rsstt-config-$(date +%Y%m%d%H%M).tar.gz -C /root/rsstt config
cd /opt/rsstt-web && docker compose up -d
docker compose logs -f --tail=50
```

日志中的 `SELF:` 应该是你原来的机器人。停机时间约 1 分钟；这段时间里没抓到的文章，启动后会正常补推一次。原版容器只是停止，不要删除，留着回退用。

## 回退到原版

```sh
cd /opt/rsstt-web && docker compose down
docker start rsstt
```

退回后，订阅、会话和推送记录都在；只有在网页“运行配置”里设置、没有写进原版 `docker-compose.yml` 的值不会生效（原版不读网页配置）。

::: tip 固定原版镜像
如果原版用的是 `rongronggg9/rss-to-telegram:dev` 这类会变化的标签，建议迁移前给它打一个固定标签，以免以后拉取更新后版本对不上：

```sh
docker tag $(docker inspect -f '{{.Image}}' rsstt) rsstt-original:rollback
```

回退时把原版 `docker-compose.yml` 里的镜像改成 `rsstt-original:rollback` 再启动。
:::

## 在 RSStT Web 的不同版本之间回退

把 `.env` 里的 `RSSTT_WEB_IMAGE` 改回旧版本号，再 `docker compose up -d` 即可。每个版本的数据格式都与上游兼容。
