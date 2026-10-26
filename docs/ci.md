# 二开版本的 CI

CI 按 Bot 兼容、Web、构建与静态分析分别检查。普通功能分支只在 PR 中运行；`main`、`dev` 和 `integration/**` 的推送运行组合版本检查。同一 PR 或分支的新提交会取消旧提交仍在运行的同类工作流，避免重复排队。

| 检查 | 自动覆盖 |
| --- | --- |
| Bot compatibility | Linux Python 3.9–3.13；macOS/Windows Python 3.13；脚本及模块入口、SQLite、Aerich helper |
| PostgreSQL and legacy migrations | PostgreSQL 16；Aerich 0.6 的 SQLite/PostgreSQL 数据库升级；升级后重复启动与迁移幂等性 |
| Web backend | Python 3.12、3.13 的后端与权限、统计等测试 |
| Browser and wheel | Node.js 22 / Chromium 页面流程；wheel 构建；所有 Web 模块与静态文件完整性；脱离源码目录的已安装包启动 |
| Docker build | amd64、默认依赖的镜像构建；无网络容器内导入 Web；实际 scratch 构建验证 Docker 上下文排除规则 |
| CodeQL | Python 与 JavaScript 静态分析 |

Bot 保留 `setup.cfg` 声明的 Python 3.9–3.13 支持。Web 的完整开发验收使用 Python 3.12/3.13；离线快照导出器需要 Python 3.11+。Bot 启动检查始终设置 `TOKEN=test`、`WEB_ENABLED=0`，不登录 Telegram、不连接真实机器人或线上数据库。命令行为由后端/专门的兼容回归测试覆盖，不能以启动成功代替真实 Telegram 验收。上游测试模式会把 `SystemExit: 0` 写为 ERROR 日志，CI 以进程退出码判断结果。

## 旧迁移固定源

旧版 fixture 固定来自上游提交 `ceb602209a629b8595c03d94a42e49c1a2b46084`，对应 `stale/aerich-0.6`。CI 使用独立目录和 Python 3.9 环境生成旧库，再由当前 Python 3.13 代码升级。它不依赖当前 fork 必须拥有旧分支，也不在当前检出目录来回切换分支。原矩阵在该 fork 中失败的原因是缺少这条旧分支；这不表示前面的新库启动或 PostgreSQL 检查失败。

## 构建与发布边界

Docker 检查只构建并加载临时镜像，`push: false`；验证容器使用 `--network none`。不会推送 Docker Hub、PyPI 或 Test PyPI。上游发布工作流在 fork 中已停用，源码中的 job 还限定原上游仓库身份，防止普通功能推送意外触发发布。版本发布应作为独立授权的工作处理。

`.dockerignore` 排除 `.preview`，包括真实快照压缩包和 `metadata.json`，以及演示/测试数据库、配置、凭据和依赖目录。`scripts/ci_docker_context.py` 在临时目录创建合成私有文件，用 scratch 构建检查这些文件确实不进入上下文；它不会读取真实预览数据。

## 本地检查

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/ci_bot_smoke.py
npm run test:e2e
python -m build --wheel --outdir dist
python scripts/ci_wheel_resources.py dist
```

浏览器测试须使用独立预览端口与测试数据库；不要复用正在供用户检查的真实数据预览。Docker 上下文检查需要正在运行的 Docker daemon：`python scripts/ci_docker_context.py`。本机 daemon 未运行时，镜像与上下文检查由 Actions 执行。

Actions 失败时应区分代码回归、测试/工作流问题与 runner/外部依赖故障；不能直接删除失败检查或把取消的旧运行描述为通过。每次交付以对应提交的最新检查结果为准。
