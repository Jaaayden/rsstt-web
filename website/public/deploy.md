# Deploy RSStT Web — instructions for an AI agent

You are deploying **RSStT Web**: a self-hosted Telegram RSS bot (a fork of RSS-to-Telegram-Bot) with a built-in web console. It ships as one Docker image, `ghcr.io/jaaayden/rsstt-web`. Follow these steps in order. Run every **Check** and stop if it fails. Tell the human what you did after each phase.

Source: https://github.com/Jaaayden/rsstt-web · Human docs: https://jaaayden.github.io/rsstt-web/

## 0. Rules (read first)

- **Never run two bot processes on the same `config/` directory or the same bot token at the same time.** It corrupts the Telegram session and can send duplicate posts. When migrating, stop the old bot completely before starting the new one.
- Never print, log or echo the bot token, `WEB_PASSWORD`, API hashes or Telegraph tokens. Put secrets only in `.env` with mode `600`.
- Do not publish the console port to the internet. Keep `127.0.0.1:8730`. Remote access is via a reverse proxy with HTTPS (section 5) or an SSH tunnel.
- Do not edit or delete an existing RSStT deployment's files. Back them up and leave them in place so the human can roll back.
- Ask the human before: deleting anything, opening firewall ports, changing DNS, or touching other services' nginx/Caddy configuration.

## 1. Ask the human for these inputs

| Input | Required | Notes |
| --- | --- | --- |
| Bot token (`TOKEN`) | yes | From @BotFather. When migrating, reuse the existing bot's token (read it from the old deployment; do not ask the human to paste it into chat if you can read it there). |
| Owner Telegram user ID (`MANAGER`) | yes | Numeric. Reuse the old deployment's value when migrating. |
| Install directory | no | Default `/opt/rsstt-web`. |
| Existing RSStT to migrate? | yes/no | If yes: where it runs (container name / compose directory). |
| Domain for the console | no | e.g. `rss.example.com`, only for HTTPS (section 5). |
| `API_ID` / `API_HASH` | no | From my.telegram.org; more reliable sign-in than the built-in shared credentials. |

Generate `WEB_PASSWORD` yourself (`openssl rand -hex 24`) and tell the human how to read it on the server (`grep WEB_PASSWORD <dir>/.env`) — do not paste it into chat.

## 2. Preconditions

```sh
uname -m                      # must be x86_64 (amd64 image)
docker --version              # Docker Engine 24+
docker compose version        # Compose v2
free -m                       # ~250 MB RAM free for the bot
df -h /                       # ~1 GB free for the image
```

**Check:** all commands succeed, architecture is `x86_64`. If Docker is missing, install Docker Engine with the official convenience script only after the human agrees.

## 3A. Fresh install (no existing RSStT)

```sh
DIR=/opt/rsstt-web
sudo mkdir -p $DIR && cd $DIR
sudo curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
sudo touch .env && sudo chmod 600 .env
```

Write `$DIR/.env` (replace values; keep the file private):

```dotenv
TOKEN=<bot token>
MANAGER=<owner user id>
WEB_PASSWORD=<openssl rand -hex 24>
WEB_ORIGIN=http://127.0.0.1:8730
RSSTT_WEB_IMAGE=ghcr.io/jaaayden/rsstt-web:1
```

`WEB_ORIGIN` must be the exact URL the browser will use. Set it to `https://<domain>` if you will do section 5.

```sh
cd $DIR && sudo docker compose pull && sudo docker compose up -d
```

Continue with section 4.

## 3B. Migrate from an existing RSStT (keeps subscriptions, no duplicate posts)

The data format is identical to upstream RSS-to-Telegram-Bot; RSStT Web stores its own data in a separate `config/console.sqlite3`. Reusing the old `config/` directory keeps every subscription and the record of already-sent posts, so nothing is re-sent.

1. Find the old deployment and its data directory:

   ```sh
   docker ps --format '{{.Names}}\t{{.Image}}' | grep -i rss
   OLD=<old container name>
   docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' $OLD
   ```

   **Check:** one mount ends in `-> /app/config`. Call its source `$DATA` (e.g. `/root/rsstt/config`). It must contain `db.sqlite3` and `bot.session`. If the old bot uses PostgreSQL (`DATABASE_URL`), stop and tell the human — keep `DATABASE_URL` in the new `.env` and use their PostgreSQL backup procedure.

2. Copy every setting of the old container into the new `.env` (this keeps `TOKEN`, `MANAGER`, `TELEGRAPH_TOKEN`, `MULTIUSER`, proxies, …). Do not print the values:

   ```sh
   DIR=/opt/rsstt-web; sudo mkdir -p $DIR && cd $DIR
   sudo curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
   docker inspect $OLD --format '{{range .Config.Env}}{{println .}}{{end}}' \
     | grep -vE '^(PATH|GPG_KEY|LANG|PYTHON[A-Z_]*|PORT|RAPIDFUZZ_IMPLEMENTATION|LD_PRELOAD|MALLOC_CONF|HOME|HOSTNAME)=' \
     | sudo tee .env >/dev/null
   echo "WEB_PASSWORD=$(openssl rand -hex 24)" | sudo tee -a .env >/dev/null
   echo "WEB_ORIGIN=http://127.0.0.1:8730"     | sudo tee -a .env >/dev/null
   echo "RSSTT_WEB_IMAGE=ghcr.io/jaaayden/rsstt-web:1" | sudo tee -a .env >/dev/null
   sudo chmod 600 .env
   cut -d= -f1 .env      # show variable NAMES only
   ```

   **Check:** names include `TOKEN` and `MANAGER`. A value spanning several lines (e.g. `TELEGRAPH_TOKEN` written as a YAML block) must be on one line, separated by spaces.

3. Point the volume at the existing data instead of `./config`:

   ```sh
   sudo sed -i "s#- ./config:/app/config#- $DATA:/app/config#" compose.yaml
   sudo docker compose config --quiet && sudo docker compose pull
   ```

4. Stop the old bot, back up, start the new one — in this order:

   ```sh
   docker stop $OLD
   test "$(docker inspect -f '{{.State.Running}}' $OLD)" = false && echo stopped
   sudo tar -czf ~/rsstt-config-before-web-$(date +%Y%m%d%H%M).tar.gz -C "$(dirname $DATA)" "$(basename $DATA)"
   cd $DIR && sudo docker compose up -d
   ```

   Keep the old container (stopped, not removed) and its compose file for rollback.

5. Record the rollback command for the human (it reverses step 4):

   ```sh
   cd $DIR && sudo docker compose down && docker start $OLD
   ```

## 4. Verify

```sh
sleep 30
docker ps --filter name=rsstt-web --format '{{.Status}}'          # Up … (healthy)
docker logs rsstt-web 2>&1 | grep -E 'started!|console listening'   # both lines present
docker logs rsstt-web 2>&1 | grep -cE 'CRITICAL|Traceback'          # expect 0
curl -s http://127.0.0.1:8730/api/public                           # JSON with "demo": false
```

**Check:** all four succeed. `SELF:` in the log shows the expected bot username. Then ask the human to send `/start` to the bot in Telegram and confirm it replies.

If `console listening` is missing, the bot still runs; read the `CRITICAL` line (usually `WEB_PASSWORD` shorter than 16 characters) and fix `.env`, then `docker compose up -d`.

## 5. Optional: HTTPS on a domain

Requires a DNS `A` record for the domain pointing to this server (ask the human; if Cloudflare proxy is on, set SSL mode to *Full (strict)*). Set `WEB_ORIGIN=https://<domain>` in `.env` and run `docker compose up -d`.

**Caddy** (simplest, automatic certificates):

```
<domain> {
    reverse_proxy 127.0.0.1:8730 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
    }
}
```

**nginx** (certificate from certbot or acme.sh):

```nginx
server {
    listen 443 ssl http2;
    server_name <domain>;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 40m;
    location / {
        proxy_pass http://127.0.0.1:8730;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
server { listen 80; server_name <domain>; return 301 https://$host$request_uri; }
```

Behind Cloudflare, also trust only Cloudflare for the visitor IP (`set_real_ip_from <Cloudflare ranges>; real_ip_header CF-Connecting-IP;`). Do not modify other sites in the same nginx; run `nginx -t` before `systemctl reload nginx`.

**Check:** `curl -sI https://<domain>/` returns `200`, and signing in works in a browser.

Without a domain, tell the human to use an SSH tunnel: `ssh -N -L 8730:127.0.0.1:8730 user@server`, then open `http://localhost:8730`.

## 6. Upgrade later

```sh
cd /opt/rsstt-web
sudo sed -i 's#^RSSTT_WEB_IMAGE=.*#RSSTT_WEB_IMAGE=ghcr.io/jaaayden/rsstt-web:<new version>#' .env
sudo docker compose pull && sudo docker compose up -d
```

Releases: https://github.com/Jaaayden/rsstt-web/releases. The database stays compatible with upstream RSStT, so rolling back to an older RSStT Web version or to the original bot works with the same `config/`.

## 7. Report to the human

Tell them: the console URL, the sign-in username (`admin`), how to read `WEB_PASSWORD` on the server, the rollback command, where the backup is, and anything you skipped.
