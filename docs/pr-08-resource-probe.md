# 低资源压力/增长验证：准备与当前证据

本文件记录 PR 08 的资源验证证据。**当前组合 `ef2e166` 的后端 149/149、浏览器 24/24（0 skip）通过，结果由主会话提供；历史 3 个组合测试失败已全部修复。Linux 受限资源结果仍由主会话统一收集，尚未据此完成第 16 项验收。** 本会话已停止重复复测，不启动本机 Docker；当前环境为 macOS，未运行 Linux 容器、远程机器或任何真实服务。

## 有证据的小修复

修改前新增生命周期回归实际运行得到 `4 failed, 1 passed`：

1. 对 10,000 个 Feed ID 执行完成状态转换，Monitor 字典仍保留 10,000 条 `EMPTY`；只读检查不存在的 ID 也会通过 defaultdict 建立记录。现在只读使用 `.get`，最后一个状态清除后删除 key。`LOCKED`、`IN_PROGRESS`、`DEFERRED` 的处理顺序、重投次数和冷却时间不变。
2. 访问 10,000 个域名后，即使调用方没有任何信号量引用，原域名字典仍强引用全部信号量。现在使用 `WeakValueDictionary`：请求的局部变量、持有者和等待 acquire 的协程保留活动信号量；没有调用方后自动移除。没有 TTL/LRU、没有淘汰活动锁，也没有改变并发配置或请求顺序。

`tests/management/test_resource_lifecycle.py` 验证：完成/不存在 ID 不累计；两种完成/解锁先后顺序均只重投一次；异常和取消只清除运行状态而保留冷却；同域调用共享同一信号量；等待及取消不拆锁；空闲域名可释放。完整后端回归已达 **64 passed**。

未改的用户相关缓存：

- `locks._user_bucket` 强引用消息锁、flood 锁、上传信号量和 pending callback set；调用方只持有子对象而非桶本身。直接将桶改成弱值字典会在锁仍被使用时回收桶，之后同一用户可能获得另一组锁，破坏互斥。因此本轮不做这种替换。
- `MessageDispatcher.user_sending_lock` 同样按见过的用户长期保留锁；Notifier 的 blocked 锁/计数也需独立分析封禁计数语义。没有通过清空字典掩盖这些增长。
- Monitor/Notifier 为每个来源/订阅生成任务，没有新增总任务数硬上限。本次不改排队、超时或发送顺序。

## 测试路径与可证明内容

脚本：`scripts/stress_resources.py`，只使用现有生产依赖及 Python 标准库。

执行真实的 SQLite ORM、EffectiveTasks 初始化、Monitor/Notifier、feedparser、Post 文本格式化、MessageDispatcher、Message.send、统计持久化，并在每轮开始时并发执行一次管理订阅查询。替换边界仅为：

- RSS 传输：在真实 HTTP 全局/域名信号量内模拟延迟，将生成的 RSS XML 交给 feedparser；不启动 HTTP server。
- Telegram：以 MockTelegram 替代客户端，验证生成实体可作真实 TL 编码并记录消息；不启动 Telethon 网络连接。

每轮验证：每个共享来源只调用一次抓取、全部目的地收到条目且无遗漏/重复、同一来源内按旧到新顺序发送、后台任务排空、Monitor 无已完成状态残留。合成 RSS 使用无媒体短文本；不证明媒体、真实 HTTP、FloodWait、权限失败、外部重试或 Telegram 服务端行为。冷却设为 0 以快速执行轮次，其两种非零状态释放顺序由单元回归覆盖；未运行真实 wall-clock 定时调度。

所有 INET/INET6 外连（含 loopback）及 DNS 由审计钩子拒绝。脚本只在独立临时目录建立数据库，不打开真实 config/session，不监听端口。JSONL 每轮输出 CPU、Linux 当前 RSS/峰值 RSS/FD、抽样任务峰值、事件循环最大延迟、查询耗时、缓存计数；最终输出 cgroup memory.events 和预热后 RSS 差值。50ms 抽样可能漏掉短峰值；峰值 RSS 是高水位，不能用来判断当前 RSS 平台。

## 已运行的本机冒烟（不是 Linux 限额结论）

```bash
.venv/bin/python scripts/stress_resources.py --sources 100 --targets 10 --rounds 10 --latency-ms 1
.venv/bin/python scripts/stress_resources.py --sources 100 --targets 10 --rounds 10 --latency-ms 1 --churn
```

每轮 100 来源、10 目的地、2 篇/来源；每组共 20,000 次 mock 发送。第二组每轮删除并重建来源/目的地，ID 和域名继续增长。原始输出保存为 `pr-08-resource-stable-smoke.jsonl` / `pr-08-resource-churn-smoke.jsonl`。

| 观察 | 稳定集合 | 新增/删除集合 |
| --- | --- | --- |
| 完整性及顺序断言 | 全部通过 | 全部通过 |
| 每轮结束 Monitor / 域名缓存 | 0 / 0 | 0 / 0 |
| 用户桶 / dispatcher 锁 | 保持 10 / 10 | 从 10 / 10 增至 100 / 100 |
| 每轮结束任务（含脚本主任务） | 1 | 1 |
| 抽样活动任务峰值 | 1,854 | 1,849 |
| 最大发现的 loop lag | 34.091 ms | 30.749 ms |
| 进程峰值 RSS | 约 152.0 MiB | 约 154.0 MiB |

macOS 下未提供当前 RSS/FD/cgroup 数据，JSON 明确为 null；不能从上述峰值声称长期内存稳定。运行时 macOS sandbox 拒绝 `os.nice`，线程初始化仅记录警告后继续；断言和发送计数全部完成。后台任务能排空并不表示峰值任务数有硬边界。用户锁随历史用户数增长已有直接证据，需要后续按真实生命周期单独处理。

## Linux 可复现预算与命令（由主会话统一收集结果）

主会话已安排 CI 专责按以下预算准备断网资源 probe job；本会话不修改 workflow、不启动本机 Docker。执行时由主会话指定 integration commit，在隔离 checkout 构建原项目镜像。构建阶段可能安装依赖；下面**测试运行阶段断网**。不修改 Dockerfile、CI workflow 或生产依赖。先记录 commit、image ID、Docker/Linux/CPU 架构与 cgroup 版本，输出与提交对应。

建议第一档预算：1 vCPU、512 MiB 内存、禁止 swap、128 pids、1024 FDs；固定集合和 churn 各运行 60 轮，随后固定集合延长到 1800 轮。脚本明确使用 HTTP 全局 32、单域 4、单进程，生产默认值未修改。

```bash
# 在指定 integration checkout，镜像 tag 应包含真实 commit。
docker build -t rsstt-resource:INTEGRATION_COMMIT .

# 生产镜像已有 /app/src；仅将测试脚本只读挂载到 /app/scripts。
docker run --rm --network none --read-only \
  --cpus 1 --memory 512m --memory-swap 512m --pids-limit 128 \
  --ulimit nofile=1024:1024 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --mount "type=bind,src=$PWD/scripts/stress_resources.py,dst=/app/scripts/stress_resources.py,readonly" \
  --entrypoint /opt/venv/bin/python rsstt-resource:INTEGRATION_COMMIT \
  /app/scripts/stress_resources.py --sources 100 --targets 10 --hosts 8 \
  --rounds 60 --latency-ms 10 --require-cgroup-limits > /tmp/rsstt-resource-stable.jsonl
# 相同命令末尾加 --churn，输出改为 /tmp/rsstt-resource-churn.jsonl。
# 固定集合延长验证：将 --rounds 60 改为 --rounds 1800。
```

测试临时数据库位于 /tmp，tmpfs 占用计入 cgroup 内存预算；预算结果同时受数据库规模影响。容器日志/JSONL 文件由宿主机保存。Linux cgroup v2 才可直接读取当前脚本中的 `memory.max/cpu.max` 等路径；指定 `--require-cgroup-limits` 后，缺少有限 CPU/内存/pid cgroup v2 限制会直接失败；仍须核对输出的具体限额符合本次预算。

第二档可增加至 500 来源 × 20 目的地 × 2 条，保持预算以暴露峰值压力；若 OOM/超时如实记录输入规模与退出状态，不提高预算后抹去失败。可再用 1 GiB 做对照，但须分别报告。完整长测预计超过交互回合，应在组合版本可用后由主会话决定运行方式，本轮未启动长测。

验收时记录：

1. cgroup 限制实际值、进程退出码与 `memory.events` 是否出现 OOM；OOM 杀进程可能没有末行 JSON，须由容器状态佐证，不能当成成功。
2. 完整性/顺序断言以及任务/FD 是否回到稳定空闲水平。
3. 排除前 5 轮后当前 RSS 随轮数的曲线和增长速率，同时记录字典条数；增长的对象计数不能被 GC 或 RSS 高水位解释掉。
4. 查询延迟、事件循环延迟、峰值任务数、CPU 秒与消息数。有限负载通过仅证明这一预算与输入下通过，不证明任意来源数、故障或长时间生产稳定。

组合版本可能继续改变统计/生命周期内部接口；更新提交后先小规模冒烟，再执行受限 Linux 预算。用户第 16 项仍处于待验收状态。

## 组合版本本机复测（2026-10-26）

主会话给出的固定组合提交：`4df444f01068da84e3d2b578f36e2f678ba24a96`。在本 PR 的 `.test-data/integration-probe` 独立 detached worktree 上仅应用生命周期修复提交 `b7aeb0e`，得到本地测试提交 `675a2ec`。没有修改主会话 worktree，没有把组合功能并入本 PR。此测试运行期间未使用浏览器或主预览端口。

基线脚本在组合版本无需修改即可运行；原始数据为 `pr-08-integration-baseline.json`。相同 20 次顺序测量、相同合成数据，5 万订阅结果：

| 操作 | 基础版中位 ms | 组合版中位 / p95 ms |
| --- | --- | --- |
| 订阅首页 | 1.572 | 1.674 / 1.781 |
| 订阅搜索 | 62.290 | 64.255 / 65.658 |
| 会话列表 | 32.019 | 31.505 / 32.945 |
| 仪表盘 | 16.878 | 85.040 / 86.667 |
| 统计事务 | 0.192 | 0.344 / 0.457 |
| 2,500 项会话 `/list` | 44.624 | 41.176 / 44.817 |

仪表盘新增活跃使用量统计会执行按订阅/来源状态过滤的 distinct 用户聚合和元数据类型纠正，应优先在 Linux 限额复核这一查询路径。这里没有通过缓存旧结果或跳过统计来改善分数，也没有改动 PR 04 的实现；时延增加不能仅凭源码就归因到某条 SQL，若限额结果超预算需要进一步查询级剖析。

组合版 100 来源 × 10 目的地 × 2 条，稳定/churn 各 10 轮（每组 20,000 次 mock 发送）都通过完整性与顺序断言，原始数据为 `pr-08-integration-stable-smoke.jsonl` / `pr-08-integration-churn-smoke.jsonl`。两组抽样任务峰值均 1,708，最大 loop lag 分别 28.595 / 26.350 ms；空闲任务数均 1，Monitor/域名缓存每轮归零。稳定用户锁保持 10，churn 两类用户锁各增长到 100，剩余增长没有消失。进程峰值 RSS 分别约 150.1 / 152.7 MiB；macOS 缺少当前 RSS，因此仍不证明长期内存平台。

**以下为旧组合 `4df444f` 的历史失败，均已修复，不属于当前未完成项。** 当时全套 `pytest` 为 **146 passed / 3 failed**，本 PR 新增 Bot/生命周期测试通过；本会话未跨范围修补：

- `test_backups.py::test_extensions_hourly_and_queue_exclusion`：测试再次 `CREATE TABLE metrics_hourly`，但统计初始化已建表，抛 `sqlite3.OperationalError: table metrics_hourly already exists`。
- `test_backups_restart.py::test_web_staging_then_real_offline_process_restart`：自建 8746 端口子进程启动等待超时；脚本清理了自己的子进程，当时具体原因未确认，后续主会话修正启动测试后已通过。
- `test_statistics.py::test_cancellation_rolls_back_and_two_connections_agree`：第二个 Store 打开同一路径时被备份的 InstanceLock 拒绝，报“实例正在运行”；测试的双连接前提与独占锁相冲突。

pytest 已打印上述结果后因失败路径遗留线程未退出，手动中断测试进程；没有将该全套测试标记为成功。当前功能分支自身仍为 **64 passed**。组合版压力脚本通过不覆盖这些备份/统计失败，也未启动完整生产管理通知生命周期。当时 Linux 预算测试、长测及跨模块失败仍待完成；后续状态见下段。

### 最新组合复核

主会话修正上述测试后，将 `27aa590577852a185471cff2b72851f975774863` 合入独立验证 worktree，得到本地测试提交 `14fa60ccd351f51c0db3f3874f04dada1be8298f`。完整后端结果 **149 passed, 1 warning，10.55s**，测试进程正常退出；先前 3 个失败已不再复现。相对 `4df444f` 的改动只有测试/文档，无生产源码变化，因此保留原组合性能测量，不重复同组负载。主会话给出的其他浏览器验证结果未作为本会话实测证据。

资源脚本新增 `--require-cgroup-limits`；在当前 macOS 上已验证该标志以退出码 2 拒绝运行，不能把普通本机运行误当成 Linux 受限环境。未运行任何 Linux 容器/长测，尚不能宣布用户第 16 项全部通过。当前可交给 CI 的预算为 1 vCPU / 512 MiB（禁 swap）/ 128 pids / 1024 FDs，运行命令见上文。

### 主会话最终组合确认（2026-10-26）

主会话确认 integration `ef2e166b8a85e108935c41de29116333156fda07` 已包含本 PR 的 `1847015` 及生命周期修复，实际后端 **149/149**、浏览器 **24/24，0 skip** 通过。此处明确引用主会话验收报告，不冒充本会话再次运行。旧 3 项失败已全部修复，本会话没有继续重复同套测试。

CI 专责已收到按本文件新增 1 CPU / 512 MiB、网络禁用资源 probe job 的安排；job 建立及运行结果由主会话统一收集。本文件尚无 Linux 限额/长期增长通过结论；剩余用户锁历史增长、监控任务无总量硬上限和真实 Telegram 未验证的边界仍有效。
