import {
    html,
    useState,
    useEffect,
    useRef,
    useAsync,
    useRoute,
    Icon,
    Button,
    IconButton,
    Field,
    Input,
    Textarea,
    Select,
    SearchInput,
    Spinner,
    Empty,
    Notice,
    Badge,
    ChatAvatar,
    Pager,
    Drawer,
    Tabs,
    Modal,
    ChatPicker,
    confirm,
} from "./ui.js";
import { L, api, qs, num, ago, dateTime, readRoute, setParams, toast, download, host, minutes, app } from "./core.js";
import { OptionsForm, IntervalField } from "./options.js";
import { EventRow } from "./page-logs.js";
import { ProxyField, ProxyTestResult, emptyProxy, proxyValue, proxyChanged, proxyReady, savedText } from "./proxy.js";

const STATUS = () => [
    ["", L("全部状态", "Any status")],
    ["active", L("启用", "Active")],
    ["paused", L("已暂停", "Paused")],
    ["attention", L("抓取异常", "Failing")],
];

function statusQuery(status) {
    if (status === "active") return { state: 1 };
    if (status === "paused") return { state: 0 };
    if (status === "attention") return { attention: 1 };
    return {};
}

export function SubStatus({ sub, threshold = 3 }) {
    if (!sub.state) return html`<${Badge}>${L("已暂停", "Paused")}<//>`;
    if (sub.feed_state === 0) return html`<${Badge} tone="red">${L("订阅源已停用", "Feed disabled")}<//>`;
    if (sub.errors >= threshold) return html`<${Badge} tone="red" dot>${L(`连续失败 ${sub.errors} 次`, `${sub.errors} failures`)}<//>`;
    if (sub.errors) return html`<${Badge} tone="amber" dot>${L(`失败 ${sub.errors} 次`, `${sub.errors} failures`)}<//>`;
    return html`<${Badge} tone="green" dot>${L("正常", "Healthy")}<//>`;
}

/** Stored as "a b" (like /set_hashtags); shown as "#a #b". */
const hashtags = (tags) => (tags ? "#" + tags.split(" ").join(" #") : "");

const feedGlyph = (s) => [...(s.title || host(s.url) || "?")][0]?.toUpperCase();

function TargetFilter({ value, onChange }) {
    const [chat, setChat] = useState(null);
    useEffect(() => {
        if (!value) return setChat(null);
        api("/targets" + qs({ q: value, visibility: "all", size: 5 }))
            .then((d) => setChat(d.items.find((c) => c.id === value) || { id: value, title: value }))
            .catch(() => setChat({ id: value, title: value }));
    }, [value]);
    if (value)
        return html`<span class="chip" style="height:36px;padding-left:6px;gap:8px">
            ${chat ? html`<${ChatAvatar} chat=${chat} size=${22} />${chat.title}` : value}
            <button type="button" aria-label=${L("清除会话筛选", "Clear chat filter")} onClick=${() => onChange("")}>
                <${Icon} name="close" size=${12} />
            </button>
        </span>`;
    return html`<div class="target-filter">
        <${ChatPicker} multiple=${false} value="" placeholder=${L("按会话筛选…", "Filter by chat…")} onChange=${(id) => onChange(id)} />
    </div>`;
}

export function Subscriptions() {
    useRoute();
    const { params } = readRoute();
    const q = params.q || "";
    const target = params.target || "";
    const status = params.status || "";
    const page = Number(params.page || 1);
    const [selected, setSelected] = useState(new Set());
    const [busy, setBusy] = useState("");
    const [proxyDialog, setProxyDialog] = useState(false);
    const [intervalDialog, setIntervalDialog] = useState(false);
    const [fetchDialog, setFetchDialog] = useState(false);
    const query = { q, target, ...statusQuery(status) };
    const { data, error, loading, reload } = useAsync(
        () => api("/subscriptions" + qs({ ...query, page, size: 30 })),
        [q, target, status, page],
    );
    const threshold = useAsync(() => api("/settings").then((s) => Number(s.console.attention_threshold) || 3), []).data || 3;
    useEffect(() => setSelected(new Set()), [q, target, status, page]);
    const items = data?.items || [];
    const allOn = items.length && items.every((s) => selected.has(s.id));
    const toggle = (id) => {
        const next = new Set(selected);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelected(next);
    };
    async function batch(action) {
        const ids = [...selected];
        if (action === "delete") {
            const ok = await confirm({
                title: L(`取消 ${ids.length} 个订阅？`, `Unsubscribe ${ids.length}?`),
                body: L(
                    "相当于在对应会话里执行 /unsub。自定义标题和格式设置会一并删除，无法撤销。",
                    "Same as /unsub in each chat. Custom titles and format settings are deleted too. This can't be undone.",
                ),
                ok: L("取消订阅", "Unsubscribe"),
                danger: true,
            });
            if (!ok) return;
        }
        setBusy(action);
        try {
            const result = await api("/subscriptions/batch", { method: "POST", body: { ids, action } });
            const failed = result.results.filter((r) => !r.ok);
            if (failed.length)
                toast(L(`${failed.length} 个未处理：${failed[0].error}`, `${failed.length} not processed: ${failed[0].error}`), "error");
            else toast(L(`已处理 ${ids.length} 个订阅`, `${ids.length} subscriptions updated`));
            setSelected(new Set());
            reload(true);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    function exportOpml() {
        const ids = [...selected];
        const params = ids.length ? { ids: ids.join(",") } : query;
        download("/subscriptions/opml" + qs(params), "rsstt.opml").catch((e) => toast(e.message, "error"));
    }
    async function copyUrls() {
        const urls = [...new Set(items.filter((s) => selected.has(s.id)).map((s) => s.url))];
        try {
            await navigator.clipboard.writeText(urls.join("\n"));
            toast(L(`已复制 ${urls.length} 个地址`, `${urls.length} URLs copied`));
        } catch {
            toast(L("浏览器不允许写入剪贴板", "The browser blocked clipboard access"), "error");
        }
    }
    const chosen = items.filter((s) => selected.has(s.id));
    const open = params.sub;
    const adding = params.add;
    return html`
        <div class="page-head">
            <div>
                <h1>${L("订阅", "Subscriptions")}</h1>
                <p>
                    ${L(
                        "所有会话的订阅。同一个 RSS 源被多个会话订阅时只抓取一次，再分别推送。",
                        "Every chat's subscriptions. A feed shared by several chats is fetched once and delivered to each.",
                    )}
                </p>
            </div>
            <div class="page-actions">
                <${Button} icon="download" onClick=${exportOpml}>${L("导出 OPML", "Export OPML")}<//>
                <${Button} icon="plus" kind="primary" onClick=${() => setParams({ add: 1 }, { replace: false })}
                    >${L("添加订阅", "Add subscription")}<//
                >
            </div>
        </div>
        <section class="card">
            <div class="toolbar">
                <${SearchInput}
                    value=${q}
                    placeholder=${L("搜索标题或网址", "Search title or URL")}
                    onInput=${(v) => setParams({ q: v, page: "" })}
                />
                <${TargetFilter} value=${target} onChange=${(v) => setParams({ target: v, page: "" })} />
                <${Select} value=${status} onChange=${(v) => setParams({ status: v, page: "" })} options=${STATUS()} />
                <span class="total">${data ? L(`${num(data.total)} 个订阅`, `${num(data.total)} subscriptions`) : ""}</span>
            </div>
            ${!target
                ? html`<div class="muted" style="padding:8px 14px 0;font-size:12.5px">
                      ${L("不含已封禁或机器人已退出的会话。", "Excludes blocked chats and chats the bot has left.")}
                  </div>`
                : null}
            ${error
                ? html`<div class="card-body"><${Notice} tone="error">${error.message}<//></div>`
                : !data
                  ? html`<${Spinner} />`
                  : !items.length
                    ? html`<${Empty}
                          icon="feeds"
                          title=${q || status || target
                              ? L("没有符合条件的订阅", "No matching subscriptions")
                              : L("还没有订阅", "No subscriptions yet")}
                          action=${!q && !status
                              ? html`<${Button} kind="primary" icon="plus" onClick=${() => setParams({ add: 1 }, { replace: false })}
                                    >${L("添加订阅", "Add subscription")}<//
                                >`
                              : null}
                      />`
                    : html`<div class="table-wrap" style=${loading ? "opacity:.6" : ""}>
                              <table class="table responsive">
                                  <thead>
                                      <tr>
                                          <th class="check">
                                              <input
                                                  type="checkbox"
                                                  class="checkbox"
                                                  aria-label=${L("全选", "Select all")}
                                                  checked=${allOn}
                                                  onChange=${() => setSelected(allOn ? new Set() : new Set(items.map((s) => s.id)))}
                                              />
                                          </th>
                                          <th>${L("订阅", "Subscription")}</th>
                                          <th>${L("推送到", "Delivers to")}</th>
                                          <th>${L("状态", "Status")}</th>
                                          <th>${L("间隔", "Interval")}</th>
                                          <th class="end"></th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${items.map(
                                          (s) =>
                                              html`<tr
                                                  class="clickable ${selected.has(s.id) ? "selected" : ""}"
                                                  onClick=${() => setParams({ sub: s.id }, { replace: false })}
                                              >
                                                  <td class="check" onClick=${(e) => e.stopPropagation()}>
                                                      <input
                                                          type="checkbox"
                                                          class="checkbox"
                                                          checked=${selected.has(s.id)}
                                                          onChange=${() => toggle(s.id)}
                                                      />
                                                  </td>
                                                  <td>
                                                      <div class="cell-main">
                                                          <span
                                                              class="feed-icon ${!s.state
                                                                  ? "paused"
                                                                  : s.errors >= threshold
                                                                    ? "error"
                                                                    : ""}"
                                                              >${feedGlyph(s)}</span
                                                          >
                                                          <div>
                                                              <span class="cell-title">${s.title}</span
                                                              ><span class="cell-sub"
                                                                  >${host(s.url)}${s.tags ? " · " + hashtags(s.tags) : ""}</span
                                                              >
                                                          </div>
                                                      </div>
                                                  </td>
                                                  <td data-label=${L("推送到", "Delivers to")}>
                                                      <button
                                                          class="link-btn"
                                                          style="color:var(--text);font-weight:450"
                                                          onClick=${(e) => (e.stopPropagation(), setParams({ target: s.target, page: "" }))}
                                                          title=${L("只看这个会话的订阅", "Only this chat")}
                                                      >
                                                          ${s.target_title}
                                                      </button>
                                                  </td>
                                                  <td data-label=${L("状态", "Status")}>
                                                      <${SubStatus} sub=${s} threshold=${threshold} />
                                                  </td>
                                                  <td data-label=${L("间隔", "Interval")} class="num">${minutes(s.effective_interval)}</td>
                                                  <td class="end chev"><${Icon} name="chevron" class="muted" /></td>
                                              </tr>`,
                                      )}
                                  </tbody>
                              </table>
                          </div>
                          <${Pager} page=${page} size=${data.size} total=${data.total} onPage=${(p) => setParams({ page: p })} />`}
        </section>
        ${selected.size
            ? html`<div class="batchbar">
                  <span>${L(`已选 ${selected.size} 个`, `${selected.size} selected`)}</span>
                  <${Button} size="sm" icon="pause" loading=${busy === "pause"} onClick=${() => batch("pause")}>${L("暂停", "Pause")}<//>
                  <${Button} size="sm" icon="play" loading=${busy === "resume"} onClick=${() => batch("resume")}>${L("恢复", "Resume")}<//>
                  ${app.info.features.manual_fetch
                      ? html`<${Button} size="sm" icon="refresh" onClick=${() => setFetchDialog(true)}>${L("立即抓取", "Fetch now")}<//>`
                      : null}
                  <${Button} size="sm" icon="clock" onClick=${() => setIntervalDialog(true)}>${L("间隔", "Interval")}<//>
                  <${Button} size="sm" icon="globe" onClick=${() => setProxyDialog(true)}>${L("代理", "Proxy")}<//>
                  <${Button} size="sm" icon="copy" onClick=${copyUrls}>${L("复制地址", "Copy URLs")}<//>
                  <${Button} size="sm" icon="download" onClick=${exportOpml}>${L("导出", "Export")}<//>
                  <${Button} size="sm" icon="trash" kind="danger" loading=${busy === "delete"} onClick=${() => batch("delete")}
                      >${L("取消订阅", "Unsubscribe")}<//
                  >
                  <${IconButton} icon="close" label=${L("取消选择", "Clear selection")} onClick=${() => setSelected(new Set())} />
              </div>`
            : null}
        ${proxyDialog
            ? html`<${BatchProxy}
                  feedIds=${[...new Set(items.filter((s) => selected.has(s.id)).map((s) => s.feed_id))]}
                  onClose=${() => setProxyDialog(false)}
                  onDone=${() => (setProxyDialog(false), setSelected(new Set()), reload(true))}
              />`
            : null}
        ${intervalDialog
            ? html`<${BatchInterval}
                  ids=${chosen.map((s) => s.id)}
                  onClose=${() => setIntervalDialog(false)}
                  onDone=${() => (setIntervalDialog(false), setSelected(new Set()), reload(true))}
              />`
            : null}
        ${fetchDialog
            ? html`<${BatchFetch}
                  chosen=${chosen}
                  onClose=${() => setFetchDialog(false)}
                  onFinished=${() => reload(true)}
              />`
            : null}
        ${open
            ? html`<${SubDrawer}
                  id=${open}
                  threshold=${threshold}
                  onClose=${() => setParams({ sub: "", tab: "" })}
                  onChanged=${() => reload(true)}
              />`
            : null}
        ${adding
            ? html`<${AddSubscription} target=${target} onClose=${() => setParams({ add: "" })} onDone=${() => reload(true)} />`
            : null}
    `;
}

/* ---------------- batch proxy ---------------- */

function BatchProxy({ feedIds, onClose, onDone }) {
    const [draft, setDraft] = useState(emptyProxy());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const value = draft.mode === "inherit" ? null : draft.mode === "direct" ? "direct" : draft.url.trim();
    async function submit() {
        setBusy(true);
        setError("");
        try {
            const result = await api("/feeds/fetch-options/batch", { method: "POST", body: { feeds: feedIds, proxy: value } });
            toast(L(`已更新 ${result.updated} 个订阅源，下次抓取生效`, `${result.updated} feeds updated; applies from their next fetch`));
            onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    return html`<${Modal}
        title=${L("设置代理", "Set proxy")}
        onClose=${onClose}
        footer=${html`<${Button} onClick=${onClose}>${L("取消", "Cancel")}<//>
            <${Button} kind="primary" loading=${busy} disabled=${draft.mode === "custom" && !draft.url.trim()} onClick=${submit}
                >${L("应用", "Apply")}<//
            >`}
    >
        <p class="confirm-body">
            ${L(
                `把下面的设置应用到所选订阅涉及的 ${feedIds.length} 个订阅源（同一个源被多个会话订阅时只算一个）。这是各个源自己的设置，不影响其他订阅，也不改变全局代理。`,
                `Applies to the ${feedIds.length} feeds behind your selection (a feed shared by several chats counts once). These are per-feed settings; other feeds and the global proxy are untouched.`,
            )}
        </p>
        <${ProxyField} draft=${draft} onChange=${setDraft} />
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}

/* ---------------- batch interval ---------------- */

function BatchInterval({ ids, onClose, onDone }) {
    const settings = useAsync(() => api("/settings"), []);
    const [value, setValue] = useState(60);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const minimal = settings.data?.options.minimal_interval || 1;
    async function submit() {
        setBusy(true);
        setError("");
        try {
            const result = await api("/subscriptions/batch", { method: "POST", body: { ids, action: "interval", interval: value } });
            const failed = result.results.filter((r) => !r.ok);
            if (failed.length) setError(L(`${failed.length} 个未处理：${failed[0].error}`, `${failed.length} not processed: ${failed[0].error}`));
            else {
                toast(L(`已更新 ${ids.length} 个订阅的检查间隔`, `Interval updated on ${ids.length} subscriptions`));
                onDone();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    return html`<${Modal}
        title=${L("设置检查间隔", "Set check interval")}
        onClose=${onClose}
        footer=${html`<${Button} onClick=${onClose}>${L("取消", "Cancel")}<//>
            <${Button} kind="primary" loading=${busy} disabled=${!settings.data || (value != null && value < minimal)} onClick=${submit}
                >${L("应用", "Apply")}<//
            >`}
    >
        <p class="confirm-body">
            ${L(
                `把检查间隔应用到所选的 ${ids.length} 个订阅。这是每个订阅自己的设置，会覆盖会话默认值；选“跟随默认”可以清除。`,
                `Applies to the ${ids.length} selected subscriptions. It is each subscription's own setting and overrides the chat default; “Default” clears it.`,
            )}
        </p>
        ${settings.data
            ? html`<${IntervalField}
                  value=${value}
                  minimal=${minimal}
                  inheritLabel=${L(`跟随默认（${minutes(settings.data.options.default_interval)}）`, `Default (${minutes(settings.data.options.default_interval)})`)}
                  onChange=${setValue}
              />`
            : html`<${Spinner} />`}
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}

/* ---------------- batch fetch now ---------------- */

function BatchFetch({ chosen, onClose, onFinished }) {
    const feeds = new Set(chosen.map((s) => s.feed_id)).size;
    const [batch, setBatch] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const timer = useRef();
    useEffect(() => () => clearTimeout(timer.current), []);
    const names = Object.fromEntries(chosen.map((s) => [String(s.id), s.title]));
    async function poll(id) {
        try {
            const next = await api(`/fetch-batches/${id}`);
            setBatch(next);
            if (next.status === "running") timer.current = setTimeout(() => poll(id), 1500);
            else onFinished();
        } catch (err) {
            setError(err.message);
        }
    }
    async function start() {
        setBusy(true);
        setError("");
        try {
            const created = await api("/subscriptions/fetch-now/batch", {
                method: "POST",
                body: { ids: chosen.map((s) => s.id), confirm: true },
            });
            setBatch(created);
            poll(created.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    const running = batch?.status === "running";
    const done = batch ? batch.counts.completed + batch.counts.failed + batch.counts.skipped : 0;
    const label = { queued: L("等待", "Waiting"), running: L("抓取中", "Fetching"), completed: L("完成", "Done"), failed: L("失败", "Failed"), skipped: L("跳过", "Skipped") };
    return html`<${Modal}
        title=${L("立即抓取", "Fetch now")}
        onClose=${running ? () => {} : onClose}
        footer=${batch
            ? html`<${Button} kind="primary" disabled=${running} onClick=${onClose}>${running ? L("抓取中…", "Fetching…") : L("完成", "Done")}<//>`
            : html`<${Button} onClick=${onClose}>${L("取消", "Cancel")}<//>
                  <${Button} kind="primary" loading=${busy} onClick=${start}>${L("开始抓取", "Start")}<//>`}
    >
        ${batch
            ? html`<p class="confirm-body">
                      ${running
                          ? L(`正在逐个抓取，已处理 ${done} / ${batch.total}。可以先去做别的，但请不要关闭页面。`, `Fetching one by one: ${done} of ${batch.total}. Please keep this page open.`)
                          : L(
                                `完成：成功 ${batch.counts.completed}，失败 ${batch.counts.failed}，跳过 ${batch.counts.skipped}。失败原因可在“运行日志”查看。`,
                                `Finished: ${batch.counts.completed} fetched, ${batch.counts.failed} failed, ${batch.counts.skipped} skipped. See Logs for failure details.`,
                            )}
                  </p>
                  <div class="batch-fetch-bar"><i style=${`width:${batch.total ? Math.round((done / batch.total) * 100) : 0}%`}></i></div>
                  <ul class="batch-fetch-list">
                      ${batch.items.map(
                          (item) => html`<li>
                              <span title=${names[item.subscription_id] || ""}>${names[item.subscription_id] || `#${item.subscription_id}`}</span>
                              <span class=${item.status === "failed" ? "bad" : "muted"}
                                  >${label[item.status]}${item.status === "completed" && item.new_entries
                                      ? L(` · ${item.new_entries} 篇新文章`, ` · ${item.new_entries} new`)
                                      : ""}${item.error ? ` · ${item.error}` : ""}</span
                              >
                          </li>`,
                      )}
                  </ul>`
            : html`<p class="confirm-body">
                  ${L(
                      `立刻抓取所选订阅涉及的 ${feeds} 个订阅源，逐个进行。有新文章会推送给订阅它们的全部会话，和定时检查完全一样。已暂停或不可用的订阅会被跳过。`,
                      `Fetches the ${feeds} feeds behind your selection, one by one. New posts go to every chat subscribed to them, exactly like a scheduled check. Paused or unavailable subscriptions are skipped.`,
                  )}
              </p>`}
        ${error ? html`<${Notice} tone="error">${error}<//>` : null}
    <//>`;
}

/* ---------------- add ---------------- */

function AddSubscription({ target, onClose, onDone }) {
    const [chat, setChat] = useState(target || "");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState("");
    const [proxy, setProxy] = useState(emptyProxy());
    const urls = text
        .split(/\s+/)
        .map((u) => u.trim())
        .filter(Boolean);
    async function submit() {
        setBusy(true);
        setError("");
        try {
            const body = { target: chat, urls };
            if (proxy.mode === "direct") body.proxy = "direct";
            else if (proxy.mode === "custom" && proxy.url.trim()) body.proxy = proxy.url.trim();
            const result = await api("/subscriptions", { method: "POST", body });
            setResults(result.results);
            const created = result.results.filter((r) => r.status === "created").length;
            if (created) onDone();
            if (result.results.every((r) => r.status !== "failed")) {
                toast(L(`已添加 ${created} 个订阅`, `${created} subscriptions added`));
                if (!result.results.some((r) => r.status === "existing")) onClose();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }
    const label = {
        created: () => L("已添加", "Added"),
        existing: () => L("已订阅过", "Already subscribed"),
        failed: () => L("失败", "Failed"),
    };
    return html`<${Modal}
        size="lg"
        title=${L("添加订阅", "Add subscriptions")}
        onClose=${onClose}
        footer=${html`<${Button} onClick=${onClose}>${results ? L("完成", "Done") : L("取消", "Cancel")}<//>
            <${Button} kind="primary" loading=${busy} disabled=${!chat || !urls.length || urls.length > 100} onClick=${submit}
                >${L("订阅", "Subscribe")}<//
            >`}
    >
        <${Field} label=${L("推送到哪个会话", "Deliver to")}>
            <${ChatPicker} multiple=${false} value=${chat} onChange=${(id) => setChat(id)} />
        <//>
        <${Field}
            label=${L("RSS 地址", "Feed URLs")}
            hint=${L(
                "每行一个，最多 100 个。机器人会先尝试读取每个地址，可能需要一点时间。",
                "One per line, up to 100. Each URL is fetched once to verify it, which may take a moment.",
            )}
            error=${error}
        >
            <${Textarea} rows="5" class="mono" placeholder="https://example.com/feed.xml" value=${text} onInput=${setText} />
        <//>
        <details class="adv" open=${proxy.mode !== "inherit"}>
            <summary>${L("这些地址需要通过代理访问？（可选）", "Do these URLs need a proxy? (optional)")}</summary>
            <p class="muted" style="font-size:12.5px;margin:6px 0 10px">
                ${L(
                    "服务器直接连不上时，先用这里的代理验证并订阅；设置会保存为这些订阅源自己的代理，验证失败则不保存。",
                    "If the server can't reach them directly, they're verified through this proxy and it's saved for these feeds; nothing is kept if verification fails.",
                )}
            </p>
            <${ProxyField} draft=${proxy} onChange=${setProxy} />
        </details>
        ${app.info.snapshot
            ? html`<${Notice} tone="warn"
                  >${L(
                      "离线副本不会真的去读取 RSS，新订阅只用于测试界面。",
                      "The offline copy doesn't fetch feeds; new subscriptions are for UI testing only.",
                  )}<//
              >`
            : null}
        ${results
            ? html`<div class="panel">
                  ${results.map(
                      (r) =>
                          html`<div class="list-row">
                              <span class="grow"
                                  ><span class="title mono" style="font-weight:450">${r.url}</span>${r.message
                                      ? html`<span class="meta" style="color:var(--red);white-space:normal">${r.message}</span>`
                                      : null}</span
                              >
                              <${Badge} tone=${r.status === "created" ? "green" : r.status === "failed" ? "red" : "neutral"}
                                  >${label[r.status]()}<//
                              >
                          </div>`,
                  )}
              </div>`
            : null}
    <//>`;
}

/* ---------------- drawer ---------------- */

export function SubDrawer({ id, onClose, onChanged, threshold }) {
    useRoute();
    const { params } = readRoute();
    const tab = params.tab || "settings";
    const detail = useAsync(() => loadSub(id), [id]);
    const s = detail.data;
    const [dirty, setDirty] = useState(false);
    const setTab = async (t) => {
        if (
            dirty &&
            t !== tab &&
            !(await confirm({
                title: L("放弃未保存的修改？", "Discard unsaved changes?"),
                body: L("“设置”里有尚未保存的修改。", "Settings has unsaved changes."),
                ok: L("放弃", "Discard"),
                danger: true,
            }))
        )
            return;
        setDirty(false);
        setParams({ tab: t === "settings" ? "" : t });
    };
    const close = async () => {
        if (
            dirty &&
            !(await confirm({
                title: L("放弃未保存的修改？", "Discard unsaved changes?"),
                body: L("“设置”里有尚未保存的修改。", "Settings has unsaved changes."),
                ok: L("放弃", "Discard"),
                danger: true,
            }))
        )
            return;
        onClose();
    };
    const changed = (next) => {
        if (next) detail.setData(next);
        else detail.reload(true);
        onChanged?.();
    };
    return html`<${Drawer}
        open=${true}
        wide
        onClose=${close}
        head=${s
            ? html`<span
                  class="feed-icon ${!s.state ? "paused" : s.errors >= threshold ? "error" : ""}"
                  style="width:40px;height:40px;font-size:16px"
                  >${feedGlyph(s)}</span
              >`
            : null}
        title=${s?.title || L("订阅", "Subscription")}
        subtitle=${s
            ? html`<${SubStatus} sub=${s} threshold=${threshold} /><a
                      href=${s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="muted"
                      style="overflow-wrap:anywhere"
                      >${s.url}</a
                  >`
            : null}
    >
        ${detail.error
            ? html`<${Notice} tone="error">${detail.error.message}<//>`
            : !s
              ? html`<${Spinner} />`
              : html`<${Tabs}
                        value=${tab}
                        onChange=${setTab}
                        tabs=${[
                            ["settings", L("设置", "Settings")],
                            ["recipients", L("接收会话", "Recipients")],
                            ...(app.info.features.articles ? [["articles", L("最近文章", "Recent posts")]] : []),
                            ["fetch", L("抓取", "Fetching")],
                            ...(app.info.features.diagnostics ? [["logs", L("日志", "Logs"), s.errors || null]] : []),
                        ]}
                    />
                    ${tab === "settings"
                        ? html`<${SubSettings}
                              sub=${s}
                              onChanged=${changed}
                              onDirty=${setDirty}
                              onDeleted=${() => (onChanged?.(), onClose())}
                          />`
                        : tab === "recipients"
                          ? html`<${Recipients}
                                sub=${s}
                                onChanged=${changed}
                                onMoved=${(nextId) => (onChanged?.(), nextId ? setParams({ sub: nextId }) : onClose())}
                            />`
                          : tab === "articles"
                            ? html`<${Articles} sub=${s} />`
                            : tab === "fetch"
                              ? html`<${Fetching} sub=${s} onChanged=${changed} />`
                              : html`<${FeedLogs} sub=${s} />`}`}
    <//>`;
}

async function loadSub(id) {
    try {
        return await api(`/subscriptions/${id}`);
    } catch (err) {
        if (err.status === 404) throw new Error(L("找不到这个订阅，可能已被取消。", "Subscription not found. It may have been removed."));
        throw err;
    }
}

function SubSettings({ sub, onChanged, onDirty, onDeleted }) {
    const chat = useAsync(
        () =>
            api("/targets" + qs({ q: sub.target, visibility: "all", include_departed: "true", size: 5 })).then((d) =>
                d.items.find((c) => c.id === sub.target),
            ),
        [sub.target],
    );
    const settings = useAsync(() => api("/settings"), []);
    const initial = { title: sub.custom_title || "", tags: hashtags(sub.tags), ...sub.options };
    const [draft, setDraft] = useState(initial);
    const [busy, setBusy] = useState("");
    const dirtyKeys = Object.keys(draft).filter((k) => draft[k] !== initial[k]);
    useEffect(() => onDirty(dirtyKeys.length > 0), [dirtyKeys.length]);
    useEffect(() => () => onDirty(false), []);
    async function save() {
        setBusy("save");
        try {
            const body = Object.fromEntries(dirtyKeys.map((k) => [k, k === "title" || k === "tags" ? draft[k].trim() || null : draft[k]]));
            const next = await api(`/subscriptions/${sub.id}`, { method: "PATCH", body });
            onDirty(false);
            onChanged(next);
            setDraft({ title: next.custom_title || "", tags: hashtags(next.tags), ...next.options });
            toast(L("已保存", "Saved"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function toggleState() {
        setBusy("state");
        try {
            onChanged(await api(`/subscriptions/${sub.id}`, { method: "PATCH", body: { state: sub.state ? 0 : 1 } }));
            toast(sub.state ? L("已暂停", "Paused") : L("已恢复", "Resumed"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function remove() {
        const ok = await confirm({
            title: L("取消这个订阅？", "Unsubscribe?"),
            body: L(
                `“${sub.target_title}”将不再收到“${sub.title}”的推送。相当于在机器人里执行 /unsub，无法撤销。`,
                `“${sub.target_title}” will stop receiving “${sub.title}”. Same as /unsub in the bot; can't be undone.`,
            ),
            ok: L("取消订阅", "Unsubscribe"),
            danger: true,
        });
        if (!ok) return;
        setBusy("delete");
        try {
            await api(`/subscriptions/${sub.id}`, { method: "DELETE" });
            toast(L("已取消订阅", "Unsubscribed"));
            onDirty(false);
            onDeleted();
        } catch (err) {
            toast(err.message, "error");
            setBusy("");
        }
    }
    const inherit = chat.data?.options;
    const minimal = settings.data?.options.minimal_interval || 1;
    const chatInterval = chat.data?.options.interval;
    return html`
        <div class="facts">
            <div>
                <small>${L("推送到", "Delivers to")}</small
                ><b><a href=${"#chats?chat=" + sub.target} style="text-decoration:none">${sub.target_title}</a></b>
            </div>
            <div><small>${L("实际检查间隔", "Effective interval")}</small><b>${minutes(sub.effective_interval)}</b></div>
            <div><small>${L("上次更新", "Last updated")}</small><b title=${dateTime(sub.updated_at)}>${ago(sub.updated_at)}</b></div>
            <div>
                <small>${L("连续抓取失败", "Consecutive failures")}</small
                ><b style=${sub.errors ? "color:var(--red)" : ""}>${sub.errors || 0}</b>
            </div>
        </div>

        <div class="form-grid">
            <${Field} label=${L("自定义标题", "Custom title")} hint=${L(`留空则使用订阅源标题。`, "Empty uses the feed's own title.")}>
                <${Input}
                    value=${draft.title}
                    placeholder=${sub.custom_title ? "" : sub.title}
                    onInput=${(v) => setDraft({ ...draft, title: v })}
                />
            <//>
            <${Field}
                label=${L("自定义 hashtag", "Custom hashtags")}
                hint=${L("空格分隔，推送时附在消息末尾。", "Space-separated, appended to each message.")}
            >
                <${Input} value=${draft.tags} placeholder="#news #tech" onInput=${(v) => setDraft({ ...draft, tags: v })} />
            <//>
            <div class="full">
                <${IntervalField}
                    value=${draft.interval}
                    minimal=${minimal}
                    inheritLabel=${chatInterval != null
                        ? L(`跟随会话默认（${minutes(chatInterval)}）`, `Chat default (${minutes(chatInterval)})`)
                        : L(
                              `跟随全局默认（${minutes(settings.data?.options.default_interval)}）`,
                              `Global default (${minutes(settings.data?.options.default_interval)})`,
                          )}
                    onChange=${(v) => setDraft({ ...draft, interval: v })}
                />
            </div>
        </div>
        <div class="form-section">
            <h4>${L("推送格式", "Message format")}</h4>
            <p>${L("“跟随会话默认”会使用接收会话的推送默认值。", "“Chat default” uses the receiving chat's defaults.")}</p>
            ${inherit
                ? html`<${OptionsForm} values=${draft} inherit=${inherit} onChange=${(next) => setDraft({ ...draft, ...next })} />`
                : html`<${Spinner} />`}
        </div>
        <div class="form-section">
            <h4>${L("订阅状态", "Subscription")}</h4>
            <div class="action-card" style="margin-top:12px">
                <${Icon} name=${sub.state ? "pause" : "play"} size=${18} />
                <div>
                    <b>${sub.state ? L("暂停推送", "Pause delivery") : L("恢复推送", "Resume delivery")}</b>
                    <p>
                        ${sub.state
                            ? L("暂停后不再检查更新，设置会保留。", "Stops checking for updates; settings are kept.")
                            : L("恢复后按检查间隔继续推送新文章。", "Resume checking and delivering new posts.")}
                    </p>
                </div>
                <${Button} size="sm" loading=${busy === "state"} onClick=${toggleState}
                    >${sub.state ? L("暂停", "Pause") : L("恢复", "Resume")}<//
                >
            </div>
            <div class="action-card danger">
                <${Icon} name="trash" size=${18} />
                <div>
                    <b>${L("取消订阅", "Unsubscribe")}</b>
                    <p>${L("从这个会话中删除这个订阅。", "Remove this subscription from the chat.")}</p>
                </div>
                <${Button} size="sm" kind="danger" loading=${busy === "delete"} onClick=${remove}>${L("取消订阅", "Unsubscribe")}<//>
            </div>
        </div>
        ${dirtyKeys.length
            ? html`<div class="drawer-foot" style="position:sticky;bottom:-24px;margin:20px -24px -24px">
                  <span class="dirty"
                      ><${Icon} name="edit" />${L(`${dirtyKeys.length} 项修改未保存`, `${dirtyKeys.length} unsaved changes`)}</span
                  >
                  <${Button} onClick=${() => setDraft(initial)}>${L("还原", "Reset")}<//>
                  <${Button} kind="primary" loading=${busy === "save"} onClick=${save}>${L("保存", "Save")}<//>
              </div>`
            : null}
    `;
}

function Recipients({ sub, onChanged, onMoved }) {
    const { data, error, reload } = useAsync(() => api(`/feeds/${sub.feed_id}/recipients`), [sub.feed_id]);
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);
    const current = data?.items.map((r) => r.target) || [];
    async function save() {
        const removed = current.filter((t) => !editing.includes(t));
        const added = editing.filter((t) => !current.includes(t));
        if (!removed.length && !added.length) return setEditing(null);
        if (removed.length) {
            const names = data.items
                .filter((r) => removed.includes(r.target))
                .map((r) => r.target_title)
                .join("、");
            const ok = await confirm({
                title: L("移除接收会话？", "Remove recipients?"),
                body: L(
                    `${names} 将不再收到这个订阅源的推送，它们在这个订阅上的自定义设置会被删除。`,
                    `${names} will stop receiving this feed; their custom settings for it will be deleted.`,
                ),
                ok: L("保存", "Save"),
                danger: true,
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            const result = await api(`/feeds/${sub.feed_id}/recipients`, { method: "PUT", body: { mode: "replace", targets: editing } });
            toast(L("接收会话已更新", "Recipients updated"));
            setEditing(null);
            if (removed.includes(sub.target)) {
                const next = result.items[0];
                onMoved(next?.id);
            } else {
                reload(true);
                onChanged();
            }
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy(false);
        }
    }
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    return html`
        <p class="muted" style="margin-bottom:14px">
            ${L(
                "这个 RSS 源推送到下面这些会话。只抓取一次，再分别推送；每个会话可以有自己的格式设置。在这里增减会话，就不用在机器人里先 /unsub 再 /sub。",
                "This feed is delivered to the chats below — fetched once, then sent to each, with per-chat formatting. Add or remove chats here instead of /unsub + /sub in the bot.",
            )}
        </p>
        ${editing
            ? html`<div class="stack" style="gap:12px">
                  <${ChatPicker} value=${editing} onChange=${setEditing} />
                  <div class="row" style="justify-content:flex-end">
                      <${Button} onClick=${() => setEditing(null)}>${L("取消", "Cancel")}<//>
                      <${Button} kind="primary" loading=${busy} disabled=${!editing.length} onClick=${save}
                          >${L("保存接收会话", "Save recipients")}<//
                      >
                  </div>
                  ${!editing.length
                      ? html`<p class="field-hint">
                            ${L(
                                "至少保留一个接收会话。要彻底取消，请在“设置”里取消订阅。",
                                "Keep at least one. To remove entirely, unsubscribe in Settings.",
                            )}
                        </p>`
                      : null}
              </div>`
            : html`<div class="panel">
                      ${data.items.map(
                          (r) =>
                              html`<div class="list-row">
                                  <${ChatAvatar}
                                      chat=${{ id: r.target, title: r.target_title, kind: Number(r.target) > 0 ? "private" : "unknown" }}
                                  />
                                  <span class="grow"
                                      ><span class="title"
                                          >${r.target_title}${r.id === sub.id
                                              ? html` <span class="muted" style="font-weight:400">· ${L("当前", "current")}</span>`
                                              : null}</span
                                      ><span class="meta mono">${r.target}</span></span
                                  >
                                  ${r.state ? null : html`<${Badge}>${L("已暂停", "Paused")}<//>`}
                                  ${r.id !== sub.id
                                      ? html`<${Button} size="sm" kind="ghost" onClick=${() => setParams({ sub: r.id, tab: "" })}
                                            >${L("打开", "Open")}<//
                                        >`
                                      : null}
                              </div>`,
                      )}
                  </div>
                  <div class="row" style="margin-top:12px">
                      <${Button} icon="edit" onClick=${() => setEditing(current)}>${L("编辑接收会话", "Edit recipients")}<//>
                  </div>`}
    `;
}

const DELIVERY = {
    sent: ["green", () => L("已推送", "Delivered")],
    queued: ["blue", () => L("等待推送", "Queued")],
    failed: ["red", () => L("推送失败", "Failed")],
    unconfirmed: ["amber", () => L("结果未确认", "Unconfirmed")],
    stopped: ["neutral", () => L("已停止", "Stopped")],
    partial: ["amber", () => L("可能部分送达", "Possibly partial")],
    not_recorded: ["neutral", () => L("无推送记录", "No record")],
};

function Articles({ sub }) {
    const { data, error, reload, loading } = useAsync(() => api(`/subscriptions/${sub.id}/articles`), [sub.id]);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    return html`
        <div class="row" style="margin-bottom:14px">
            <p class="muted grow" style="flex:1">
                ${L(
                    `这个源最近抓到的 ${data.items.length} 篇文章，以及推送到“${data.target.title}”的结果。`,
                    `Latest ${data.items.length} posts from this feed and their delivery to “${data.target.title}”.`,
                )}
            </p>
            <${Button} size="sm" icon="refresh" loading=${loading} onClick=${() => reload()}>${L("刷新", "Refresh")}<//>
        </div>
        ${data.degraded
            ? html`<${Notice} tone="warn"
                  >${L("文章记录暂时写入失败，部分状态可能缺失。", "Article history had write errors; some states may be missing.")}<//
              >`
            : null}
        ${!data.items.length
            ? html`<${Empty} icon="file" title=${L("还没有记录到文章", "No posts recorded yet")}>
                  ${L(
                      `文章从 ${dateTime(data.started_at)} 启用记录后开始积累，下次成功抓取后就会出现。`,
                      `Recording started ${dateTime(data.started_at)}; posts appear after the next successful fetch.`,
                  )}
              <//>`
            : data.items.map((a) => {
                  const [tone, label] = DELIVERY[a.status] || DELIVERY.not_recorded;
                  return html`<article class="article">
                      <div class="article-head">
                          <h4>
                              ${a.link
                                  ? html`<a href=${a.link} target="_blank" rel="noopener noreferrer"
                                        >${a.title || L("（无标题）", "(untitled)")}</a
                                    >`
                                  : a.title || L("（无标题）", "(untitled)")}
                          </h4>
                          <${Badge} tone=${tone} dot>${label()}<//>
                      </div>
                      ${a.summary ? html`<p>${a.summary}</p>` : null}
                      <div class="meta">
                          ${a.published_at
                              ? L(`发布于 ${dateTime(a.published_at)}`, `Published ${dateTime(a.published_at)}`) + " · "
                              : ""}${L(`抓取于 ${dateTime(a.fetched_at)}`, `Fetched ${dateTime(a.fetched_at)}`)}
                          ${a.last_sent_at ? " · " + L(`推送于 ${dateTime(a.last_sent_at)}`, `Delivered ${dateTime(a.last_sent_at)}`) : ""}
                          ${a.source === "test" ? " · " + L("测试推送", "test delivery") : ""}
                          ${a.detail && a.status !== "sent" ? html`<div style="color:var(--red)">${a.detail}</div>` : null}
                      </div>
                  </article>`;
              })}
    `;
}

function Fetching({ sub, onChanged }) {
    const info = useAsync(
        () => (app.info.features.manual_fetch ? api(`/subscriptions/${sub.id}/fetch-now`) : Promise.resolve(null)),
        [sub.id, sub.state],
    );
    const ua = useAsync(() => api(`/feeds/${sub.feed_id}/fetch-options`), [sub.feed_id]);
    const [agent, setAgent] = useState(null);
    const [proxy, setProxy] = useState(emptyProxy());
    const [proxyResult, setProxyResult] = useState(null);
    const [job, setJob] = useState(null);
    const [busy, setBusy] = useState("");
    const timer = useRef();
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (ua.data && agent === null) {
            setAgent(ua.data.user_agent || "");
            setProxy({ mode: ua.data.proxy.mode, url: "" }); // start from what is saved
        }
    }, [ua.data]);
    async function poll(id) {
        try {
            const next = await api(`/fetch-jobs/${id}`);
            setJob(next);
            if (next.status === "queued" || next.status === "running") timer.current = setTimeout(() => poll(id), 1200);
            else onChanged();
        } catch (err) {
            setJob((j) => ({ ...j, status: "failed", error: err.message }));
        }
    }
    async function run(mode) {
        const d = info.data;
        const ok = await confirm({
            title:
                mode === "updates"
                    ? L("立即检查更新？", "Check for updates now?")
                    : L("测试推送最新一篇？", "Send the latest post as a test?"),
            body:
                mode === "updates"
                    ? L(
                          `立刻抓取这个源。有新文章会推送给全部 ${d.affected_recipients} 个接收会话，和定时检查完全一样。`,
                          `Fetch now. New posts are delivered to all ${d.affected_recipients} recipients, exactly like a scheduled check.`,
                      )
                    : L(
                          `把这个源当前最新的一篇重新发送到“${sub.target_title}”，即使它已经收到过。只发给这一个会话，不影响定时检查。`,
                          `Resend the newest post to “${sub.target_title}”, even if already delivered. Only this chat; scheduled checks are unaffected.`,
                      ),
            ok: mode === "updates" ? L("立即检查", "Check now") : L("发送测试", "Send test"),
        });
        if (!ok) return;
        setBusy(mode);
        try {
            const created = await api(`/subscriptions/${sub.id}/fetch-now`, { method: "POST", body: { mode, confirm: true } });
            setJob(created);
            poll(created.id);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    const savedProxy = ua.data?.proxy;
    async function saveProxy() {
        setBusy("proxy");
        try {
            const next = await api(`/feeds/${sub.feed_id}/fetch-options`, {
                method: "PATCH",
                body: { proxy: proxyValue(proxy, savedProxy) },
            });
            ua.setData(next);
            setProxy({ mode: next.proxy.mode, url: "" });
            setProxyResult(null);
            toast(L("已保存，下次抓取生效", "Saved; applies from the next fetch"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function testProxy() {
        setBusy("proxy-test");
        setProxyResult(null);
        try {
            const value = proxyValue(proxy, savedProxy);
            const body = value === undefined || value === null ? {} : { proxy: value };
            setProxyResult(await api(`/feeds/${sub.feed_id}/proxy-test`, { method: "POST", body }));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    async function saveAgent() {
        setBusy("ua");
        try {
            const next = await api(`/feeds/${sub.feed_id}/fetch-options`, { method: "PATCH", body: { user_agent: agent.trim() || null } });
            ua.setData(next);
            toast(L("已保存，下次抓取生效", "Saved; applies from the next fetch"));
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setBusy("");
        }
    }
    const d = info.data;
    const running = job && (job.status === "queued" || job.status === "running");
    const outcome = {
        updated: () =>
            L(
                `发现 ${job.result.new_entries} 篇新文章，已交给推送队列。`,
                `${job.result.new_entries} new posts found and queued for delivery.`,
            ),
        unchanged: () => L("没有新文章。", "No new posts."),
        not_modified: () => L("订阅源没有变化。", "The feed hasn't changed."),
        empty: () => L("订阅源目前是空的。", "The feed is currently empty."),
        simulated: () => L("演示模式：仅模拟，没有真的抓取或发送。", "Demo mode: simulated, nothing fetched or sent."),
        test_delivered: () => L("测试文章已确认送达。", "Test post delivered."),
    };
    return html`
        <div class="section-title">
            <div>
                <h3>${L("立即抓取", "Fetch now")}</h3>
                <p>${L("不用等下一次定时检查，也可以用来测试推送效果。", "Don't wait for the schedule — also handy for testing.")}</p>
            </div>
        </div>
        ${!app.info.features.manual_fetch
            ? null
            : !d
              ? html`<${Spinner} />`
              : html`
                    ${!d.available ? html`<${Notice} tone="warn">${d.reason}<//>` : null}
                    <div class="action-card" style=${!d.available ? "margin-top:12px" : ""}>
                        <${Icon} name="refresh" size=${18} />
                        <div>
                            <b>${L("检查更新并推送", "Check and deliver")}</b>
                            <p>
                                ${L(
                                    `有新文章就推送给全部 ${d.affected_recipients} 个接收会话。`,
                                    `Deliver any new posts to all ${d.affected_recipients} recipients.`,
                                )}
                            </p>
                        </div>
                        <${Button}
                            size="sm"
                            kind="primary"
                            disabled=${!d.available || running}
                            loading=${busy === "updates"}
                            onClick=${() => run("updates")}
                            >${L("立即检查", "Check now")}<//
                        >
                    </div>
                    ${d.modes.includes("test_latest")
                        ? html`<div class="action-card">
                              <${Icon} name="send" size=${18} />
                              <div>
                                  <b>${L("测试推送最新一篇", "Send latest as test")}</b>
                                  <p>
                                      ${L(
                                          `只发给“${sub.target_title}”，看看消息格式效果。`,
                                          `Only to “${sub.target_title}”, to preview formatting.`,
                                      )}
                                  </p>
                              </div>
                              <${Button}
                                  size="sm"
                                  disabled=${!d.available || running}
                                  loading=${busy === "test_latest"}
                                  onClick=${() => run("test_latest")}
                                  >${L("发送测试", "Send test")}<//
                              >
                          </div>`
                        : null}
                    ${job
                        ? html`<div style="margin-top:12px">
                              ${running
                                  ? html`<${Notice}
                                        ><span class="row"
                                            ><span class="spinner"></span>${job.status === "queued"
                                                ? L("排队中…", "Queued…")
                                                : L("正在抓取…", "Fetching…")}</span
                                        ><//
                                    >`
                                  : job.status === "completed"
                                    ? html`<${Notice} title=${L("完成", "Done")}
                                          >${(outcome[job.result?.outcome] || (() => L("已完成。", "Completed.")))()}<//
                                      >`
                                    : html`<${Notice} tone="error" title=${L("没有完成", "Didn't complete")}>${job.error}<//>`}
                          </div>`
                        : null}
                `}

        <div class="section-title" style="margin-top:28px">
            <div>
                <h3>${L("代理", "Proxy")}</h3>
                <p>
                    ${L(
                        "只对这个 RSS 源生效。服务器连不上这个网站（例如海外服务器访问只部署在国内的网站）时，可以让它单独走一个代理，其他订阅源不受影响。",
                        "Applies to this feed only. When the server can't reach the site (say, a server abroad and a site hosted only in China), route just this feed through a proxy.",
                    )}
                </p>
            </div>
        </div>
        ${!ua.data
            ? html`<${Spinner} />`
            : html`<div class="stack" style="gap:12px">
                  <div class="muted" style="font-size:13px">
                      ${L("当前：", "Currently: ")}<b style="color:var(--text)">${savedText(savedProxy)}</b>
                  </div>
                  <${ProxyField} draft=${proxy} onChange=${(next) => (setProxy(next), setProxyResult(null))} saved=${savedProxy} />
                  <div class="row" style="justify-content:flex-end">
                      <${Button}
                          size="sm"
                          icon="zap"
                          disabled=${!app.info.features.manual_fetch || !proxyReady(proxy, savedProxy)}
                          loading=${busy === "proxy-test"}
                          onClick=${testProxy}
                          >${L("测试这个设置", "Test this setting")}<//
                      >
                      <${Button}
                          size="sm"
                          kind="primary"
                          disabled=${!proxyChanged(proxy, savedProxy) || !proxyReady(proxy, savedProxy)}
                          loading=${busy === "proxy"}
                          onClick=${saveProxy}
                          >${L("保存", "Save")}<//
                      >
                  </div>
                  <${ProxyTestResult} result=${proxyResult} />
              </div>`}

        <div class="section-title" style="margin-top:28px">
            <div>
                <h3>User-Agent</h3>
                <p>
                    ${L(
                        "只对这个 RSS 源生效。有些网站会拦截默认的 UA，可以在这里换一个。",
                        "Applies to this feed only. Some sites block the default UA; override it here.",
                    )}
                </p>
            </div>
        </div>
        ${!ua.data
            ? html`<${Spinner} />`
            : html`<div class="stack" style="gap:10px">
                  <${Input}
                      class="mono"
                      value=${agent ?? ""}
                      placeholder=${L("留空则使用全局设置", "Empty = use the global setting")}
                      onInput=${setAgent}
                  />
                  <div class="row" style="justify-content:space-between">
                      <span class="muted" style="font-size:12.5px"
                          >${ua.data.inherits_global
                              ? L("当前：使用全局设置", "Currently: global setting")
                              : L("当前：使用自定义 UA", "Currently: custom UA")}${app.info.features.recipients
                              ? L(" · 同一个源的所有接收会话共用", " · shared by all recipients of this feed")
                              : ""}</span
                      >
                      <${Button}
                          size="sm"
                          kind="primary"
                          disabled=${(agent ?? "") === (ua.data.user_agent || "")}
                          loading=${busy === "ua"}
                          onClick=${saveAgent}
                          >${L("保存", "Save")}<//
                      >
                  </div>
              </div>`}
    `;
}

function FeedLogs({ sub }) {
    const [page, setPage] = useState(1);
    const { data, error } = useAsync(() => api(`/feeds/${sub.feed_id}/diagnostics` + qs({ page, size: 20 })), [sub.feed_id, page]);
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    return html`
        <p class="muted" style="margin-bottom:12px">
            ${L("这个 RSS 源每次抓取和推送的结果。", "Every fetch and delivery result for this feed.")}
            <a class="link-btn" href=${"#logs?feed=" + sub.feed_id}>${L("在运行日志中查看", "Open in Logs")}</a>
        </p>
        ${sub.errors
            ? html`<${Notice} tone="warn" title=${L(`已连续失败 ${sub.errors} 次`, `${sub.errors} consecutive failures`)}>
                  ${L(
                      "日志从启用记录后开始保存，更早的失败原因无法补回。",
                      "Logs start when recording was enabled; earlier failure reasons can't be recovered.",
                  )}
              <//>`
            : null}
        ${!data.items.length
            ? html`<${Empty} icon="logs" title=${L("还没有日志", "No logs yet")}
                  >${app.info.snapshot
                      ? L("离线副本不运行抓取，所以没有日志。", "The offline copy doesn't fetch, so there are no logs.")
                      : L(
                            "还没有失败或更新的记录。没有新文章的正常检查不会逐条记录。",
                            "No failures or updates yet. Routine checks with nothing new aren't logged.",
                        )}<//
              >`
            : html`<div class="timeline" style="margin-top:8px">${data.items.map((e) => html`<${EventRow} event=${e} hideFeed />`)}</div>
                  <${Pager} page=${page} size=${data.size} total=${data.total} onPage=${setPage} />`}
    `;
}
