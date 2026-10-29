# 使用独立机器人做联网验收

需要验证真实 RSS 请求、Telegram 发送、频道权限和外部通知时，使用独立测试机器人与测试频道。原机器人继续运行，测试实例使用自己的 Bot Token、Telegram session、数据库和管理台密码。

通过 [BotFather 的 `/newbot`](https://core.telegram.org/bots/features#creating-a-new-bot) 创建测试机器人。不要把生产 Bot Token、`bot.session`、数据库备份或整个 `config/` 复制到测试实例；生产备份带有真实接收会话，直接联网运行可能向它们推送。

## 启动测试实例

使用包含本文件且已经通过 CI 的独立检出目录，记录 `git rev-parse HEAD` 的结果，方便复测和回退。不要在正在运行原机器人的目录内执行下面的命令。

```sh
cp .env.testing.example .env.testing
chmod 600 .env.testing
```

编辑 `.env.testing`，填写新测试机器人的 Token、你的 Telegram 数字用户 ID 和独立的管理台密码。密码至少 16 个字符，可以用 `openssl rand -hex 24` 生成。文件已被 Git 和 Docker 构建上下文排除。

```sh
docker compose -p rsstt-web-test --env-file .env.testing -f compose.testing.yaml config --quiet
docker compose -p rsstt-web-test --env-file .env.testing -f compose.testing.yaml up -d --build
docker compose -p rsstt-web-test --env-file .env.testing -f compose.testing.yaml logs --tail=100 rsstt-test
```

这份文件使用独立镜像 `rsstt-web:testing`、服务 `rsstt-test` 和项目内的数据卷。宿主机只在 `127.0.0.1:8735` 提供管理台。Compose 项目名用于隔离容器、网络和数据卷；`-p rsstt-web-test` 应在每次命令中保持一致，参见 [Docker 项目名说明](https://docs.docker.com/compose/how-tos/project-name/)。不要把本文件叠加到生产 Compose 文件上。

`MULTIUSER=0` 关闭陌生人的默认使用权限。管理者以及显式授予用户／会话权限的对象仍可使用；不要把测试频道授权给陌生人。

如果实例运行在服务器，通过本机终端建立 SSH 隧道：

```sh
ssh -N -L 8735:127.0.0.1:8735 -p PORT USER@HOST
```

打开 `http://127.0.0.1:8735`，使用测试管理台密码登录。这里需要保持默认 `TEST_WEB_ORIGIN=http://127.0.0.1:8735`。SSH 隧道断开后网页不可达，但测试机器人继续运行。

## 按顺序验收

1. 私聊测试机器人并发送 `/start`；新建私有测试群组或频道，加入测试机器人，按上游要求授予发送权限。在网页确认测试会话的名称和状态。
2. 从真实数据快照预览导出少量订阅的 OPML，只向测试会话导入。OPML 可以带有私有 RSS 地址，应留在私有环境；它不复制原接收会话或 Telegram session。先选择 2–3 个来源，避免短时间重复抓取全部生产来源。
3. 在订阅设置中执行“检查更新并推送”。该动作按同一来源共享抓取和去重，有新文章才向启用的接收会话推送；没有新文章时不发送旧文章。
4. 执行“测试推送最新一篇”，确认当前测试会话收到内容。它可能重复已收到的最新文章，只用于当前接收会话，不修改定时抓取的去重基线。
5. 打开“最近文章”，检查标题、摘要和当前测试会话的推送状态。把同一个来源订阅到第二个测试会话，确认两个会话的发送结果分别记录；只有 Telegram 确认完整发送才显示已推送。查看抓取和推送日志，再用一个可控的无效 RSS 地址验证失败说明。检查权限不足、暂停／恢复、封禁、新会话通知、手机返回操作。外部通知测试会真实发送，请使用测试渠道。
6. 重启一次测试容器，确认订阅、日志和密码保留；浏览器需要重新登录是正常的会话撤销行为。

页面显示“推送已提交”时，仅表示抓取流程已安排发送；以测试会话实际收到内容、运行日志和确认的推送统计判断送达。离线快照不执行真实抓取或推送，纯示例模式的模拟结果也不代表联网验收成功。

## 停止与切换生产

```sh
docker compose -p rsstt-web-test --env-file .env.testing -f compose.testing.yaml stop
```

停止不会删除测试数据卷。后续 `up -d` 可以继续验收，替换 `.env.testing` 的密码也不会覆盖数据库里已有的密码，应在网页改密。

联网验收通过后，生产迁移应作为单独步骤执行：记录测试通过的提交，备份原实例及配置，停止原进程，再用该提交构建的增强版接管同一份生产数据和 Telegram session。同一 session／数据库只运行一个进程。测试实例不直接改绑生产 Token，也不要用测试备份覆盖生产数据。需要回退时先停止增强版，再按升级前的完整备份恢复原版。
