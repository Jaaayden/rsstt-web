import {
    html,
    useState,
    useAsync,
    useRoute,
    Icon,
    Button,
    Field,
    Input,
    Select,
    Segmented,
    SearchInput,
    Spinner,
    Empty,
    Notice,
    Badge,
    ChatAvatar,
    KindBadge,
    Pager,
    Copy,
    Drawer,
    Tabs,
    confirm,
    Modal,
} from "./ui.js";
import { L, api, qs, ago, dateTime, readRoute, setParams, go, toast, download, ROLE, KIND, kindOf, app } from "./core.js";
import { OptionsForm, IntervalField, labelOf, OPTIONS } from "./options.js";

const VISIBILITY = () => [
    ["unbanned", L("全部可用会话", "All available")],
    ["active", L("有启用的订阅", "With active subscriptions")],
    ["inactive", L("没有启用的订阅", "Without active subscriptions")],
    ["banned", L("已封禁", "Blocked")],
    ["all", L("全部（含已封禁）", "Everything incl. blocked")],
];

const roleTone = { manager: "accent", admin: "violet", user: "neutral", guest: "amber", banned: "red" };

export function RoleBadge({ chat }) {
    return html`<${Badge} tone=${roleTone[chat.role]}>${ROLE[chat.role]?.() || chat.role}<//>`;
}

function SubsCell({ chat }) {
    if (!chat.subscriptions) return html`<span class="muted">—</span>`;
    return html`<span class="num"><b>${chat.active_subscriptions}</b><span class="muted"> / ${chat.subscriptions}</span></span>`;
}

export function Chats() {
    useRoute();
    const { params } = readRoute();
    const q = params.q || "";
    const kind = params.kind || "";
    const visibility = params.visibility || "unbanned";
    const page = Number(params.page || 1);
    const { data, error, loading, reload } = useAsync(
        () => api("/targets" + qs({ q, kind, visibility, page, size: 25 })),
        [q, kind, visibility, page],
    );
    const [adding, setAdding] = useState(false);
    const open = params.chat;
    return html`
        <div class="page-head">
            <div>
                <h1>${L("会话", "Chats")}</h1>
                <p>
                    ${L(
                        "使用这个机器人的私聊、群组和频道。可以在这里设置角色、封禁陌生人，或让机器人退出群组和频道。",
                        "Private chats, groups and channels using this bot. Set roles, block strangers, or make the bot leave.",
                    )}
                </p>
            </div>
            <div class="page-actions">
                <${Button} icon="plus" onClick=${() => setAdding(true)}>${L("添加会话", "Add chat")}<//>
            </div>
        </div>
        <section class="card">
            <div class="toolbar">
                <${SearchInput}
                    value=${q}
                    placeholder=${L("搜索名称、@用户名或 ID", "Search name, @username or ID")}
                    onInput=${(v) => setParams({ q: v, page: "" })}
                />
                <${Segmented}
                    value=${kind}
                    onChange=${(v) => setParams({ kind: v, page: "" })}
                    options=${[
                        ["", L("全部", "All")],
                        ["private", L("私聊", "Private")],
                        ["group", L("群组", "Groups")],
                        ["channel", L("频道", "Channels")],
                    ]}
                />
                <${Select} value=${visibility} onChange=${(v) => setParams({ visibility: v, page: "" })} options=${VISIBILITY()} />
                <span class="total">${data ? L(`${data.total} 个会话`, `${data.total} chats`) : ""}</span>
            </div>
            ${error
                ? html`<div class="card-body"><${Notice} tone="error">${error.message}<//></div>`
                : !data
                  ? html`<${Spinner} />`
                  : !data.items.length
                    ? html`<${Empty} icon="chats" title=${L("没有符合条件的会话", "No matching chats")}>
                          ${visibility === "unbanned"
                              ? L("新的私聊、群组或频道开始使用机器人后会出现在这里。", "Chats appear here once they start using the bot.")
                              : L("换个筛选条件试试。", "Try a different filter.")}
                      <//>`
                    : html`<div class="table-wrap" style=${loading ? "opacity:.6" : ""}>
                              <table class="table responsive">
                                  <thead>
                                      <tr>
                                          <th>${L("会话", "Chat")}</th>
                                          <th>${L("类型", "Type")}</th>
                                          <th>${L("角色", "Role")}</th>
                                          <th>${L("订阅（启用 / 全部）", "Subscriptions (active / all)")}</th>
                                          <th>${L("抓取异常", "Fetch issues")}</th>
                                          <th class="end"></th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${data.items.map(
                                          (chat) =>
                                              html`<tr class="clickable" onClick=${() => setParams({ chat: chat.id }, { replace: false })}>
                                                  <td>
                                                      <div class="cell-main">
                                                          <${ChatAvatar} chat=${chat} />
                                                          <div>
                                                              <span class="cell-title">${chat.title}</span>
                                                              <span class="cell-sub"
                                                                  >${chat.username ? "@" + chat.username + " · " : ""}<span class="mono"
                                                                      >${chat.id}</span
                                                                  ></span
                                                              >
                                                          </div>
                                                      </div>
                                                  </td>
                                                  <td data-label=${L("类型", "Type")}><${KindBadge} chat=${chat} /></td>
                                                  <td data-label=${L("角色", "Role")}><${RoleBadge} chat=${chat} /></td>
                                                  <td data-label=${L("订阅", "Subscriptions")}><${SubsCell} chat=${chat} /></td>
                                                  <td data-label=${L("抓取异常", "Fetch issues")}>
                                                      ${chat.attention
                                                          ? html`<${Badge} tone="amber">${chat.attention}<//>`
                                                          : html`<span class="muted">—</span>`}
                                                  </td>
                                                  <td class="end" onClick=${(e) => e.stopPropagation()}>
                                                      <${Button}
                                                          size="sm"
                                                          kind="ghost"
                                                          onClick=${() => go("subscriptions", { target: chat.id })}
                                                          >${L("查看订阅", "Subscriptions")}<//
                                                      >
                                                      <${Button} size="sm" onClick=${() => setParams({ chat: chat.id }, { replace: false })}
                                                          >${L("管理", "Manage")}<//
                                                      >
                                                  </td>
                                              </tr>`,
                                      )}
                                  </tbody>
                              </table>
                          </div>
                          <${Pager} page=${page} size=${data.size} total=${data.total} onPage=${(p) => setParams({ page: p })} />`}
        </section>
        ${open
            ? html`<${ChatDrawer} id=${open} onClose=${() => setParams({ chat: "", ctab: "" })} onChanged=${() => reload(true)} />`
            : null}
        ${adding
            ? html`<${AddChat}
                  onClose=${() => setAdding(false)}
                  onDone=${(chat) => (setAdding(false), reload(true), setParams({ chat: chat.id }, { replace: false }))}
              />`
            : null}
    `;
}

function AddChat({ onClose, onDone }) {
    const [id, setId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function submit() {
        setBusy(true);
        setError("");
        try {
            onDone(await api("/targets", { method: "POST", body: { id: id.trim() } }));
            toast(L("会话已添加", "Chat added"));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    return html`<${Modal}
        title=${L("添加会话", "Add a chat")}
        onClose=${onClose}
        footer=${html`<${Button} onClick=${onClose}>${L("取消", "Cancel")}<//
            ><${Button} kind="primary" loading=${busy} disabled=${!/^-?\d+$/.test(id.trim())} onClick=${submit}>${L("添加", "Add")}<//>`}
    >
        <p class="confirm-body">
            ${L(
                "先把机器人拉进频道或群组（频道需要“发布消息”权限），再填入会话 ID。机器人会向 Telegram 核实它能否在这里发消息。",
                "Add the bot to the channel or group first (channels need “Post messages”), then enter the chat ID. The bot checks with Telegram that it can post there.",
            )}
        </p>
        <${Field}
            label=${L("会话 ID", "Chat ID")}
            hint=${L("频道和超级群组以 -100 开头，例如 -1001234567890。", "Channels and supergroups start with -100, e.g. -1001234567890.")}
            error=${error}
        >
            <${Input} class="mono" value=${id} onInput=${setId} placeholder="-100…" autofocus />
        <//>
    <//>`;
}

/* ---------------- chat drawer ---------------- */

export function ChatDrawer({ id, onClose, onChanged }) {
    const { params } = readRoute();
    const tab = params.ctab || "overview";
    const {
        data: chat,
        error,
        reload,
        setData,
    } = useAsync(async () => {
        const result = await api("/targets" + qs({ q: id, visibility: "all", include_departed: "true", size: 5 }));
        const found = result.items.find((c) => c.id === String(id));
        if (!found) throw new Error(L("找不到这个会话，可能已被移除。", "Chat not found. It may have been removed."));
        return found;
    }, [id]);
    const changed = (next) => {
        if (next) setData(next);
        else reload(true);
        onChanged?.();
    };
    const setTab = (t) => setParams({ ctab: t === "overview" ? "" : t });
    return html`<${Drawer}
        open=${true}
        onClose=${onClose}
        head=${chat ? html`<${ChatAvatar} chat=${chat} size=${40} />` : null}
        title=${chat?.title || L("会话", "Chat")}
        subtitle=${chat
            ? html`<${KindBadge} chat=${chat} /><${Copy} text=${chat.id} />${chat.username
                      ? html`<a href=${"https://t.me/" + chat.username} target="_blank" rel="noopener noreferrer" class="muted"
                            >@${chat.username}</a
                        >`
                      : null}`
            : null}
    >
        ${error
            ? html`<${Notice} tone="error">${error.message}<//>`
            : !chat
              ? html`<${Spinner} />`
              : html`<${Tabs}
                        value=${tab}
                        onChange=${setTab}
                        tabs=${[
                            ["overview", L("概况与权限", "Access")],
                            ["subs", L("订阅", "Subscriptions"), chat.subscriptions || null],
                            ["defaults", L("推送默认值", "Defaults")],
                            ...(app.info.features.chat_activity ? [["activity", L("操作记录", "Activity")]] : []),
                        ]}
                    />
                    ${tab === "overview"
                        ? html`<${ChatOverview} chat=${chat} onChanged=${changed} onClose=${onClose} />`
                        : tab === "subs"
                          ? html`<${ChatSubs} chat=${chat} onChanged=${changed} />`
                          : tab === "defaults"
                            ? html`<${ChatDefaults} chat=${chat} onChanged=${changed} />`
                            : html`<${ChatActivity} chat=${chat} />`}`}
    <//>`;
}

const ROLE_HELP = {
    admin: () => L("可以在机器人里使用管理员命令（仅限私聊用户）。", "Can use admin commands in the bot (private users only)."),
    user: () => L("可以正常使用机器人订阅。", "Can use the bot normally."),
    guest: () => L("关闭多用户模式（MULTIUSER）时，访客不能使用机器人。", "When MULTIUSER is off, guests can't use the bot."),
    banned: () =>
        L("停止服务：暂停全部订阅，并拒绝该会话之后的所有命令。", "Stop service: pause all subscriptions and reject further commands."),
};

function ChatOverview({ chat, onChanged, onClose }) {
    const [busy, setBusy] = useState("");
    const kind = kindOf(chat);
    const departed = ["left", "banned", "disabled"].includes(chat.membership);
    async function setRole(role) {
        if (role === chat.role) return;
        if (role === "banned") {
            const ok = await confirm({
                title: L(`封禁“${chat.title}”？`, `Block “${chat.title}”?`),
                body: L(
                    `机器人会暂停这个会话的 ${chat.active_subscriptions} 个启用订阅，并拒绝它之后发来的所有命令。之后可以解除封禁，但订阅需要手动恢复。`,
                    `The bot pauses this chat's ${chat.active_subscriptions} active subscriptions and rejects all further commands. You can unblock later, but subscriptions must be resumed manually.`,
                ),
                ok: L("封禁", "Block"),
                danger: true,
            });
            if (!ok) return;
        }
        setBusy("role");
        try {
            onChanged(await api(`/targets/${chat.id}/role`, { method: "PATCH", body: { role } }));
            toast(role === "banned" ? L("已封禁", "Blocked") : L("角色已更新", "Role updated"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function leave() {
        const ok = await confirm({
            title: L("让机器人退出这个" + KIND[kind](), "Make the bot leave this " + KIND[kind]().toLowerCase()),
            body: L(
                "机器人会立即退出，并暂停这个会话的全部订阅。想恢复服务需要重新把机器人加回来。",
                "The bot leaves immediately and pauses all of this chat's subscriptions. To resume, add the bot back.",
            ),
            ok: L("退出", "Leave"),
            danger: true,
            typed: chat.id,
        });
        if (!ok) return;
        setBusy("leave");
        try {
            await api(`/targets/${chat.id}/leave`, { method: "POST", body: { confirm: chat.id } });
            toast(L("机器人已退出", "The bot has left"));
            onChanged();
            onClose();
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function refresh() {
        setBusy("refresh");
        try {
            onChanged(await api(`/targets/${chat.id}/refresh`, { method: "POST", body: {} }));
            toast(L("已从 Telegram 同步", "Synced from Telegram"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    const roles = [
        ...(kind === "private" ? [["admin", ROLE.admin()]] : []),
        ["user", ROLE.user()],
        ["guest", ROLE.guest()],
        ["banned", ROLE.banned()],
    ];
    return html`
        ${departed
            ? html`<${Notice} tone="warn" title=${L("机器人已不在这个会话中", "The bot is no longer in this chat")}
                  >${L(
                      "它已退出、被移除或被停用，订阅不会再推送。",
                      "It left, was removed or disabled; nothing will be delivered here.",
                  )}<//
              >`
            : null}
        <div class="facts" style=${departed ? "margin-top:14px" : ""}>
            <div>
                <small>${L("启用的订阅", "Active subscriptions")}</small
                ><b>${chat.active_subscriptions} <span class="muted" style="font-weight:450">/ ${chat.subscriptions}</span></b>
            </div>
            <div>
                <small>${L("抓取异常", "Fetch issues")}</small
                ><b style=${chat.attention ? "color:var(--amber)" : ""}>${chat.attention || "—"}</b>
            </div>
            <div>
                <small>${L("机器人语言", "Bot language")}</small
                ><b>${(LANGS.find(([v]) => v === chat.lang)?.[1] || (() => chat.lang))()}</b>
            </div>
            <div>
                <small>${L("状态更新", "Last checked")}</small
                ><b title=${dateTime(chat.checked_at)}>${chat.checked_at ? ago(chat.checked_at) : "—"}</b>
            </div>
        </div>

        <div class="section-title">
            <div>
                <h3>${L("角色", "Role")}</h3>
                <p>${L("决定这个会话能否使用机器人。", "Controls whether this chat may use the bot.")}</p>
            </div>
        </div>
        ${chat.role_protected
            ? html`<${Notice} title=${L("这是机器人所有者", "This is the bot owner")}
                  >${L(
                      "所有者由部署配置 MANAGER 指定，不能在网页上修改。",
                      "The owner is set by the MANAGER deployment setting and can't be changed here.",
                  )}<//
              >`
            : html`<div class="panel">
                  ${roles.map(
                      ([value, label]) =>
                          html`<label class="list-row" style="cursor:pointer">
                              <input
                                  type="radio"
                                  name="role"
                                  class="checkbox"
                                  checked=${chat.role === value}
                                  disabled=${!!busy}
                                  onClick=${(e) => (e.preventDefault(), setRole(value))}
                              />
                              <span class="grow"
                                  ><span class="title">${label}</span
                                  ><span class="meta" style="white-space:normal">${ROLE_HELP[value]()}</span></span
                              >
                              ${chat.role === value ? html`<${Badge} tone=${roleTone[value]}>${L("当前", "Current")}<//>` : null}
                          </label>`,
                  )}
              </div>`}

        <div class="section-title">
            <div><h3>${L("服务控制", "Service")}</h3></div>
        </div>
        ${!app.info.snapshot
            ? html`<div class="action-card">
                  <${Icon} name="refresh" size=${18} />
                  <div>
                      <b>${L("从 Telegram 同步", "Sync from Telegram")}</b>
                      <p>
                          ${L(
                              "更新名称、类型，并检查机器人是否还能在这里发消息。",
                              "Update name and type, and check the bot can still post here.",
                          )}
                      </p>
                  </div>
                  <${Button} size="sm" loading=${busy === "refresh"} onClick=${refresh}>${L("同步", "Sync")}<//>
              </div>`
            : null}
        ${kind !== "private" && !departed
            ? html`<div class="action-card danger">
                  <${Icon} name="logout" size=${18} />
                  <div>
                      <b>${L("让机器人退出", "Make the bot leave")}</b>
                      <p>
                          ${L(
                              "从这个群组或频道中移除机器人，并暂停所有订阅。",
                              "Remove the bot from this group or channel and pause its subscriptions.",
                          )}
                      </p>
                  </div>
                  <${Button} size="sm" kind="danger" loading=${busy === "leave"} disabled=${!!app.info.snapshot} onClick=${leave}
                      >${L("退出", "Leave")}<//
                  >
              </div>`
            : null}
        ${kind === "private" && !chat.role_protected
            ? html`<p class="muted" style="font-size:12.5px;margin-top:10px">
                  ${L(
                      "私聊无法“退出”。要停止为陌生人服务，请把角色设为“已封禁”。",
                      "Bots can't leave private chats. To stop serving a stranger, set the role to Blocked.",
                  )}
              </p>`
            : null}
    `;
}

function ChatSubs({ chat, onChanged }) {
    const { data, error, reload } = useAsync(() => api("/subscriptions" + qs({ target: chat.id, size: 100 })), [chat.id]);
    const [busy, setBusy] = useState("");
    async function importOpml(file) {
        if (!file) return;
        setBusy("import");
        try {
            const result = await api(`/targets/${chat.id}/opml`, { method: "POST", body: { opml: await file.text() } });
            const created = result.results.filter((r) => r.status === "created").length;
            const failed = result.results.filter((r) => r.status === "failed").length;
            toast(
                L(
                    `导入完成：新增 ${created} 个${failed ? `，失败 ${failed} 个` : ""}`,
                    `Imported: ${created} added${failed ? `, ${failed} failed` : ""}`,
                ),
                failed ? "error" : "ok",
            );
            reload(true);
            onChanged();
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    return html`
        <div class="row wrap" style="margin-bottom:14px">
            <${Button} kind="primary" size="sm" icon="plus" onClick=${() => go("subscriptions", { target: chat.id, add: 1 })}
                >${L("添加订阅", "Add subscription")}<//
            >
            <label class="btn btn-sm ${busy === "import" ? "is-loading" : ""}">
                <${Icon} name="upload" />${L("导入 OPML", "Import OPML")}
                <input type="file" accept=".opml,.xml,text/xml" hidden onChange=${(e) => importOpml(e.currentTarget.files[0])} />
            </label>
            <${Button}
                size="sm"
                icon="download"
                disabled=${!chat.subscriptions}
                onClick=${() => download(`/targets/${chat.id}/opml`, `rsstt-${chat.id}.opml`).catch((e) => toast(e.message, "error"))}
                >${L("导出 OPML", "Export OPML")}<//
            >
            <span class="spacer"></span>
            <${Button} size="sm" kind="ghost" onClick=${() => go("subscriptions", { target: chat.id })}
                >${L("在订阅页打开", "Open in Subscriptions")} →<//
            >
        </div>
        ${error
            ? html`<${Notice} tone="error">${error.message}<//>`
            : !data
              ? html`<${Spinner} />`
              : !data.items.length
                ? html`<${Empty} icon="feeds" title=${L("这个会话还没有订阅", "No subscriptions yet")} />`
                : html`<div class="panel">
                          ${data.items.map(
                              (s) =>
                                  html`<button class="list-row" onClick=${() => go("subscriptions", { target: chat.id, sub: s.id })}>
                                      <span class="feed-icon ${s.state ? (s.errors >= 3 ? "error" : "") : "paused"}"
                                          >${[...(s.title || "?")][0]}</span
                                      >
                                      <span class="grow"><span class="title">${s.title}</span><span class="meta">${s.url}</span></span>
                                      ${s.state
                                          ? s.errors
                                              ? html`<${Badge} tone="red">${L(`失败 ${s.errors} 次`, `${s.errors} failures`)}<//>`
                                              : null
                                          : html`<${Badge}>${L("已暂停", "Paused")}<//>`}
                                      <${Icon} name="chevron" class="muted" />
                                  </button>`,
                          )}
                      </div>
                      ${data.total > data.items.length
                          ? html`<p class="muted" style="margin-top:10px">
                                ${L(
                                    `仅显示前 ${data.items.length} 个，共 ${data.total} 个。`,
                                    `Showing ${data.items.length} of ${data.total}.`,
                                )}
                            </p>`
                          : null}`}
    `;
}

const LANGS = [
    ["null", () => L("跟随 Telegram 客户端", "Telegram client language")],
    ["zh-Hans", () => "简体中文"],
    ["zh-Hant", () => "繁體中文"],
    ["en", () => "English"],
    ["ja", () => "日本語"],
    ["ru", () => "Русский"],
];

function ChatDefaults({ chat, onChanged }) {
    const settings = useAsync(() => api("/settings"), []);
    const [draft, setDraft] = useState(() => ({ lang: chat.lang, sub_limit: chat.sub_limit, ...chat.options }));
    const [busy, setBusy] = useState(false);
    const base = { lang: chat.lang, sub_limit: chat.sub_limit, ...chat.options };
    const dirty = Object.keys(draft).filter((k) => draft[k] !== base[k]);
    const minimal = settings.data?.options.minimal_interval || 1;
    const globalLimit = settings.data
        ? kindOf(chat) === "private"
            ? settings.data.options.user_sub_limit
            : settings.data.options.channel_or_group_sub_limit
        : null;
    async function save() {
        setBusy(true);
        try {
            const body = Object.fromEntries(dirty.map((k) => [k, draft[k]]));
            onChanged(await api(`/targets/${chat.id}`, { method: "PATCH", body }));
            toast(L("已保存", "Saved"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy(false);
        }
    }
    const langs = LANGS.some(([v]) => v === chat.lang) ? LANGS : [...LANGS, [chat.lang, () => chat.lang]];
    return html`
        <p class="muted" style="margin-bottom:16px">
            ${L(
                "这些是这个会话的默认值，对选择“跟随会话默认”的订阅生效。等同于在机器人里使用 /set_default。",
                "Defaults for this chat; apply to subscriptions set to “Chat default”. Same as /set_default in the bot.",
            )}
        </p>
        <div class="form-grid">
            <${Field} label=${L("机器人回复语言", "Bot reply language")}>
                <${Select}
                    value=${draft.lang}
                    onChange=${(v) => setDraft({ ...draft, lang: v })}
                    options=${langs.map(([v, l]) => [v, l()])}
                />
            <//>
            <${Field}
                label=${L("订阅数量上限", "Subscription limit")}
                hint=${L(
                    `留空则使用全局设置（${globalLimit == null ? "…" : globalLimit === -1 ? "不限" : globalLimit}）；-1 表示不限。`,
                    `Empty uses the global setting (${globalLimit == null ? "…" : globalLimit === -1 ? "unlimited" : globalLimit}); -1 = unlimited.`,
                )}
            >
                <${Input}
                    type="number"
                    min="-1"
                    value=${draft.sub_limit ?? ""}
                    placeholder=${L("全局设置", "Global")}
                    onInput=${(v) => setDraft({ ...draft, sub_limit: v === "" ? null : Number(v) })}
                />
            <//>
            <div class="full">
                <${IntervalField}
                    value=${draft.interval}
                    minimal=${minimal}
                    inheritLabel=${L(
                        `全局默认（${settings.data?.options.default_interval ?? "…"} 分钟）`,
                        `Global default (${settings.data?.options.default_interval ?? "…"} min)`,
                    )}
                    onChange=${(v) => setDraft({ ...draft, interval: v })}
                />
            </div>
        </div>
        <div class="form-section">
            <h4>${L("推送格式", "Message format")}</h4>
            <p>${L("决定推送到这个会话的消息长什么样。", "How messages delivered to this chat look.")}</p>
            <${OptionsForm} values=${draft} onChange=${(next) => setDraft({ ...draft, ...next })} />
        </div>
        <div class="row" style="margin-top:22px;justify-content:flex-end">
            ${dirty.length
                ? html`<span class="muted" style="margin-right:auto">${L(`${dirty.length} 项未保存`, `${dirty.length} unsaved`)}</span>`
                : null}
            <${Button} disabled=${!dirty.length} onClick=${() => setDraft(base)}>${L("还原", "Reset")}<//>
            <${Button} kind="primary" disabled=${!dirty.length} loading=${busy} onClick=${save}>${L("保存", "Save")}<//>
        </div>
    `;
}

const ACTION_NAMES = {
    "subscriptions.add": () => L("添加订阅", "Added subscriptions"),
    "subscriptions.remove": () => L("取消订阅", "Removed subscriptions"),
    "subscriptions.update": () => L("修改订阅设置", "Changed subscription settings"),
    "subscriptions.batch": () => L("批量处理订阅", "Batch updated subscriptions"),
    "subscriptions.import": () => L("导入 OPML", "Imported OPML"),
    "subscriptions.reset": () => L("重置订阅设置", "Reset subscription settings"),
    "subscriptions.list": () => L("查看订阅列表（/list）", "Viewed list (/list)"),
    "subscriptions.export": () => L("导出订阅（/export）", "Exported (/export)"),
    "subscriptions.settings": () => L("打开订阅设置（/set）", "Opened settings (/set)"),
    "settings.update": () => L("修改默认设置", "Changed defaults"),
    "settings.view": () => L("查看默认设置", "Viewed defaults"),
    "role.update": () => L("修改角色", "Changed role"),
    "role.view": () => L("查看角色", "Viewed role"),
    "language.update": () => L("修改语言（/lang）", "Changed language (/lang)"),
    "language.view": () => L("查看语言", "Viewed language"),
    "recipients.update": () => L("修改接收会话", "Changed recipients"),
    "destination.settings": () => L("修改会话设置", "Changed chat settings"),
    "destination.leave": () => L("机器人退出", "Bot left"),
    "destination.join": () => L("机器人加入", "Bot joined"),
    "destination.register": () => L("登记会话", "Registered chat"),
    "destination.refresh": () => L("同步会话信息", "Synced chat"),
    "bot.start": () => "/start",
    "bot.help": () => "/help",
    "bot.version": () => "/version",
    "bot.test": () => "/test",
    "bot.inline": () => L("内联查询", "Inline query"),
    "bot.callback": () => L("点击按钮", "Button press"),
    "bot.other": () => L("其他命令", "Other command"),
    "bot.lifecycle": () => L("成员变动", "Membership change"),
};
const SOURCE = { bot: () => L("机器人", "Bot"), web: () => L("网页", "Web"), agent: () => "API" };
const FIELD = {
    state: () => L("状态", "state"),
    role: () => L("角色", "role"),
    lang: () => L("语言", "language"),
    title: () => L("标题", "title"),
    tags: () => "hashtag",
    interval: () => L("间隔", "interval"),
    exists: () => L("存在", "exists"),
    subscriptions_count: () => L("订阅数", "subscriptions"),
    membership: () => L("成员状态", "membership"),
    sub_limit: () => L("订阅上限", "limit"),
};
const USER_STATE = {
    "-1": () => L("已封禁", "Blocked"),
    0: () => L("访客", "Guest"),
    1: () => L("用户", "User"),
    50: () => L("用户（频道）", "User (channel)"),
    51: () => L("用户（群组）", "User (group)"),
    100: () => L("管理员", "Admin"),
};
const show = (field, v, entity) => {
    if (v === null || v === undefined) return "—";
    if (field === "state" && entity === "user") return USER_STATE[v]?.() ?? String(v);
    if (field === "state" && entity === "subscription") return v ? L("启用", "active") : L("暂停", "paused");
    if (typeof v === "boolean") return v ? L("是", "yes") : L("否", "no");
    if (OPTIONS.some((o) => o.key === field && o.values) && typeof v === "number") return labelOf(field, v);
    return String(v);
};

function summarize(changes) {
    const rows = [];
    const subState = changes.filter((c) => c.entity === "subscription" && c.field === "state");
    const paused = subState.filter((c) => c.after === 0).length;
    const resumed = subState.filter((c) => c.after === 1).length;
    const added = changes.filter((c) => c.entity === "subscription" && c.field === "exists" && c.after).length;
    const removed = changes.filter((c) => c.entity === "subscription" && c.field === "exists" && !c.after).length;
    for (const c of changes) {
        if (c.entity === "subscription" && (c.field === "state" || c.field === "exists")) continue;
        const name =
            c.field === "state" && c.entity === "user"
                ? L("角色", "Role")
                : FIELD[c.field]?.() || OPTIONS.find((o) => o.key === c.field)?.label() || c.field;
        rows.push(
            html`<dt>${c.entity === "subscription" ? L(`订阅 #${c.id} · `, `Sub #${c.id} · `) : ""}${name}</dt>
                <dd>${show(c.field, c.before, c.entity)} → <b>${show(c.field, c.after, c.entity)}</b></dd>`,
        );
    }
    if (paused)
        rows.push(
            html`<dt>${L("订阅", "Subscriptions")}</dt>
                <dd>${L(`暂停了 ${paused} 个`, `${paused} paused`)}</dd>`,
        );
    if (resumed)
        rows.push(
            html`<dt>${L("订阅", "Subscriptions")}</dt>
                <dd>${L(`恢复了 ${resumed} 个`, `${resumed} resumed`)}</dd>`,
        );
    if (added)
        rows.push(
            html`<dt>${L("订阅", "Subscriptions")}</dt>
                <dd>${L(`新增 ${added} 个`, `${added} added`)}</dd>`,
        );
    if (removed)
        rows.push(
            html`<dt>${L("订阅", "Subscriptions")}</dt>
                <dd>${L(`取消 ${removed} 个`, `${removed} removed`)}</dd>`,
        );
    return rows;
}

function ChatActivity({ chat }) {
    const [page, setPage] = useState(1);
    const { data, error } = useAsync(() => api(`/targets/${chat.id}/activity` + qs({ page, size: 20 })), [chat.id, page]);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    if (!data.items.length)
        return html`<${Empty} icon="clock" title=${L("还没有记录", "Nothing recorded yet")}
            >${L(
                "记录从启用管理台之后开始积累：这个会话在机器人里用过的命令、网页上做过的修改都会出现在这里。",
                "Recorded since the console was enabled: commands used in the bot and changes made on the web appear here.",
            )}<//
        >`;
    return html`
        <div class="timeline">
            ${data.items.map(
                (e) =>
                    html`<div class="event">
                        <span
                            class="lvl ${e.outcome === "completed" ? "lvl-ok" : e.outcome === "denied" ? "lvl-warning" : "lvl-error"}"
                        ></span>
                        <div>
                            <div class="event-head">
                                <b>${ACTION_NAMES[e.action]?.() || e.action}</b>
                                ${e.outcome !== "completed"
                                    ? html`<${Badge} tone=${e.outcome === "denied" ? "amber" : "red"}
                                          >${e.outcome === "denied" ? L("被拒绝", "Denied") : L("出错", "Error")}<//
                                      >`
                                    : null}
                            </div>
                            <div class="event-meta">
                                ${dateTime(e.at)} ·
                                ${SOURCE[e.source]?.() || e.source}${e.actor && e.actor !== "anonymous"
                                    ? " · " + (e.actor === "administrator" ? L("管理员", "admin") : e.actor)
                                    : ""}
                            </div>
                            ${e.changes?.length ? html`<dl class="kv">${summarize(e.changes)}</dl>` : null}
                        </div>
                    </div>`,
            )}
        </div>
        <${Pager} page=${page} size=${data.size} total=${data.total} onPage=${setPage} />
    `;
}
