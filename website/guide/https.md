# Nginx 与 HTTPS

管理台监听在服务器本机的 `127.0.0.1:8730`。用域名访问时，在前面放一个反向代理负责 HTTPS，并把真实访问者 IP 传给管理台（登录失败次数按访问者分别计算）。

配置前：

1. 给域名添加 DNS `A` 记录，指向服务器；
2. 在 `.env` 里设置 `WEB_ORIGIN=https://你的域名`，然后 `docker compose up -d`。

## Caddy（最省事）

Caddy 会自动申请和续期证书：

```text
rss.example.com {
    reverse_proxy 127.0.0.1:8730 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
    }
}
```

## Nginx

证书可以用 certbot 或 acme.sh 申请，然后：

```nginx
server {
    listen 80;
    server_name rss.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rss.example.com;

    ssl_certificate     /etc/ssl/rss.example.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/rss.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 40m;   # 网页上传备份最大 32 MB

    location / {
        proxy_pass http://127.0.0.1:8730;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
```

改完先 `nginx -t`，通过后再 `systemctl reload nginx`。

## 经过 Cloudflare 代理（橙色云）

- SSL/TLS 模式设为 **Full (strict)**，源站仍然要有有效证书（可以用 acme.sh 的 `dns_cf` 方式签发）。
- 让 nginx 只信任 Cloudflare 传来的访问者 IP，并拒绝绕过 Cloudflare 的直连：

```nginx
# http {} 中（Cloudflare 官方 IP 段：https://www.cloudflare.com/ips/）
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ……其余 Cloudflare 段
real_ip_header CF-Connecting-IP;
```

如果你的 443 端口由 nginx `stream` 按 SNI 分流（例如与代理程序共用 443），把新域名加进分流表，并参考 `ssl_preread` 时“仅为来自 Cloudflare 的连接打标记”的做法，在站点里用 `$realip_remote_addr` 判断是否来自可信入口。

::: tip 新域名刚生效时访问不了？
如果在 DNS 记录创建之前查询过这个域名，DNS 会把“不存在”缓存一段时间（Cloudflare 默认最多 30 分钟）。等缓存过期即可，无需改配置。
:::

## 备用入口

域名、证书或 Cloudflare 出问题时，用 SSH 隧道直连管理台：

```sh
ssh -N -L 8730:127.0.0.1:8730 user@your-server
```

然后打开 `http://localhost:8730`。登录 Cookie 只在实际使用 HTTPS 时才标记为 Secure，所以隧道里的 HTTP 访问在 Safari 等浏览器里也能正常登录。
