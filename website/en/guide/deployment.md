# Quick start

## Deploy with an AI agent

Send this link to Claude Code, Codex or another agent that can run commands on your server, and ask it to deploy RSStT Web:

```text
https://jaaayden.github.io/rsstt-web/deploy.md
```

It asks for what it needs (bot token, your Telegram ID, whether to migrate an existing RSStT, an optional domain), installs and verifies, then tells you the console address, where the password is, and how to roll back.

## By hand

You need an x86_64 Linux server with Docker Engine and the Compose plugin, a bot token from [@BotFather](https://t.me/BotFather), and your numeric Telegram user ID (ask [@userinfobot](https://t.me/userinfobot)).

```sh
mkdir -p /opt/rsstt-web && cd /opt/rsstt-web
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
curl -fsSLo .env https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/.env.console.example
chmod 600 .env   # set TOKEN, MANAGER and WEB_PASSWORD (16+ characters)
docker compose up -d
docker compose logs -f --tail=50
```

The console listens on `127.0.0.1:8730` only. Put a reverse proxy with HTTPS in front of it (see [Nginx & HTTPS](/guide/https), Chinese) and set `WEB_ORIGIN=https://your-domain` in `.env`, or use an SSH tunnel:

```sh
ssh -N -L 8730:127.0.0.1:8730 user@your-server   # then open http://localhost:8730
```

For production, pin a version in `.env`: `RSSTT_WEB_IMAGE=ghcr.io/jaaayden/rsstt-web:1.0.0`. Any other upstream variable (`API_ID`, `TELEGRAPH_TOKEN`, `MULTIUSER`, proxies…) can go in `.env` as well.
