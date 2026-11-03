// Batch settings: everything the subscription drawer can change on one subscription, for a whole selection.
// Every setting starts as "keep" and only the ones that are ticked are sent, with the same values the drawer sends.
import { html, useState, useAsync, Modal, Button, Field, Input, Select, Spinner, Notice, ChatPicker, confirm } from "./ui.js";
import { L, api, toast, minutes, app, lang } from "./core.js";
import { businessError } from "./error-messages.js";
import { OPTIONS, OptionField, IntervalField } from "./options.js";
import { ProxyField, emptyProxy, proxyReady } from "./proxy.js";

const DEFAULTS = () => ({
    title: "",
    tags: "",
    interval: null,
    state: 0,
    user_agent: "",
    proxy: emptyProxy(),
    add_recipients: [],
    remove_recipients: [],
    ...Object.fromEntries(OPTIONS.map((o) => [o.key, -100])),
});

const SAVED = () => ({
    subscription: L("订阅设置", "subscription settings"),
    fetch_options: L("抓取设置", "fetch settings"),
    recipients: L("接收会话", "recipients"),
});

/** The request value of a setting, in the form the single-subscription PATCH uses. */
function valueOf(key, draft) {
    if (key === "title" || key === "tags" || key === "user_agent") return draft[key].trim() || null;
    if (key === "proxy") return draft.proxy.mode === "inherit" ? null : draft.proxy.mode === "direct" ? "direct" : draft.proxy.url.trim();
    return draft[key];
}

function problemOf(key, draft, minimal) {
    const value = valueOf(key, draft);
    if (key === "interval" && value != null && !(value >= minimal && value <= 32767))
        return L(`检查间隔不能小于 ${minimal} 分钟。`, `The interval cannot be below ${minimal} minutes.`);
    if (key === "length_limit" && value !== -100 && !(Number.isInteger(value) && value >= 0 && value <= 4096))
        return L("长度上限应为 0–4096。", "The length limit must be 0–4096.");
    if (key === "title" && value && value.length > 1024) return L("标题过长。", "The title is too long.");
    if (key === "tags" && value && value.length > 255) return L("hashtag 过长。", "The hashtags are too long.");
    if (key === "user_agent" && value && !(value.length <= 512 && /^[\x20-\x7e]+$/.test(value)))
        return L("User-Agent 应为最多 512 个可打印 ASCII 字符。", "The User-Agent must be up to 512 printable ASCII characters.");
    if (key === "proxy" && !proxyReady(draft.proxy, null)) return L("请填写代理地址。", "Enter the proxy address.");
    if (key === "add_recipients" && !value.length) return L("请选择要添加的会话。", "Choose the chats to add.");
    if (key === "remove_recipients" && !value.length) return L("请选择要移除的会话。", "Choose the chats to remove.");
    return "";
}

/** A labelled block for controls made of several elements (a label would forward clicks to the first one). */
function Block({ label, hint, setting, children }) {
    return html`<div class="field" data-setting=${setting}>
        <span class="field-label">${label}</span> ${children} ${hint ? html`<span class="field-hint">${hint}</span>` : null}
    </div>`;
}

/** One setting: a tick to change it (otherwise it keeps what each subscription has), and the very control the drawer uses. */
function Row({ setting, on, onToggle, wide, children }) {
    return html`<div class="batch-row ${on ? "on" : ""} ${wide ? "wide" : ""}" data-setting=${setting} data-changing=${on ? "yes" : "no"}>
        <input
            type="checkbox"
            class="checkbox"
            checked=${on}
            aria-label=${L("修改这一项", "Change this setting")}
            onChange=${(e) => onToggle(e.currentTarget.checked)}
        />
        <fieldset class="batch-control" disabled=${!on}>${children}</fieldset>
        <span class="batch-state">${on ? L("将修改", "Will change") : L("保持不变", "Keep")}</span>
    </div>`;
}

export function BatchSettings({ chosen, onClose, onChanged, onDone }) {
    const settings = useAsync(() => api("/settings"), []);
    const [on, setOn] = useState(new Set());
    const [draft, setDraft] = useState(DEFAULTS);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [results, setResults] = useState(null);
    const ids = chosen.map((s) => s.id);
    const minimal = settings.data?.options.minimal_interval || 1;
    const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
    const toggle = (key, checked) =>
        setOn((current) => {
            const next = new Set(current);
            checked ? next.add(key) : next.delete(key);
            return next;
        });
    const row = (key, children, wide) =>
        html`<${Row} setting=${key} on=${on.has(key)} onToggle=${(c) => toggle(key, c)} wide=${wide}>${children}<//>`;
    const keys = [...on];
    const problems = keys.map((key) => problemOf(key, draft, minimal)).filter(Boolean);
    const overlap =
        draft.add_recipients.some((id) => draft.remove_recipients.includes(id)) && on.has("add_recipients") && on.has("remove_recipients");
    const invalid = !keys.length || problems.length || overlap || !settings.data;

    async function submit() {
        const removing = on.has("remove_recipients") ? draft.remove_recipients.length : 0;
        if (
            removing &&
            !(await confirm({
                title: L(`移除 ${removing} 个接收会话？`, `Remove ${removing} recipients?`),
                body: L(
                    "所选订阅涉及的订阅源将不再推送给这些会话，它们在这些订阅上的自定义设置会被删除，相当于在对应会话里执行 /unsub，无法撤销。",
                    "The feeds behind the selection will stop being delivered to these chats and their settings for them are deleted, like /unsub in each chat. This can't be undone.",
                ),
                ok: L("移除并保存", "Remove and save"),
                danger: true,
            }))
        )
            return;
        setBusy(true);
        setError("");
        try {
            const changes = Object.fromEntries(keys.map((key) => [key, valueOf(key, draft)]));
            const result = await api("/subscriptions/batch", { method: "POST", body: { ids, action: "settings", changes } });
            const failed = result.results.filter((r) => !r.ok);
            if (!failed.length) {
                toast(L(`已修改 ${ids.length} 个订阅`, `${ids.length} subscriptions updated`));
                onDone();
            } else {
                setResults(result.results);
                onChanged();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    if (results) {
        const failed = results.filter((r) => !r.ok);
        const byId = Object.fromEntries(chosen.map((s) => [s.id, s]));
        return html`<${Modal}
            title=${L("批量设置的结果", "Batch settings result")}
            size="lg"
            onClose=${onDone}
            footer=${html`<${Button} kind="primary" onClick=${onDone}>${L("完成", "Done")}<//>`}
        >
            <${Notice} tone=${failed.length === results.length ? "error" : "warn"}>
                ${L(
                    `${results.length - failed.length} 个已保存，${failed.length} 个失败。失败的订阅没有被修改的部分保持原样。`,
                    `${results.length - failed.length} saved, ${failed.length} failed. Whatever failed was left as it was.`,
                )}
            <//>
            <ul class="batch-fetch-list" data-testid="batch-failures">
                ${failed.map((r) => {
                    const sub = byId[r.id];
                    return html`<li>
                        <span>${sub ? `${sub.title} · ${sub.target_title}` : `#${r.id}`}</span>
                        <span class="muted"
                            >${businessError(r, lang) || r.error}${r.applied?.length
                                ? L(
                                      `（已保存：${r.applied.map((g) => SAVED()[g]).join("、")}）`,
                                      ` (saved: ${r.applied.map((g) => SAVED()[g]).join(", ")})`,
                                  )
                                : ""}</span
                        >
                    </li>`;
                })}
            </ul>
        <//>`;
    }

    return html`<${Modal}
        title=${L("批量设置", "Batch settings")}
        size="lg"
        onClose=${onClose}
        footer=${html`<span class="muted grow" style="font-size:12.5px"
                >${keys.length
                    ? L(
                          `将修改 ${keys.length} 项，应用到 ${ids.length} 个订阅`,
                          `${keys.length} settings will change on ${ids.length} subscriptions`,
                      )
                    : L("勾选要修改的项；没有勾选的保持不变。", "Tick what to change; everything else stays as it is.")}</span
            >
            <${Button} onClick=${onClose}>${L("取消", "Cancel")}<//>
            <${Button} kind="primary" loading=${busy} disabled=${invalid} onClick=${submit}>${L("应用", "Apply")}<//>`}
    >
        <p class="confirm-body">
            ${L(
                `对所选的 ${ids.length} 个订阅，勾选的项会被改成下面的值，没有勾选的项保持各自原来的样子。这里和单个订阅里的设置一一对应。`,
                `Ticked settings are set to the value shown on all ${ids.length} selected subscriptions; the rest stay as they are. Same settings as a single subscription.`,
            )}
        </p>
        ${!settings.data ? html`<${Spinner} />` : null}
        <div class="form-section" style="margin-top:0;padding-top:0;border:0">
            <h4>${L("基本", "General")}</h4>
            <div class="batch-rows">
                ${row(
                    "title",
                    html`<${Field}
                        label=${L("自定义标题", "Custom title")}
                        setting="title"
                        hint=${L("留空会清除自定义标题，改用订阅源标题。", "Empty clears the custom title.")}
                    >
                        <${Input} value=${draft.title} onInput=${(v) => set("title", v)} />
                    <//>`,
                )}
                ${row(
                    "tags",
                    html`<${Field}
                        label=${L("自定义 hashtag", "Custom hashtags")}
                        setting="tags"
                        hint=${L("空格分隔；留空会清除。", "Space-separated; empty clears them.")}
                    >
                        <${Input} value=${draft.tags} placeholder="#news #tech" onInput=${(v) => set("tags", v)} />
                    <//>`,
                )}
                ${row(
                    "interval",
                    html`<${IntervalField}
                        value=${draft.interval}
                        minimal=${minimal}
                        inheritLabel=${L(
                            `跟随默认（${minutes(settings.data?.options.default_interval)}）`,
                            `Default (${minutes(settings.data?.options.default_interval)})`,
                        )}
                        onChange=${(v) => set("interval", v)}
                    />`,
                )}
                ${row(
                    "state",
                    html`<${Field} label=${L("订阅状态", "Subscription")} setting="state">
                        <${Select}
                            value=${draft.state}
                            onChange=${(v) => set("state", Number(v))}
                            options=${[
                                [0, L("暂停推送", "Pause delivery")],
                                [1, L("恢复推送", "Resume delivery")],
                            ]}
                        />
                    <//>`,
                )}
            </div>
        </div>
        <div class="form-section">
            <h4>${L("推送格式", "Message format")}</h4>
            <p>
                ${L(
                    "“跟随会话默认”会让每个订阅使用各自接收会话的推送默认值。",
                    "“Chat default” makes each subscription use its own chat's defaults.",
                )}
            </p>
            <div class="batch-rows option-grid">
                ${OPTIONS.map((o) => row(o.key, html`<${OptionField} option=${o} values=${draft} onChange=${set} generic />`))}
            </div>
        </div>
        <div class="form-section" data-group="fetch">
            <h4>${L("抓取", "Fetching")}</h4>
            <p>
                ${L(
                    "这些是订阅源自己的设置：同一个源被多个所选订阅使用时只改一次，也会影响没有被选中的接收会话。",
                    "These belong to the feed: a feed shared by several selected subscriptions is changed once, and its other recipients are affected too.",
                )}
            </p>
            <div class="batch-rows">
                ${row(
                    "user_agent",
                    html`<${Field}
                        label="User-Agent"
                        setting="user_agent"
                        hint=${L("留空会恢复为全局设置。", "Empty restores the global setting.")}
                    >
                        <${Input} class="mono" value=${draft.user_agent} onInput=${(v) => set("user_agent", v)} />
                    <//>`,
                )}
                ${row(
                    "proxy",
                    html`<${Block} label=${L("代理", "Proxy")} setting="proxy">
                        <${ProxyField} draft=${draft.proxy} onChange=${(v) => set("proxy", v)} />
                    <//>`,
                )}
            </div>
        </div>
        ${app.info.features.recipients
            ? html`<div class="form-section" data-group="recipients">
                  <h4>${L("接收会话", "Recipients")}</h4>
                  <p>
                      ${L(
                          "对所选订阅涉及的每个订阅源，增加或移除接收会话（同一个源只处理一次）。",
                          "For every feed behind the selection, add or remove recipient chats (each feed once).",
                      )}
                  </p>
                  <div class="batch-rows">
                      ${row(
                          "add_recipients",
                          html`<${Block}
                              label=${L("添加接收会话", "Add recipients")}
                              setting="add_recipients"
                              hint=${L("新增的接收关系使用该会话的推送默认值。", "New recipients use that chat's defaults.")}
                          >
                              <${ChatPicker} value=${draft.add_recipients} onChange=${(v) => set("add_recipients", v)} />
                          <//>`,
                          true,
                      )}
                      ${row(
                          "remove_recipients",
                          html`<${Block}
                              label=${L("移除接收会话", "Remove recipients")}
                              setting="remove_recipients"
                              hint=${L("相当于在这些会话里取消订阅。", "Same as unsubscribing in those chats.")}
                          >
                              <${ChatPicker} value=${draft.remove_recipients} onChange=${(v) => set("remove_recipients", v)} />
                          <//>`,
                          true,
                      )}
                  </div>
              </div>`
            : null}
        ${overlap
            ? html`<${Notice} tone="error">${L("同一个会话不能同时添加和移除。", "A chat cannot be added and removed at once.")}<//>`
            : null}
        ${problems.length ? html`<${Notice} tone="error">${problems[0]}<//>` : null}
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}
