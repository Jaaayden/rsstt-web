# 低资源压力/增长验证：准备与当前证据

本文件是 PR 08 的后续验证准备。**组合版本的 Linux 受限资源验收尚未执行**；等待主会话给出 integration commit。当前环境为 macOS，Docker CLI 存在，但 daemon 不可连接。本轮没有启动 Docker、远程机器或任何真实服务。

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

## Linux 可复现预算与命令（待执行）

组合代码准备后，由主会话指定 integration commit，在隔离 checkout 构建原项目镜像。构建阶段可能安装依赖；下面**测试运行阶段断网**。不修改 Dockerfile、CI workflow 或生产依赖。先记录 commit、image ID、Docker/Linux/CPU 架构与 cgroup 版本，输出与提交对应。

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
  --rounds 60 --latency-ms 10 > /tmp/rsstt-resource-stable.jsonl
# 相同命令末尾加 --churn，输出改为 /tmp/rsstt-resource-churn.jsonl。
# 固定集合延长验证：将 --rounds 60 改为 --rounds 1800。
```

测试临时数据库位于 /tmp，tmpfs 占用计入 cgroup 内存预算；预算结果同时受数据库规模影响。容器日志/JSONL 文件由宿主机保存。Linux cgroup v2 才可直接读取当前脚本中的 `memory.max/cpu.max` 等路径；若输出 null，必须先从容器检查补充资源限制证据，不能宣称限制已生效。

第二档可增加至 500 来源 × 20 目的地 × 2 条，保持预算以暴露峰值压力；若 OOM/超时如实记录输入规模与退出状态，不提高预算后抹去失败。可再用 1 GiB 做对照，但须分别报告。完整长测预计超过交互回合，应在组合版本可用后由主会话决定运行方式，本轮未启动长测。

验收时记录：

1. cgroup 限制实际值、进程退出码与 `memory.events` 是否出现 OOM；OOM 杀进程可能没有末行 JSON，须由容器状态佐证，不能当成成功。
2. 完整性/顺序断言以及任务/FD 是否回到稳定空闲水平。
3. 排除前 5 轮后当前 RSS 随轮数的曲线和增长速率，同时记录字典条数；增长的对象计数不能被 GC 或 RSS 高水位解释掉。
4. 查询延迟、事件循环延迟、峰值任务数、CPU 秒与消息数。有限负载通过仅证明这一预算与输入下通过，不证明任意来源数、故障或长时间生产稳定。

组合版本可能改变统计/生命周期内部接口；拿到 integration commit 后先运行小规模冒烟并按实际接口调整测试，随后再执行受限 Linux 预算。用户第 16 项仍处于待验收状态。
