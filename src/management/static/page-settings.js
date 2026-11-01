import {
    html,
    useState,
    useEffect,
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
    openModal,
    Copy,
} from "./ui.js";
import { L, api, qs, num, ago, dateTime, readRoute, setParams, toast, download, app, emit } from "./core.js";

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

/* ---------- general ---------- */
function General() {
    const { data, error, reload } = useAsync(() => api("/settings"), []);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const base = data && { ...data.options, attention_threshold: Number(data.console.attention_threshold) };
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
    const { data, error, reload, setData } = useAsync(() => api("/notifications"), []);
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
    const configured = Object.keys(data.channels);
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
            TOKEN: () =>
                L(
                    "机器人 Token（来自 @BotFather）。修改后重启即换成另一个机器人。",
                    "Bot token from @BotFather. Changing it switches bots after restart.",
                ),
            API_ID: () => L("Telegram API ID，可选。", "Telegram API ID (optional)."),
            API_HASH: () => L("Telegram API Hash，可选。", "Telegram API hash (optional)."),
            MULTIUSER: () =>
                L(
                    "允许其他人使用机器人。关闭后只有所有者和管理员可用。",
                    "Let others use the bot. When off, only the owner and admins can.",
                ),
            ERROR_LOGGING_CHAT: () => L("把错误日志发到这个会话 ID。", "Send error logs to this chat ID."),
        },
    },
    {
        title: () => L("网络与代理", "Network & proxy"),
        keys: {
            T_PROXY: () => L("连接 Telegram 用的代理，如 socks5://127.0.0.1:1080。", "Proxy for Telegram, e.g. socks5://127.0.0.1:1080."),
            R_PROXY: () => L("抓取 RSS 用的代理。", "Proxy for fetching feeds."),
            SOCKS_PROXY: () => L("全局 SOCKS 代理（旧写法）。", "Global SOCKS proxy (legacy)."),
            HTTP_PROXY: () => L("全局 HTTP 代理（旧写法）。", "Global HTTP proxy (legacy)."),
            HTTPS_PROXY: () => L("全局 HTTPS 代理（旧写法）。", "Global HTTPS proxy (legacy)."),
            PROXY_BYPASS_PRIVATE: () => L("访问内网地址时不走代理。", "Bypass the proxy for private addresses."),
            PROXY_BYPASS_DOMAINS: () => L("不走代理的域名，空格分隔。", "Domains that bypass the proxy, space-separated."),
            IPV6_PRIOR: () => L("优先使用 IPv6。", "Prefer IPv6."),
            VERIFY_TLS: () => L("校验 HTTPS 证书。", "Verify TLS certificates."),
        },
    },
    {
        title: () => L("抓取", "Fetching"),
        keys: {
            USER_AGENT: () =>
                L(
                    "抓取 RSS 时使用的 User-Agent（单个订阅源可在订阅详情里单独覆盖）。",
                    "User-Agent for fetching (individual feeds can override it).",
                ),
            HTTP_TIMEOUT: () => L("单次请求超时（秒）。", "Request timeout (seconds)."),
            HTTP_CONCURRENCY: () => L("同时进行的请求数，0 为不限。", "Concurrent requests, 0 = unlimited."),
            HTTP_CONCURRENCY_PER_HOST: () => L("对同一主机同时进行的请求数。", "Concurrent requests per host."),
            CRON_SECOND: () => L("每分钟的第几秒开始检查。", "Second of the minute when checks start."),
            HTTP_MAX_LINE_SIZE: () => L("HTTP 响应行最大字节数。", "Max HTTP line size (bytes)."),
            HTTP_MAX_FIELD_SIZE: () => L("HTTP 响应头最大字节数。", "Max HTTP header field size (bytes)."),
        },
    },
    {
        title: () => L("内容处理", "Content"),
        keys: {
            TELEGRAPH_TOKEN: () =>
                L("Telegraph Token，长文章会发到 Telegraph。可以填多个，空格分隔。", "Telegraph token(s) for long posts; space-separated."),
            TABLE_TO_IMAGE: () => L("把文章里的表格渲染成图片。", "Render tables as images."),
            TRAFFIC_SAVING: () => L("省流模式：少下载媒体。", "Traffic saving: download less media."),
            LAZY_MEDIA_VALIDATION: () => L("延迟校验媒体，降低资源占用。", "Validate media lazily to save resources."),
            IMG_RELAY_SERVER: () => L("图片中转服务器地址。", "Image relay server URL."),
            IMAGES_WESERV_NL: () => L("images.weserv.nl 镜像地址。", "images.weserv.nl mirror URL."),
        },
    },
];

function Runtime() {
    const { data, error, reload } = useAsync(() => api("/runtime-config"), []);
    const [draft, setDraft] = useState({});
    const [busy, setBusy] = useState(false);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    const items = Object.fromEntries(data.items.map((i) => [i.key, i]));
    const dirty = Object.keys(draft);
    async function save() {
        setBusy(true);
        try {
            await api("/runtime-config", { method: "PATCH", body: draft });
            toast(L("已保存，重启后生效", "Saved; restart to apply"));
            setDraft({});
            reload(true);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy(false);
        }
    }
    const set = (key, value) => setDraft({ ...draft, [key]: value });
    const unset = (key) => {
        const next = { ...draft };
        delete next[key];
        setDraft(next);
    };
    function control(item) {
        const pending = item.key in draft;
        const value = pending ? draft[item.key] : item.value;
        if (item.type === "boolean") {
            const current = value === null || value === undefined ? (item.effective_value ?? "") : value;
            return html`<${Select}
                value=${pending ? (draft[item.key] === null ? "" : String(draft[item.key])) : item.configured ? String(item.value) : ""}
                onChange=${(v) => set(item.key, v === "" ? null : v === "true")}
                options=${[
                    ["", L("使用部署值", "Deployment value")],
                    ["true", L("开启", "On")],
                    ["false", L("关闭", "Off")],
                ]}
            />`;
        }
        if (item.sensitive)
            return html`<${Input}
                type="password"
                autocomplete="off"
                class="mono"
                placeholder=${item.configured
                    ? L("已在网页设置（留空不变）", "Set here (empty = unchanged)")
                    : item.effective_configured
                      ? L("已在部署环境中设置", "Set in deployment")
                      : L("未设置", "Not set")}
                value=${pending ? draft[item.key] || "" : ""}
                onInput=${(v) => (v ? set(item.key, v) : unset(item.key))}
            />`;
        return html`<${Input}
            type=${item.type === "integer" ? "number" : "text"}
            class=${item.type === "string" ? "mono" : ""}
            min=${item.min}
            max=${item.max}
            placeholder=${item.effective_value != null ? String(item.effective_value) : L("默认", "Default")}
            value=${value ?? ""}
            onInput=${(v) => set(item.key, v === "" ? null : item.type === "integer" ? Number(v) : v)}
        />`;
    }
    return html`
        ${data.pending_restart
            ? html`<${Notice} tone="warn" title=${L("有配置等待重启", "Changes waiting for restart")}
                  >${L("已保存的运行配置要在机器人重启后才生效。", "Saved runtime settings take effect after the bot restarts.")}<//
              >`
            : null}
        ${RUNTIME_GROUPS.map(
            (g) =>
                html`<${Card} title=${g.title()}>
                    <div class="form-grid">
                        ${Object.entries(g.keys)
                            .filter(([key]) => items[key])
                            .map(([key, help]) => {
                                const item = items[key];
                                return html`<${Field}
                                    label=${html`<span class="mono" style="font-size:12.5px">${key}</span> ${item.pending_restart
                                            ? html`<${Badge} tone="amber">${L("待重启", "Restart")}<//>`
                                            : item.configured
                                              ? html`<${Badge} tone="accent">${L("网页设置", "Web")}<//>`
                                              : null}`}
                                    hint=${help()}
                                >
                                    <div class="row">
                                        ${control(item)}
                                        ${item.configured && !(key in draft)
                                            ? html`<${Button}
                                                  size="sm"
                                                  kind="ghost"
                                                  title=${L(
                                                      "删除网页设置，重启后改用部署值",
                                                      "Remove the web override; deployment value applies after restart",
                                                  )}
                                                  onClick=${() => set(key, null)}
                                                  >${L("恢复", "Revert")}<//
                                              >`
                                            : null}
                                    </div>
                                <//>`;
                            })}
                    </div>
                <//>`,
        )}
        <p class="muted" style="font-size:12.5px">
            ${L(
                `所有者（${data.deployment_only.join("、")}）、数据库地址、网页登录密码和监听地址只能在部署环境里修改。`,
                `Owner (${data.deployment_only.join(", ")}), database URL, console password and listen address can only be set in the deployment environment.`,
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
                        action=${html`<${Button} size="sm" onClick=${cancelPending}>${L("取消", "Cancel")}<//>`}
                        >${L("重启机器人后会自动应用。", "It will be applied when the bot restarts.")}<//
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
    const [form, setForm] = useState({ current: "", next: "", again: "" });
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const mismatch = form.again && form.next !== form.again;
    async function change(e) {
        e.preventDefault();
        setBusy("password");
        setError("");
        try {
            await api("/auth/password", { method: "POST", body: { current_password: form.current, new_password: form.next } });
            toast(L("密码已修改，请用新密码重新登录", "Password changed. Sign in with the new password."));
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
            title=${L("修改密码", "Change password")}
            description=${L(
                "修改后所有设备需要重新登录。部署时的 WEB_PASSWORD 只在第一次启动时使用。",
                "All devices will need to sign in again. WEB_PASSWORD from deployment is only used on first start.",
            )}
        >
            <form class="stack" style="max-width:420px;gap:14px" onSubmit=${change}>
                <${Field} label=${L("当前密码", "Current password")}
                    ><${Input}
                        type="password"
                        autocomplete="current-password"
                        value=${form.current}
                        onInput=${(v) => setForm({ ...form, current: v })}
                /><//>
                <${Field} label=${L("新密码", "New password")} hint=${L("至少 16 个字符。", "At least 16 characters.")}
                    ><${Input}
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
                        disabled=${!form.current || form.next.length < 16 || form.next !== form.again}
                        >${L("修改密码", "Change password")}<//
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
        <${Card} title=${L("关于这个实例", "About this instance")}>
            ${!s
                ? html`<${Spinner} />`
                : html`<dl class="kv" style="margin:0">
                          <dt>${L("版本", "Version")}</dt>
                          <dd class="mono">${s.version}</dd>
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
