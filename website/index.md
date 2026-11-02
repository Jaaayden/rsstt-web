---
layout: home
title: 订阅、会话与推送，一处掌握
hero:
  name: RSStT Web
  text: 订阅、会话与推送，一处掌握。
  tagline: 带网页管理台的自托管 Telegram RSS 机器人。保留 RSS-to-Telegram-Bot 的全部命令与推送能力，再加上一个好用的管理台。
  image:
    src: /favicon.svg
    alt: RSStT Web
  actions:
    - theme: brand
      text: 快速部署
      link: /guide/deployment
    - theme: alt
      text: 交给 AI 部署
      link: /guide/deployment#交给-ai-部署
    - theme: alt
      text: GitHub
      link: https://github.com/Jaaayden/rsstt-web
features:
  - title: 看清机器人在为谁服务
    details: 私聊、群组、频道一目了然。设置角色、封禁陌生人、让机器人退出群组或频道，新会话出现时立刻通知你。
    link: /guide/console#会话
    linkText: 管理会话
  - title: 一个源，推送到多个会话
    details: 同一个 RSS 源只抓取一次，再分发给多个会话。在网页上增减接收会话，不用再 /unsub 后 /sub。
    link: /guide/console#订阅
    linkText: 管理订阅
  - title: 失败原因写得清清楚楚
    details: 运行日志直接告诉你是 HTTP 403、连接超时还是 RSS 格式错误，并能立即抓取、测试推送最新一篇。
    link: /guide/console#运行日志
    linkText: 排查问题
  - title: 通知到你的 Telegram
    details: 订阅源连续失败、恢复正常、有陌生人开始使用机器人，都由机器人直接私聊你。也支持 Bark、ntfy、Webhook。
    link: /guide/console#通知
    linkText: 配置通知
  - title: 原版数据，随时可退
    details: 数据库与原版完全兼容，迁移不会重复推送。管理台数据单独存放，任何时候都能换回原版。
    link: /guide/migration
    linkText: 迁移与回退
  - title: 轻量，一个镜像
    details: 单个 Docker 镜像，前端无需构建。以 429 个订阅源实测，比原版只多约 5 MB 内存、0.3% CPU。
    link: /guide/maintenance
    linkText: 升级与维护
---

<div class="shot"><img src="/console-overview.zh.png" alt="RSStT Web 概览页"></div>

## 三步上线

<div class="home-steps">
  <div><span class="number">01 / 准备</span><h3>一台有 Docker 的服务器</h3><p>从 @BotFather 拿到机器人 Token，再准备好你自己的 Telegram 数字 ID。</p></div>
  <div><span class="number">02 / 启动</span><h3>下载配置，填三个值</h3><p>Token、你的 ID 和管理台密码，一条命令拉取镜像并启动。</p></div>
  <div><span class="number">03 / 使用</span><h3>打开管理台</h3><p>机器人照常响应命令，网页上管理订阅、会话、通知与备份。</p></div>
</div>

```sh
mkdir -p /opt/rsstt-web && cd /opt/rsstt-web
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/compose.console.yaml
curl -fsSLo .env https://raw.githubusercontent.com/Jaaayden/rsstt-web/main/.env.console.example
chmod 600 .env && nano .env      # 填写 TOKEN、MANAGER、WEB_PASSWORD
docker compose up -d
```

[完整部署步骤 →](/guide/deployment) · [从原版迁移](/guide/migration) · [配置 HTTPS](/guide/https)

## 交给 AI 部署

把下面这个链接发给 Claude、ChatGPT 等能操作服务器的 AI，说一句“按这个部署 RSStT Web”。它会询问需要的信息，然后完成安装、迁移、HTTPS 和验证，并告诉你如何回退。

<div class="ai-box"><code>https://jaaayden.github.io/rsstt-web/deploy.md</code></div>

<div class="shot-pair">
  <div class="shot"><img src="/console-chats.zh.png" alt="会话管理"></div>
  <div class="shot"><img src="/console-subscription.zh.png" alt="订阅的接收会话"></div>
</div>
