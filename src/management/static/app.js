const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const n = (v) => (v === null ? "—" : new Intl.NumberFormat("zh-CN").format(v || 0));
const paths = {
    dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    chats: "M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z M7 9h10 M7 13h6",
    rss: "M5 12a7 7 0 0 1 7 7 M5 5a14 14 0 0 1 14 14 M5 19h.01",
    settings:
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
    plus: "M12 5v14 M5 12h14",
    search: "M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
    chevron: "m9 5 7 7-7 7",
    check: "m5 12 4 4L19 6",
    close: "m6 6 12 12 M6 18 18 6",
    arrow: "M5 12h14 m-6-6 6 6-6 6",
    down: "M12 3v12 m-5-5 5 5 5-5 M5 17v4h14v-4",
    refresh: "M20 7V3l-3 3a8 8 0 1 0 3 9 M20 7h-5",
    clock: "M12 8v5l3 2 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
    alert: "M12 3 2 21h20L12 3Z M12 9v5 M12 17v.01",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M4 21v-2a8 8 0 0 1 16 0v2",
    channel: "M3 10v4h4l11 5V5L7 10H3Z M7 14l2 7",
    group: "M16 21v-2a6 6 0 0 0-12 0v2 M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M19 4a4 4 0 0 1 0 7 M20 15a6 6 0 0 1 2 4v2",
    exit: "M9 4H4v16h5 M10 12h11 m-4-4 4 4-4 4",
    menu: "M4 6h16 M4 12h16 M4 18h16",
    edit: "m15 4 5 5 M4 20l5-1L21 7l-5-5L4 14v6Z",
    key: "M15 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z M10 13l-8 8 M4 19l-2-2 M7 16l-2-2",
    send: "m22 2-7 20-4-9-9-4L22 2Z M22 2 11 13",
    pause: "M8 5v14 M16 5v14",
    play: "m6 3 15 9-15 9V3Z",
    trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
};
const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.rss}"/></svg>`;
const labels = { dashboard: "仪表盘", targets: "会话与频道", subscriptions: "全部订阅", settings: "设置" };
const kindName = { private: "私聊", channel: "频道", group: "群组", unknown: "群组/频道" };
const kindIcon = { unknown: "chats", private: "user", channel: "channel", group: "group" };
const S = {
    route: "dashboard",
    session: null,
    demo: false,
    snapshot: null,
    period: 14,
    settings: "general",
    page: 1,
    q: "",
    kind: "",
    target: "",
    status: "",
    attention: false,
    selected: new Set(),
    items: [],
    serial: 0,
};
let modalState = {},
    toastTimer,
    searchTimer;

async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
        credentials: "same-origin",
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
        const e = new Error(data.error || "请求未完成");
        e.status = response.status;
        throw e;
    }
    return data;
}
const toast = (text) => {
    clearTimeout(toastTimer);
    $("#toast").textContent = text;
    $("#toast").classList.add("show");
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
};
const pill = (text, cls = "") => `<span class="pill ${cls}">${esc(text)}</span>`;
const dateText = (v) =>
    v
        ? new Intl.DateTimeFormat("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
          }).format(new Date(v))
        : "尚未同步";
const feedMark = (title) => `<div class="feed-mark">${esc((title || "R")[0].toUpperCase())}</div>`;
const empty = (title, description) =>
    `<div class="empty">${icon("rss", 26)}<strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;

function shell() {
    $("#app").innerHTML =
        `<div class="layout"><aside class="sidebar" aria-label="主导航"><a class="brand" href="#dashboard"><img src="/assets/mark.svg" alt=""><div><strong>RSStT</strong><small>YOUR READING RELAY</small></div></a><div><div class="nav-label">工作空间</div><nav class="nav">${Object.entries(
            labels,
        )
            .map(
                ([key, label]) =>
                    `<a href="#${key}" data-nav="${key}">${icon({ targets: "chats", subscriptions: "rss" }[key] || key)}${label}</a>`,
            )
            .join(
                "",
            )}</nav></div><div class="sidebar-bottom"><div class="instance"><strong><span class="dot"></span>${S.demo ? "离线预览实例" : "RSStT 管理实例"}</strong><small>${S.snapshot ? "真实数据副本 · 修改仅在本地" : S.demo ? "示例数据 · 不发送 Telegram 消息" : "同一个机器人，更清晰的掌控"}</small></div><div class="profile"><div class="avatar">J</div><div><span class="small">管理员</span><p class="muted micro">${S.demo ? "本地预览" : "管理台会话"}</p></div><button class="quiet" data-action="logout" title="退出登录" aria-label="退出登录">${icon("exit", 16)}</button></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><button class="quiet mobile-menu" data-action="menu" aria-label="展开导航">${icon("menu")}</button><span>工作空间</span>${icon("chevron", 12)}<strong id="breadcrumb"></strong></div><div class="date">${new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date())}</div></header>${S.demo ? '<div class="demo-banner">' + icon("alert", 13) + (S.snapshot ? "真实数据离线预览 · 快照 " + esc(dateText(S.snapshot.captured_at)) + " · 修改仅保存在本地，不会影响线上机器人" : "离线预览 · 所有数据和操作均为本地示例，不会连接 Telegram") + "</div>" : ""}<main id="main" tabindex="-1"></main></div></div>`;
}

function header(title, description, button = "") {
    return `<div class="page-title"><div><div class="eyebrow">${{ dashboard: "OVERVIEW", targets: "DESTINATIONS", subscriptions: "SUBSCRIPTIONS", settings: "PREFERENCES" }[S.route]}</div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
}
const targetKindName = (item) =>
    S.snapshot && item.kind === "group" && ![50, 51].includes(item.state) ? "群组/频道" : kindName[item.kind];
const newButton = () => `<button class="primary" data-action="new-sub">${icon("plus", 16)}添加订阅</button>`;
const credit = () =>
    `<footer class="credit"><span>RSStT Web · 让信息有序抵达。</span><a href="https://github.com/Rongronggg9/RSS-to-Telegram-Bot" target="_blank" rel="noreferrer">基于 RSS-to-Telegram-Bot · AGPL-3.0</a></footer>`;

async function render(quiet = false) {
    if (!S.session) return;
    const serial = ++S.serial;
    const focus = document.activeElement,
        focusId = focus?.id,
        cursor = focus?.selectionStart;
    $("#breadcrumb").textContent = labels[S.route];
    $$("[data-nav]").forEach((e) => {
        e.classList.toggle("active", e.dataset.nav === S.route);
        if (e.dataset.nav === S.route) e.setAttribute("aria-current", "page");
        else e.removeAttribute("aria-current");
    });
    if (!quiet) $("#main").innerHTML = `<div class="loading" role="status">正在加载${labels[S.route]}…</div>`;
    try {
        let html;
        if (S.route === "dashboard") html = dashboard(await api("/dashboard"));
        if (S.route === "targets") {
            const data = await api("/targets?" + new URLSearchParams({ page: S.page, q: S.q, kind: S.kind }));
            if (serial !== S.serial) return;
            S.items = data.items;
            html = targets(data);
        }
        if (S.route === "subscriptions") {
            const data = await api(
                "/subscriptions?" +
                    new URLSearchParams({
                        page: S.page,
                        q: S.q,
                        target: S.target,
                        state: S.status,
                        attention: S.attention ? "1" : "0",
                    }),
            );
            if (serial !== S.serial) return;
            S.items = data.items;
            html = subscriptions(data);
        }
        if (S.route === "settings") {
            const [data, tokens] = await Promise.all([
                api("/settings"),
                S.settings === "tokens" ? api("/tokens") : Promise.resolve(null),
            ]);
            html = settings(data, tokens, S.settings === "runtime" ? await api("/runtime-config") : null);
        }
        if (serial !== S.serial) return;
        $("#main").innerHTML = html + credit();
        if (quiet && focusId) {
            const next = document.getElementById(focusId);
            if (next) {
                next.focus();
                if (cursor !== null && next.setSelectionRange)
                    try {
                        next.setSelectionRange(cursor, cursor);
                    } catch {}
            }
        }
    } catch (e) {
        if (serial !== S.serial) return;
        if (e.status === 401) {
            S.session = null;
            login();
            return;
        }
        $("#main").innerHTML =
            `<div class="page-error"><p>${esc(e.message)}</p><button data-action="retry">${icon("refresh", 15)}重新加载</button></div>`;
    }
}

function dashboard(d) {
    const c = d.counts,
        t = d.statistics.totals;
    const cards = [
        [
            "rss",
            "订阅关系",
            c.subscriptions,
            `<em>${n(c.active)}</em> 个${S.snapshot ? "已启用" : "正在更新"} · ${n(c.feeds)} 个独立来源`,
        ],
        [
            "chats",
            "已知会话",
            c.users + c.groups + c.channels,
            S.snapshot
                ? `${n(c.channels + c.groups)} 个群组/频道 · ${n(c.users)} 个私聊`
                : `${n(c.channels)} 个频道 · ${n(c.groups)} 个群组 · ${n(c.users)} 个私聊`,
        ],
        [
            "send",
            "累计推送",
            t.delivered,
            S.snapshot ? "原版没有累计统计" : `累计抓取 <em>${n(t.fetched)}</em> 篇新内容`,
        ],
        ["alert", "需要检查", c.attention, `连续失败 ${d.threshold} 次后提醒`],
    ];
    return (
        header("一切动态，尽在眼前。", "看看订阅的近况，让值得阅读的内容持续抵达。", newButton()) +
        (!d.bot.connected && !S.demo
            ? `<div class="notice warning">机器人当前未连接 Telegram，订阅推送暂不可用。</div><br>`
            : "") +
        (d.metrics_error ? `<div class="notice warning">${esc(d.metrics_error)}</div><br>` : "") +
        `<section class="stats" aria-label="运行概况">${cards.map(([i, label, value, foot], idx) => `<article class="stat ${idx === 3 && value ? "warning" : ""}"><div class="stat-head"><span>${label}</span>${icon(i, 17)}</div><div class="stat-value">${n(value)}</div><div class="stat-foot">${foot}</div></article>`).join("")}</section><section class="panel"><div class="panel-head"><div><h2>内容流动</h2><p>每天发现的新内容，以及成功送达的篇次</p></div><div class="segmented" aria-label="趋势时间范围">${[7, 14, 30].map((v) => `<button data-period="${v}" class="${S.period === v ? "active" : ""}" aria-pressed="${S.period === v}">${v} 天</button>`).join("")}</div></div><div class="chart-wrap"><div class="chart-meta"><span><i class="legend"></i>成功推送</span><span><i class="legend orange"></i>新内容</span><span>UTC</span></div>${S.snapshot ? empty("没有历史统计", "原版未记录累计推送和每日趋势，无法从订阅快照还原。") : chart(d.statistics.daily)}</div><div class="chart-footer"><span>${S.snapshot ? "订阅与失败次数来自快照，不会自动更新" : (S.demo ? "示例统计" : "开始记录于 " + dateText(d.started_at)) + " · 累计值持续保留，趋势保留 90 天"}</span><span>${S.demo ? "未连接 Telegram" : d.bot.connected ? "机器人在线" : "机器人离线"} · @${esc(d.bot.username || "未设置")}</span></div></section><div class="dashboard-lower"><section class="panel"><div class="panel-head"><h2>需要检查 <span class="muted small">${n(c.attention)}</span></h2><button class="text-link" data-action="attention">查看全部 ${icon("arrow", 13)}</button></div>${d.attention.length ? d.attention.map((item) => `<div class="attention-row">${feedMark(item.title)}<div class="feed-info"><strong>${esc(item.title)}</strong><small>${esc(item.target_title)}</small></div>${pill(`连续失败 ${item.errors} 次`, "warn")}</div>`).join("") : empty("目前没有需要检查的订阅", "偶发失败会自动重试，你可以安心阅读。")}</section><section class="panel"><div class="panel-head"><h2>最近操作</h2><span class="muted small">管理台记录</span></div><div class="activity">${
            d.activity.length
                ? d.activity
                      .slice(0, 4)
                      .map(
                          (a) =>
                              `<div class="activity-row"><div class="activity-icon">${icon("check", 14)}</div><div><p>${esc(a.action)}</p><small>${esc(a.detail)}</small></div><time>${dateText(a.at)}</time></div>`,
                      )
                      .join("")
                : empty("还没有操作记录", "你在管理台中的修改会出现在这里。")
        }</div></section></div>`
    );
}

function chart(rows) {
    const today = new Date(),
        data = [];
    for (let i = S.period - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - i);
        const day = date.toISOString().slice(0, 10);
        data.push(rows.find((r) => r.day === day) || { day, fetched: 0, delivered: 0 });
    }
    const max = Math.max(10, ...data.flatMap((r) => [r.fetched, r.delivered])),
        ceiling = Math.ceil(max / 50) * 50;
    const x = (i) => 42 + (i * 854) / (data.length - 1),
        y = (v) => 139 - (v / ceiling) * 118;
    const line = (key) => data.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(" ");
    const delivered = data.reduce((a, r) => a + r.delivered, 0),
        fetched = data.reduce((a, r) => a + r.fetched, 0);
    return `<svg class="chart" viewBox="0 0 920 172" preserveAspectRatio="none" role="img" aria-label="最近 ${S.period} 天抓取 ${fetched} 篇，推送 ${delivered} 篇次"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#8fbca0" stop-opacity=".18"/><stop offset="1" stop-color="#8fbca0" stop-opacity="0"/></linearGradient></defs>${[0, 0.5, 1].map((f) => `<line x1="42" x2="900" y1="${y(ceiling * f)}" y2="${y(ceiling * f)}"/><text x="30" y="${y(ceiling * f) + 4}" text-anchor="end">${n(ceiling * f)}</text>`).join("")}<path d="${line("delivered")} L896 139 L42 139Z" fill="url(#chart-fill)"/><path class="delivered" d="${line("delivered")}" fill="none" stroke="#37795b" stroke-width="2.2" vector-effect="non-scaling-stroke"/><path d="${line("fetched")}" fill="none" stroke="#c59857" stroke-width="1.8" vector-effect="non-scaling-stroke"/>${data.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.delivered)}" r="7" fill="transparent"><title>${r.day}：抓取 ${r.fetched} 篇 · 推送 ${r.delivered} 篇次</title></circle>${i % Math.ceil(data.length / 7) === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="164" text-anchor="middle">${r.day.slice(5).replace("-", "/")}</text>` : ""}`).join("")}</svg>`;
}

function searchBox(placeholder = "搜索名称或网址") {
    return `<div class="search">${icon("search", 16)}<input id="page-search" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(S.q)}" autocomplete="off"></div>`;
}
const select = (id, entries, value) =>
    `<select id="${id}" aria-label="${id === "kind-filter" ? "会话类型" : "订阅状态"}">${entries.map(([key, label]) => `<option value="${key}" ${String(value) === String(key) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
function pager(d) {
    return `<div class="pager"><span>共 ${n(d.total)} 条 · 第 ${d.page} / ${Math.max(1, Math.ceil(d.total / d.size))} 页</span><div class="inline"><button data-page="${d.page - 1}" ${d.page <= 1 ? "disabled" : ""}>上一页</button><button data-page="${d.page + 1}" ${d.page * d.size >= d.total ? "disabled" : ""}>下一页</button></div></div>`;
}

function targets(d) {
    return (
        header(
            "会话与频道",
            "管理机器人已知的接收目的地，以及各自的订阅和推送偏好。",
            `<button class="primary" data-action="register">${icon("plus", 16)}登记会话</button>`,
        ) +
        `<section class="panel"><div class="toolbar">${searchBox("搜索名称、用户名或 ID")}${select(
            "kind-filter",
            [
                ["", "全部类型"],
                ["channel", "频道"],
                ["group", S.snapshot ? "群组/待分类" : "群组"],
                ["private", "私聊"],
            ],
            S.kind,
        )}<span class="count">${n(d.total)} 个目的地</span></div>${d.items.length ? `<div class="table-wrap"><table><thead><tr><th>会话</th><th>类型</th><th>订阅数</th><th>需要检查</th><th>访问状态</th><th></th></tr></thead><tbody>${d.items.map((item) => `<tr><td><div class="table-feed"><div class="feed-mark">${icon(kindIcon[item.kind], 17)}</div><div class="feed-info"><strong>${esc(item.title)}</strong><small>${item.username ? "@" + esc(item.username) + " · " : ""}${esc(item.id)}</small></div></div></td><td>${targetKindName(item)}</td><td class="mono">${n(item.subscriptions)}</td><td>${item.attention ? pill(item.attention, "warn") : '<span class="muted">—</span>'}</td><td>${pill(item.state === -1 ? "已封禁" : { available: "可用", known: "已识别", left: "已退出", unknown: "待同步", snapshot: "离线快照" }[item.membership] || "待同步", item.membership === "available" && item.state !== -1 ? "" : "gray")}</td><td><div class="table-actions"><button data-target-subs="${item.id}">查看订阅</button><button data-target-edit="${item.id}" aria-label="管理 ${esc(item.title)}">${icon("settings", 15)}</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("还没有匹配的会话", "机器人与用户互动后会留下记录；也可以登记已知的会话 ID。")}${pager(d)}</section><p class="muted small page-note">${S.snapshot ? "会话名称来自 Telegram 本地缓存，可能已过时；缺失名称显示 ID；未明确区分类型的显示为“群组/频道”，当前权限未联网验证。" : "会话列表来自 RSStT 记录；名称和权限在手动同步或添加订阅时更新。机器人需先在 Telegram 中加入频道或群组。"}</p>`
    );
}

function subscriptions(d) {
    return (
        header(
            S.attention ? "需要检查的订阅" : "全部订阅",
            S.target
                ? `当前目的地：${esc(d.items[0]?.target_title || S.target)}`
                : "在一张列表里查看、筛选和调整所有订阅。",
            newButton(),
        ) +
        `<section class="panel"><div class="toolbar">${searchBox()}${select(
            "status-filter",
            [
                ["", "全部状态"],
                ["1", S.snapshot ? "已启用" : "更新中"],
                ["0", "已暂停"],
            ],
            S.status,
        )}<button data-action="toggle-attention" class="${S.attention ? "primary" : ""} small">${icon("alert", 14)}需要检查</button>${S.target ? '<button class="quiet small" data-action="clear-target">清除会话筛选 ×</button>' : ""}<span class="count">${n(d.total)} 条订阅</span></div>${S.selected.size ? `<div class="bulkbar"><span>已选择 ${S.selected.size} 条</span><button data-batch="pause">暂停</button><button data-batch="resume">恢复</button><button class="danger" data-batch="delete">取消订阅</button><button class="quiet" data-action="clear-selection">清空选择</button></div>` : ""}${d.items.length ? `<div class="table-wrap"><table><thead><tr><th class="selection"><input type="checkbox" id="select-page" aria-label="全选本页" ${d.items.every((i) => S.selected.has(i.id)) ? "checked" : ""}></th><th>订阅内容</th><th>目的地</th><th>状态</th><th>间隔</th><th></th></tr></thead><tbody>${d.items.map((item) => `<tr><td><input type="checkbox" data-select="${item.id}" aria-label="选择 ${esc(item.title)}" ${S.selected.has(item.id) ? "checked" : ""}></td><td><div class="table-feed">${feedMark(item.title)}<div class="feed-info"><strong>${esc(item.title)}</strong><small title="${esc(item.url)}">${esc(item.url)}</small></div></div></td><td>${esc(item.target_title)}</td><td>${pill(item.state === 0 ? "已暂停" : item.errors ? `失败 ${item.errors} 次` : S.snapshot ? "已启用" : "更新中", item.state === 0 ? "gray" : item.errors ? "warn" : "")}</td><td class="muted">${n(item.effective_interval)} 分钟</td><td><div class="table-actions"><button data-sub-toggle="${item.id}" title="${item.state ? "暂停" : "恢复"}" aria-label="${item.state ? "暂停" : "恢复"} ${esc(item.title)}">${icon(item.state ? "pause" : "play", 15)}</button><button data-sub-edit="${item.id}" aria-label="编辑 ${esc(item.title)}">${icon("edit", 15)}</button><button data-sub-delete="${item.id}" aria-label="取消订阅 ${esc(item.title)}">${icon("trash", 15)}</button></div></td></tr>`).join("")}</tbody></table></div>` : empty(S.attention ? "目前没有需要检查的订阅" : "没有匹配的订阅", S.attention ? "偶发失败会自动重试，连续失败达到设置的次数后才会出现在这里。" : "试试调整筛选，或添加一个新的 RSS 地址。")}${pager(d)}</section>`
    );
}

function settings(d, tokens, runtime) {
    const o = d.options;
    const settingRow = (key, label, hint, min = 1, max = 32767, value = o[key]) =>
        `<div class="form-row"><label for="setting-${key}">${label}<p>${hint}</p></label><input id="setting-${key}" name="${key}" type="number" min="${min}" max="${max}" value="${value}" required></div>`;
    let content = "";
    if (S.settings === "general")
        content = `<form id="settings-form" class="panel"><div class="panel-head"><div><h2>更新与订阅</h2><p>新订阅使用的默认值，以及管理台提醒方式</p></div></div><div class="form-body">${settingRow("default_interval", "默认更新间隔", "单位：分钟。影响使用默认值的订阅。")}${settingRow("minimal_interval", "最短更新间隔", "单位：分钟。限制今后设置的更新间隔。")}${settingRow("user_sub_limit", "私聊订阅上限", "-1 表示不限，0 表示不允许添加。", -1)}${settingRow("channel_or_group_sub_limit", "频道 / 群组订阅上限", "每个目的地的默认上限，-1 表示不限。", -1)}${settingRow("attention_threshold", "需要检查的失败次数", "仅改变管理台提醒，不改变上游重试和停用策略。", 1, 100, d.console.attention_threshold)}<div class="form-row"><label for="limit-message">订阅上限提示<p>达到上限时机器人显示的附加说明。</p></label><textarea id="limit-message" name="sub_limit_reached_message" maxlength="2000">${esc(o.sub_limit_reached_message)}</textarea></div></div><div class="form-footer"><button class="primary" type="submit">保存设置</button></div></form>`;
    if (S.settings === "tokens")
        content = `<section class="panel"><div class="panel-head"><div><h2>连接授权</h2><p>允许外部应用通过 API 管理选定的会话</p></div><button class="primary" data-action="new-token">${icon("plus", 14)}创建授权</button></div>${tokens.items.length ? tokens.items.map((t) => `<div class="token-row">${icon("key", 20)}<div><p>${esc(t.name)} ${pill(t.permission === "write" ? "读写" : "只读", "gray")}</p><small>${t.targets === null ? "全部会话（含今后新增）" : `${t.targets.length} 个指定会话`} · ${dateText(t.expires_at * 1000)} 到期</small></div><button class="danger" data-revoke="${esc(t.id)}">撤销</button></div>`).join("") : empty("还没有连接授权", "未来接入 FeedLantern 时，在这里创建专用授权。")}<div class="form-body"><div class="notice">授权只允许访问指定会话的订阅，不包含管理台设置、创建授权或退出频道等管理员操作。完整密钥只显示一次。</div></div></section>`;
    if (S.settings === "security")
        content = `<form id="password-form" class="panel"><div class="panel-head"><h2>账户安全</h2></div><div class="form-body"><p>当前账户：${esc(S.session.name)} · ${S.demo ? "预览管理员" : "管理台管理员"}。此账户独立于 Telegram 机器人管理员。</p><label>当前密码<input name="current_password" type="password" autocomplete="current-password" required></label><label>新密码<input name="new_password" type="password" autocomplete="new-password" minlength="16" maxlength="512" required></label><p>修改后所有网页登录会话失效，连接授权保持有效。</p><p class="error" role="alert"></p></div><div class="form-footer"><button class="primary" type="submit">修改密码并退出</button><button type="button" data-action="revoke-sessions">撤销全部网页登录会话</button></div></form>`;
    if (S.settings === "runtime")
        content = `<form id="runtime-form" class="panel"><div class="panel-head"><h2>运行配置</h2></div><div class="form-body"><p class="notice">${runtime.pending_restart ? "有配置待重启。" : "没有待应用的覆盖。"} 保存不会改变当前连接；请在部署端安排重启。每项选择“修改”才会保存；“恢复部署值”会删除覆盖。敏感值只显示配置状态。</p>${runtime.items.map(r => `<div class="form-row"><label for="runtime-${r.key}">${esc(r.key)}<p>${r.pending_restart ? "待重启 · " : ""}${r.configured ? "已保存网页覆盖" : "使用部署或默认值"}${r.sensitive ? (r.effective_configured ? " · 当前已配置" : " · 当前未配置") : ""}</p></label><div><select name="mode-${r.key}" aria-label="${esc(r.key)} 操作"><option value="keep">保持不变</option><option value="set">修改</option><option value="reset">恢复部署值</option></select>${r.type === "boolean" ? `<select id="runtime-${r.key}" name="${r.key}" data-type="boolean"><option value="true" ${r.value === true ? "selected" : ""}>启用</option><option value="false" ${r.value === false ? "selected" : ""}>禁用</option></select>` : `<input id="runtime-${r.key}" name="${r.key}" data-type="${r.type}" type="${r.sensitive ? "password" : r.type === "integer" ? "number" : "text"}" autocomplete="off" value="${r.sensitive ? "" : esc(r.value ?? "")}" ${r.min !== undefined ? `min="${r.min}" max="${r.max}"` : ""}>`}</div></div>`).join("")}<p class="hint">必须由部署管理：${runtime.deployment_only.map(esc).join("、")}。网页登录凭据请使用连接授权／登录设置。</p></div><div class="form-footer"><button class="primary" type="submit">保存，重启后生效</button></div></form>`;
    if (S.settings === "instance")
        content = `<section class="panel"><div class="panel-head"><h2>实例信息</h2></div><div class="form-body"><dl class="info-grid"><div><dt>机器人</dt><dd>${esc(d.bot.name)} · @${esc(d.bot.username || "未设置")}</dd></div><div><dt>连接状态</dt><dd>${S.snapshot ? "真实数据离线预览" : d.demo ? "离线演示" : d.bot.connected ? "在线" : "未连接"}</dd></div><div><dt>管理台地址</dt><dd>${esc(d.origin)}</dd></div><div><dt>RSStT 数据库</dt><dd>${esc(d.database)}</dd></div><div><dt>${S.snapshot ? "快照时间" : "统计开始时间"}</dt><dd>${dateText(S.snapshot ? S.snapshot.captured_at : d.console.started_at)}</dd></div><div><dt>统计存储</dt><dd>${S.snapshot ? "原版无历史统计" : "独立 SQLite · 累计值永久保留"}</dd></div></dl><div class="notice">机器人 Token、Telegram API 凭证与代理可在运行配置中保存，重启后应用。管理者身份由部署管理；网页登录密码通过账户安全修改。敏感值不会回显。</div></div></section>`;
    return (
        header("设置", "熟悉的管理方式，按需调整。") +
        `<div class="settings"><nav class="settings-nav" aria-label="设置栏目">${[
            ["general", "settings", "更新与订阅"],
            ["runtime", "settings", "运行配置"],
            ["tokens", "key", "连接授权"],
            ["security", "key", "账户安全"],
            ["instance", "rss", "实例信息"],
        ]
            .map(
                ([key, i, label]) =>
                    `<button data-settings="${key}" class="${S.settings === key ? "active" : ""}">${icon(i, 16)}${label}</button>`,
            )
            .join("")}</nav><div class="settings-content">${content}</div></div>`
    );
}

function modal(title, body, footer = '<button type="button" data-action="close">关闭</button>') {
    const d = $("#dialog");
    d.innerHTML = `<form id="modal-form"><div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="quiet" data-action="close" aria-label="关闭">${icon("close", 19)}</button></div><div class="dialog-body">${body}<p class="dialog-error" role="alert"></p></div><div class="dialog-footer">${footer}</div></form>`;
    if (!d.open) d.showModal();
}
const saveFooter = (text) =>
    `<button type="button" data-action="close">取消</button><button class="primary" type="submit">${text}</button>`;
const formatLabels = {
    notify: [
        "通知方式",
        [
            [1, "正常通知"],
            [0, "静默发送"],
        ],
    ],
    send_mode: [
        "发送方式",
        [
            [0, "自动选择"],
            [-1, "仅链接"],
            [1, "Telegraph"],
            [2, "Telegram 消息"],
        ],
    ],
    link_preview: [
        "链接预览",
        [
            [0, "自动"],
            [1, "显示"],
            [-1, "隐藏"],
        ],
    ],
    display_media: [
        "媒体内容",
        [
            [0, "显示"],
            [1, "仅媒体"],
            [-1, "隐藏"],
        ],
    ],
    display_author: [
        "作者",
        [
            [0, "自动"],
            [1, "显示"],
            [-1, "隐藏"],
        ],
    ],
    display_title: [
        "标题",
        [
            [0, "自动"],
            [1, "显示"],
            [-1, "隐藏"],
        ],
    ],
    display_via: [
        "来源",
        [
            [0, "源标题与链接"],
            [1, "源标题与文章标题链接"],
            [-1, "结尾超链接，无源标题"],
            [-2, "完全隐藏"],
            [-3, "文章标题链接，无源标题"],
            [-4, "结尾完整网址，无源标题"],
        ],
    ],
    display_entry_tags: [
        "条目标签",
        [
            [1, "显示"],
            [-1, "隐藏"],
        ],
    ],
    style: [
        "排版样式",
        [
            [0, "RSStT"],
            [1, "flowerss"],
        ],
    ],
};
function formatFields(o, isSub) {
    const field = (key, label, entries) =>
        `<label>${label}<select name="${key}">${(isSub ? [[-100, "继承会话默认值"], ...entries] : entries).map(([v, t]) => `<option value="${v}" ${o[key] === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
    return `<div class="field-grid"><label>更新间隔（分钟）<input type="number" name="interval" min="1" max="32767" placeholder="默认" value="${o.interval ?? ""}"></label>${field("send_mode", ...formatLabels.send_mode)}</div><details><summary>更多推送与排版设置</summary><div class="field-grid">${Object.entries(
        formatLabels,
    )
        .filter(([k]) => k !== "send_mode")
        .map(([k, [l, v]]) => field(k, l, v))
        .join(
            "",
        )}<label>Telegraph 长度阈值<input name="length_limit" type="number" min="${isSub ? -100 : 0}" max="4096" value="${o.length_limit}"><span class="hint">0 为自动${isSub ? "，-100 为继承会话默认值" : ""}。</span></label></div></details>`;
}

async function targetPicker(multiple = false) {
    modalState.multiple = multiple;
    modalState.chosen = new Set(modalState.chosen || []);
    const data = await api("/targets?size=50&q=" + encodeURIComponent($("#picker-search")?.value || ""));
    if (!$("#target-picker")) return;
    $("#target-picker").innerHTML = data.items.length
        ? data.items
              .map(
                  (i) =>
                      `<label class="target-choice"><input type="${multiple ? "checkbox" : "radio"}" name="target-choice" value="${i.id}" ${modalState.chosen.has(i.id) ? "checked" : ""}>${icon(kindIcon[i.kind], 15)}${esc(i.title)}<small>${kindName[i.kind]}</small></label>`,
              )
              .join("")
        : empty("没有匹配的会话", "先在「会话与频道」中登记。");
    $("#picker-hint").textContent =
        `匹配 ${data.total} 个会话${data.total > 50 ? "，先显示前 50 个，请继续搜索缩小范围" : ""}${multiple ? ` · 已选 ${modalState.chosen.size} 个` : ""}`;
}
const pickerHtml = (multiple) =>
    `<label>选择${multiple ? "允许管理的会话" : "接收会话"}<input id="picker-search" placeholder="搜索会话名称、用户名或 ID" autocomplete="off"></label><div class="target-choices" id="target-picker"></div><span class="hint" id="picker-hint"></span>`;

async function newSub() {
    modalState = { action: "new-sub", chosen: S.target ? [S.target] : [] };
    modal(
        "添加订阅",
        pickerHtml(false) +
            `<label>RSS 地址<textarea name="urls" required placeholder="https://example.com/feed.xml&#10;可以粘贴多个地址，每行一个"></textarea><span class="hint">每次最多 100 个。已存在的订阅会自动跳过，保留原来的设置。${S.snapshot ? " 离线新增不会读取 RSS 内容或校验地址。" : ""}</span></label>`,
        saveFooter("添加订阅"),
    );
    await targetPicker();
}
function editSub(item) {
    modalState = { action: "edit-sub", item };
    modal(
        "订阅设置",
        `<div class="notice">${esc(item.url)}<br>接收会话：${esc(item.target_title)}</div><label>自定义标题<input name="title" value="${esc(item.custom_title || "")}" maxlength="1024" placeholder="使用订阅源原标题"></label><label>附加标签<input name="tags" value="${esc(item.tags || "")}" maxlength="255" placeholder="以空格分隔"></label>${formatFields(item.options, true)}`,
        saveFooter("保存设置"),
    );
}
function editTarget(item) {
    modalState = { action: "edit-target", item };
    modal(
        item.title,
        `<div class="spread"><span class="muted mono small">${esc(item.id)} · ${targetKindName(item)}</span><button type="button" data-refresh-target="${item.id}" class="small">${icon("refresh", 13)}同步名称与权限</button></div><div class="inline"><a class="text-link" href="/api/targets/${item.id}/opml" download>导出 OPML</a><button type="button" class="text-link" data-import-target="${item.id}">导入 OPML</button></div><label>用户角色<select id="target-role" ${item.role_protected ? "disabled" : ""}>${(item.role_protected ? [["manager","MANAGER（部署管理）"]] : [["banned","封禁"],["guest","访客"],["user","普通用户"],...(!item.id.startsWith("-") ? [["admin","管理员（原版状态 100）"]] : [])]).map(([v,l]) => `<option value="${v}" ${item.role === v ? "selected" : ""}>${l}</option>`).join("")}</select><span class="hint">原版管理员状态不等于 MANAGER，不授予管理台登录或管理者命令权限。封禁会暂停订阅，解封不会自动恢复。</span></label><button type="button" data-save-role="${item.id}" ${item.role_protected ? "disabled" : ""}>保存角色</button><label>Bot 语言<input name="lang" value="${esc(item.lang || "null")}" maxlength="16"><span class="hint">例如 zh-Hans、en；null 使用自动语言。</span></label><label>此会话的订阅上限<input name="sub_limit" type="number" min="-1" max="32767" value="${item.sub_limit ?? ""}" placeholder="使用实例默认值"><span class="hint">-1 表示不限，留空则继承实例设置。</span></label>${formatFields(item.options, false)}${item.id.startsWith("-") ? `<div class="spread"><span class="hint">退出后保留订阅记录，并暂停更新。</span><button type="button" class="danger small" data-leave-target="${item.id}">退出会话</button></div>` : ""}`,
        saveFooter("保存默认设置"),
    );
}
function confirmation(title, description, action, extra = {}) {
    modalState = { action, ...extra };
    modal(
        title,
        `<p>${esc(description)}</p>${action === "leave" ? `<label>输入会话 ID 确认<input name="confirm" required placeholder="${esc(extra.id)}" autocomplete="off"></label>` : ""}`,
        saveFooter("确认"),
    );
}
function resultModal(result) {
    const failed = result.results.filter((r) => r.status === "failed" || r.ok === false).length;
    modalState = { action: "done" };
    modal(
        failed ? "处理完成，部分条目未成功" : "处理完成",
        `<div class="notice">${result.results.length - failed} 条完成，${failed} 条失败。失败条目可修正后重新提交。</div><div class="result-list">${result.results.map((r) => `<div class="result-item">${pill(r.status === "existing" ? "已存在" : r.status === "failed" || r.ok === false ? "失败" : "完成", r.status === "failed" || r.ok === false ? "warn" : "")}<div>${esc(r.url || "订阅 #" + r.id)}${r.message || r.error ? `<small>${esc(r.message || r.error)}</small>` : ""}</div></div>`).join("")}</div>`,
    );
}

document.addEventListener("click", async (event) => {
    const b = event.target.closest("button,[data-target-subs]");
    if (!b || b.disabled) return;
    const d = b.dataset;
    try {
        if (d.action === "close") {
            $("#dialog").close();
            return;
        }
        if (d.action === "menu") {
            document.body.classList.toggle("menu-open");
            return;
        }
        if (d.action === "revoke-sessions") {
            await api("/auth/sessions", { method: "DELETE" });
            S.session = null;
            login();
            return;
        }
        if (d.action === "logout") {
            await api("/logout", { method: "POST" });
            S.session = null;
            login();
            return;
        }
        if (d.action === "retry") return render();
        if (d.period) {
            S.period = Number(d.period);
            return render(true);
        }
        if (d.page) {
            S.page = Number(d.page);
            S.selected.clear();
            return render(true);
        }
        if (d.saveRole) {
            const updated = await api(`/targets/${d.saveRole}/role`, { method: "PATCH", body: {role: $("#target-role").value} });
            toast("角色已保存");
            editTarget(updated);
            return;
        }
        if (d.settings) {
            S.settings = d.settings;
            return render(true);
        }
        if (d.action === "new-sub") return await newSub();
        if (d.action === "register") {
            modalState = { action: "register" };
            modal(
                "登记已有会话",
                '<p class="muted small">请先在 Telegram 中让用户启动机器人，或将机器人加入频道 / 群组并授予发布权限。</p><label>Telegram 会话 ID<input name="id" required placeholder="例如 -1001234567890" inputmode="numeric"></label>',
                saveFooter("验证并登记"),
            );
            return;
        }
        if (d.action === "attention") {
            S.attention = true;
            S.page = 1;
            S.target = "";
            S.q = "";
            location.hash = "subscriptions";
            if (S.route === "subscriptions") render();
            return;
        }
        if (d.action === "toggle-attention") {
            S.attention = !S.attention;
            S.page = 1;
            S.selected.clear();
            return render(true);
        }
        if (d.action === "clear-target") {
            S.target = "";
            S.page = 1;
            return render(true);
        }
        if (d.action === "clear-selection") {
            S.selected.clear();
            return render(true);
        }
        if (d.targetSubs) {
            S.target = d.targetSubs;
            S.q = "";
            S.attention = false;
            S.status = "";
            location.hash = "subscriptions";
            return;
        }
        if (d.subEdit) return editSub(S.items.find((i) => i.id === Number(d.subEdit)));
        if (d.targetEdit) return editTarget(S.items.find((i) => i.id === d.targetEdit));
        if (d.subToggle) {
            const item = S.items.find((i) => i.id === Number(d.subToggle));
            b.disabled = true;
            await api(`/subscriptions/${item.id}`, { method: "PATCH", body: { state: item.state ? 0 : 1 } });
            toast(item.state ? "订阅已暂停" : "订阅已恢复");
            return render(true);
        }
        if (d.subDelete) {
            const item = S.items.find((i) => i.id === Number(d.subDelete));
            return confirmation(
                "取消订阅",
                `取消「${item.title}」在「${item.target_title}」的订阅？其他会话不受影响。`,
                "delete-sub",
                { id: item.id },
            );
        }
        if (d.batch)
            return confirmation(
                "批量处理订阅",
                `对选中的 ${S.selected.size} 条订阅执行「${{ pause: "暂停", resume: "恢复", delete: "取消订阅" }[d.batch]}」？`,
                "batch",
                { batchAction: d.batch, ids: [...S.selected] },
            );
        if (d.refreshTarget) {
            b.disabled = true;
            const item = await api(`/targets/${d.refreshTarget}/refresh`, { method: "POST", body: {} });
            toast("名称与权限已同步");
            editTarget(item);
            return render(true);
        }
        if (d.leaveTarget)
            return confirmation("退出会话", "机器人退出后，订阅将暂停。重新加入需要在 Telegram 中操作。", "leave", {
                id: d.leaveTarget,
            });
        if (d.importTarget) {
            modalState = { action: "import", id: d.importTarget };
            modal(
                "导入 OPML",
                '<label>选择 OPML 文件<input type="file" name="opml" accept=".opml,.xml,text/xml" required><span class="hint">最多 100 个订阅、512 KB。导入到当前会话，重复订阅会跳过。</span></label>',
                saveFooter("导入订阅"),
            );
            return;
        }
        if (d.action === "new-token") {
            modalState = { action: "new-token" };
            modal(
                "创建连接授权",
                `<label>授权名称<input name="name" required maxlength="80" placeholder="例如 FeedLantern"></label><div class="field-grid"><label>权限<select name="permission"><option value="read">只读</option><option value="write">读写订阅</option></select></label><label>有效天数<input name="days" type="number" value="90" min="1" max="365" required></label></div>${pickerHtml(true)}<label class="inline-label"><input type="checkbox" name="all_targets">允许全部会话，包括今后新增的会话</label>`,
                saveFooter("创建授权"),
            );
            await targetPicker(true);
            return;
        }
        if (d.revoke)
            return confirmation("撤销连接授权", "使用这个授权的外部应用将立即失去访问权限。", "revoke", {
                id: d.revoke,
            });
        if (d.action === "copy-token") {
            await navigator.clipboard.writeText($("#token-secret").textContent);
            toast("已复制授权密钥");
        }
    } catch (e) {
        if ($("#dialog").open) $(".dialog-error").textContent = e.message;
        else toast(e.message);
        b.disabled = false;
    }
});

document.addEventListener("input", (e) => {
    if (e.target.id === "page-search") {
        S.q = e.target.value;
        S.page = 1;
        S.selected.clear();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => render(true), 250);
    }
    if (e.target.id === "picker-search") {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(
            () => targetPicker(modalState.multiple).catch((e) => ($(".dialog-error").textContent = e.message)),
            250,
        );
    }
});
document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "kind-filter") {
        S.kind = t.value;
        S.page = 1;
        render(true);
    }
    if (t.id === "status-filter") {
        S.status = t.value;
        S.page = 1;
        S.selected.clear();
        render(true);
    }
    if (t.dataset.select) {
        t.checked ? S.selected.add(Number(t.dataset.select)) : S.selected.delete(Number(t.dataset.select));
        render(true);
    }
    if (t.id === "select-page") {
        for (const i of S.items) t.checked ? S.selected.add(i.id) : S.selected.delete(i.id);
        render(true);
    }
    if (t.name === "target-choice") {
        if (!modalState.multiple) modalState.chosen.clear();
        t.checked ? modalState.chosen.add(t.value) : modalState.chosen.delete(t.value);
    }
});

document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target,
        button = $("button[type=submit]", form),
        f = new FormData(form);
    if (!button) return;
    button.disabled = true;
    try {
        if (form.id === "login-form") {
            await api("/login", { method: "POST", body: { password: f.get("password") } });
            await boot();
            return;
        }
        if (form.id === "runtime-form") {
            const values = {};
            for (const [key, mode] of f) {
                if (!key.startsWith("mode-") || mode === "keep") continue;
                const name = key.slice(5), field = form.elements.namedItem(name), value = f.get(name);
                values[name] = mode === "reset" ? null : field.dataset.type === "boolean" ? value === "true" : field.dataset.type === "integer" ? Number(value) : value;
            }
            if (!Object.keys(values).length) throw new Error("请先选择需要修改的项目。");
            await api("/runtime-config", {method: "PATCH", body: values});
            toast("已保存；需要在部署端重启后生效");
            return render(true);
        }
        if (form.id === "password-form") {
            await api("/auth/password", { method: "POST", body: Object.fromEntries(f) });
            S.session = null;
            login();
            return;
        }
        if (form.id === "settings-form") {
            const values = Object.fromEntries(f);
            for (const k of Object.keys(values)) if (k !== "sub_limit_reached_message") values[k] = Number(values[k]);
            await api("/settings", { method: "PATCH", body: values });
            toast("设置已保存");
            return render(true);
        }
        let result;
        const m = modalState;
        if (m.action === "new-sub") {
            if (!m.chosen?.size) throw new Error("请选择接收会话。");
            result = await api("/subscriptions", {
                method: "POST",
                body: { target: [...m.chosen][0], urls: f.get("urls").split(/\s+/).filter(Boolean) },
            });
        }
        if (m.action === "register") {
            await api("/targets", { method: "POST", body: { id: f.get("id") } });
            toast("会话已登记");
        }
        if (m.action === "edit-sub" || m.action === "edit-target") {
            const v = Object.fromEntries(f);
            for (const k of Object.keys(v))
                if (!["title", "tags", "lang"].includes(k)) v[k] = v[k] === "" ? null : Number(v[k]);
            await api(`/${m.action === "edit-sub" ? "subscriptions" : "targets"}/${m.item.id}`, {
                method: "PATCH",
                body: v,
            });
            toast("设置已保存");
        }
        if (m.action === "delete-sub") {
            await api(`/subscriptions/${m.id}`, { method: "DELETE" });
            S.selected.delete(m.id);
            toast("订阅已取消");
        }
        if (m.action === "batch") {
            result = await api("/subscriptions/batch", { method: "POST", body: { ids: m.ids, action: m.batchAction } });
            S.selected.clear();
        }
        if (m.action === "leave") {
            await api(`/targets/${m.id}/leave`, { method: "POST", body: { confirm: f.get("confirm") } });
            toast("已退出会话并暂停订阅");
        }
        if (m.action === "import") {
            const file = f.get("opml");
            if (file.size > 512 * 1024) throw new Error("文件不能超过 512 KB。");
            result = await api(`/targets/${m.id}/opml`, { method: "POST", body: { opml: await file.text() } });
        }
        if (m.action === "new-token") {
            const r = await api("/tokens", {
                method: "POST",
                body: {
                    name: f.get("name"),
                    permission: f.get("permission"),
                    days: Number(f.get("days")),
                    all_targets: f.has("all_targets"),
                    targets: [...m.chosen],
                },
            });
            modalState = { action: "done" };
            modal(
                "保存连接密钥",
                `<p class="muted small">完整密钥只在这里显示一次。复制到需要连接的应用中，并妥善保存。</p><div class="secret" id="token-secret">${esc(r.token)}</div>`,
                `<button type="button" data-action="copy-token">复制密钥</button><button type="button" class="primary" data-action="close">已保存</button>`,
            );
            render(true);
            return;
        }
        if (m.action === "revoke") {
            await api(`/tokens/${m.id}`, { method: "DELETE" });
            toast("授权已撤销");
        }
        if (result) resultModal(result);
        else $("#dialog").close();
        render(true);
    } catch (e) {
        const error = $(".dialog-error", form) || $(".error", form);
        if (error) error.textContent = e.message;
        else toast(e.message);
    } finally {
        button.disabled = false;
    }
});

function route() {
    const next = location.hash.slice(1).split("?")[0] || "dashboard";
    S.route = labels[next] ? next : "dashboard";
    S.page = 1;
    S.selected.clear();
    S.q = "";
    document.body.classList.remove("menu-open");
    if (S.session) render();
}
window.addEventListener("hashchange", route);
function login() {
    $("#app").innerHTML =
        `<div class="login"><form id="login-form" class="login-card"><img src="/assets/mark.svg" alt="RSStT"><h1>欢迎回来。</h1><p>登录 RSStT 管理台，照看你的订阅。</p><label for="password">管理台密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><p class="error" role="alert"></p><button type="submit" class="primary">进入管理台 ${icon("arrow", 15)}</button></form></div>`;
}
async function boot() {
    try {
        const pub = await api("/public");
        S.demo = pub.demo;
        S.snapshot = pub.snapshot;
        try {
            S.session = await api("/session");
        } catch (e) {
            if (e.status !== 401) throw e;
            return login();
        }
        shell();
        route();
    } catch (e) {
        $("#app").innerHTML = `<div class="initial">无法连接管理台：${esc(e.message)}。请刷新页面重试。</div>`;
    }
}
// Only the visible dashboard refreshes, using one request per minute.
setInterval(() => {
    if (S.session && S.route === "dashboard" && !document.hidden && !$("#dialog").open) render(true);
}, 60000);
boot();
