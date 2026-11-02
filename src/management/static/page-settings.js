import {
    html,
    useState,
    useEffect,
    useRef,
    useAsync,
    useRoute,
    Icon,
    Button,
    Field,
    Input,
    Textarea,
    Select,
    Switch,
    Segmented,
    Spinner,
    Empty,
    Notice,
    Badge,
    Modal,
    ChatPicker,
    confirm,
    Copy,
    SearchInput,
} from "./ui.js";
import { L, api, qs, num, dateTime, readRoute, setParams, toast, download, app, emit } from "./core.js";

const SECTIONS = [
    ["general", "sliders", () => L("订阅规则", "Subscription rules")],
    ["notifications", "bell", () => L("通知", "Notifications")],
    ["runtime", "server", () => L("运行配置", "Runtime")],
    ["backup", "archive", () => L("备份与恢复", "Backup & restore")],
    ["tokens", "key", () => L("API 访问", "API access")],
    ["account", "shield", () => L("账户与安全", "Account")],
];

export function Settings() {
    useRoute();
    const { params } = readRoute();
    const section = SECTIONS.some(([k]) => k === params.section) ? params.section : "general";
    const View = { general: General, notifications: Notifications, runtime: Runtime, backup: Backup, tokens: Tokens, account: Account }[
        section
    ];
    return html`
        <div class="page-head">
            <div>
                <h1>${L("设置", "Settings")}</h1>
                <p>
                    ${L(
                        "机器人命令能改的设置在这里都能改；原本写在 docker-compose 环境变量里的配置也可以在“运行配置”中修改。",
                        "Everything the bot's commands can change, plus deployment variables under Runtime.",
                    )}
                </p>
            </div>
        </div>
        <div class="settings-layout">
            <nav class="subnav">
                ${SECTIONS.map(
                    ([key, icon, label]) =>
                        html`<button class=${key === section ? "on" : ""} onClick=${() => setParams({ section: key })}>
                            <${Icon} name=${icon} />${label()}
                        </button>`,
                )}
            </nav>
            <div class="stack"><${View} key=${section} /></div>
        </div>
    `;
}

function Card({ title, description, children, footer }) {
    return html`<section class="card">
        <div class="card-head">
            <div>
                <h2>${title}</h2>
                ${description ? html`<div class="sub">${description}</div>` : null}
            </div>
        </div>
        <div class="card-body">${children}</div>
        ${footer ? html`<div class="drawer-foot" style="border-radius:0 0 var(--radius-lg) var(--radius-lg)">${footer}</div>` : null}
    </section>`;
}

function SaveBar({ dirty, busy, onReset, onSave }) {
    return html`${dirty ? html`<span class="dirty"><${Icon} name="edit" />${L("有未保存的修改", "Unsaved changes")}</span>` : null}
        <${Button} disabled=${!dirty} onClick=${onReset}>${L("还原", "Reset")}<//>
        <${Button} kind="primary" disabled=${!dirty} loading=${busy} onClick=${onSave}>${L("保存", "Save")}<//>`;
}

/* ---------- restart ---------- */
function RestartProgress({ close }) {
    const [phase, setPhase] = useState("stopping");
    useEffect(() => {
        let alive = true;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const boot = async () => {
            try {
                const r = await fetch("/api/public", { cache: "no-store" });
                return r.ok ? (await r.json()).boot : null;
            } catch {
                return null;
            }
        };
        (async () => {
            const before = app.info.boot;
            const started = Date.now();
            while (alive && Date.now() - started < 180000) {
                await sleep(2000);
                const now = await boot();
                if (!alive) return;
                if (now === null) setPhase("starting");
                else if (now !== before) {
                    setPhase("done");
                    await sleep(800);
                    location.reload();
                    return;
                }
            }
            if (alive) setPhase("timeout");
        })();
        return () => (alive = false);
    }, []);
    const text = {
        stopping: L("正在停止机器人…", "Stopping the bot…"),
        starting: L("正在重新启动，通常需要 10–30 秒…", "Starting again, usually 10–30 seconds…"),
        done: L("已恢复，正在刷新页面…", "Back online, reloading…"),
        timeout: L(
            "3 分钟内没有检测到机器人恢复。请到服务器上查看容器状态和日志（docker ps、docker logs）。",
            "The bot didn't come back within 3 minutes. Check the container on the server (docker ps, docker logs).",
        ),
    }[phase];
    return html`<${Modal} title=${L("重启机器人", "Restarting the bot")} onClose=${phase === "timeout" ? close : () => {}}>
        ${phase === "timeout" ? html`<${Notice} tone="error">${text}<//>` : html`<${Spinner} label=${text} />`}
    <//>`;
}

export async function restartBot(restart) {
    const outside = restart && !restart.container;
    const ok = await confirm({
        title: L("立即重启机器人？", "Restart the bot now?"),
        body: html`<p>
                ${L(
                    "机器人会正常退出，再由 Docker 自动启动，通常 10–30 秒。期间暂停推送，恢复后会继续检查更新，不会丢订阅。重启后需要重新登录网页。",
                    "The bot exits cleanly and Docker starts it again, usually in 10–30 seconds. Delivery pauses meanwhile and resumes afterwards; no subscriptions are lost. You'll need to sign in again.",
                )}
            </p>
            ${outside
                ? html`<div style="margin-top:10px">
                      <${Notice} tone="warn" title=${L("没有检测到容器环境", "No container detected")}>
                          ${L(
                              "看起来机器人不是在 Docker 里运行。只有配置了 systemd、pm2 等进程管理器自动拉起时才能用这个按钮，否则机器人会停止，需要你手动启动。",
                              "The bot doesn't seem to run in Docker. Only use this if a process manager (systemd, pm2…) restarts it automatically; otherwise it will stop until you start it by hand.",
                          )}
                      <//>
                  </div>`
                : null}`,
        ok: L("立即重启", "Restart now"),
        danger: true,
    });
    if (!ok) return;
    try {
        await api("/system/restart", { method: "POST", body: { confirm: true } });
    } catch (err) {
        toast(err.message, "error");
        return;
    }
    openModal((close) => html`<${RestartProgress} close=${close} />`);
}

function RestartButton({ size, kind = "secondary" }) {
    const settings = useAsync(() => api("/settings"), []);
    const restart = settings.data?.restart;
    if (!restart?.supported) return null;
    return html`<${Button} size=${size} kind=${kind} icon="refresh" onClick=${() => restartBot(restart)}
        >${L("立即重启", "Restart now")}<//
    >`;
}

/* ---------- general ---------- */
function General() {
    const { data, error, reload } = useAsync(() => api("/settings"), []);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const base = data && {
        ...data.options,
        attention_threshold: Number(data.console.attention_threshold),
        fetch_run_rows: Number(data.console.fetch_run_rows) || 20,
    };
    useEffect(() => base && setDraft(base), [data]);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!draft) return html`<${Spinner} />`;
    const dirty = Object.keys(draft).filter((k) => draft[k] !== base[k]);
    const num = (key) => (v) => setDraft({ ...draft, [key]: v === "" ? "" : Number(v) });
    async function save() {
        setBusy(true);
        try {
            await api("/settings", { method: "PATCH", body: Object.fromEntries(dirty.map((k) => [k, draft[k]])) });
            toast(L("已保存", "Saved"));
            reload(true);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy(false);
        }
    }
    return html`<${Card}
        title=${L("订阅规则", "Subscription rules")}
        description=${L(
            "全局默认值，等同于机器人里的 /set_option。立即生效。",
            "Global defaults, same as /set_option in the bot. Applied immediately.",
        )}
        footer=${html`<${SaveBar} dirty=${dirty.length} busy=${busy} onReset=${() => setDraft(base)} onSave=${save} />`}
    >
        <div class="form-grid">
            <${Field}
                label=${L("默认检查间隔（分钟）", "Default interval (min)")}
                hint=${L("没有单独设置间隔的订阅都用这个值。", "Used by subscriptions without their own interval.")}
            >
                <${Input} type="number" min=${draft.minimal_interval} value=${draft.default_interval} onInput=${num("default_interval")} />
            <//>
            <${Field}
                label=${L("最短检查间隔（分钟）", "Minimum interval (min)")}
                hint=${L("用户自定义间隔不能低于它。", "Users can't set an interval below this.")}
            >
                <${Input} type="number" min="1" value=${draft.minimal_interval} onInput=${num("minimal_interval")} />
            <//>
            <${Field} label=${L("每个用户的订阅上限", "Subscription limit per user")} hint=${L("-1 表示不限。", "-1 = unlimited.")}>
                <${Input} type="number" min="-1" value=${draft.user_sub_limit} onInput=${num("user_sub_limit")} />
            <//>
            <${Field} label=${L("每个频道/群组的订阅上限", "Limit per channel/group")} hint=${L("-1 表示不限。", "-1 = unlimited.")}>
                <${Input} type="number" min="-1" value=${draft.channel_or_group_sub_limit} onInput=${num("channel_or_group_sub_limit")} />
            <//>
            <div class="full">
                <${Field}
                    label=${L("达到上限时的提示", "Message when the limit is reached")}
                    hint=${L("留空则使用机器人的默认提示。支持 HTML。", "Empty uses the bot's default. HTML allowed.")}
                >
                    <${Textarea}
                        rows="3"
                        value=${draft.sub_limit_reached_message}
                        onInput=${(v) => setDraft({ ...draft, sub_limit_reached_message: v })}
                    />
                <//>
            </div>
            <${Field}
                label=${L("“抓取异常”的判定阈值", "“Failing” threshold")}
                hint=${L(
                    "连续失败达到这个次数，就在网页上标为异常。",
                    "Consecutive failures before a subscription is marked as failing here.",
                )}
            >
                <${Input} type="number" min="1" max="100" value=${draft.attention_threshold} onInput=${num("attention_threshold")} />
            <//>
            <${Field}
                label=${L("每个订阅源保留的抓取记录", "Fetch-run rows kept per feed")}
                hint=${L(
                    "结果相同的连续检查合并成一行，所以 20 行通常能覆盖很长时间。5–200。",
                    "Identical consecutive checks share a row, so 20 rows usually cover a long time. 5–200.",
                )}
            >
                <${Input} type="number" min="5" max="200" value=${draft.fetch_run_rows} onInput=${num("fetch_run_rows")} />
            <//>
        </div>
    <//>`;
}

/* ---------- notifications ---------- */
const CHANNELS = [
    {
        key: "bot",
        name: () => L("通过本机器人发给我", "Message me via this bot"),
        desc: () =>
            L(
                "由正在运行的机器人私聊发给所有者（MANAGER）。无需额外配置，推荐。",
                "The running bot DMs the owner (MANAGER). No setup needed — recommended.",
            ),
        fields: [],
    },
    {
        key: "telegram",
        name: () => L("另一个 Telegram 机器人", "Another Telegram bot"),
        desc: () => L("用单独的机器人 Token 发到指定会话。", "Send through a separate bot token to a chat of your choice."),
        fields: [
            ["token", "Bot Token", "123456:ABC…", true],
            ["chat_id", () => L("接收者 ID 或 @频道", "Recipient ID or @channel"), "123456789"],
        ],
    },
    {
        key: "bark",
        name: () => "Bark",
        desc: () => L("iOS 推送。填写 Bark App 里的完整推送地址。", "iOS push. Paste the full push URL from the Bark app."),
        fields: [["url", () => L("推送地址", "Push URL"), "https://api.day.app/YOUR_KEY", true]],
    },
    {
        key: "ntfy",
        name: () => "ntfy",
        desc: () => L("自建或公共的 ntfy 服务。", "Self-hosted or public ntfy server."),
        fields: [
            ["url", () => L("服务器地址", "Server URL"), "https://ntfy.sh"],
            ["topic", "Topic", "rsstt-alerts"],
            ["token", () => L("访问令牌（可选）", "Access token (optional)"), "", true],
        ],
    },
    {
        key: "webhook",
        name: () => "Webhook",
        desc: () => L("以 JSON POST 到你的地址，适合接入其他自动化。", "POSTs JSON to your endpoint, for other automation."),
        fields: [["url", () => L("地址", "URL"), "https://example.com/hook", true]],
    },
];

function Notifications() {
    const { data, error, setData } = useAsync(() => api("/notifications"), []);
    const history = useAsync(() => api("/notifications/history"), []);
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState("");
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    const p = data.policy;
    async function patch(body, label) {
        setBusy(label);
        try {
            setData(await api("/notifications", { method: "PATCH", body }));
            toast(L("已保存", "Saved"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function test(channel) {
        setBusy("test-" + channel);
        try {
            const result = await api("/notifications/test", { method: "POST", body: { channel } });
            toast(
                result.simulated
                    ? L("离线模式：已模拟发送", "Offline: simulated")
                    : L("测试通知已加入发送队列", "Test notification queued"),
            );
            setTimeout(() => history.reload(true), 2500);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    const statusTone = { sent: "green", simulated: "blue", pending: "amber", failed: "red", cancelled: "neutral" };
    const statusName = {
        sent: L("已发送", "Sent"),
        simulated: L("已模拟", "Simulated"),
        pending: L("等待重试", "Retrying"),
        failed: L("失败", "Failed"),
        cancelled: L("已取消", "Cancelled"),
    };
    const eventName = {
        "fetch.failed": L("抓取连续失败", "Feed failing"),
        "fetch.recovered": L("抓取恢复", "Feed recovered"),
        "user.first_seen": L("新会话", "New chat"),
        test: L("测试", "Test"),
    };
    return html`
        <${Card}
            title=${L("什么时候通知我", "When to notify me")}
            description=${L(
                "机器人在 Telegram 上可以被任何人搜到并使用；打开“新会话”通知，陌生人一开始用就能知道。",
                "Anyone can find and use the bot on Telegram; turn on new-chat alerts to know when a stranger starts using it.",
            )}
        >
            ${data.offline
                ? html`<div style="margin-bottom:10px">
                      <${Notice} tone="warn"
                          >${L(
                              "当前是离线/演示实例，通知只会模拟，不会真的发出。",
                              "Offline/demo instance: notifications are simulated, not sent.",
                          )}<//
                      >
                  </div>`
                : null}
            <${Switch}
                label=${L("启用通知", "Enable notifications")}
                description=${L("总开关。关闭时不会发出任何通知（测试除外）。", "Master switch. Nothing is sent while off (except tests).")}
                checked=${p.enabled}
                disabled=${!!busy}
                onChange=${(v) => patch({ policy: { enabled: v } }, "policy")}
            />
            <${Switch}
                label=${L("有新会话开始使用机器人时", "When a new chat starts using the bot")}
                description=${L("新用户私聊、机器人被拉进新的群组或频道。", "A new private user, or the bot added to a new group/channel.")}
                checked=${p.new_users}
                disabled=${!!busy || !p.enabled}
                onChange=${(v) => patch({ policy: { new_users: v } }, "policy")}
            />
            <div class="form-grid" style="margin-top:12px">
                <${Field}
                    label=${L("订阅源连续失败多少次时通知", "Notify after this many consecutive failures")}
                    hint=${L("恢复正常后也会通知一次。", "You'll also be told when it recovers.")}
                >
                    <${Select}
                        value=${p.threshold}
                        disabled=${!p.enabled}
                        onChange=${(v) => patch({ policy: { threshold: Number(v) } }, "policy")}
                        options=${[1, 2, 3, 5, 10, 20, 50].map((n) => [n, L(`${n} 次`, `${n}`)])}
                    />
                <//>
                <${Field}
                    label=${L("同一订阅源的最短通知间隔", "Minimum gap per feed")}
                    hint=${L("避免同一个源反复提醒。", "Avoids repeat alerts for the same feed.")}
                >
                    <${Select}
                        value=${p.cooldown}
                        disabled=${!p.enabled}
                        onChange=${(v) => patch({ policy: { cooldown: Number(v) } }, "policy")}
                        options=${[
                            [600, L("10 分钟", "10 min")],
                            [3600, L("1 小时", "1 hour")],
                            [21600, L("6 小时", "6 hours")],
                            [86400, L("1 天", "1 day")],
                            [604800, L("7 天", "7 days")],
                        ]}
                    />
                <//>
            </div>
        <//>
        <${Card}
            title=${L("发送渠道", "Channels")}
            description=${L("至少启用一个渠道才能收到通知。", "Enable at least one channel to receive notifications.")}
        >
            <div class="panel">
                ${CHANNELS.map((c) => {
                    const state = data.channels[c.key];
                    return html`<div class="list-row" style="align-items:flex-start">
                        <span class="grow">
                            <span class="title"
                                >${c.name()}
                                ${state
                                    ? html`<${Badge} tone=${state.enabled ? "green" : "neutral"}
                                          >${state.enabled ? L("已启用", "On") : L("已停用", "Off")}<//
                                      >`
                                    : null}</span
                            >
                            <span class="meta" style="white-space:normal">${c.desc()}</span>
                        </span>
                        <span class="row">
                            ${state?.enabled
                                ? html`<${Button} size="sm" kind="ghost" loading=${busy === "test-" + c.key} onClick=${() => test(c.key)}
                                      >${L("发送测试", "Test")}<//
                                  >`
                                : null}
                            ${c.fields.length
                                ? html`<${Button} size="sm" onClick=${() => setEditing(c)}
                                      >${state ? L("修改", "Edit") : L("设置", "Set up")}<//
                                  >`
                                : html`<${Button}
                                      size="sm"
                                      kind=${state?.enabled ? "secondary" : "primary"}
                                      loading=${busy === "ch-" + c.key}
                                      onClick=${() => patch({ channels: { [c.key]: { enabled: !state?.enabled } } }, "ch-" + c.key)}
                                      >${state?.enabled ? L("停用", "Turn off") : L("启用", "Turn on")}<//
                                  >`}
                        </span>
                    </div>`;
                })}
            </div>
        <//>
        <${Card} title=${L("最近的通知", "Recent notifications")}>
            ${!history.data
                ? html`<${Spinner} />`
                : !history.data.items.length
                  ? html`<${Empty} icon="bell" title=${L("还没有发过通知", "No notifications yet")} />`
                  : html`<div class="panel">
                        ${history.data.items.slice(0, 20).map(
                            (j) =>
                                html`<div class="list-row">
                                    <span class="grow"
                                        ><span class="title">${eventName[j.event] || j.event}</span
                                        ><span class="meta"
                                            >${CHANNELS.find((c) => c.key === j.channel)?.name() || j.channel} ·
                                            ${dateTime(j.created)}${j.attempts > 1
                                                ? " · " + L(`尝试 ${j.attempts} 次`, `${j.attempts} attempts`)
                                                : ""}</span
                                        ></span
                                    >
                                    <${Badge} tone=${statusTone[j.status]}>${statusName[j.status] || j.status}<//>
                                </div>`,
                        )}
                    </div>`}
        <//>
        ${editing
            ? html`<${ChannelEditor}
                  channel=${editing}
                  state=${data.channels[editing.key]}
                  onClose=${() => setEditing(null)}
                  onSave=${async (value) => {
                      try {
                          setData(await api("/notifications", { method: "PATCH", body: { channels: { [editing.key]: value } } }));
                          toast(L("已保存", "Saved"));
                          setEditing(null);
                      } catch (err) {
                          return err.message;
                      }
                  }}
                  onRemove=${async () => {
                      setData(await api("/notifications", { method: "PATCH", body: { channels: { [editing.key]: null } } }));
                      setEditing(null);
                  }}
              />`
            : null}
    `;
}

function ChannelEditor({ channel, state, onClose, onSave, onRemove }) {
    const [values, setValues] = useState({});
    const [enabled, setEnabled] = useState(state ? state.enabled : true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    async function save() {
        setBusy(true);
        const clean = Object.fromEntries(
            Object.entries(values)
                .filter(([, v]) => v.trim())
                .map(([k, v]) => [k, v.trim()]),
        );
        setError((await onSave({ enabled, ...clean })) || "");
        setBusy(false);
    }
    return html`<${Modal}
        title=${channel.name()}
        onClose=${onClose}
        footer=${html`${state
                ? html`<${Button} kind="danger" onClick=${onRemove} style="margin-right:auto">${L("删除渠道", "Remove")}<//>`
                : null} <${Button} onClick=${onClose}>${L("取消", "Cancel")}<//
            ><${Button} kind="primary" loading=${busy} onClick=${save}>${L("保存", "Save")}<//>`}
    >
        <p class="confirm-body">${channel.desc()}</p>
        ${state
            ? html`<${Notice}
                  >${L(
                      "已保存的密钥和地址不会显示；留空的字段保持原值不变。",
                      "Saved secrets and URLs aren't shown; empty fields keep their current value.",
                  )}<//
              >`
            : null}
        ${channel.fields.map(
            ([key, label, placeholder, secret]) =>
                html`<${Field} label=${typeof label === "function" ? label() : label}>
                    <${Input}
                        type=${secret ? "password" : "text"}
                        autocomplete="off"
                        class="mono"
                        placeholder=${state ? L("（保持不变）", "(unchanged)") : placeholder}
                        value=${values[key] || ""}
                        onInput=${(v) => setValues({ ...values, [key]: v })}
                    />
                <//>`,
        )}
        <${Switch} label=${L("启用此渠道", "Enable this channel")} checked=${enabled} onChange=${setEnabled} />
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}

/* ---------- runtime ---------- */
const RUNTIME_GROUPS = [
    {
        title: () => L("Telegram 连接", "Telegram connection"),
        keys: {
            TOKEN: [
                () => L("机器人 Token", "Bot token"),
                () =>
                    L(
                        "当前机器人使用的 Token（来自 @BotFather）。正常情况下不需要改动。只有在 @BotFather 里重新生成了 Token、旧 Token 失效时，才需要在这里填入新的。重启或更新程序都不会改变它；但如果在这里填入另一个机器人的 Token，重启后就会以那个机器人的身份运行。",
                        "The token this bot runs with (from @BotFather). Normally leave it alone. Only fill in a new one if you regenerated the token in @BotFather and the old one stopped working. Restarting or updating never changes it — but if you enter another bot's token here, the next restart runs as that bot.",
                    ),
            ],
            MULTIUSER: [
                () => L("允许其他人使用", "Let others use the bot"),
                () =>
                    L(
                        "开启：任何人都可以私聊机器人订阅，或把机器人拉进自己的群组和频道。关闭：只有所有者（MANAGER），以及你在“会话”里设为“用户”或“管理员”的会话可以使用。",
                        "On: anyone can subscribe via the bot or add it to their own groups and channels. Off: only the owner (MANAGER) and chats you set to User or Admin under Chats can use it.",
                    ),
            ],
            ERROR_LOGGING_CHAT: [
                () => L("错误报告发送到", "Send error reports to"),
                () =>
                    L(
                        "机器人遇到未处理的错误时，把报错发到这个会话 ID。不填则发给所有者。",
                        "Chat ID that receives unhandled error reports. Empty = the owner.",
                    ),
            ],
            API_ID: [
                () => L("Telegram API ID（可选）", "Telegram API ID (optional)"),
                () =>
                    L(
                        "在 my.telegram.org 申请的应用凭据，需和下面的 API Hash 一起填。不填时使用内置的公共凭据，偶尔会因为使用的人多而登录变慢；填自己的更稳定。",
                        "App credentials from my.telegram.org, together with the API hash below. Without them the bot uses shared public credentials, which occasionally slows sign-in; your own are more reliable.",
                    ),
            ],
            API_HASH: [
                () => L("Telegram API Hash（可选）", "Telegram API hash (optional)"),
                () => L("与上面的 API ID 配套。", "Goes with the API ID above."),
            ],
        },
    },
    {
        title: () => L("网络与代理", "Network & proxy"),
        keys: {
            T_PROXY: [
                () => L("连接 Telegram 的代理", "Proxy for Telegram"),
                () =>
                    L(
                        "服务器无法直连 Telegram 时使用，例如 socks5://127.0.0.1:1080。支持 http、socks4、socks5。",
                        "Use when the server can't reach Telegram directly, e.g. socks5://127.0.0.1:1080. http, socks4 and socks5 are supported.",
                    ),
            ],
            R_PROXY: [
                () => L("抓取 RSS 的代理", "Proxy for fetching feeds"),
                () =>
                    L(
                        "只用于抓取订阅源，例如有些网站需要换一个出口 IP 才能访问。",
                        "Only for fetching feeds, e.g. when some sites need a different outgoing IP.",
                    ),
            ],
            SOCKS_PROXY: [
                () => L("全局 SOCKS 代理（旧写法）", "Global SOCKS proxy (legacy)"),
                () =>
                    L(
                        "同时用于 Telegram 和 RSS，只在上面两项都没设置时生效。新部署建议用上面两项。",
                        "Used for both Telegram and feeds when the two settings above are empty. Prefer those for new setups.",
                    ),
            ],
            HTTP_PROXY: [
                () => L("全局 HTTP 代理（旧写法）", "Global HTTP proxy (legacy)"),
                () => L("同上，HTTP 代理的写法。", "Same as above, for an HTTP proxy."),
            ],
            HTTPS_PROXY: [
                () => L("全局 HTTPS 代理（旧写法）", "Global HTTPS proxy (legacy)"),
                () => L("同上，HTTPS 代理的写法。", "Same as above, for an HTTPS proxy."),
            ],
            PROXY_BYPASS_PRIVATE: [
                () => L("内网地址不走代理", "Bypass proxy for private addresses"),
                () =>
                    L(
                        "开启后，访问 192.168.x.x、10.x.x.x 这类内网地址时直接连接，适合订阅自建的 RSSHub 等内网服务。",
                        "When on, private addresses like 192.168.x.x or 10.x.x.x are reached directly — handy for a self-hosted RSSHub.",
                    ),
            ],
            PROXY_BYPASS_DOMAINS: [
                () => L("不走代理的域名", "Domains that bypass the proxy"),
                () =>
                    L(
                        "这些域名直接连接，用空格分隔，例如 example.com rsshub.app。",
                        "Reached directly; separate with spaces, e.g. example.com rsshub.app.",
                    ),
            ],
            IPV6_PRIOR: [
                () => L("优先使用 IPv6", "Prefer IPv6"),
                () => L("服务器同时有 IPv4 和 IPv6 时，抓取优先走 IPv6。", "When the server has both, fetch over IPv6 first."),
            ],
            VERIFY_TLS: [
                () => L("校验 HTTPS 证书", "Verify HTTPS certificates"),
                () =>
                    L(
                        "关闭后可以访问证书过期或自签名的网站，但会有被劫持的风险。建议保持开启。",
                        "Turning it off allows sites with expired or self-signed certificates, at the risk of interception. Keep it on.",
                    ),
            ],
        },
    },
    {
        title: () => L("抓取", "Fetching"),
        keys: {
            USER_AGENT: [
                () => L("浏览器标识（User-Agent）", "User-Agent"),
                () =>
                    L(
                        "抓取时告诉网站“我是谁”。有些网站会拦截默认标识，可以换成常见浏览器的值。单个订阅源可以在订阅详情的“抓取”里单独设置。",
                        "How the bot identifies itself to sites. Some sites block the default; use a common browser value instead. Individual feeds can override it under the subscription's Fetching tab.",
                    ),
            ],
            HTTP_TIMEOUT: [
                () => L("请求超时（秒）", "Request timeout (seconds)"),
                () =>
                    L(
                        "抓取一个订阅源最多等多久。网站响应慢、经常超时可以调大。",
                        "How long to wait for a feed. Raise it if slow sites keep timing out.",
                    ),
            ],
            HTTP_CONCURRENCY: [
                () => L("同时抓取的数量", "Concurrent requests"),
                () =>
                    L(
                        "同一时间最多发出多少个请求，0 表示不限。服务器配置低可以调小。",
                        "Maximum requests in flight; 0 = unlimited. Lower it on small servers.",
                    ),
            ],
            HTTP_CONCURRENCY_PER_HOST: [
                () => L("同一网站同时抓取的数量", "Concurrent requests per site"),
                () => L("避免同时向一个网站发太多请求而被限制或封禁。", "Avoids hitting one site with too many requests at once."),
            ],
            CRON_SECOND: [
                () => L("每分钟第几秒开始检查", "Second of each minute to start checks"),
                () =>
                    L(
                        "机器人每分钟检查一次哪些订阅该更新了，这里设置从第几秒（0–59）开始。一般不用改。",
                        "The bot checks which feeds are due once a minute; this sets the second (0–59) it starts. Rarely needs changing.",
                    ),
            ],
            HTTP_MAX_LINE_SIZE: [
                () => L("响应行长度上限（字节）", "Max response line size (bytes)"),
                () => L("个别网站的响应过长导致抓取失败时才需要调大。", "Only raise if a site fails because of overly long responses."),
            ],
            HTTP_MAX_FIELD_SIZE: [
                () => L("响应头长度上限（字节）", "Max response header size (bytes)"),
                () => L("个别网站的响应头过长导致抓取失败时才需要调大。", "Only raise if a site fails because of overly long headers."),
            ],
        },
    },
    {
        title: () => L("内容处理", "Content"),
        keys: {
            TELEGRAPH_TOKEN: [
                () => L("Telegraph Token", "Telegraph tokens"),
                () =>
                    L(
                        "文章太长、一条 Telegram 消息放不下时，机器人会把全文发布到 Telegraph，再推送链接。没有 Token 就不能使用 Telegraph。订阅较多时建议 5 个以上，用来分摊 Telegraph 的频率限制。点“自动获取”即可生成，不需要注册。",
                        "When a post is too long for one Telegram message, the bot publishes it on Telegraph and sends the link. Without tokens Telegraph is disabled. With many subscriptions use 5 or more to spread Telegraph's rate limits. Click Generate — no sign-up needed.",
                    ),
            ],
            TABLE_TO_IMAGE: [
                () => L("表格转成图片", "Render tables as images"),
                () =>
                    L(
                        "Telegram 不支持表格，开启后把文章里的表格画成图片发送。会多占一些 CPU 和内存。",
                        "Telegram can't show tables; this draws them as images. Uses extra CPU and memory.",
                    ),
            ],
            TRAFFIC_SAVING: [
                () => L("省流量模式", "Traffic saving"),
                () =>
                    L(
                        "减少下载和检查图片、视频，适合流量有限的服务器。",
                        "Downloads and checks less media; for servers with limited traffic.",
                    ),
            ],
            LAZY_MEDIA_VALIDATION: [
                () => L("跳过预先检查媒体", "Skip media pre-checks"),
                () =>
                    L(
                        "不预先检查图片和视频能否访问，直接交给 Telegram，能降低资源占用；遇到失效的媒体时再自动降级处理。",
                        "Hand media straight to Telegram without checking it first; saves resources and falls back automatically if something is broken.",
                    ),
            ],
            IMG_RELAY_SERVER: [
                () => L("图片中转服务", "Image relay server"),
                () =>
                    L(
                        "有些网站禁止外链图片，通过这个服务中转后再发送。",
                        "Some sites block hot-linked images; they're relayed through this service.",
                    ),
            ],
            IMAGES_WESERV_NL: [
                () => L("图片压缩服务", "Image resize service"),
                () =>
                    L(
                        "图片太大无法发送时，用这个服务压缩。可以换成自建的 wsrv.nl 镜像。",
                        "Shrinks images too large to send. You can point it at your own wsrv.nl mirror.",
                    ),
            ],
        },
    },
];

const SOURCE_LABEL = {
    web: () => L("来自网页设置", "set on the web"),
    deployment: () => L("来自部署环境", "from deployment"),
    default: () => L("默认值", "default"),
};
const onOff = (v) => (v ? L("开启", "On") : L("关闭", "Off"));

function currentText(item) {
    const v = item.current;
    if (item.key === "TELEGRAPH_TOKEN")
        return v ? L(`${v} 个`, `${v} tokens`) : L("未设置（不使用 Telegraph）", "none (Telegraph disabled)");
    if (item.sensitive) return v ? L("已设置", "set") : L("未设置", "not set");
    if (item.type === "boolean") return onOff(v);
    if (item.key === "API_ID" && v == null) return L("未设置（使用公共凭据）", "not set (public credentials)");
    if (item.key === "ERROR_LOGGING_CHAT" && item.current_source === "default") return L(`${v}（所有者）`, `${v} (owner)`);
    if (v === null || v === undefined || v === "") return L("未设置", "not set");
    return String(v);
}

/** Value used when the web override is cleared: deployment value, else the default. */
function fallbackOf(item) {
    if (item.deployment_set)
        return item.sensitive
            ? L("部署环境中的值", "the deployment value")
            : item.type === "boolean"
              ? onOff(item.deployment_value)
              : String(item.deployment_value ?? "");
    if (item.type === "boolean") return onOff(item.default);
    return item.default != null ? String(item.default) : null;
}

function RuntimeRow({ item, label, help, draft, set, unset, onTelegraph }) {
    const pending = item.key in draft;
    const fallback = fallbackOf(item);
    const fallbackWord = item.deployment_set ? L("部署设置", "Deployment") : L("默认", "Default");
    let control;
    if (item.type === "boolean") {
        const value = pending ? draft[item.key] : item.configured ? item.value : null;
        control = html`<${Segmented}
            size="sm"
            value=${value === null ? "inherit" : value ? "on" : "off"}
            onChange=${(v) => set(item.key, v === "inherit" ? null : v === "on")}
            options=${[
                ["inherit", `${fallbackWord}（${fallback}）`],
                ["on", L("开启", "On")],
                ["off", L("关闭", "Off")],
            ]}
        />`;
    } else if (item.sensitive) {
        control = html`<div class="row" style="width:100%">
            <${Input}
                type="password"
                autocomplete="off"
                class="mono"
                placeholder=${item.configured
                    ? L("已在网页设置，留空保持不变", "Set on the web — leave empty to keep")
                    : L("留空保持不变", "Leave empty to keep")}
                value=${pending ? draft[item.key] || "" : ""}
                onInput=${(v) => (v ? set(item.key, v) : unset(item.key))}
            />
            ${item.key === "TELEGRAPH_TOKEN"
                ? html`<${Button} kind="primary" icon="zap" onClick=${onTelegraph}>${L("自动获取", "Generate")}<//>`
                : null}
        </div>`;
    } else {
        const value = pending ? draft[item.key] : item.value;
        control = html`<${Input}
            type=${item.type === "integer" ? "number" : "text"}
            class=${item.type === "string" ? "mono" : ""}
            min=${item.min}
            max=${item.max}
            placeholder=${fallback
                ? L(
                      `留空使用${fallbackWord === "默认" ? "默认值" : "部署设置"}：${fallback}`,
                      `Empty uses the ${fallbackWord.toLowerCase()}: ${fallback}`,
                  )
                : L("留空则不设置", "Empty = not set")}
            value=${value ?? ""}
            onInput=${(v) => set(item.key, v === "" ? null : item.type === "integer" ? Number(v) : v)}
        />`;
    }
    return html`<div class="rt-row ${pending ? "is-dirty" : ""}">
        <div class="rt-main">
            <div class="rt-head">
                <b>${label()}</b>
                <${Hint} text=${help()} />
                <span class="mono muted rt-key">${item.key}</span>
                ${item.pending_restart ? html`<${Badge} tone="amber">${L("已保存，待重启", "Saved, restart needed")}<//>` : null}
                ${pending ? html`<${Badge} tone="accent">${L("未保存", "Unsaved")}<//>` : null}
            </div>
            <div class="rt-current">
                ${L("当前：", "Now: ")}<b>${currentText(item)}</b>
                <span class="muted"> · ${SOURCE_LABEL[item.current_source]?.()}</span>
                ${item.type !== "boolean" && !item.sensitive && item.default != null && item.current_source !== "default"
                    ? html`<span class="muted"> · ${L("默认", "default")} ${String(item.default)}</span>`
                    : null}
                ${item.configured && !pending
                    ? html` ·
                          <button class="link-btn" onClick=${() => set(item.key, null)}>${L("删除网页设置", "Remove web override")}</button>`
                    : null}
            </div>
        </div>
        <div class="rt-control">${control}</div>
    </div>`;
}

/** The long explanation lives behind an "i" button instead of taking up a paragraph per setting. */
function Hint({ text }) {
    const [open, setOpen] = useState(false);
    const box = useRef();
    useEffect(() => {
        if (!open) return;
        const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
        const esc = (e) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", away);
        document.addEventListener("keydown", esc);
        return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
    }, [open]);
    return html`<span class="hint" ref=${box} onKeyDown=${(e) => e.key === "Escape" && setOpen(false)}>
        <button type="button" class="hint-btn" aria-expanded=${open} aria-label=${L("说明", "About this setting")} onClick=${() => setOpen(!open)}>
            <${Icon} name="info" size=${15} />
        </button>
        ${open ? html`<div class="hint-pop" role="note">${text}</div>` : null}
    </span>`;
}

/** One collapsible group of settings; `open` is forced while searching. */
function RuntimeGroup({ title, rows, open, onToggle, forced }) {
    const changed = rows.filter((r) => r.item.configured).length;
    const shown = open || forced;
    return html`<section class="card rt-group">
        <button type="button" class="rt-group-head" aria-expanded=${shown} onClick=${onToggle}>
            <h2>${title}</h2>
            <span class="muted">${L(`${rows.length} 项`, `${rows.length} settings`)}</span>
            ${changed ? html`<${Badge} tone="accent">${L(`${changed} 项来自网页设置`, `${changed} set on the web`)}<//>` : null}
            <span class="rt-chev ${shown ? "open" : ""}"><${Icon} name="down" size=${16} /></span>
        </button>
        ${shown ? html`<div class="card-body rt-list">${rows.map((r) => r.node)}</div>` : null}
    </section>`;
}

function Runtime() {
    const { data, error, setData } = useAsync(() => api("/runtime-config"), []);
    const [draft, setDraft] = useState({});
    const [query, setQuery] = useState("");
    const [opened, setOpened] = useState(new Set([0]));
    const [busy, setBusy] = useState(false);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    const items = Object.fromEntries(data.items.map((i) => [i.key, i]));
    const dirty = Object.keys(draft);
    async function save() {
        if ("TOKEN" in draft && draft.TOKEN) {
            const ok = await confirm({
                title: L("更换机器人 Token？", "Change the bot token?"),
                body: L(
                    "重启后，程序会用这个新 Token 登录。如果它属于另一个机器人，就会变成以那个机器人身份运行，现有会话会收不到推送。只有在 @BotFather 重新生成了当前机器人的 Token 时才需要这样做。",
                    "After restart the program signs in with this token. If it belongs to a different bot, it will run as that bot and existing chats stop receiving posts. Only do this after regenerating the current bot's token in @BotFather.",
                ),
                ok: L("确认更换", "Change token"),
                danger: true,
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            setData(await api("/runtime-config", { method: "PATCH", body: draft }));
            toast(L("已保存，重启机器人后生效", "Saved; restart the bot to apply"));
            setDraft({});
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy(false);
        }
    }
    async function telegraph() {
        const ok = await confirm({
            title: L("自动获取 Telegraph Token？", "Generate Telegraph tokens?"),
            body: L(
                "服务器会向 Telegraph（api.telegra.ph）申请 5 个新 Token，加到现有 Token 后面，并保存到运行配置。不需要注册账号。重启机器人后生效。",
                "The server requests 5 new tokens from Telegraph (api.telegra.ph), adds them to the existing ones and saves them. No sign-up needed. Applies after restart.",
            ),
            ok: L("获取", "Generate"),
        });
        if (!ok) return;
        try {
            const result = await api("/runtime-config/telegraph-tokens", { method: "POST", body: { count: 5 } });
            setData(result);
            toast(
                L(
                    `已获取 ${result.added} 个，共 ${result.total} 个，重启后生效`,
                    `Added ${result.added}, ${result.total} in total; restart to apply`,
                ),
            );
        } catch (err) {
            toast(err.message, "error");
        }
    }
    const set = (key, value) => setDraft({ ...draft, [key]: value });
    const unset = (key) => {
        const next = { ...draft };
        delete next[key];
        setDraft(next);
    };
    const needle = query.trim().toLowerCase();
    const groups = RUNTIME_GROUPS.map((g, index) => ({
        index,
        title: g.title(),
        rows: Object.entries(g.keys)
            .filter(([key]) => items[key])
            .filter(([key, [label, help]]) => !needle || `${key} ${label()} ${help()}`.toLowerCase().includes(needle))
            .map(([key, [label, help]]) => ({
                item: items[key],
                node: html`<${RuntimeRow}
                    key=${key}
                    item=${items[key]}
                    label=${label}
                    help=${help}
                    draft=${draft}
                    set=${set}
                    unset=${unset}
                    onTelegraph=${telegraph}
                />`,
            })),
    })).filter((g) => g.rows.length);
    return html`
        <${Notice}
            action=${data.pending_restart ? html`<${RestartButton} size="sm" kind="primary" />` : null}
            tone=${data.pending_restart ? "warn" : "info"}
            title=${data.pending_restart
                ? L("有已保存的修改还没生效", "Saved changes are waiting for a restart")
                : L("这些设置在重启机器人后生效", "These settings apply after the bot restarts")}
        >
            ${L(
                "这里的设置会覆盖部署环境（docker-compose 或 .env）中的同名配置；“删除网页设置”后重启即恢复为部署环境的值。保存后需要重启机器人，例如在服务器上执行 docker restart 加容器名。",
                "Values here override the same settings from the deployment (docker-compose or .env). Remove the web override and restart to go back to the deployment value. Saving needs a restart, e.g. docker restart <container> on the server.",
            )}
        <//>
        <div class="toolbar" style="margin-bottom:12px">
            <${SearchInput}
                value=${query}
                onInput=${setQuery}
                placeholder=${L("搜索设置名、变量名或说明", "Search by name, variable or description")}
            />
            <${Button} size="sm" onClick=${() => setOpened(new Set(RUNTIME_GROUPS.map((_, i) => i)))}>${L("全部展开", "Expand all")}<//>
            <${Button} size="sm" onClick=${() => setOpened(new Set())}>${L("全部收起", "Collapse all")}<//>
        </div>
        ${groups.length
            ? groups.map(
                  (g) =>
                      html`<${RuntimeGroup}
                          title=${g.title}
                          rows=${g.rows}
                          open=${opened.has(g.index) || g.rows.some((r) => r.item.key in draft)}
                          forced=${!!needle}
                          onToggle=${() => {
                              const next = new Set(opened);
                              next.has(g.index) ? next.delete(g.index) : next.add(g.index);
                              setOpened(next);
                          }}
                      />`,
              )
            : html`<${Empty} icon="search" title=${L("没有匹配的设置", "No matching settings")} />`}
        <p class="muted" style="font-size:12.5px">
            ${L(
                `所有者（${data.deployment_only.slice(0, 3).join("、")} 等）、数据库地址、网页登录密码和监听地址只能在部署环境里修改。`,
                `Owner (${data.deployment_only.slice(0, 3).join(", ")}…), database URL, console password and listen address can only be set in the deployment environment.`,
            )}
        </p>
        ${dirty.length
            ? html`<div class="batchbar">
                  <span>${L(`${dirty.length} 项修改`, `${dirty.length} changes`)}</span>
                  <${Button} size="sm" onClick=${() => setDraft({})}>${L("放弃", "Discard")}<//>
                  <${Button}
                      size="sm"
                      kind="primary"
                      loading=${busy}
                      onClick=${save}
                      style="background:var(--accent);border-color:var(--accent)"
                      >${L("保存（重启后生效）", "Save (applies on restart)")}<//
                  >
              </div>`
            : null}
    `;
}

/* ---------- backup ---------- */
const COMPONENTS = {
    admin_credentials: [
        () => L("网页登录密码", "Console password"),
        () => L("恢复后用备份里的密码登录。", "After restore, sign in with the backup's password."),
    ],
    agent_tokens: [() => L("API 访问令牌", "API tokens"), () => L("外部程序用的访问令牌。", "Tokens used by external programs.")],
    feed_proxies: [
        () => L("订阅源的单独代理", "Per-feed proxies"),
        () => L("为单个订阅源设置的代理地址，可能含用户名和密码。", "Proxy addresses set for individual feeds; may contain credentials."),
    ],
    notification_secrets: [() => L("通知渠道配置", "Notification channels"), () => L("包含通知渠道的密钥。", "Includes channel secrets.")],
    runtime_config: [
        () => L("运行配置", "Runtime configuration"),
        () => L("网页上修改过的运行配置（不含密钥）。", "Runtime overrides set on the web (no secrets)."),
    ],
};

function Backup() {
    const { data, error, reload } = useAsync(() => api("/backups"), []);
    const [include, setInclude] = useState({});
    const [busy, setBusy] = useState("");
    const [file, setFile] = useState(null);
    const [summary, setSummary] = useState(null);
    const [overwrite, setOverwrite] = useState({});
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    const available = Object.keys(COMPONENTS).filter((k) => data.components[k]?.length);
    async function exportBackup() {
        setBusy("export");
        try {
            await download("/backups/export", "rsstt-backup.json", { method: "POST", body: include });
            toast(L("备份已下载", "Backup downloaded"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function check(selected, flags = {}) {
        setBusy("check");
        try {
            const result = await api("/backups/preflight" + qs(Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, String(v)]))), {
                method: "POST",
                body: new Blob([await selected.text()], { type: "application/json" }),
            });
            setSummary(result);
        } catch (err) {
            setSummary(null);
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function stage() {
        const ok = await confirm({
            title: L("暂存恢复任务？", "Stage the restore?"),
            body: L(
                "下次重启机器人时，会先用这个备份覆盖订阅数据，再启动。重启之前可以随时取消。所有网页登录都会失效。",
                "On the next restart the bot replaces its data with this backup before starting. You can cancel until then. All browser sessions will be signed out.",
            ),
            ok: L("暂存", "Stage"),
            danger: true,
        });
        if (!ok) return;
        setBusy("stage");
        try {
            await api("/backups/restore" + qs(Object.fromEntries(Object.entries(overwrite).map(([k, v]) => [k, String(v)]))), {
                method: "POST",
                body: new Blob([await file.text()], { type: "application/json" }),
                headers: { "X-Backup-SHA256": summary.sha256 },
            });
            toast(L("已暂存，重启后恢复", "Staged; restores on restart"));
            setFile(null);
            setSummary(null);
            reload(true);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function cancelPending() {
        await api("/backups/pending", { method: "DELETE" });
        toast(L("已取消待恢复任务", "Pending restore cancelled"));
        reload(true);
    }
    const restore = data.restore || {};
    return html`
        <${Card}
            title=${L("导出备份", "Export a backup")}
            description=${L(
                "包含所有订阅、会话、格式设置和管理台数据。机器人 Token 和 Telegram 登录会话永远不会导出。",
                "Includes all subscriptions, chats, formatting and console data. The bot token and Telegram session are never exported.",
            )}
        >
            ${available.length
                ? html`<p class="field-label" style="margin-bottom:4px">
                          ${L("另外包含（含敏感信息，按需勾选）：", "Also include (sensitive, opt-in):")}
                      </p>
                      ${available.map(
                          (k) =>
                              html`<label class="chk"
                                  ><input
                                      type="checkbox"
                                      class="checkbox"
                                      checked=${!!include[k]}
                                      onChange=${(e) => setInclude({ ...include, [k]: e.currentTarget.checked })}
                                  />
                                  <span><b>${COMPONENTS[k][0]()}</b><small>${COMPONENTS[k][1]()}</small></span></label
                              >`,
                      )}`
                : null}
            <div class="row" style="margin-top:12px">
                <${Button} kind="primary" icon="download" loading=${busy === "export"} onClick=${exportBackup}
                    >${L("下载备份", "Download backup")}<//
                >
            </div>
        <//>
        <${Card}
            title=${L("从备份恢复", "Restore from backup")}
            description=${L(
                "为了安全，恢复不会在运行中直接覆盖数据库：先检查备份文件，暂存后在下次重启时自动恢复。",
                "For safety, restores never overwrite the live database: check the file, stage it, and it's applied on the next restart.",
            )}
        >
            ${!data.restore_supported
                ? html`<${Notice} tone="warn"
                      >${L(
                          "当前部署（PostgreSQL 或 Windows）不支持网页恢复，请按文档手动恢复。",
                          "Web restore isn't supported on this deployment (PostgreSQL or Windows); restore manually per the docs.",
                      )}<//
                  >`
                : restore.status === "pending_restart"
                  ? html`<${Notice}
                        tone="warn"
                        title=${L("有一个恢复任务等待重启", "A restore is waiting for restart")}
                        action=${html`<div class="row">
                            <${Button} size="sm" onClick=${cancelPending}>${L("取消", "Cancel")}<//
                            ><${RestartButton} size="sm" kind="primary" />
                        </div>`}
                        >${L(
                            "重启机器人后会自动应用，所有网页登录都会失效。",
                            "It's applied when the bot restarts; all browser sessions are signed out.",
                        )}<//
                    >`
                  : html`
                        ${restore.status === "succeeded"
                            ? html`<div style="margin-bottom:12px"><${Notice} title=${L("上次恢复成功", "Last restore succeeded")} /></div>`
                            : null}
                        ${restore.status === "failed"
                            ? html`<div style="margin-bottom:12px">
                                  <${Notice} tone="error" title=${L("上次恢复失败，已回滚", "Last restore failed and was rolled back")} />
                              </div>`
                            : null}
                        <label class="dropzone">
                            <${Icon} name="upload" size=${22} />
                            <b>${file ? file.name : L("选择备份文件（.json）", "Choose a backup file (.json)")}</b>
                            <span style="font-size:12.5px"
                                >${L(
                                    `最大 ${Math.round(data.max_bytes / 1048576)} MB`,
                                    `Up to ${Math.round(data.max_bytes / 1048576)} MB`,
                                )}</span
                            >
                            <input
                                type="file"
                                accept="application/json,.json"
                                onChange=${(e) => {
                                    const f = e.currentTarget.files[0];
                                    setFile(f);
                                    setSummary(null);
                                    setOverwrite({});
                                    if (f) check(f);
                                }}
                            />
                        </label>
                        ${busy === "check" ? html`<${Spinner} label=${L("正在检查…", "Checking…")} />` : null}
                        ${summary
                            ? html`<div style="margin-top:16px">
                                  <div class="facts">
                                      <div><small>${L("备份时间", "Created")}</small><b>${dateTime(summary.created_at)}</b></div>
                                      <div><small>${L("会话", "Chats")}</small><b>${num(summary.counts["main.user"] ?? 0)}</b></div>
                                      <div><small>${L("订阅", "Subscriptions")}</small><b>${num(summary.counts["main.sub"] ?? 0)}</b></div>
                                      <div><small>${L("订阅源", "Feeds")}</small><b>${num(summary.counts["main.feed"] ?? 0)}</b></div>
                                  </div>
                                  ${Object.keys(COMPONENTS).filter((k) => summary.included?.[k]).length
                                      ? html`<p class="field-label">
                                                ${L(
                                                    "备份里还包含以下内容，要用它们覆盖当前实例吗？",
                                                    "The backup also contains these. Overwrite the current instance's?",
                                                )}
                                            </p>
                                            ${Object.keys(COMPONENTS)
                                                .filter((k) => summary.included?.[k])
                                                .map(
                                                    (k) =>
                                                        html`<label class="chk"
                                                            ><input
                                                                type="checkbox"
                                                                class="checkbox"
                                                                checked=${!!overwrite[k]}
                                                                onChange=${(e) =>
                                                                    setOverwrite({ ...overwrite, [k]: e.currentTarget.checked })}
                                                            />
                                                            <span
                                                                ><b>${COMPONENTS[k][0]()}</b
                                                                ><small
                                                                    >${overwrite[k]
                                                                        ? COMPONENTS[k][1]()
                                                                        : L(
                                                                              "不勾选则保留当前实例的设置。",
                                                                              "Unchecked keeps this instance's current value.",
                                                                          )}</small
                                                                ></span
                                                            ></label
                                                        >`,
                                                )}`
                                      : null}
                                  <div class="row" style="margin-top:12px;justify-content:flex-end">
                                      <${Button} onClick=${() => (setFile(null), setSummary(null))}>${L("取消", "Cancel")}<//>
                                      <${Button} kind="primary" loading=${busy === "stage"} onClick=${stage}
                                          >${L("暂存，重启后恢复", "Stage for restart")}<//
                                      >
                                  </div>
                              </div>`
                            : null}
                    `}
        <//>
    `;
}

/* ---------- tokens ---------- */
function Tokens() {
    const { data, error, reload } = useAsync(() => api("/tokens"), []);
    const [creating, setCreating] = useState(false);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    async function revoke(t) {
        if (
            !(await confirm({
                title: L(`撤销“${t.name}”？`, `Revoke “${t.name}”?`),
                body: L("使用这个令牌的程序会立即失去访问权限。", "Programs using this token lose access immediately."),
                ok: L("撤销", "Revoke"),
                danger: true,
            }))
        )
            return;
        await api(`/tokens/${t.id}`, { method: "DELETE" });
        toast(L("已撤销", "Revoked"));
        reload(true);
    }
    return html`
        <${Card}
            title=${L("API 访问令牌", "API tokens")}
            description=${L(
                "让 Agent、脚本或其他应用通过 API 管理订阅。令牌只能读写订阅，不能修改设置、角色或备份。",
                "Let agents, scripts or other apps manage subscriptions through the API. Tokens can only read/write subscriptions — not settings, roles or backups.",
            )}
        >
            <div class="row" style="margin-bottom:14px">
                <${Button} kind="primary" icon="plus" onClick=${() => setCreating(true)}>${L("创建令牌", "Create token")}<//>
                <a class="btn btn-ghost" href="/api/openapi.json" target="_blank" rel="noopener"
                    >${L("API 文档（OpenAPI）", "API reference (OpenAPI)")}<${Icon} name="external"
                /></a>
            </div>
            ${!data
                ? html`<${Spinner} />`
                : !data.items.length
                  ? html`<${Empty} icon="key" title=${L("还没有令牌", "No tokens yet")} />`
                  : html`<div class="panel">
                        ${data.items.map(
                            (t) =>
                                html`<div class="list-row">
                                    <span class="grow"
                                        ><span class="title"
                                            >${t.name}
                                            <${Badge} tone=${t.permission === "write" ? "accent" : "neutral"}
                                                >${t.permission === "write" ? L("读写", "Read & write") : L("只读", "Read only")}<//
                                            ></span
                                        >
                                        <span class="meta"
                                            >${t.targets
                                                ? L(`${t.targets.length} 个会话`, `${t.targets.length} chats`)
                                                : L("全部会话", "All chats")}
                                            · ${L(`${dateTime(t.expires_at)} 到期`, `expires ${dateTime(t.expires_at)}`)}</span
                                        ></span
                                    >
                                    <${Button} size="sm" kind="danger" onClick=${() => revoke(t)}>${L("撤销", "Revoke")}<//>
                                </div>`,
                        )}
                    </div>`}
        <//>
        <${Card} title=${L("如何调用", "How to call")}>
            <pre class="kv mono" style="display:block;white-space:pre-wrap;margin:0">
${`curl -H "Authorization: Bearer <token>" ${location.origin}/api/subscriptions?size=20

curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  -d '{"target":"-100…","urls":["https://example.com/feed.xml"]}' ${location.origin}/api/subscriptions`}</pre
            >
        <//>
        ${creating ? html`<${CreateToken} onClose=${() => (setCreating(false), reload(true))} />` : null}
    `;
}

function CreateToken({ onClose }) {
    const [name, setName] = useState("");
    const [permission, setPermission] = useState("read");
    const [scope, setScope] = useState("all");
    const [targets, setTargets] = useState([]);
    const [days, setDays] = useState(90);
    const [busy, setBusy] = useState(false);
    const [secret, setSecret] = useState(null);
    const [error, setError] = useState("");
    async function create() {
        setBusy(true);
        setError("");
        try {
            const result = await api("/tokens", {
                method: "POST",
                body: { name, permission, days, ...(scope === "all" ? { all_targets: true } : { targets }) },
            });
            setSecret(result.token);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    if (secret)
        return html`<${Modal}
            title=${L("令牌已创建", "Token created")}
            onClose=${onClose}
            footer=${html`<${Button} kind="primary" onClick=${onClose}>${L("我已保存", "I've saved it")}<//>`}
        >
            <${Notice} tone="warn">${L("完整令牌只显示这一次，关闭后无法再查看。", "This is the only time the full token is shown.")}<//>
            <div class="secret">${secret}</div>
            <${Copy} text=${secret} label=${L("复制令牌", "Copy token")} />
        <//>`;
    return html`<${Modal}
        title=${L("创建 API 令牌", "Create API token")}
        onClose=${onClose}
        footer=${html`<${Button} onClick=${onClose}>${L("取消", "Cancel")}<//
            ><${Button} kind="primary" loading=${busy} disabled=${!name.trim() || (scope === "some" && !targets.length)} onClick=${create}
                >${L("创建", "Create")}<//
            >`}
    >
        <${Field}
            label=${L("名称", "Name")}
            hint=${L("用来区分是哪个程序在用，例如“FeedLantern”。", "To tell programs apart, e.g. “FeedLantern”.")}
            ><${Input} value=${name} onInput=${setName} autofocus
        /><//>
        <${Field} label=${L("权限", "Permission")}>
            <${Segmented}
                value=${permission}
                onChange=${setPermission}
                options=${[
                    ["read", L("只读", "Read only")],
                    ["write", L("读写订阅", "Read & write")],
                ]}
            />
        <//>
        <${Field} label=${L("可访问的会话", "Chats")}>
            <${Segmented}
                value=${scope}
                onChange=${setScope}
                options=${[
                    ["all", L("全部（含以后新增）", "All, incl. future")],
                    ["some", L("指定会话", "Selected")],
                ]}
            />
        <//>
        ${scope === "some" ? html`<${ChatPicker} value=${targets} onChange=${setTargets} />` : null}
        <${Field} label=${L("有效期", "Expires in")}>
            <${Select}
                value=${days}
                onChange=${(v) => setDays(Number(v))}
                options=${[
                    [7, L("7 天", "7 days")],
                    [30, L("30 天", "30 days")],
                    [90, L("90 天", "90 days")],
                    [365, L("1 年", "1 year")],
                ]}
            />
        <//>
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}

/* ---------- account ---------- */
function Account() {
    const settings = useAsync(() => api("/settings"), []);
    const sessions = useAsync(() => api("/auth/sessions"), []);
    const account = useAsync(() => api("/auth/account"), []);
    const [form, setForm] = useState({ name: null, current: "", next: "", again: "" });
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const mismatch = form.again && form.next !== form.again;
    const name = form.name ?? account.data?.username ?? "";
    const renamed = !!account.data && name.trim() !== account.data.username;
    const newPassword = form.next !== "";
    async function change(e) {
        e.preventDefault();
        setBusy("password");
        setError("");
        try {
            const body = { current_password: form.current };
            if (renamed) body.username = name.trim();
            if (newPassword) body.new_password = form.next;
            await api("/auth/password", { method: "POST", body });
            try {
                if (renamed) localStorage.setItem("rsstt.user", name.trim());
            } catch {
                /* private mode */
            }
            toast(L("已修改，请重新登录", "Saved. Sign in again."));
            app.session = null;
            emit();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy("");
        }
    }
    async function revokeAll() {
        if (
            !(await confirm({
                title: L("退出所有设备？", "Sign out everywhere?"),
                body: L("包括当前浏览器在内的所有网页登录都会失效。", "All browser sessions, including this one, will be signed out."),
                ok: L("全部退出", "Sign out all"),
                danger: true,
            }))
        )
            return;
        await api("/auth/sessions", { method: "DELETE" });
        app.session = null;
        emit();
    }
    const s = settings.data;
    return html`
        <${Card}
            title=${L("账号与密码", "Account and password")}
            description=${L(
                "登录网页管理台用的账号和密码。修改后所有设备需要重新登录；部署时的 WEB_PASSWORD 只在第一次启动时使用。",
                "The username and password for this console. All devices will need to sign in again; WEB_PASSWORD from deployment is only used on first start.",
            )}
        >
            <form class="stack" style="max-width:420px;gap:14px" onSubmit=${change}>
                <${Field} label=${L("账号", "Username")} hint=${L("字母、数字和 . _ @ + -，最多 64 个字符。", "Letters, digits and . _ @ + -, up to 64 characters.")}
                    ><${Input}
                        name="username"
                        autocomplete="username"
                        autocapitalize="none"
                        spellcheck="false"
                        value=${name}
                        onInput=${(v) => setForm({ ...form, name: v })}
                /><//>
                <${Field} label=${L("当前密码", "Current password")}
                    ><${Input}
                        name="current-password"
                        type="password"
                        autocomplete="current-password"
                        value=${form.current}
                        onInput=${(v) => setForm({ ...form, current: v })}
                /><//>
                <${Field}
                    label=${L("新密码", "New password")}
                    hint=${L("至少 16 个字符；只想改账号时留空。", "At least 16 characters; leave empty to only change the username.")}
                    ><${Input}
                        name="new-password"
                        type="password"
                        autocomplete="new-password"
                        value=${form.next}
                        onInput=${(v) => setForm({ ...form, next: v })}
                /><//>
                <${Field} label=${L("再次输入新密码", "Confirm new password")} error=${mismatch ? L("两次输入不一致", "Doesn't match") : ""}
                    ><${Input}
                        type="password"
                        autocomplete="new-password"
                        value=${form.again}
                        onInput=${(v) => setForm({ ...form, again: v })}
                /><//>
                ${error ? html`<${Notice} tone="error">${error}<//>` : null}
                <div>
                    <${Button}
                        kind="primary"
                        type="submit"
                        loading=${busy === "password"}
                        disabled=${!form.current ||
                        !(renamed || newPassword) ||
                        (newPassword && (form.next.length < 16 || form.next !== form.again)) ||
                        !name.trim()}
                        >${L("保存", "Save")}<//
                    >
                </div>
            </form>
        <//>
        <${Card}
            title=${L("登录中的设备", "Signed-in browsers")}
            description=${L(
                "每次登录有效 8 小时，重启机器人后需要重新登录。",
                "Each sign-in lasts 8 hours; restarting the bot signs everyone out.",
            )}
        >
            ${sessions.data
                ? html`<p style="margin-bottom:12px">
                      ${L(`当前有 ${sessions.data.items.length} 个有效登录。`, `${sessions.data.items.length} active sessions.`)}
                  </p>`
                : null}
            <${Button} kind="danger" icon="logout" onClick=${revokeAll}>${L("退出所有设备", "Sign out everywhere")}<//>
        <//>
        ${s?.restart?.supported
            ? html`<${Card}
                  title=${L("重启机器人", "Restart the bot")}
                  description=${L(
                      "运行配置、备份恢复等需要重启才生效的修改，可以在这里直接重启，不用登录服务器。",
                      "Apply changes that need a restart (runtime settings, restores) without logging in to the server.",
                  )}
              >
                  <div class="action-card">
                      <${Icon} name="refresh" size=${18} />
                      <div>
                          <b>${L("立即重启", "Restart now")}</b>
                          <p>
                              ${s.restart.container
                                  ? L(
                                        "机器人会正常退出，并由 Docker 自动启动，通常 10–30 秒。",
                                        "The bot exits cleanly and Docker starts it again, usually in 10–30 seconds.",
                                    )
                                  : L(
                                        "没有检测到容器环境：只有配置了进程管理器自动拉起时才能使用。",
                                        "No container detected: only use this with a process manager that restarts the bot.",
                                    )}
                          </p>
                      </div>
                      <${Button} size="sm" kind="primary" onClick=${() => restartBot(s.restart)}>${L("重启", "Restart")}<//>
                  </div>
              <//>`
            : null}
        <${Card} title=${L("关于这个实例", "About this instance")}>
            ${!s
                ? html`<${Spinner} />`
                : html`<dl class="kv" style="margin:0">
                          <dt>${L("版本", "Version")}</dt>
                          <dd>
                              <a
                                  href=${`https://github.com/Jaaayden/rsstt-web/releases/tag/web-v${s.version}`}
                                  target="_blank"
                                  rel="noopener"
                                  >RSStT Web ${s.version}</a
                              >
                              ${s.build ? html` <span class="muted mono">(${s.build})</span>` : null}
                          </dd>
                          <dt>${L("机器人核心", "Bot core")}</dt>
                          <dd>RSS-to-Telegram-Bot <span class="mono">${s.upstream_version}</span></dd>
                          <dt>${L("数据库", "Database")}</dt>
                          <dd>${s.database}</dd>
                          <dt>${L("管理台地址", "Console origin")}</dt>
                          <dd class="mono">${s.origin}</dd>
                          <dt>${L("机器人", "Bot")}</dt>
                          <dd>
                              ${s.bot.username ? "@" + s.bot.username : s.bot.name} ·
                              ${s.bot.connected ? L("已连接", "connected") : L("未连接", "not connected")}
                          </dd>
                          <dt>${L("统计开始于", "Statistics since")}</dt>
                          <dd>${dateTime(s.console.started_at)}</dd>
                      </dl>
                      <p class="muted" style="margin-top:12px;font-size:12.5px">
                          RSStT Web · ${L("基于", "based on")}
                          <a href="https://github.com/Rongronggg9/RSS-to-Telegram-Bot" target="_blank" rel="noopener"
                              >RSS-to-Telegram-Bot</a
                          >
                          · AGPL-3.0
                      </p>`}
        <//>
    `;
}
