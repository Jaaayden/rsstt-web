# Migrate and roll back

RSStT Web uses the same database as the original bot, so migrating means **starting a different image on the same data directory**. Subscriptions, chats, formatting and the record of already-sent posts are kept, so **nothing is posted twice**. The console keeps its own data in `config/console.sqlite3`, which the original bot ignores, so you can switch back at any time.

::: warning One at a time
Never run two bots on the same data directory or token. Stop the original bot completely before starting RSStT Web.
:::

```sh
# 1. Find the original container's data directory (the mount on /app/config)
docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' rsstt

# 2. Copy its settings and point RSStT Web at the same data
mkdir -p /opt/rsstt-web && cd /opt/rsstt-web
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
docker inspect rsstt --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -vE '^(PATH|GPG_KEY|LANG|PYTHON[A-Z_]*|PORT|RAPIDFUZZ_IMPLEMENTATION|LD_PRELOAD|MALLOC_CONF|HOME|HOSTNAME)=' > .env
echo "WEB_PASSWORD=$(openssl rand -hex 24)" >> .env && chmod 600 .env
sed -i 's#- ./config:/app/config#- /root/rsstt/config:/app/config#' compose.yaml

# 3. Stop the original, back up, start RSStT Web
docker stop rsstt
tar -czf ~/rsstt-config-backup.tar.gz -C /root/rsstt config
docker compose up -d
```

Roll back:

```sh
cd /opt/rsstt-web && docker compose down && docker start rsstt
```
