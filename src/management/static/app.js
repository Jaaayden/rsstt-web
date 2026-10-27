import { locale, tr, html, setLocale, setTheme, errorText, count, message, runtimeText } from "./i18n.js";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const n = (v) => (v === null ? "—" : new Intl.NumberFormat(locale).format(v || 0));
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
    html`<svg
        width="${size}"
        height="${size}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <path d="${paths[name] || paths.rss}" />
    </svg>`;
const labels = {
    dashboard: tr("仪表盘"),
    targets: tr("会话与频道"),
    subscriptions: tr("全部订阅"),
    settings: tr("设置"),
};
const kindName = { private: tr("私聊"), channel: tr("频道"), group: tr("群组") };
const kindIcon = { private: "user", channel: "channel", group: "group" };
const languageNames = new Intl.DisplayNames([locale], { type: "language" });
const botLanguages = [
    "ar",
    "be",
    "ca",
    "cs",
    "de",
    "el",
    "en",
    "es",
    "eu",
    "fa",
    "fr",
    "he",
    "id",
    "it",
    "ja",
    "ko",
    "lv",
    "pl",
    "pt-BR",
    "pt",
    "ru",
    "si",
    "ta",
    "tr",
    "uk",
    "uz",
    "yue",
    "zh-Hans",
    "zh-Hant",
].map((code) => {
    let label;
    try {
        label = languageNames.of(code);
    } catch {
        label = code;
    }
    return [code, label || code];
});
const S = {
    route: "dashboard",
    session: null,
    features: {},
    runtimeItems: [],
    demo: false,
    snapshot: null,
    period: 14,
    granularity: "hour",
    settings: "general",
    page: 1,
    q: "",
    kind: "",
    visibility: "unbanned",
    target: "",
    status: "",
    attention: false,
    selected: new Set(),
    items: [],
    serial: 0,
};
let modalState = {},
    toastTimer,
    searchTimer,
    pickerSerial = 0;

async function api(path, options = {}) {
    const response = await fetch(html`/api${path}`, {
        credentials: "same-origin",
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
    }).catch(() => {
        throw new Error(errorText({}, 503));
    });
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(errorText({}, response.ok ? 500 : response.status));
    }
    if (!response.ok) {
        const e = new Error(errorText(data, response.status));
        e.code = data.code || html`http_${response.status}`;
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
const pill = (text, cls = "") => html`<span class="pill ${cls}">${esc(text)}</span>`;
const dateText = (v) =>
    v
        ? new Intl.DateTimeFormat(locale, {
              year: "numeric",
              timeZoneName: "short",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
          }).format(new Date(v))
        : tr("尚未同步");
const feedMark = (title) => html`<div class="feed-mark">${esc((title || "R")[0].toUpperCase())}</div>`;
const empty = (title, description) =>
    html`<div class="empty">
        ${icon("rss", 26)}<strong>${esc(title)}</strong>
        <p>${esc(description)}</p>
    </div>`;

function shell() {
    $("#app").innerHTML = html`<div class="layout">
        <aside class="sidebar" aria-label="主导航">
            <button class="quiet mobile-menu" data-action="menu">关闭导航</button
            ><a class="brand" href="#dashboard"
                ><img src="/assets/mark.svg" alt="" />
                <div><strong>RSStT</strong><small>YOUR READING RELAY</small></div></a
            >
            <div>
                <div class="nav-label">管理台</div>
                <nav class="nav">
                    ${Object.entries(labels)
                        .map(
                            ([key, label]) =>
                                html`<a href="#${key}" data-nav="${key}"
                                    >${icon({ targets: "chats", subscriptions: "rss" }[key] || key)}${label}</a
                                >`,
                        )
                        .join("")}
                </nav>
            </div>
            <div class="sidebar-bottom">
                <div class="instance">
                    <strong><span class="dot"></span>${S.demo ? tr("离线预览实例") : tr("RSStT 管理实例")}</strong
                    ><small
                        >${S.snapshot
                            ? tr("真实数据副本 · 修改仅在本地")
                            : S.demo
                              ? tr("示例数据 · 不发送 Telegram 消息")
                              : tr("同一个机器人，更清晰的掌控")}</small
                    >
                </div>
                <div class="profile">
                    <div class="avatar">${icon("user", 16)}</div>
                    <div>
                        <span class="small">管理台管理员</span>
                        <p class="muted micro">${S.demo ? tr("本地预览") : tr("管理台会话")}</p>
                    </div>
                    <button class="quiet" data-action="logout" title="退出登录" aria-label="退出登录">
                        ${icon("exit", 16)}退出登录
                    </button>
                </div>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <div class="breadcrumb">
                    <button class="quiet mobile-menu" data-action="menu" aria-label="展开导航" aria-expanded="false">
                        ${icon("menu")}</button
                    ><span>管理台</span>${icon("chevron", 12)}<strong id="breadcrumb"></strong>
                </div>
                ${preferences()}
                <div class="date">${new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date())}</div>
            </header>
            ${S.demo
                ? '<div class="demo-banner">' +
                  icon("alert", 13) +
                  (S.snapshot
                      ? tr("真实数据离线预览 · 快照 ") +
                        esc(dateText(S.snapshot.captured_at)) +
                        tr(" · 修改仅保存在本地，不会影响线上机器人")
                      : tr("离线预览 · 所有数据和操作均为本地示例，不会连接 Telegram")) +
                  "</div>"
                : ""}
            <main id="main" tabindex="-1"></main>
        </div>
    </div>`;
}

function header(title, description, button = "") {
    return html`<div class="page-title">
        <div>
            <div class="eyebrow">
                ${{
                    dashboard: "OVERVIEW",
                    targets: "CHATS & CHANNELS",
                    subscriptions: "SUBSCRIPTIONS",
                    settings: "SETTINGS",
                }[S.route]}
            </div>
            <h1>${title}</h1>
            <p>${description}</p>
        </div>
        ${button}
    </div>`;
}
const targetKindName = (item) => kindName[item.kind] || tr("未知");
const newButton = () => html`<button class="primary" data-action="new-sub">${icon("plus", 16)}添加订阅</button>`;
const credit = () =>
    html`<footer class="credit">
        <span>RSStT Web · 让信息有序抵达。</span
        ><a href="https://github.com/Rongronggg9/RSS-to-Telegram-Bot" target="_blank" rel="noreferrer"
            >基于 RSS-to-Telegram-Bot · AGPL-3.0</a
        >
    </footer>`;

async function render(quiet = false) {
    if (!S.session) return;
    syncURL();
    const serial = ++S.serial;
    const focus = document.activeElement,
        focusData = [
            "select",
            "subToggle",
            "subEdit",
            "subDelete",
            "targetSubs",
            "targetEdit",
            "page",
            "settings",
        ].find((key) => focus?.dataset?.[key]),
        focusSelector = focusData
            ? `[data-${focusData.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(focus.dataset[focusData])}"]`
            : null,
        focusId = focus?.id,
        cursor = focus?.selectionStart;
    $("#breadcrumb").textContent =
        labels[S.route] + (S.route === "subscriptions" && S.target ? html` / ${S.target}` : "");
    $$("[data-nav]").forEach((e) => {
        e.classList.toggle("active", e.dataset.nav === S.route);
        if (e.dataset.nav === S.route) e.setAttribute("aria-current", "page");
        else e.removeAttribute("aria-current");
    });
    if (!quiet)
        $("#main").innerHTML = html`<div class="loading" role="status">
            ${message("loading", { page: labels[S.route] })}
        </div>`;
    try {
        let html;
        if (S.route === "dashboard") {
            const data = await api("/dashboard");
            if (data.usage) {
                const end = new Date();
                end.setUTCMinutes(0, 0, 0);
                if (S.granularity === "day") end.setUTCHours(0);
                const step = S.granularity === "hour" ? 3600000 : 86400000;
                const finish = new Date(end.getTime() + step);
                const start = new Date(finish.getTime() - (S.granularity === "hour" ? 24 : S.period) * step);
                data.trend = await api(
                    "/statistics?" +
                        new URLSearchParams({
                            granularity: S.granularity,
                            start: start.toISOString(),
                            end: finish.toISOString(),
                        }),
                );
            }
            html = dashboard(data);
        }
        if (S.route === "targets") {
            const data = await api(
                "/targets?" + new URLSearchParams({ page: S.page, q: S.q, kind: S.kind, visibility: S.visibility }),
            );
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
            const [data, tokens, security, feature] = await Promise.all([
                api("/settings"),
                S.settings === "tokens" ? api("/tokens") : Promise.resolve(null),
                S.settings === "security"
                    ? Promise.all([api("/auth/account"), api("/auth/sessions")])
                    : Promise.resolve(null),
                { runtime: "/runtime-config", notifications: "/notifications", backups: "/backups" }[S.settings]
                    ? api(
                          { runtime: "/runtime-config", notifications: "/notifications", backups: "/backups" }[
                              S.settings
                          ],
                      )
                    : Promise.resolve(null),
            ]);
            if (S.settings === "runtime") S.runtimeItems = feature.items;
            if (S.settings === "notifications") {
                S.notificationChannels = feature.channels;
                feature.history = (await api("/notifications/history")).items;
            }
            html = settings(data, tokens, security, feature);
        }
        if (serial !== S.serial) return;
        $("#main").innerHTML = html + credit();
        syncTableHints();
        if (quiet && (focusId || focusSelector)) {
            const next = focusId ? document.getElementById(focusId) : $(focusSelector);
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
        $("#main").innerHTML = html`<div class="page-error">
            <p>${esc(e.message)}</p>
            <button data-action="retry">${icon("refresh", 15)}重新加载</button>
        </div>`;
    }
}

function dashboard(d) {
    const c = d.counts,
        t = d.statistics.totals;
    const cards = [
        [
            "rss",
            tr("订阅总数"),
            c.subscriptions,
            html`${message("enabledSubs", { count: n(d.usage?.active_subscriptions ?? c.active) })} ·
                ${count(c.feeds, "feed")}
                <p class="hint">${tr("同一订阅源推送到两个会话，计两条订阅。")}</p>`,
        ],
        [
            "chats",
            d.usage ? tr("活跃会话") : tr("已知会话"),
            d.usage ? d.usage.active.total : c.users + c.groups + c.channels,
            d.usage
                ? html`${message("recordedChats", { total: n(d.usage.known.total), unknown: n(d.usage.known.unknown) })}
                      <details>
                          <summary>会话分类</summary>
                          ${["private", "channel", "group", "unknown"]
                              .map(
                                  (kind) =>
                                      html`<div>
                                          ${tr(
                                              {
                                                  private: "私聊",
                                                  channel: "频道",
                                                  group: "群组",
                                                  unknown: "未核验类型",
                                              }[kind],
                                          )}：${n(d.usage.active[kind])}
                                          / ${n(d.usage.known[kind])}
                                      </div>`,
                              )
                              .join("")}<span>${tr("有启用订阅 / 已记录会话")}</span>
                          <p class="hint">${tr("活跃会话未被封禁，且至少有一条已启用订阅，其订阅源也已启用。")}</p>
                      </details>`
                : S.snapshot
                  ? html`${n(c.channels + c.groups)} 个群组/频道 · ${n(c.users)} 个私聊`
                  : html`${n(c.channels)} 个频道 · ${n(c.groups)} 个群组 · ${n(c.users)} 个私聊`,
        ],
        [
            "send",
            tr("累计成功推送（篇次）"),
            t.delivered,
            S.snapshot ? tr("快照不含历史推送统计") : html`${message("discoveredTotal", { count: n(t.fetched) })}`,
        ],
        ["alert", tr("抓取异常"), c.attention, message("attentionThreshold", { count: n(d.threshold) })],
    ];
    return (
        header(tr("运行概况"), tr("查看订阅启用情况、抓取异常和推送统计。"), newButton()) +
        (!d.bot.connected && !S.demo
            ? html`<div class="notice warning">机器人当前未连接 Telegram，订阅推送暂不可用。</div>
                  <br />`
            : "") +
        (d.metrics_error
            ? html`<div class="notice warning">${esc(d.metrics_error)}</div>
                  <br />`
            : "") +
        html`<section class="stats" aria-label="运行概况">
                ${cards
                    .map(
                        ([i, label, value, foot], idx) =>
                            html`<article class="stat ${idx === 3 && value ? "warning" : ""}">
                                <div class="stat-head"><span>${label}</span>${icon(i, 17)}</div>
                                <div class="stat-value">${n(value)}</div>
                                <div class="stat-foot">${foot}</div>
                            </article>`,
                    )
                    .join("")}
            </section>
            <section class="panel">
                <div class="panel-head">
                    <div>
                        <h2>抓取与推送趋势</h2>
                        <p>
                            ${d.trend?.granularity === "hour"
                                ? tr("每小时新发现文章（篇）与成功推送（篇次），按本地时间显示")
                                : d.trend
                                  ? tr("每天新发现文章（篇）与成功推送（篇次），按 UTC 日聚合")
                                  : tr("每天发现的新发现文章，以及成功送达的篇次")}
                        </p>
                    </div>
                    <div class="segmented" aria-label="趋势时间范围">
                        ${(d.usage ? [24, 7, 30] : [7, 14, 30])
                            .map(
                                (v) =>
                                    html`<button
                                        data-period="${v}"
                                        class="${(d.usage && S.granularity === "hour" ? v === 24 : S.period === v)
                                            ? "active"
                                            : ""}"
                                        aria-pressed="${d.usage && S.granularity === "hour"
                                            ? v === 24
                                            : S.period === v}"
                                    >
                                        ${d.usage && v === 24 ? tr("24 小时") : count(v, "day")}
                                    </button>`,
                            )
                            .join("")}
                    </div>
                </div>
                <div class="chart-wrap">
                    <p class="hint">${tr("新发现文章按订阅源计数；同一文章推送给多个会话，分别计为成功推送篇次。")}</p>
                    <div class="chart-meta">
                        <span><i class="legend"></i>成功推送（篇次）</span
                        ><span><i class="legend orange"></i>新发现文章</span
                        ><span
                            >${d.trend?.granularity === "day"
                                ? tr("按 UTC 日聚合（00:00–24:00 UTC）")
                                : d.trend
                                  ? esc(Intl.DateTimeFormat().resolvedOptions().timeZone)
                                  : "UTC"}</span
                        >
                    </div>
                    ${d.trend
                        ? trendChart(d.trend)
                        : S.snapshot
                          ? empty(
                                tr("没有历史统计"),
                                tr("这份快照不含历史推送统计；新版运行后开始记录，无法从已有订阅倒推。"),
                            )
                          : chart(d.statistics.daily)}
                </div>
                <div class="chart-footer">
                    <span
                        >${d.trend
                            ? tr("小时趋势保留 31 天，日趋势保留 90 天；累计值持续保留。")
                            : S.snapshot
                              ? tr("订阅与失败次数来自快照，不会自动更新")
                              : (S.demo ? tr("示例统计") : tr("开始记录于 ") + dateText(d.started_at)) +
                                tr(" · 累计值持续保留，趋势保留 90 天")}</span
                    ><span
                        >${S.demo ? tr("未连接 Telegram") : d.bot.connected ? tr("机器人在线") : tr("机器人离线")} ·
                        @${esc(d.bot.username || tr("未设置"))}</span
                    >
                </div>
            </section>
            <div class="dashboard-lower">
                <section class="panel">
                    <div class="panel-head">
                        <h2>抓取异常 <span class="muted small">${n(c.attention)}</span></h2>
                        <button class="text-link" data-action="attention">查看异常订阅 ${icon("arrow", 13)}</button>
                    </div>
                    ${d.attention.length
                        ? d.attention
                              .map(
                                  (item) =>
                                      html`<div class="attention-row">
                                          ${feedMark(item.title)}
                                          <div class="feed-info">
                                              <strong>${esc(item.title)}</strong
                                              ><small>${esc(item.target_title)}</small>
                                          </div>
                                          ${pill(message("fetchFailures", { count: n(item.errors) }), "warn")}
                                      </div>`,
                              )
                              .join("")
                        : empty(tr("目前没有需要检查的订阅"), tr("偶发失败会自动重试，你可以安心阅读。"))}
                </section>
                <section class="panel">
                    <div class="panel-head">
                        <h2>最近操作</h2>
                        <span class="muted small">管理台记录</span>
                    </div>
                    <div class="activity">
                        ${d.activity.length
                            ? d.activity
                                  .slice(0, 4)
                                  .map(
                                      (a) =>
                                          html`<div class="activity-row">
                                              <div class="activity-icon">${icon("check", 14)}</div>
                                              <div>
                                                  <p>${esc(auditAction(a.action))}</p>
                                                  <small>${esc(auditDetail(a.action, a.detail))}</small>
                                              </div>
                                              <time>${dateText(a.at)}</time>
                                          </div>`,
                                  )
                                  .join("")
                            : empty(tr("还没有操作记录"), tr("你在管理台中的修改会出现在这里。"))}
                    </div>
                </section>
            </div>`
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
    const width = Math.min(920, Math.max(300, $("#main").clientWidth - 76));
    const max = Math.max(10, ...data.flatMap((r) => [r.fetched, r.delivered])),
        ceiling = Math.ceil(max / 50) * 50;
    const x = (i) => 42 + (i * (width - 66)) / (data.length - 1),
        y = (v) => 139 - (v / ceiling) * 118;
    const line = (key) =>
        data.map((r, i) => html`${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(" ");
    const delivered = data.reduce((a, r) => a + r.delivered, 0),
        fetched = data.reduce((a, r) => a + r.fetched, 0);
    return html`<svg
        class="chart"
        viewBox="0 0 ${width} 172"
        preserveAspectRatio="none"
        role="img"
        aria-label="最近 ${S.period} 天抓取 ${fetched} 篇，推送 ${delivered} 篇次"
    >
        <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop stop-color="#8fbca0" stop-opacity=".18" />
                <stop offset="1" stop-color="#8fbca0" stop-opacity="0" />
            </linearGradient>
        </defs>
        ${[0, 0.5, 1]
            .map(
                (f) =>
                    html`<line x1="42" x2="${width - 20}" y1="${y(ceiling * f)}" y2="${y(ceiling * f)}" /><text
                            x="30"
                            y="${y(ceiling * f) + 4}"
                            text-anchor="end"
                            >${n(ceiling * f)}</text
                        >`,
            )
            .join("")}
        <path d="${line("delivered")} L${width - 24} 139 L42 139Z" fill="url(#chart-fill)" />
        <path
            class="delivered"
            d="${line("delivered")}"
            fill="none"
            stroke="#37795b"
            stroke-width="2.2"
            vector-effect="non-scaling-stroke"
        />
        <path
            d="${line("fetched")}"
            fill="none"
            stroke="var(--orange)"
            stroke-width="1.8"
            vector-effect="non-scaling-stroke"
        />
        ${data
            .map(
                (r, i) =>
                    html`<circle cx="${x(i)}" cy="${y(r.delivered)}" r="7" fill="transparent"
                            ><title>${r.day}：抓取 ${r.fetched} 篇 · 推送 ${r.delivered} 篇次</title></circle
                        >${i % Math.ceil(data.length / (width < 500 ? 4 : 7)) === 0 || i === data.length - 1
                            ? html`<text x="${x(i)}" y="164" text-anchor="middle"
                                  >${r.day.slice(5).replace("-", "/")}</text
                              >`
                            : ""}`,
            )
            .join("")}
    </svg>`;
}

function searchBox(placeholder = tr("搜索订阅源名称或 RSS 地址")) {
    return html`<div class="search">
        ${icon("search", 16)}<input
            id="page-search"
            aria-label="${placeholder}"
            placeholder="${placeholder}"
            value="${esc(S.q)}"
            autocomplete="off"
        />
    </div>`;
}
const select = (id, entries, value) =>
    html`<select
        id="${id}"
        aria-label="${id === "kind-filter"
            ? tr("会话类型")
            : id === "visibility-filter"
              ? tr("会话显示范围")
              : tr("订阅状态")}"
    >
        ${entries
            .map(
                ([key, label]) =>
                    html`<option value="${key}" ${String(value) === String(key) ? "selected" : ""}>${label}</option>`,
            )
            .join("")}
    </select>`;
function pager(d) {
    return html`<div class="pager">
        <span
            >${message("pager", {
                total: n(d.total),
                page: n(d.page),
                pages: n(Math.max(1, Math.ceil(d.total / d.size))),
            })}</span
        >
        <div class="inline">
            <button data-page="${d.page - 1}" ${d.page <= 1 ? "disabled" : ""}>上一页</button
            ><button data-page="${d.page + 1}" ${d.page * d.size >= d.total ? "disabled" : ""}>下一页</button>
        </div>
    </div>`;
}

function targets(d) {
    return (
        header(
            tr("会话与频道"),
            tr("管理已接入机器人的会话，查看启用订阅并控制使用权限。"),
            html`<button class="primary" data-action="register">${icon("plus", 16)}添加已有会话</button>`,
        ) +
        html`<section class="panel">
                <div class="toolbar">
                    ${searchBox(tr("搜索名称、用户名或 ID"))}${select(
                        "kind-filter",
                        [
                            ["", tr("全部类型")],
                            ["private", tr("私聊")],
                            ["group", tr("群组")],
                            ["channel", tr("频道")],
                        ],
                        S.kind,
                    )}${select(
                        "visibility-filter",
                        [
                            ["unbanned", tr("未封禁")],
                            ["active", tr("活跃")],
                            ["inactive", tr("不活跃")],
                            ["banned", tr("已封禁")],
                            ["all", tr("全部")],
                        ],
                        S.visibility,
                    )}<span class="count">${count(d.total, "destination")}</span>
                </div>
                <p class="filter-help">
                    ${tr(
                        "默认隐藏已封禁会话；可选择“已封禁”或“全部”查看。机器人已退出或被移除的会话不再显示。活跃指未封禁且有已启用订阅和已启用订阅源的会话。",
                    )}
                </p>
                ${d.items.length
                    ? html`<div class="table-wrap">
                          <table class="chat-table">
                              <thead>
                                  <tr>
                                      <th>会话</th>
                                      <th>类型</th>
                                      <th>订阅数</th>
                                      <th title="${tr("达到管理台连续抓取失败阈值的启用订阅数")}">抓取异常</th>
                                      <th>机器人访问状态</th>
                                      <th></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${d.items
                                      .map(
                                          (item) =>
                                              html`<tr>
                                                  <td>
                                                      <div class="table-feed">
                                                          <div class="feed-mark">${icon(kindIcon[item.kind], 17)}</div>
                                                          <div class="feed-info">
                                                              <strong title="${esc(item.title)}"
                                                                  >${esc(item.title)}</strong
                                                              ><small
                                                                  >${item.username
                                                                      ? "@" + esc(item.username) + " · "
                                                                      : ""}${esc(item.id)}</small
                                                              >
                                                          </div>
                                                      </div>
                                                  </td>
                                                  <td>${targetKindName(item)}</td>
                                                  <td class="mono">
                                                      ${n(item.subscriptions)}<small class="enabled-subscriptions"
                                                          >${Number.isInteger(item.active_subscriptions)
                                                              ? message("enabledSubs", {
                                                                    count: n(item.active_subscriptions),
                                                                })
                                                              : tr("启用数未记录")}</small
                                                      >
                                                  </td>
                                                  <td>
                                                      ${item.attention
                                                          ? pill(item.attention, "warn")
                                                          : '<span class="muted">—</span>'}
                                                  </td>
                                                  <td>
                                                      ${pill(
                                                          item.state === -1
                                                              ? tr("已封禁")
                                                              : {
                                                                    available: tr("上次核验可发送"),
                                                                    joined: tr("已加入，发送权限待确认"),
                                                                    known: tr("已记录私聊"),
                                                                    left: tr("机器人已退出"),
                                                                    unknown: tr("尚未核验"),
                                                                    snapshot: tr("离线快照"),
                                                                }[item.membership] || tr("待同步"),
                                                          item.membership === "available" && item.state !== -1
                                                              ? ""
                                                              : "gray",
                                                      )}${item.checked_at && !S.snapshot
                                                          ? html`<small class="last-verified"
                                                                >${message("lastVerified", {
                                                                    time: dateText(item.checked_at),
                                                                })}</small
                                                            >`
                                                          : ""}
                                                  </td>
                                                  <td>
                                                      <div class="table-actions">
                                                          <button data-target-subs="${item.id}">管理订阅</button
                                                          ><button
                                                              data-target-edit="${item.id}"
                                                              aria-label="管理 ${esc(item.title)}"
                                                          >
                                                              ${icon("settings", 15)}会话设置
                                                          </button>
                                                      </div>
                                                  </td>
                                              </tr>`,
                                      )
                                      .join("")}
                              </tbody>
                          </table>
                      </div>`
                    : empty(
                          tr("没有符合条件的会话"),
                          tr("请调整搜索、类型或显示范围；没有会话记录时，可添加已与机器人建立联系的会话。"),
                      )}${pager(d)}
            </section>
            <p class="muted small page-note">
                ${S.snapshot
                    ? tr(
                          "会话名称来自 Telegram 本地缓存，可能已过时；缺失名称显示 ID。离线快照未记录的会话类型显示为“未知”；联网核验后会归入私聊、群组或频道。当前访问权限未联网验证。",
                      )
                    : tr(
                          "会话状态在启动核验和 Telegram 成员事件后更新。已加入不代表已确认发送权限；页面显示最近记录的状态，不会每次打开都实时查询 Telegram。类型缺失时仅显示“未知”，核验后归入私聊、群组或频道。",
                      )}
            </p>`
    );
}

function subscriptions(d) {
    return (
        header(
            S.attention ? tr("抓取异常的订阅") : tr("全部订阅"),
            S.target
                ? html`当前会话：${esc(d.items[0]?.target_title || S.target)}`
                : tr("查看未封禁会话的订阅，按订阅源、会话或状态筛选。已封禁会话的订阅可从该会话的“管理订阅”查看。"),
            newButton(),
        ) +
        html`<section class="panel">
            <div class="toolbar">
                ${searchBox()}${select(
                    "status-filter",
                    [
                        ["", tr("全部状态")],
                        ["1", tr("已启用")],
                        ["0", tr("已暂停")],
                    ],
                    S.status,
                )}<button data-action="filter-target" class="small">${icon("chats", 14)}按会话筛选</button
                >${d.items.some((i) => i.feed_id)
                    ? html`<a
                          class="button-link"
                          href="${filteredExportURL()}"
                          download
                          title="${tr("导出当前筛选的全部页，相同 RSS 地址合并；不含接收会话与推送设置。")}"
                          >导出筛选订阅源（OPML）</a
                      >`
                    : S.target
                      ? html`<a class="button-link" href="/api/targets/${encodeURIComponent(S.target)}/opml" download
                            >导出订阅源（OPML）</a
                        >`
                      : ""}<button data-action="toggle-attention" class="${S.attention ? "primary" : ""} small">
                    ${icon("alert", 14)}仅看抓取异常</button
                >${S.target
                    ? tr('<button class="quiet small" data-action="clear-target">清除会话筛选 ×</button>')
                    : ""}<span class="count">${count(d.total, "subscription")}</span>
            </div>
            ${S.selected.size
                ? html`<div class="bulkbar">
                      <span>${message("selectedSubs", { count: n(S.selected.size) })}</span
                      ><button data-batch="pause">暂停所选订阅</button><button data-batch="resume">恢复所选订阅</button
                      ><button class="danger" data-batch="delete">取消所选订阅</button>${d.items.some((i) => i.feed_id)
                          ? html`<a
                                class="button-link"
                                href="${filteredExportURL([...S.selected])}"
                                download
                                title="${tr("相同 RSS 地址合并；不含接收会话与推送设置。")}"
                                >导出所选订阅源（OPML）</a
                            >`
                          : ""}<button class="quiet" data-action="clear-selection">清空选择</button>
                  </div>`
                : ""}${d.items.length
                ? html`<div class="table-wrap">
                      <table>
                          <thead>
                              <tr>
                                  <th class="selection">
                                      <input
                                          type="checkbox"
                                          id="select-page"
                                          aria-label="全选本页"
                                          ${d.items.every((i) => S.selected.has(i.id)) ? "checked" : ""}
                                      />
                                  </th>
                                  <th>订阅源</th>
                                  <th>接收会话</th>
                                  <th>状态</th>
                                  <th>检查间隔</th>
                                  <th></th>
                              </tr>
                          </thead>
                          <tbody>
                              ${d.items
                                  .map(
                                      (item) =>
                                          html`<tr>
                                              <td>
                                                  <input
                                                      type="checkbox"
                                                      data-select="${item.id}"
                                                      aria-label="选择 ${esc(item.title)}"
                                                      ${S.selected.has(item.id) ? "checked" : ""}
                                                  />
                                              </td>
                                              <td>
                                                  <div class="table-feed">
                                                      ${feedMark(item.title)}
                                                      <div class="feed-info">
                                                          <strong>${esc(item.title)}</strong
                                                          ><small title="${esc(item.url)}">${esc(item.url)}</small>
                                                      </div>
                                                  </div>
                                              </td>
                                              <td>${esc(item.target_title)}</td>
                                              <td>
                                                  ${pill(
                                                      item.state === 0
                                                          ? tr("已暂停")
                                                          : item.errors
                                                            ? message("fetchFailures", { count: n(item.errors) })
                                                            : S.snapshot
                                                              ? tr("已启用")
                                                              : tr("已启用"),
                                                      item.state === 0 ? "gray" : item.errors ? "warn" : "",
                                                  )}
                                              </td>
                                              <td class="muted">${n(item.effective_interval)} 分钟</td>
                                              <td>
                                                  <div class="table-actions">
                                                      <button
                                                          data-sub-toggle="${item.id}"
                                                          title="${item.state ? tr("暂停订阅") : tr("恢复订阅")}"
                                                          aria-label="${item.state
                                                              ? tr("暂停订阅")
                                                              : tr("恢复订阅")} ${esc(item.title)}"
                                                      >
                                                          ${icon(item.state ? "pause" : "play", 15)}${item.state
                                                              ? tr("暂停订阅")
                                                              : tr("恢复订阅")}</button
                                                      ><button
                                                          data-sub-edit="${item.id}"
                                                          aria-label="编辑 ${esc(item.title)}"
                                                      >
                                                          ${icon("edit", 15)}编辑</button
                                                      ><button
                                                          data-sub-delete="${item.id}"
                                                          aria-label="取消订阅 ${esc(item.title)}"
                                                      >
                                                          ${icon("trash", 15)}取消订阅
                                                      </button>
                                                  </div>
                                              </td>
                                          </tr>`,
                                  )
                                  .join("")}
                          </tbody>
                      </table>
                  </div>`
                : empty(
                      S.attention ? tr("目前没有需要检查的订阅") : tr("没有符合条件的订阅"),
                      S.attention
                          ? tr("偶发失败会自动重试，连续失败达到设置的次数后才会出现在这里。")
                          : tr("试试调整筛选，或添加一个新的 RSS 地址。"),
                  )}${pager(d)}
        </section>`
    );
}

function settings(d, tokens, security, feature) {
    const o = d.options;
    const settingRow = (key, label, hint, min = 1, max = 32767, value = o[key]) =>
        html`<div class="form-row">
            <label for="setting-${key}"
                >${label}
                <p>${hint}</p></label
            ><input
                id="setting-${key}"
                name="${key}"
                type="number"
                min="${min}"
                max="${max}"
                value="${value}"
                required
            />
        </div>`;
    let content = "";
    if (S.settings === "general")
        content = html`<form id="settings-form" class="panel">
            <div class="panel-head">
                <div>
                    <h2>更新与订阅</h2>
                    <p>全局订阅默认值和管理台抓取异常标记</p>
                </div>
            </div>
            <div class="form-body">
                ${settingRow(
                    "default_interval",
                    tr("默认更新间隔"),
                    tr("单位：分钟。影响使用默认值的订阅。"),
                )}${settingRow(
                    "minimal_interval",
                    tr("最短更新间隔"),
                    tr("单位：分钟。限制今后设置的更新间隔。"),
                )}${settingRow(
                    "user_sub_limit",
                    tr("私聊订阅上限"),
                    tr("-1 表示不限，0 表示不允许添加。"),
                    -1,
                )}${settingRow(
                    "channel_or_group_sub_limit",
                    tr("频道 / 群组订阅上限"),
                    tr("每个频道或群组的默认订阅上限。-1 表示不限，0 禁止新增。"),
                    -1,
                )}${settingRow(
                    "attention_threshold",
                    tr("管理台抓取异常阈值"),
                    tr("只影响管理台异常列表，不控制外部通知发送，也不改变抓取重试策略。"),
                    1,
                    100,
                    d.console.attention_threshold,
                )}
                <div class="form-row">
                    <label for="limit-message"
                        >订阅上限提示
                        <p>达到上限时机器人显示的附加说明。</p></label
                    ><textarea id="limit-message" name="sub_limit_reached_message" maxlength="2000">
${esc(o.sub_limit_reached_message)}</textarea
                    >
                </div>
            </div>
            <div class="form-footer"><button class="primary" type="submit">保存设置</button></div>
        </form>`;
    if (S.settings === "tokens")
        content = html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>API 访问令牌</h2>
                    <p>授权 Agent 或外部应用读取、管理所选会话的订阅</p>
                </div>
                <button class="primary" data-action="new-token">${icon("plus", 14)}创建令牌</button>
            </div>
            ${tokens.items.length
                ? tokens.items
                      .map(
                          (t) =>
                              html`<div class="token-row">
                                  ${icon("key", 20)}
                                  <div>
                                      <p>
                                          ${esc(t.name)}
                                          ${pill(
                                              t.permission === "write" ? tr("读取和修改订阅") : tr("仅读取订阅"),
                                              "gray",
                                          )}
                                      </p>
                                      <small
                                          >${t.targets === null
                                              ? tr("全部会话（包括今后新增）")
                                              : html`${count(t.targets.length, "selectedDestination")}`}
                                          · ${dateText(t.expires_at * 1000)} 到期</small
                                      >
                                  </div>
                                  <button class="danger" data-revoke="${esc(t.id)}">撤销</button>
                              </div>`,
                      )
                      .join("")
                : empty(tr("尚未创建 API 访问令牌"), tr("为 Agent 或外部应用创建专用令牌，并限制可访问的会话。"))}
            <div class="form-body">
                <div class="notice">
                    令牌仅允许访问所选会话的订阅，不包含用户角色、全局设置、备份或令牌管理。完整令牌只显示一次。
                </div>
                ${S.features.security
                    ? html`<p>
                          <a class="text-link" href="/api/openapi.json" download="rsstt-openapi.json"
                              >下载 API 接口说明（OpenAPI）</a
                          >
                      </p>`
                    : ""}
            </div>
        </section>`;
    if (S.settings === "instance")
        content = html`<section class="panel">
            <div class="panel-head"><h2>实例信息</h2></div>
            <div class="form-body">
                <dl class="info-grid">
                    <div>
                        <dt>机器人</dt>
                        <dd>${esc(d.bot.name)} · @${esc(d.bot.username || tr("未设置"))}</dd>
                    </div>
                    <div>
                        <dt>连接状态</dt>
                        <dd>
                            ${S.snapshot
                                ? tr("真实数据离线预览")
                                : d.demo
                                  ? tr("离线演示")
                                  : d.bot.connected
                                    ? tr("在线")
                                    : tr("未连接")}
                        </dd>
                    </div>
                    <div>
                        <dt>管理台地址</dt>
                        <dd>${esc(d.origin)}</dd>
                    </div>
                    <div>
                        <dt>RSStT 数据库</dt>
                        <dd>${esc(d.database)}</dd>
                    </div>
                    <div>
                        <dt>${S.snapshot ? tr("快照时间") : tr("统计开始时间")}</dt>
                        <dd>${dateText(S.snapshot ? S.snapshot.captured_at : d.console.started_at)}</dd>
                    </div>
                    <div>
                        <dt>统计存储</dt>
                        <dd>${S.snapshot ? tr("快照不含历史统计") : tr("独立 SQLite · 累计值永久保留")}</dd>
                    </div>
                </dl>
                <div class="notice">
                    机器人连接配置可在运行配置中保存，重启后生效；管理台密码在账户安全中修改。敏感值不会在页面回显。
                </div>
            </div>
        </section>`;
    if (feature) content = featureSettings(S.settings, feature);
    if (S.settings === "security" && security) {
        const [account, sessions] = security;
        content = html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>账户安全</h2>
                    <p>${esc(account.username)}</p>
                </div>
            </div>
            <form id="password-form" class="form-body stack">
                <label
                    >当前密码<input
                        name="current_password"
                        type="password"
                        autocomplete="current-password"
                        required /></label
                ><label
                    >新密码<input
                        name="new_password"
                        type="password"
                        autocomplete="new-password"
                        minlength="16"
                        maxlength="512"
                        required
                /></label>
                <p class="hint">
                    ${tr("至少 16 个字符。修改后所有网页登录会话（包括当前窗口）将退出，API 访问令牌保持有效。")}
                </p>
                <p class="error" role="alert"></p>
                <div><button type="submit" class="primary">修改密码并退出</button></div>
            </form>
            <div class="form-body">
                <h2>网页登录会话</h2>
                <p>${n(sessions.items.length)} ${tr("个有效的网页登录会话")}</p>
                <button class="danger" data-action="revoke-sessions">退出所有网页登录会话</button>
            </div>
        </section>`;
    }
    return (
        header(tr("设置"), tr("熟悉的管理方式，按需调整。")) +
        html`<div class="settings">
            <nav class="settings-nav" aria-label="设置栏目">
                ${[
                    ["general", "settings", tr("更新与订阅")],
                    ["tokens", "key", tr("API 访问令牌")],
                    ...["runtime", "notifications", "backups"]
                        .filter((key) => S.features[key])
                        .map((key) => [
                            key,
                            { runtime: "settings", notifications: "alert", backups: "down" }[key],
                            tr({ runtime: "运行配置", notifications: "通知", backups: "备份与恢复" }[key]),
                        ]),
                    ["instance", "rss", tr("实例信息")],
                    ...(["console_admin", "preview_admin"].includes(S.session.account_type)
                        ? [["security", "key", tr("账户安全")]]
                        : []),
                ]
                    .map(
                        ([key, i, label]) =>
                            html`<button data-settings="${key}" class="${S.settings === key ? "active" : ""}">
                                ${icon(i, 16)}${label}
                            </button>`,
                    )
                    .join("")}
            </nav>
            <div class="settings-content">${content}</div>
        </div>`
    );
}

function modal(title, body, footer = tr('<button type="button" data-action="close">关闭</button>')) {
    const d = $("#dialog");
    d.innerHTML = html`<form id="modal-form">
        <div class="dialog-head">
            <h2 id="dialog-title">${esc(title)}</h2>
            <button type="button" class="quiet" data-action="close" aria-label="关闭">${icon("close", 19)}</button>
        </div>
        <div class="dialog-body">
            ${body}
            <p class="dialog-error" role="alert"></p>
        </div>
        <div class="dialog-footer">${footer}</div>
    </form>`;
    if (!d.open) d.showModal();
    syncTableHints();
}
const saveFooter = (text) =>
    html`<button type="button" data-action="close">取消</button><button class="primary" type="submit">${text}</button>`;
const formatLabels = {
    notify: [
        tr("Telegram 推送声音"),
        [
            [1, tr("正常提示")],
            [0, tr("静默发送")],
        ],
    ],
    send_mode: [
        tr("推送格式"),
        [
            [0, tr("自动选择格式")],
            [-1, tr("仅标题与出处")],
            [1, tr("始终使用 Telegraph")],
            [2, tr("始终使用 Telegram 消息")],
        ],
    ],
    link_preview: [
        tr("链接预览"),
        [
            [0, tr("自动")],
            [1, tr("显示")],
            [-1, tr("隐藏")],
        ],
    ],
    display_media: [
        tr("文章媒体"),
        [
            [0, tr("显示")],
            [1, tr("仅发送有媒体的文章")],
            [-1, tr("隐藏")],
        ],
    ],
    display_author: [
        tr("作者"),
        [
            [0, tr("自动")],
            [1, tr("显示")],
            [-1, tr("隐藏")],
        ],
    ],
    display_title: [
        tr("标题"),
        [
            [0, tr("自动")],
            [1, tr("显示")],
            [-1, tr("隐藏")],
        ],
    ],
    display_via: [
        tr("原文出处显示方式"),
        [
            [0, tr("显示订阅源名称及原文链接")],
            [1, tr("标题链接到原文，另显示订阅源名称")],
            [-1, tr("结尾显示原文链接，不显示订阅源名称")],
            [-2, tr("完全隐藏")],
            [-3, tr("标题链接到原文，不显示订阅源名称")],
            [-4, tr("结尾显示原文网址，不显示订阅源名称")],
        ],
    ],
    display_entry_tags: [
        tr("文章自带标签"),
        [
            [1, tr("显示")],
            [-1, tr("隐藏")],
        ],
    ],
    style: [
        tr("消息排版样式"),
        [
            [0, "RSStT"],
            [1, "flowerss"],
        ],
    ],
};
function formatFields(o, isSub) {
    const field = (key, label, entries) =>
        html`<label
            >${label}<select name="${key}">
                ${(isSub ? [[-100, tr("继承会话默认值")], ...entries] : entries)
                    .map(([v, t]) => html`<option value="${v}" ${o[key] === v ? "selected" : ""}>${t}</option>`)
                    .join("")}
            </select></label
        >`;
    return html`<div class="field-grid">
            <label
                >检查间隔（分钟）<input
                    type="number"
                    name="interval"
                    min="1"
                    max="32767"
                    placeholder="留空使用默认间隔"
                    value="${o.interval ?? ""}"
                /><span class="hint"
                    >${isSub
                        ? tr("留空使用会话默认间隔；抓取时会与其他接收会话共享同一订阅源。")
                        : tr("留空使用全局默认间隔；仅影响继承此会话默认值的订阅。")}</span
                ></label
            >${field("send_mode", ...formatLabels.send_mode)}
        </div>
        <p class="hint">${tr("自动格式按文章长度和媒体选择发送方式；强制 Telegram 可能拆分为多条消息。")}</p>
        <details class="format-explanation">
            <summary>${tr("推送格式说明")}</summary>
            <p class="hint">
                ${tr(
                    "仅发送有媒体的文章：无媒体的文章会跳过；标题、作者和出处仍按各自设置显示。自动标题只显示非自动补全的标题；自动作者在名称未包含于订阅源标题时显示。已启用标题和出处时，RSStT 通常为“文章标题 → 正文 → 出处”，flowerss 为“订阅源名称 → 文章标题 → 正文 → 出处”。",
                )}
            </p>
        </details>
        <details>
            <summary>更多推送与排版设置</summary>
            <div class="field-grid">
                ${Object.entries(formatLabels)
                    .filter(([k]) => k !== "send_mode")
                    .map(([k, [l, v]]) => field(k, l, v))
                    .join("")}<label
                    >自动模式的转 Telegraph 长度阈值（字符）<input
                        name="length_limit"
                        type="number"
                        min="${isSub ? -100 : 0}"
                        max="4096"
                        value="${o.length_limit}"
                    /><span class="hint"
                        >${tr(
                            "仅在自动格式下生效；达到阈值时转为 Telegraph。0 表示不额外限制，仍受 Telegram 消息长度限制。",
                        )}${isSub ? tr("-100 表示继承会话默认值。") : ""}</span
                    ></label
                >
            </div>
        </details>`;
}

async function targetPicker(multiple = false) {
    const serial = ++pickerSerial;
    const context = modalState;
    modalState.multiple = multiple;
    modalState.chosen = new Set(modalState.chosen || []);
    const data = await api(
        "/targets?size=50&visibility=unbanned&q=" + encodeURIComponent($("#picker-search")?.value || ""),
    );
    if (!$("#target-picker") || serial !== pickerSerial || context !== modalState) return;
    $("#target-picker").innerHTML = data.items.length
        ? data.items
              .map(
                  (i) =>
                      html`<label class="target-choice"
                          ><input
                              type="${multiple ? "checkbox" : "radio"}"
                              name="target-choice"
                              value="${i.id}"
                              ${modalState.chosen.has(i.id) ? "checked" : ""}
                          /><span class="target-choice-main"
                              >${icon(kindIcon[i.kind], 15)}<span class="target-choice-name" title="${esc(i.title)}"
                                  >${esc(i.title)}</span
                              ></span
                          ><small class="target-choice-kind">${targetKindName(i)}</small></label
                      >`,
              )
              .join("")
        : empty(
              tr("没有匹配的会话"),
              $("#picker-search")?.value
                  ? tr("请调整会话名称、用户名或 ID 后重试。")
                  : tr("机器人需要先与用户建立联系，或加入群组、频道；然后可在“会话与频道”添加已有会话。"),
          );
    $("#picker-hint").textContent =
        message("pickerSummary", { total: n(data.total) }) +
        (data.total > 50 ? " · " + tr("仅显示前 50 个，请继续搜索缩小范围。") : "") +
        (multiple ? " · " + message("pickerSelected", { count: n(modalState.chosen.size) }) : "");
}
const pickerHtml = (multiple, purpose = "receiving") => {
    const label =
        purpose === "filter"
            ? tr("选择要查看订阅的会话")
            : purpose === "authorization"
              ? tr("选择允许管理的会话")
              : multiple
                ? tr("选择接收会话（可多选）")
                : tr("选择接收会话");
    return html`<label
            >${label}<input id="picker-search" placeholder="${tr("搜索会话名称、用户名或 ID")}" autocomplete="off"
        /></label>
        <div class="target-choices" id="target-picker"></div>
        <span class="hint" id="picker-hint"></span>`;
};

async function newSub() {
    modalState = { action: "new-sub", chosen: S.target ? [S.target] : [] };
    modal(
        tr("添加订阅"),
        pickerHtml(false) +
            html`<label
                >订阅源地址（RSS/Atom）<textarea
                    name="urls"
                    required
                    placeholder="https://example.com/feed.xml&#10;可以粘贴多个地址，每行一个"
                ></textarea
                ><span class="hint"
                    >每次最多 100
                    个。所选会话已经订阅的地址会跳过，保留原设置；其他会话可以订阅同一地址。${S.snapshot
                        ? tr(" 离线新增不会读取 RSS 内容或校验地址。")
                        : ""}</span
                ></label
            >`,
        saveFooter(tr("添加订阅")),
    );
    await targetPicker();
}
function editSub(item) {
    modalState = { action: "edit-sub", item };
    modal(
        tr("订阅设置"),
        html`<div class="notice">${esc(item.url)}<br />接收会话：${esc(item.target_title)}</div>
            ${item.feed_id
                ? html`<div class="inline">
                      <button type="button" data-feed-recipients="${item.feed_id}">管理接收会话</button
                      ><button type="button" data-feed-fetch="${item.feed_id}">订阅源请求设置</button>
                  </div>`
                : ""}<label
                >此订阅的显示名称<input
                    name="title"
                    value="${esc(item.custom_title || "")}"
                    maxlength="1024"
                    placeholder="留空使用订阅源名称" /></label
            ><label
                >推送附加标签<input
                    name="tags"
                    value="${esc(item.tags || "")}"
                    maxlength="255"
                    placeholder="以空格分隔" /></label
            >${formatFields(item.options, true)}`,
        saveFooter(tr("保存设置")),
    );
}
const activityActions = {
    "subscriptions.add": "添加订阅",
    "subscriptions.remove": "取消订阅",
    "subscriptions.update": "修改订阅设置",
    "subscriptions.batch": "批量处理订阅",
    "subscriptions.import": "导入订阅",
    "subscriptions.reset": "重置订阅设置",
    "subscriptions.list": "查看订阅列表",
    "subscriptions.export": "导出订阅",
    "subscriptions.settings": "查看订阅设置",
    "settings.update": "修改会话设置",
    "settings.view": "查看会话设置",
    "role.update": "修改 Bot 用户角色",
    "role.view": "查看 Bot 用户角色",
    "language.update": "修改 Bot 回复语言",
    "language.view": "查看 Bot 回复语言",
    "recipients.update": "修改接收会话",
    "destination.settings": "修改会话推送默认值",
    "destination.leave": "让机器人退出",
    "destination.refresh": "核验会话信息",
    "destination.register": "登记已有会话",
    "destination.join": "机器人加入会话",
    "bot.start": "Bot 命令 /start",
    "bot.help": "Bot 命令 /help",
    "bot.version": "Bot 命令 /version",
    "bot.test": "Bot 测试命令",
    "bot.inline": "Bot 内联操作",
    "bot.callback": "Bot 按钮操作",
    "bot.other": "其他 Bot 操作",
    "bot.lifecycle": "机器人会话关系变更",
    "command.list": "Bot 命令 /list",
};
const activityFields = {
    state: "状态",
    role: "Bot 用户角色",
    lang: "Bot 回复语言",
    interval: "检查间隔（分钟）",
    sub_limit: "订阅上限",
    title: "订阅显示名称",
    tags: "推送附加标签",
    notify: "Telegram 推送声音",
    send_mode: "推送格式",
    length_limit: "Telegraph 长度阈值",
    link_preview: "链接预览",
    display_author: "作者显示",
    display_via: "原文出处显示方式",
    display_title: "标题显示",
    display_entry_tags: "文章自带标签",
    display_media: "文章媒体",
    style: "消息排版样式",
    membership: "机器人访问状态",
    kind: "会话类型",
    subscriptions_count: "订阅总数",
    exists: "记录是否存在",
    feed_id: "订阅源 ID",
};
function activityValue(change, value) {
    if (value === null || value === undefined) return tr("未设置");
    if (change.field === "state") {
        const values =
            change.entity === "subscription"
                ? { 0: "已暂停", 1: "已启用" }
                : { [-1]: "已封禁", 0: "访客", 1: "普通用户", 50: "普通用户", 51: "普通用户", 100: "Bot 管理员" };
        if (Object.hasOwn(values, value)) return tr(values[value]);
    }
    if (change.field === "role" && ["banned", "guest", "user", "admin", "manager"].includes(value))
        return roleName(value);
    if (change.field === "lang") {
        if (value === "null") return tr("自动识别");
        try {
            return languageNames.of(String(value)) || String(value);
        } catch {
            return String(value);
        }
    }
    if (change.field === "membership") {
        const labels = {
            available: "上次核验可发送",
            joined: "已加入，发送权限待确认",
            known: "已记录私聊",
            left: "机器人已退出",
            banned: "机器人已被移除",
            disabled: "已禁用",
            unknown: "未知",
            snapshot: "离线快照",
        };
        return Object.hasOwn(labels, value) ? tr(labels[value]) : String(value);
    }
    if (change.field === "kind") return kindName[value] || tr("未知");
    if (value === -100) return tr("继承会话默认值");
    if (Object.hasOwn(formatLabels, change.field)) {
        const option = formatLabels[change.field][1].find(([code]) => code === value);
        if (option) return option[1];
    }
    if (change.field === "exists") return tr(value ? "存在" : "已移除");
    if (typeof value === "boolean") return tr(value ? "是" : "否");
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function chatActivityContent(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    return html`<p class="hint">
            ${tr(
                "仅记录本版本启用后的 Bot 命令、管理操作和设置变更，保留有限的近期记录。不记录普通聊天内容或密钥，升级前的日志无法补回。",
            )}
        </p>
        ${data.degraded
            ? html`<p class="notice warning">
                  ${tr("会话记录存储暂不可用，当前显示可能不完整。请检查服务日志后重试。")}
              </p>`
            : ""}
        ${items.length
            ? html`<div class="chat-activity-list">
                  ${items
                      .map((item) => {
                          const source = { bot: "Bot", web: "管理台", agent: "API" }[item.source];
                          const action = Object.hasOwn(activityActions, item.action)
                              ? tr(activityActions[item.action])
                              : String(item.action || "");
                          const outcomes = { completed: "已完成", denied: "已拒绝", error: "执行失败" };
                          const outcome = Object.hasOwn(outcomes, item.outcome)
                              ? tr(outcomes[item.outcome])
                              : String(item.outcome || "");
                          const actor =
                              item.actor === "administrator"
                                  ? tr("管理台管理员")
                                  : item.actor === "anonymous"
                                    ? tr("未记录发起人")
                                    : String(item.actor ?? tr("未记录发起人"));
                          const changes = Array.isArray(item.changes) ? item.changes : [];
                          return html`<article class="chat-activity-entry">
                              <div class="spread">
                                  <time>${esc(dateText(item.at))}</time>
                                  <div class="inline">
                                      ${pill(source ? tr(source) : String(item.source || ""), "gray")}${pill(
                                          outcome,
                                          item.outcome === "completed" ? "" : "warn",
                                      )}
                                  </div>
                              </div>
                              <strong>${esc(action)}</strong>
                              <p class="hint">${message("activityActor", { actor: esc(actor) })}</p>
                              ${changes.length
                                  ? html`<details>
                                        <summary>${message("activityChanges", { count: n(changes.length) })}</summary>
                                        <div class="table-wrap">
                                            <table class="change-table">
                                                <thead>
                                                    <tr>
                                                        <th>设置项</th>
                                                        <th>变更前</th>
                                                        <th>变更后</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${changes
                                                        .map(
                                                            (change) =>
                                                                html`<tr>
                                                                    <th>
                                                                        <span
                                                                            >${esc(
                                                                                Object.hasOwn(
                                                                                    activityFields,
                                                                                    change.field,
                                                                                )
                                                                                    ? tr(activityFields[change.field])
                                                                                    : String(change.field || ""),
                                                                            )}</span
                                                                        ><small class="hint"
                                                                            >${tr(
                                                                                change.entity === "subscription"
                                                                                    ? "订阅"
                                                                                    : "会话",
                                                                            )}${change.entity === "subscription"
                                                                                ? " #" + esc(change.id)
                                                                                : ""}</small
                                                                        >
                                                                    </th>
                                                                    <td>
                                                                        <span class="change-value"
                                                                            >${esc(
                                                                                activityValue(change, change.before),
                                                                            )}</span
                                                                        >
                                                                    </td>
                                                                    <td>
                                                                        <span class="change-value"
                                                                            >${esc(
                                                                                activityValue(change, change.after),
                                                                            )}</span
                                                                        >
                                                                    </td>
                                                                </tr>`,
                                                        )
                                                        .join("")}
                                                </tbody>
                                            </table>
                                        </div>
                                    </details>`
                                  : html`<p class="hint">${tr("本条记录没有设置变更详情。")}</p>`}
                              ${item.truncated ? html`<p class="hint">${tr("本条记录仅保留了部分变更详情。")}</p>` : ""}
                          </article>`;
                      })
                      .join("")}
              </div>`
            : empty(
                  tr(data.degraded ? "当前没有可显示的会话记录" : "尚无此会话的操作记录"),
                  tr("记录从本版本启用后开始；升级前的交互和设置变更无法从旧日志补回。"),
              )}
        <div class="pager">
            <span
                >${message("pager", {
                    total: n(data.total || 0),
                    page: n(data.page || 1),
                    pages: n(Math.max(1, Math.ceil((data.total || 0) / (data.size || 20)))),
                })}</span
            >
            <div class="inline">
                <button
                    type="button"
                    data-activity-page="${(data.page || 1) - 1}"
                    ${(data.page || 1) <= 1 ? "disabled" : ""}
                >
                    上一页</button
                ><button
                    type="button"
                    data-activity-page="${(data.page || 1) + 1}"
                    ${(data.page || 1) * (data.size || 20) >= (data.total || 0) ? "disabled" : ""}
                >
                    下一页
                </button>
            </div>
        </div>`;
}
async function showChatActivity(id, title, page = 1) {
    const context = { action: "chat-activity", id: String(id), title: String(title), page: Math.max(1, page || 1) };
    modalState = context;
    const heading = message("chatActivityTitle", { name: context.title });
    modal(heading, html`<p role="status">${tr("正在加载会话记录…")}</p>`);
    try {
        const data = await api(
            `/targets/${encodeURIComponent(context.id)}/activity?` +
                new URLSearchParams({ page: context.page, size: 20 }),
        );
        if (modalState !== context || !$("#dialog").open) return;
        modal(heading, chatActivityContent(data));
        $("#dialog [data-action=close]").focus({ preventScroll: true });
    } catch (error) {
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            heading,
            html`<p class="notice warning" role="alert">${esc(error.message)}</p>
                <button type="button" data-activity-page="${context.page}">重试加载记录</button>`,
        );
        $("#dialog [data-activity-page]").focus({ preventScroll: true });
    }
}
function chatServiceControls(item) {
    const active = Number.isInteger(item.active_subscriptions) ? item.active_subscriptions : null;
    return html`<section class="service-controls" aria-label="${tr("服务控制")}">
        <h3>服务控制</h3>
        <div class="spread">
            <span>Bot 用户角色：${esc(roleName(item.role))}</span>${item.role_protected
                ? html`<span class="hint">机器人管理者受保护</span>`
                : html`<button type="button" data-role-target="${item.id}">修改角色</button>`}
        </div>
        <p>
            ${pill(
                tr(active === null ? "启用数未记录" : active > 0 ? "有启用订阅" : "尚无启用订阅"),
                active ? "" : "gray",
            )}${active === null
                ? ""
                : html` <span class="hint"
                      >${message("chatEnabledCount", { total: n(item.subscriptions), enabled: n(active) })}</span
                  >`}
        </p>
        ${item.role === "banned"
            ? html`<p class="notice">
                  ${tr("此会话已停止服务并封禁，订阅保持暂停。解除封禁后不会自动恢复订阅，请在管理订阅中手动恢复。")}
              </p>`
            : item.role_protected
              ? ""
              : html`<div>
                        <button type="button" class="danger" data-stop-service="${item.id}">停止服务并封禁</button>
                    </div>
                    <p class="hint">
                        ${tr(
                            "暂停该会话的全部订阅并拒绝其常规命令，保留已有订阅和设置；不会自动让机器人退出群组或频道。",
                        )}
                    </p>`}
        <div class="inline">
            ${S.features.chat_activity
                ? html`<button type="button" data-target-activity="${item.id}">查看会话记录</button>`
                : ""}${item.id.startsWith("-")
                ? html`<button type="button" class="danger small" data-leave-target="${item.id}">让机器人退出</button>`
                : ""}
        </div>
        ${item.id.startsWith("-")
            ? html`<p class="hint">让机器人退出此群组或频道后，保留本地订阅记录并暂停该会话的订阅。</p>`
            : ""}
    </section>`;
}
function editTarget(item) {
    modalState = { action: "edit-target", item };
    modal(
        item.title,
        html`<div class="spread">
                <span class="muted mono small">${esc(item.id)} · ${targetKindName(item)}</span
                ><button type="button" data-refresh-target="${item.id}" class="small">
                    ${icon("refresh", 13)}更新 Telegram 会话信息
                </button>
            </div>
            ${chatServiceControls(item)}
            <section class="chat-defaults">
                <h3>推送默认值</h3>
                <p class="hint">${tr("以下默认值仅影响继承此会话设置的订阅；尚无启用订阅不等于不能使用机器人。")}</p>
                <div class="inline">
                    <a class="text-link" href="/api/targets/${item.id}/opml" download>导出订阅源（OPML）</a
                    ><button type="button" class="text-link" data-import-target="${item.id}">导入 OPML</button>
                </div>
                <label
                    >此会话的订阅上限<input
                        name="sub_limit"
                        type="number"
                        min="-1"
                        max="32767"
                        value="${item.sub_limit ?? ""}"
                        placeholder="使用实例默认值"
                    /><span class="hint">-1 表示不限，0 禁止新增；留空使用全局上限，不删除现有订阅。</span></label
                >
                ${item.lang !== undefined
                    ? html`<label
                          >Bot 回复语言<select name="lang">
                              ${[
                                  ["null", tr("自动识别")],
                                  ...botLanguages,
                                  ...(item.lang &&
                                  !botLanguages.some(([code]) => code === item.lang) &&
                                  item.lang !== "null"
                                      ? [[item.lang, item.lang]]
                                      : []),
                              ]
                                  .map(
                                      ([value, label]) =>
                                          html`<option
                                              value="${esc(value)}"
                                              ${(item.lang || "null") === value ? "selected" : ""}
                                          >
                                              ${esc(label)}
                                          </option>`,
                                  )
                                  .join("")}</select
                          ><span class="hint">Bot 回复语言与管理台界面语言独立。自动识别沿用原版语言规则。</span></label
                      >`
                    : ""}
                ${formatFields(item.options, false)}
            </section>`,
        saveFooter(tr("保存会话默认设置")),
    );
}

function confirmation(title, description, action, extra = {}) {
    modalState = { action, ...extra };
    modal(
        title,
        html`<p>${esc(description)}</p>
            ${action === "leave"
                ? html`<label
                      >输入会话 ID 确认<input name="confirm" required placeholder="${esc(extra.id)}" autocomplete="off"
                  /></label>`
                : ""}`,
        saveFooter(
            tr(
                {
                    "delete-sub": "取消这条订阅",
                    batch:
                        extra.batchAction === "pause"
                            ? "暂停所选订阅"
                            : extra.batchAction === "resume"
                              ? "恢复所选订阅"
                              : "取消所选订阅",
                    revoke: "撤销令牌",
                    "revoke-sessions": "退出所有网页登录会话",
                    leave: "让机器人退出",
                    "notify-test": S.demo ? "执行离线模拟" : "发送测试通知",
                    "notify-delete": "删除此渠道配置",
                    "cancel-restore": "取消已安排的恢复",
                    "stop-service": "确认停止服务并封禁",
                }[action] || "确认操作",
            ),
        ),
    );
}
function resultModal(result) {
    const failed = result.results.filter((r) => r.status === "failed" || r.ok === false).length;
    const skipped = result.results.filter((r) => r.status === "existing").length;
    modalState = { action: "done" };
    modal(
        failed ? tr("处理完成，部分条目未成功") : tr("处理完成"),
        html`<div class="notice">
                ${message("resultCounts", {
                    completed: n(result.results.length - failed - skipped),
                    skipped: n(skipped),
                    failed: n(failed),
                })}
            </div>
            <div class="result-list">
                ${result.results
                    .map(
                        (r) =>
                            html`<div class="result-item">
                                ${pill(
                                    r.status === "existing"
                                        ? tr("已订阅，已跳过")
                                        : r.status === "failed" || r.ok === false
                                          ? tr("失败")
                                          : tr("操作完成"),
                                    r.status === "failed" || r.ok === false ? "warn" : "",
                                )}
                                <div>
                                    ${esc(r.url || tr("订阅 #") + r.id)}${r.message || r.error
                                        ? html`<small
                                              >${esc(
                                                  r.ok === false || r.status === "failed"
                                                      ? errorText({ ...r, error: r.error || r.message }, 400)
                                                      : r.message || r.error,
                                              )}</small
                                          >`
                                        : ""}
                                </div>
                            </div>`,
                    )
                    .join("")}
            </div>`,
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
            b.setAttribute("aria-expanded", String(!document.body.classList.contains("menu-open")));
            document.body.classList.toggle("menu-open");
            $$(".mobile-menu").forEach((el) =>
                el.setAttribute("aria-expanded", String(document.body.classList.contains("menu-open"))),
            );
            if (document.body.classList.contains("menu-open")) $(".sidebar .nav a")?.focus();
            return;
        }
        if (d.action === "logout") {
            await api("/logout", { method: "POST" });
            S.session = null;
            login();
            return;
        }
        if (d.action === "revoke-sessions") {
            return confirmation(
                tr("退出所有网页登录会话"),
                tr("所有网页登录会话（包括当前窗口）将退出，API 访问令牌保持有效。"),
                "revoke-sessions",
            );
        }
        if (d.action === "retry") return render();
        if (d.period) {
            S.period = Number(d.period);
            S.granularity = S.period === 24 ? "hour" : "day";
            return render(true);
        }
        if (d.page) {
            S.page = Number(d.page);
            S.selected.clear();
            return render(true);
        }
        if (d.settings) {
            S.settings = d.settings;
            return render(true);
        }
        if (d.stopService) {
            const item = S.items.find((item) => item.id === d.stopService);
            if (!item || item.role_protected) return;
            return confirmation(
                tr("停止服务并封禁此会话"),
                message("stopServiceConfirm", { name: item.title }),
                "stop-service",
                { id: item.id },
            );
        }
        if (d.targetActivity) {
            return showChatActivity(
                d.targetActivity,
                S.items.find((item) => item.id === d.targetActivity)?.title || d.targetActivity,
            );
        }
        if (d.activityPage) {
            return showChatActivity(modalState.id, modalState.title, Number(d.activityPage));
        }
        if (d.roleTarget) {
            const item = S.items.find((i) => i.id === d.roleTarget);
            modalState = { action: "role", id: item.id };
            modal(
                tr("修改角色"),
                html`<p>${esc(item.title)}</p>
                    <label
                        >Bot 使用权限<select name="role">
                            ${["banned", "guest", "user", ...(item.id.startsWith("-") ? [] : ["admin"])]
                                .map(
                                    (role) =>
                                        html`<option value="${role}" ${item.role === role ? "selected" : ""}>
                                            ${esc(roleName(role))}
                                        </option>`,
                                )
                                .join("")}
                        </select></label
                    >
                    <p class="hint">角色控制机器人使用权限。部署中的机器人管理者不可在网页降级或封禁。</p>
                    <p class="hint">
                        ${tr(
                            "访客按多用户模式和所在会话权限检查，并非只读角色；普通用户和 Bot 管理员沿用原版命令权限。",
                        )}
                    </p>
                    <p class="hint">
                        封禁会暂停该会话的订阅，解除封禁后需手动恢复。Bot 管理员不会获得管理台账号或 MANAGER
                        专属命令权限。
                    </p>`,
                saveFooter(tr("保存角色")),
            );
            return;
        }
        if (d.runtimeEdit) {
            const item = S.runtimeItems.find((i) => i.key === d.runtimeEdit);
            modalState = { action: "runtime", item };
            const value = item.sensitive ? "" : (item.value ?? item.effective_value ?? "");
            modal(
                tr("运行配置"),
                html`<h3>${esc(runtimeText(item.key).label)}</h3>
                    <p class="mono">${esc(item.key)}</p>
                    <p class="hint">${esc(runtimeText(item.key).help)}</p>
                    <p class="notice">保存后在下次重启时生效，本页不会自动重启服务。</p>
                    <label
                        >配置值${item.type === "boolean"
                            ? html`<select name="value">
                                  <option value="true" ${value === true || value === "1" ? "selected" : ""}>
                                      启用
                                  </option>
                                  <option value="false" ${value === false || value === "0" ? "selected" : ""}>
                                      关闭
                                  </option>
                              </select>`
                            : html`<input
                                  name="value"
                                  type="${item.sensitive ? "password" : item.type === "integer" ? "number" : "text"}"
                                  value="${esc(value)}"
                                  ${item.type === "integer"
                                      ? html`min="${item.min}" max="${item.max}"`
                                      : "maxlength=4096"}
                                  autocomplete="off"
                              />`}</label
                    >${item.sensitive ? html`<p class="hint">敏感值不会显示；留空不修改已保存的值。</p>` : ""}<label
                        class="inline-label"
                        ><input type="checkbox" name="reset" />移除网页覆盖，重启后使用部署配置</label
                    >`,
                saveFooter(tr("保存（重启后生效）")),
            );
            return;
        }
        if (d.notifyChannel) {
            modalState = { action: "notify-channel", channel: d.notifyChannel };
            const fields =
                d.notifyChannel === "telegram"
                    ? ["token", "chat_id"]
                    : d.notifyChannel === "ntfy"
                      ? ["url", "topic", "token"]
                      : ["url"];
            modal(
                tr("配置通知渠道"),
                html`<p class="mono">${esc(d.notifyChannel)}</p>
                    <p class="hint">敏感值不会显示；留空不修改已保存的值。</p>
                    ${fields
                        .map(
                            (key) =>
                                html`<label
                                    >${esc(notificationFieldLabel(d.notifyChannel, key))}<input
                                        name="${key}"
                                        type="${key === "token" || key === "url" ? "password" : "text"}"
                                        autocomplete="off"
                                        maxlength="2048"
                                /></label>`,
                        )
                        .join("")}<label class="inline-label"
                        ><input
                            type="checkbox"
                            name="enabled"
                            ${S.notificationChannels?.[d.notifyChannel]?.enabled !== false ? "checked" : ""}
                        />启用渠道</label
                    >`,
                saveFooter(tr("保存设置")),
            );
            return;
        }
        if (d.notifyDelete)
            return confirmation(tr("删除通知配置"), tr("删除渠道凭据和配置，不影响其他渠道。"), "notify-delete", {
                channel: d.notifyDelete,
            });
        if (d.notifyTest)
            return confirmation(
                tr("测试通知"),
                S.demo ? tr("离线模式仅模拟，不会外连。") : tr("将向这个渠道发送一条测试通知。"),
                "notify-test",
                { channel: d.notifyTest },
            );
        if (d.action === "cancel-restore")
            return confirmation(
                tr("取消已安排的恢复"),
                tr("取消下次启动时的恢复任务，继续使用现有数据。"),
                "cancel-restore",
            );
        if (d.feedRecipients) {
            const result = await api(`/feeds/${d.feedRecipients}/recipients`);
            modalState = {
                action: "recipients",
                feedId: d.feedRecipients,
                chosen: result.items.map((i) => String(i.target)),
            };
            modal(
                tr("管理接收会话"),
                html`<p class="mono small">${esc(result.items[0]?.url || "")}</p>
                    <p class="notice">每次检查只抓取一次订阅源，再推送到各接收会话。已有订阅的推送设置保持不变。</p>
                    <label
                        >修改方式<select name="mode">
                            <option value="append">仅添加接收会话</option>
                            <option value="replace">按当前选择设置接收会话</option>
                        </select></label
                    >${pickerHtml(true)}
                    <p class="hint">
                        ${tr(
                            "未勾选的可选会话将取消对此订阅源的订阅。已封禁、机器人已退出或被移除的会话，其已有订阅保持不变；API 令牌范围外的订阅也保持不变。",
                        )}
                    </p>`,
                saveFooter(tr("保存接收会话")),
            );
            await targetPicker(true);
            return;
        }
        if (d.feedFetch) {
            const result = await api(`/feeds/${d.feedFetch}/fetch-options`);
            modalState = { action: "feed-fetch", feedId: d.feedFetch };
            modal(
                tr("订阅源请求设置"),
                html`<p class="mono small">
                        ${esc(S.items.find((item) => item.feed_id === Number(d.feedFetch))?.url || "")}
                    </p>
                    <p class="notice">此设置按 RSS 地址共享，影响所有订阅此地址的会话，下次抓取生效。</p>
                    <label
                        >请求标识（User-Agent）<input
                            name="user_agent"
                            maxlength="512"
                            value="${esc(result.user_agent || "")}"
                            placeholder="继承全局默认值"
                    /></label>
                    <p class="hint">
                        用于访问该订阅源。最多 512 个英文字符、数字及可打印符号，不含换行；留空使用全局 User-Agent。
                    </p>`,
                saveFooter(tr("保存设置")),
            );
            return;
        }
        if (d.action === "filter-target") {
            modalState = { action: "filter-target", chosen: S.target ? [S.target] : [] };
            modal(tr("按会话筛选"), pickerHtml(false, "filter"), saveFooter(tr("应用筛选")));
            await targetPicker();
            return;
        }
        if (d.action === "new-sub") return await newSub();
        if (d.action === "register") {
            modalState = { action: "register" };
            modal(
                tr("添加已有会话"),
                tr(
                    '<p class="muted small">请先在 Telegram 中让用户启动机器人，或将机器人加入频道 / 群组并授予发布权限。</p><label>Telegram 会话 ID<input name="id" required placeholder="例如 -1001234567890" inputmode="numeric"></label>',
                ),
                saveFooter(tr("验证并添加")),
            );
            return;
        }
        if (d.action === "attention") {
            S.attention = true;
            S.page = 1;
            S.target = "";
            S.q = "";
            location.hash =
                "subscriptions?" + new URLSearchParams({ target: S.target, attention: S.attention ? "1" : "0" });
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
            location.hash =
                "subscriptions?" + new URLSearchParams({ target: S.target, attention: S.attention ? "1" : "0" });
            return;
        }
        if (d.subEdit) return editSub(S.items.find((i) => i.id === Number(d.subEdit)));
        if (d.targetEdit) return editTarget(S.items.find((i) => i.id === d.targetEdit));
        if (d.subToggle) {
            const item = S.items.find((i) => i.id === Number(d.subToggle));
            b.disabled = true;
            await api(html`/subscriptions/${item.id}`, { method: "PATCH", body: { state: item.state ? 0 : 1 } });
            toast(item.state ? tr("订阅已暂停") : tr("订阅已恢复"));
            return render(true);
        }
        if (d.subDelete) {
            const item = S.items.find((i) => i.id === Number(d.subDelete));
            return confirmation(
                tr("取消订阅"),
                html`取消「${item.title}」在「${item.target_title}」的订阅？其他会话不受影响。`,
                "delete-sub",
                { id: item.id },
            );
        }
        if (d.batch)
            return confirmation(
                tr("批量处理订阅"),
                html`对选中的 ${S.selected.size}
                条订阅执行「${{ pause: tr("暂停订阅"), resume: tr("恢复订阅"), delete: tr("取消订阅") }[d.batch]}」？`,
                "batch",
                { batchAction: d.batch, ids: [...S.selected] },
            );
        if (d.refreshTarget) {
            b.disabled = true;
            const item = await api(html`/targets/${d.refreshTarget}/refresh`, { method: "POST", body: {} });
            toast(tr("会话名称与机器人访问权限已更新"));
            editTarget(item);
            return render(true);
        }
        if (d.leaveTarget)
            return confirmation(
                tr("让机器人退出"),
                tr("让机器人退出此群组或频道，并暂停该会话的订阅。重新加入需在 Telegram 中操作。"),
                "leave",
                {
                    id: d.leaveTarget,
                },
            );
        if (d.importTarget) {
            modalState = { action: "import", id: d.importTarget };
            modal(
                tr("导入 OPML"),
                tr(
                    '<label>选择 OPML 文件<input type="file" name="opml" accept=".opml,.xml,text/xml" required><span class="hint">最多 100 个订阅、512 KB。导入到当前会话，重复订阅会跳过。</span></label>',
                ),
                saveFooter(tr("导入订阅")),
            );
            return;
        }
        if (d.action === "new-token") {
            modalState = { action: "new-token" };
            modal(
                tr("创建API 访问令牌"),
                html`<label>令牌名称<input name="name" required maxlength="80" placeholder="例如 FeedLantern" /></label>
                    <div class="field-grid">
                        <label
                            >权限<select name="permission">
                                <option value="read">仅读取订阅</option>
                                <option value="write">读取和修改订阅</option>
                            </select></label
                        ><label
                            >有效天数<input name="days" type="number" value="90" min="1" max="365" required
                        /></label>
                    </div>
                    ${pickerHtml(true, "authorization")}<label class="inline-label"
                        ><input type="checkbox" name="all_targets" />允许访问全部会话，包括今后新增的会话</label
                    >`,
                saveFooter(tr("创建令牌")),
            );
            await targetPicker(true);
            return;
        }
        if (d.revoke)
            return confirmation(
                tr("撤销API 访问令牌"),
                tr("使用此令牌的 Agent 或外部应用将立即失去访问权限。"),
                "revoke",
                {
                    id: d.revoke,
                },
            );
        if (d.action === "copy-token") {
            await navigator.clipboard.writeText($("#token-secret").textContent);
            toast(tr("已复制API 访问令牌"));
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
    if (t.id === "language") {
        setLocale(t.value);
        return;
    }
    if (t.id === "theme") {
        setTheme(t.value);
        return;
    }
    if (t.id === "kind-filter") {
        S.kind = t.value;
        S.page = 1;
        render(true);
    }
    if (t.id === "visibility-filter") {
        S.visibility = t.value;
        S.page = 1;
        S.selected.clear();
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
        if (form.id === "notification-form") {
            await api("/notifications", {
                method: "PATCH",
                body: {
                    policy: {
                        enabled: f.has("enabled"),
                        new_users: f.has("new_users"),
                        threshold: Number(f.get("threshold")),
                        cooldown: Number(f.get("cooldown")),
                    },
                },
            });
            toast(tr("设置已保存"));
            return render(true);
        }
        if (form.id === "backup-export-form") {
            const flags = backupFlags(f);
            const response = await fetch("/api/backups/export", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(flags),
            });
            if (!response.ok) throw new Error(errorText(await response.json(), response.status));
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            link.download = "rsstt-backup.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            toast(tr("备份已下载"));
            return;
        }
        if (form.id === "backup-restore-form") {
            const file = f.get("backup");
            if (!file?.size || file.size > 32 * 1024 * 1024) throw new Error(tr("请选择不超过 32 MiB 的 JSON 备份。"));
            const raw = await file.text(),
                flags = backupFlags(f),
                query = new URLSearchParams(flags);
            const summary = await rawAPI("/backups/preflight?" + query, raw);
            modalState = { action: "restore", raw, query: String(query), sha: summary.sha256 };
            modal(
                tr("确认下次重启时恢复此备份"),
                html`<p class="notice">
                        检查通过尚未恢复数据。确认后，下次正常重启会用备份替换订阅、会话和基础管理数据。
                    </p>
                    <p>${message("backupCreated", { time: dateText(summary.created_at) })}</p>
                    <div class="table-wrap">
                        <table>
                            <tbody>
                                ${Object.entries(summary.counts)
                                    .map(
                                        ([key, value]) =>
                                            html`<tr>
                                                <th>${esc(backupCountLabel(key))}</th>
                                                <td>${n(value)}</td>
                                            </tr>`,
                                    )
                                    .join("")}
                            </tbody>
                        </table>
                    </div>
                    <p>
                        ${Object.values(flags).some(Boolean)
                            ? tr("订阅、会话和基础管理数据将替换；下列已勾选数据也将从备份覆盖。")
                            : tr("订阅、会话和基础管理数据仍将替换；未勾选的可选数据保留当前值。")}
                    </p>
                    <ul>
                        ${backupKeys
                            .filter((key) => flags[key])
                            .map((key) => html`<li>${tr(backupLabels[key])}</li>`)
                            .join("")}
                    </ul>
                    <label class="inline-label"
                        ><input
                            name="confirm_restore"
                            type="checkbox"
                            required
                        />我确认安排下次重启时恢复，并会在重启前备份当前数据。</label
                    >`,
                saveFooter(tr("安排重启后恢复")),
            );
            return;
        }
        if (form.id === "password-form") {
            await api("/auth/password", {
                method: "POST",
                body: { current_password: f.get("current_password"), new_password: f.get("new_password") },
            });
            S.session = null;
            login();
            toast(tr("密码已修改，请重新登录。"));
            return;
        }
        if (form.id === "settings-form") {
            const values = Object.fromEntries(f);
            for (const k of Object.keys(values)) if (k !== "sub_limit_reached_message") values[k] = Number(values[k]);
            await api("/settings", { method: "PATCH", body: values });
            toast(tr("设置已保存"));
            return render(true);
        }
        let result;
        const m = modalState;
        if (m.action === "stop-service") {
            await api(`/targets/${m.id}/role`, { method: "PATCH", body: { role: "banned" } });
            toast(tr("服务已停止并封禁，订阅已暂停。可切换到“已封禁”查看；解除封禁后需手动恢复订阅。"));
        }
        if (m.action === "role") {
            await api(`/targets/${m.id}/role`, { method: "PATCH", body: { role: f.get("role") } });
            const wasBanned = S.items.find((item) => item.id === m.id)?.role === "banned";
            toast(
                tr(
                    f.get("role") === "banned"
                        ? "会话已封禁，订阅已暂停。可切换到“已封禁”查看。"
                        : wasBanned
                          ? "会话已解除封禁，订阅仍保持暂停。请在管理订阅中手动恢复。"
                          : "角色已保存",
                ),
            );
        }
        if (m.action === "runtime") {
            if (!f.has("reset") && m.item.sensitive && !f.get("value")) {
                $("#dialog").close();
                return;
            }
            const value = f.has("reset")
                ? null
                : m.item.type === "boolean"
                  ? f.get("value") === "true"
                  : m.item.type === "integer"
                    ? Number(f.get("value"))
                    : f.get("value");
            await api("/runtime-config", { method: "PATCH", body: { [m.item.key]: value } });
            toast(tr("配置已保存，待重启生效。"));
        }
        if (m.action === "notify-channel") {
            const values = { enabled: f.has("enabled") };
            for (const [key, value] of f) if (key !== "enabled" && value) values[key] = value;
            await api("/notifications", { method: "PATCH", body: { channels: { [m.channel]: values } } });
            toast(tr("设置已保存"));
        }
        if (m.action === "notify-delete")
            await api("/notifications", { method: "PATCH", body: { channels: { [m.channel]: null } } });
        if (m.action === "notify-test") {
            const result = await api("/notifications/test", { method: "POST", body: { channel: m.channel } });
            toast(result.simulated ? tr("离线模式仅模拟，不会外连。") : tr("测试通知已排队，请查看通知记录。"));
        }
        if (m.action === "cancel-restore") await api("/backups/pending", { method: "DELETE" });
        if (m.action === "restore") {
            await rawAPI("/backups/restore?" + m.query, m.raw, { "X-Backup-SHA256": m.sha });
            m.raw = null;
            toast(tr("恢复已安排，当前数据尚未替换。请按部署方式正常重启服务以执行恢复。"));
        }
        if (m.action === "recipients") {
            await api(`/feeds/${m.feedId}/recipients`, {
                method: "PUT",
                body: { mode: f.get("mode"), targets: [...m.chosen] },
            });
            S.selected.clear();
            toast(tr("接收会话已保存"));
        }
        if (m.action === "feed-fetch") {
            await api(`/feeds/${m.feedId}/fetch-options`, {
                method: "PATCH",
                body: { user_agent: f.get("user_agent") || null },
            });
            toast(tr("设置已保存"));
        }
        if (m.action === "revoke-sessions") {
            await api("/auth/sessions", { method: "DELETE" });
            $("#dialog").close();
            S.session = null;
            login();
            return;
        }
        if (m.action === "filter-target") {
            if (!m.chosen?.size) throw new Error(tr("请选择接收会话。"));
            S.target = [...m.chosen][0];
            S.page = 1;
            S.selected.clear();
        }
        if (m.action === "new-sub") {
            if (!m.chosen?.size) throw new Error(tr("请选择接收会话。"));
            result = await api("/subscriptions", {
                method: "POST",
                body: { target: [...m.chosen][0], urls: f.get("urls").split(/\s+/).filter(Boolean) },
            });
        }
        if (m.action === "register") {
            await api("/targets", { method: "POST", body: { id: f.get("id") } });
            toast(tr("会话已登记"));
        }
        if (m.action === "edit-sub" || m.action === "edit-target") {
            const v = Object.fromEntries(f);
            for (const k of Object.keys(v))
                if (!["title", "tags", "lang"].includes(k)) v[k] = v[k] === "" ? null : Number(v[k]);
            await api(html`/${m.action === "edit-sub" ? "subscriptions" : "targets"}/${m.item.id}`, {
                method: "PATCH",
                body: v,
            });
            toast(tr("设置已保存"));
        }
        if (m.action === "delete-sub") {
            await api(html`/subscriptions/${m.id}`, { method: "DELETE" });
            S.selected.delete(m.id);
            toast(tr("订阅已取消"));
        }
        if (m.action === "batch") {
            result = await api("/subscriptions/batch", { method: "POST", body: { ids: m.ids, action: m.batchAction } });
            S.selected.clear();
        }
        if (m.action === "leave") {
            await api(html`/targets/${m.id}/leave`, { method: "POST", body: { confirm: f.get("confirm") } });
            toast(tr(S.demo ? "已在本地预览中模拟退出，订阅已暂停。" : "机器人已退出，订阅已暂停"));
        }
        if (m.action === "import") {
            const file = f.get("opml");
            if (file.size > 512 * 1024) throw new Error(tr("文件不能超过 512 KB。"));
            result = await api(html`/targets/${m.id}/opml`, { method: "POST", body: { opml: await file.text() } });
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
                tr("保存API 访问令牌"),
                html`<p class="muted small">完整令牌只在这里显示一次。复制到需要连接的应用中，并妥善保存。</p>
                    <div class="secret" id="token-secret">${esc(r.token)}</div>`,
                html`<button type="button" data-action="copy-token">复制令牌</button
                    ><button type="button" class="primary" data-action="close">我已妥善保存</button>`,
            );
            render(true);
            return;
        }
        if (m.action === "revoke") {
            await api(html`/tokens/${m.id}`, { method: "DELETE" });
            toast(tr("令牌已撤销"));
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
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    S.page = Math.max(1, Number(params.get("page")) || 1);
    S.q = params.get("q") || "";
    S.kind = ["private", "group", "channel"].includes(params.get("kind")) ? params.get("kind") : "";
    S.visibility = ["unbanned", "active", "inactive", "banned", "all"].includes(params.get("visibility"))
        ? params.get("visibility")
        : "unbanned";
    S.target = params.get("target") || "";
    S.status = params.get("state") || "";
    S.attention = params.get("attention") === "1";
    S.settings = ["general", "tokens", "instance", "security", "runtime", "notifications", "backups"].includes(
        params.get("section"),
    )
        ? params.get("section")
        : "general";
    S.selected.clear();
    document.body.classList.remove("menu-open");
    $$(".mobile-menu").forEach((el) => el.setAttribute("aria-expanded", "false"));
    if (S.session) render();
}
window.addEventListener("hashchange", route);
function login() {
    $("#app").innerHTML = html`<div class="login">
        <form id="login-form" class="login-card">
            <img src="/assets/mark.svg" alt="RSStT" />${preferences()}
            <h1>欢迎回来。</h1>
            ${S.demo
                ? html`<div class="notice">${S.snapshot ? tr("真实数据副本 · 修改仅在本地") : tr("离线预览实例")}</div>`
                : ""}
            <p>登录 RSStT 管理台，照看你的订阅。</p>
            <label for="password">管理台密码</label
            ><input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
            <p class="error" role="alert"></p>
            <button type="submit" class="primary">进入管理台 ${icon("arrow", 15)}</button>
        </form>
    </div>`;
}
async function boot() {
    try {
        const pub = await api("/public");
        S.features = pub.features || {};
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
        $("#app").innerHTML = html`<div class="initial">
            ${tr("管理台加载失败：")}${esc(e.message)}
            <p>${tr("请根据上述原因处理后重试；网络连接异常时，请确认服务正在运行。")}</p>
        </div>`;
    }
}
// Only the visible dashboard refreshes, using one request per minute.
setInterval(() => {
    if (S.session && S.route === "dashboard" && !document.hidden && !$("#dialog").open) render(true);
}, 60000);
boot();

function syncURL() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
        page: S.page > 1 ? S.page : "",
        q: S.q,
        kind: S.kind,
        visibility: S.route === "targets" ? S.visibility : "",
        target: S.target,
        state: S.status,
        attention: S.attention ? "1" : "",
        section: S.route === "settings" ? S.settings : "",
    }))
        if (v) p.set(k, v);
    history.replaceState(null, "", html`#${S.route}${p.size ? "?" + p : ""}`);
}
function preferences() {
    return html`<div class="preferences">
        <label
            >语言<select id="language" aria-label="语言">
                <option value="zh-CN" ${locale === "zh-CN" ? "selected" : ""}>简体中文</option>
                <option value="en" ${locale === "en" ? "selected" : ""}>English</option>
            </select></label
        ><label
            >外观<select id="theme" aria-label="外观">
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
            </select></label
        >
    </div>`;
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
        document.body.classList.remove("menu-open");
        const trigger = document.querySelector(".topbar .mobile-menu");
        trigger?.setAttribute("aria-expanded", "false");
        trigger?.focus();
    }
});
let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (S.session && S.route === "dashboard" && !$("#dialog").open) render(true);
    }, 200);
});

document.querySelector(".skip").addEventListener("click", (event) => {
    event.preventDefault();
    const main = $("#main") || $("#password");
    main?.focus();
});

function filteredExportURL(ids) {
    const params = new URLSearchParams({
        q: S.q,
        target: S.target,
        state: S.status,
        attention: S.attention ? "1" : "0",
    });
    if (ids) params.set("ids", ids.join(","));
    return "/api/subscriptions/opml?" + params;
}
function trendChart(data) {
    if (!data.available || !data.buckets.some((b) => b.availability !== "unavailable"))
        return empty(tr("没有历史统计"), tr("未记录的时间段显示为空，不计为零。"));
    const rows = data.buckets;
    const width = Math.min(920, Math.max(300, $("#main").clientWidth - 76));
    const max = Math.max(1, ...rows.flatMap((r) => [r.fetched || 0, r.delivered || 0]));
    const x = (i) => 36 + (i * (width - 58)) / Math.max(1, rows.length - 1);
    const y = (v) => 130 - (v / max) * 108;
    const line = (key) => {
        let previous = false;
        return rows
            .map((r, i) => {
                if (r[key] === null) {
                    previous = false;
                    return "";
                }
                const part = `${previous ? "L" : "M"}${x(i)} ${y(r[key])}`;
                previous = true;
                return part;
            })
            .join(" ");
    };
    const shortDate = (v) =>
        new Intl.DateTimeFormat(
            locale,
            data.granularity === "hour"
                ? { hour: "2-digit", hour12: false }
                : { month: "short", day: "numeric", timeZone: "UTC" },
        ).format(new Date(v));
    const bucketTime = (v) =>
        data.granularity === "day"
            ? new Intl.DateTimeFormat(locale, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  timeZone: "UTC",
              }).format(new Date(v)) + " UTC"
            : dateText(v);
    return html`<p class="muted small">未记录的时间段显示为空，不计为零；空心点表示该时间段记录不完整。</p>
        <svg
            class="chart"
            viewBox="0 0 ${width} 172"
            role="img"
            aria-label="${data.granularity === "day" ? tr("按 UTC 日聚合的统计趋势") : tr("按本地时间显示的统计趋势")}"
        >
            <line x1="36" x2="${width - 22}" y1="130" y2="130" />
            <text x="30" y="26" text-anchor="end">${n(max)}</text>
            <text x="30" y="134" text-anchor="end">0</text>
            <path class="delivered" d="${line("delivered")}" fill="none" stroke="#37795b" stroke-width="2" />
            <path d="${line("fetched")}" fill="none" stroke="var(--orange)" stroke-width="2" />
            ${rows
                .map(
                    (r, i) =>
                        html`${r.delivered === null
                            ? ""
                            : html`<circle
                                  cx="${x(i)}"
                                  cy="${y(r.delivered)}"
                                  r="${r.availability === "partial" ? 4 : 2}"
                                  fill="${r.availability === "partial" ? "var(--panel)" : "var(--green)"}"
                                  stroke="var(--green)"
                                  ><title>
                                      ${esc(
                                          message("deliveryPoint", {
                                              time: bucketTime(r.start),
                                              count: n(r.delivered),
                                          }),
                                      )}
                                  </title></circle
                              >`}${i % Math.ceil(rows.length / (width < 500 ? 4 : 7)) === 0
                            ? html`<text x="${x(i)}" y="158" text-anchor="middle">${esc(shortDate(r.start))}</text>`
                            : ""}`,
                )
                .join("")}
        </svg>
        <details>
            <summary>查看统计数据</summary>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>${data.granularity === "day" ? tr("UTC 日期") : tr("时间段开始（本地时间）")}</th>
                            <th>新发现文章</th>
                            <th>成功推送（篇次）</th>
                            <th>记录状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                            .map(
                                (r) =>
                                    html`<tr>
                                        <td>${esc(bucketTime(r.start))}</td>
                                        <td>${n(r.fetched)}</td>
                                        <td>${n(r.delivered)}</td>
                                        <td>
                                            ${tr(
                                                { available: "记录完整", partial: "记录不完整", unavailable: "未记录" }[
                                                    r.availability
                                                ],
                                            )}
                                        </td>
                                    </tr>`,
                            )
                            .join("")}
                    </tbody>
                </table>
            </div>
        </details>`;
}

const roleName = (role) =>
    tr(
        { manager: "机器人管理者", admin: "Bot 管理员", user: "普通用户", guest: "访客", banned: "已封禁" }[role] ||
            role,
    );
const notificationFieldLabel = (channel, key) =>
    tr(
        ({
            telegram: { token: "Telegram 机器人 Token", chat_id: "接收通知的 Telegram 会话 ID" },
            ntfy: { url: "ntfy 服务器地址", topic: "ntfy 主题", token: "ntfy 访问令牌" },
            bark: { url: "Bark 推送地址" },
            webhook: { url: "Webhook 通知地址" },
        }[channel] || {})[key] || key,
    );
const backupCountLabel = (key) =>
    tr(
        {
            "main.user": "用户与会话",
            "main.feed": "订阅源",
            "main.sub": "订阅",
            "main.option": "全局设置",
            "console.targets": "会话信息",
            "console.metrics": "日统计",
            "console.metrics_hourly": "小时统计",
            "console.activity": "管理操作记录",
            "console.chat_events": "会话操作记录",
            "console.credentials": "API 访问令牌",
            "console.console_admin": "管理台管理员凭据",
            "console.notify_config": "通知渠道配置",
            "console.notify_seen": "通知事件去重记录",
            "console.feed_fetch_options": "订阅源请求设置",
            "runtime.config": "非敏感运行配置",
        }[key] || key,
    );
const backupKeys = ["agent_tokens", "admin_credentials", "runtime_config", "notification_secrets"];
const backupLabels = {
    agent_tokens: "API 访问令牌",
    admin_credentials: "管理台管理员账号和密码凭据",
    runtime_config: "网页保存的非敏感运行配置",
    notification_secrets: "通知渠道凭据与配置",
};
function backupOptions(components, restore = false) {
    return html`<details>
        <summary>${restore ? tr("从备份覆盖的数据（默认保留当前值）") : tr("额外包含的数据（默认不包含）")}</summary>
        ${backupKeys
            .map(
                (key) =>
                    html`<label class="inline-label"
                        ><input type="checkbox" name="${key}" ${components?.[key]?.length ? "" : "disabled"} />${tr(
                            backupLabels[key],
                        )}${components?.[key]?.length ? "" : html` <span class="hint">此项当前不可用</span>`}</label
                    >`,
            )
            .join("")}
    </details>`;
}
function backupFlags(form) {
    return Object.fromEntries(backupKeys.map((key) => [key, form.has(key)]));
}
async function rawAPI(path, raw, headers = {}) {
    const response = await fetch("/api" + path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...headers },
        body: raw,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(errorText(result, response.status));
    return result;
}
function featureSettings(key, data) {
    if (key === "runtime")
        return html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>运行配置</h2>
                    <p>保存后在下次重启时生效，本页不会自动重启服务。</p>
                </div>
                ${data.pending_restart ? pill(tr("待重启"), "warn") : ""}
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>配置项</th>
                            <th>当前进程使用值</th>
                            <th>已保存值（下次启动使用）</th>
                            <th>配置来源与状态</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.items
                            .map(
                                (item) =>
                                    html`<tr>
                                        <td>
                                            <strong>${esc(runtimeText(item.key).label)}</strong
                                            ><small class="runtime-key mono">${esc(item.key)}</small>
                                        </td>
                                        <td>
                                            ${item.sensitive
                                                ? tr(item.effective_configured ? "已配置（不回显）" : "未设置")
                                                : esc(item.effective_value ?? "—")}
                                        </td>
                                        <td>
                                            ${item.configured
                                                ? item.sensitive
                                                    ? tr("已保存（不回显）")
                                                    : esc(item.value ?? "—")
                                                : tr("未设置网页覆盖")}
                                        </td>
                                        <td>
                                            <div>
                                                ${tr(item.source === "web" ? "网页覆盖" : "部署配置或应用默认值")}
                                            </div>
                                            ${item.pending_restart ? pill(tr("待重启"), "warn") : ""}
                                        </td>
                                        <td><button data-runtime-edit="${esc(item.key)}">编辑</button></td>
                                    </tr>`,
                            )
                            .join("")}
                    </tbody>
                </table>
            </div>
            <details class="form-body">
                <summary>需在部署配置中修改</summary>
                <p>
                    ${tr(
                        "管理者、数据库和监听地址等需在部署配置中修改，并按部署方式重启服务。当前进程使用值来自启动配置，不代表远端连接已验证成功。",
                    )}
                </p>
                <p class="mono small">${data.deployment_only.map(esc).join(" · ")}</p>
            </details>
        </section>`;
    if (key === "notifications")
        return html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>通知</h2>
                    <p>订阅源抓取故障与新增使用会话通知</p>
                    ${data.degraded ? html`<p class="notice warning">通知存储异常，请检查服务日志。</p>` : ""}
                </div>
                ${data.offline ? pill(tr("离线模式仅模拟，不会外连。"), "gray") : ""}
            </div>
            <form id="notification-form" class="form-body stack">
                <label class="inline-label"
                    ><input type="checkbox" name="enabled" ${data.policy.enabled ? "checked" : ""} />启用自动通知</label
                ><label class="inline-label"
                    ><input
                        type="checkbox"
                        name="new_users"
                        ${data.policy.new_users ? "checked" : ""}
                    />新会话接入时通知我</label
                >
                <div class="field-grid">
                    <label
                        >连续抓取失败次数<input
                            type="number"
                            name="threshold"
                            min="1"
                            max="100"
                            value="${data.policy.threshold}"
                            required /></label
                    ><label
                        >重复通知的最短间隔（秒）<input
                            type="number"
                            name="cooldown"
                            min="1"
                            max="604800"
                            value="${data.policy.cooldown}"
                            required
                    /></label>
                </div>
                <p class="hint">
                    ${tr(
                        "连续抓取失败达到阈值时通知；同一事件去重并遵守最短间隔，恢复后再次失败可重新通知。此设置不控制 RSS 重试频率。",
                    )}
                </p>
                <p class="hint">
                    ${tr(
                        "用户首次私聊机器人，或机器人新加入群组、频道时通知；被拒绝的新使用尝试也会记录。发送通知需要同时开启自动通知总开关和至少一个通知渠道。",
                    )}
                </p>
                <p class="error" role="alert"></p>
                <div><button type="submit" class="primary">保存通知策略</button></div>
            </form>
            <div class="form-body stack">
                ${["bark", "telegram", "webhook", "ntfy"]
                    .map(
                        (channel) =>
                            html`<div class="spread">
                                <div>
                                    <strong>${esc(channel)}</strong> ${pill(
                                        tr(data.channels[channel]?.enabled ? "已启用" : "未启用"),
                                        "gray",
                                    )}
                                </div>
                                <div class="inline">
                                    <button data-notify-channel="${channel}">配置</button>${data.channels[channel]
                                        ?.configured
                                        ? html`<button class="danger" data-notify-delete="${channel}">删除配置</button>`
                                        : ""}${data.channels[channel]?.enabled
                                        ? html`<button data-notify-test="${channel}">
                                              ${data.offline ? tr("模拟测试") : tr("测试通知")}
                                          </button>`
                                        : ""}
                                </div>
                            </div>`,
                    )
                    .join("")}
            </div>
            ${!data.policy.enabled
                ? html`<p class="notice">${tr("自动通知总开关已关闭。已启用渠道仍可接收手动测试通知。")}</p>`
                : ""}${data.history?.length
                ? html`<details class="form-body">
                      <summary>最近通知发送记录</summary>
                      <div class="table-wrap">
                          <table>
                              <thead>
                                  <tr>
                                      <th>时间</th>
                                      <th>通知渠道</th>
                                      <th>事件与对象</th>
                                      <th>发送状态</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${data.history
                                      .slice(0, 20)
                                      .map(
                                          (item) =>
                                              html`<tr>
                                                  <td>${esc(dateText(item.created * 1000))}</td>
                                                  <td>${esc(item.channel)}</td>
                                                  <td>
                                                      ${esc(
                                                          tr(
                                                              {
                                                                  fetch: "订阅源抓取失败",
                                                                  user: "新使用会话",
                                                                  test: "测试通知",
                                                              }[item.event] ||
                                                                  item.event ||
                                                                  "",
                                                          ),
                                                      )}${item.subject && item.event !== "test"
                                                          ? html` · ${esc(item.subject)}`
                                                          : ""}
                                                  </td>
                                                  <td>
                                                      ${esc(
                                                          tr(
                                                              {
                                                                  pending: "等待发送",
                                                                  sent: "已提交到通知渠道",
                                                                  failed: "失败",
                                                                  simulated: "离线模拟完成",
                                                                  cancelled: "已取消",
                                                              }[item.status] || item.status,
                                                          ),
                                                      )}
                                                  </td>
                                              </tr>`,
                                      )
                                      .join("")}
                              </tbody>
                          </table>
                      </div>
                  </details>`
                : ""}
        </section>`;
    if (key === "backups")
        return html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>备份与恢复</h2>
                    <p>备份订阅、会话和管理台数据；检查备份后，可安排在下次重启时恢复。</p>
                </div>
            </div>
            <div class="form-body stack">
                ${!data.sqlite
                    ? html`<p class="notice">
                          网页备份仅支持文件型 SQLite。PostgreSQL 请使用维护文档中的数据库备份工具。
                      </p>`
                    : html`${data.restore?.status === "succeeded"
                              ? html`<p class="notice">上次恢复已在启动时应用。</p>`
                              : data.restore?.status === "failed"
                                ? html`<p class="notice warning">
                                      上次恢复未成功。当前数据状态需根据恢复结果与回退记录确认；请检查服务日志后再安排恢复。
                                  </p>`
                                : ""}${data.restore?.status === "pending_restart"
                              ? html`<div class="notice warning">
                                    恢复已安排，当前数据尚未替换。请按部署方式正常重启服务以执行恢复。<button
                                        data-action="cancel-restore"
                                    >
                                        取消已安排的恢复
                                    </button>
                                </div>`
                              : ""}
                          <form id="backup-export-form" class="stack">
                              <h2>导出备份</h2>
                              <p class="hint">
                                  默认不导出凭据。备份始终不包含机器人 Token、Telegram 登录会话和部署环境配置。
                              </p>
                              ${backupOptions(data.components)}
                              <p class="error" role="alert"></p>
                              <div><button type="submit">下载备份</button></div>
                          </form>
                          <hr />
                          <form id="backup-restore-form" class="stack">
                              <h2>恢复备份</h2>
                              ${data.restore_supported === false
                                  ? html`<p class="notice">
                                        当前平台可导出备份；网页检查与自动恢复需在受支持的 POSIX 环境执行。
                                    </p>`
                                  : ""}
                              <label
                                  >JSON 备份文件<input
                                      type="file"
                                      name="backup"
                                      accept=".json,application/json"
                                      required /></label
                              >${backupOptions(data.components, true)}
                              <p class="error" role="alert"></p>
                              <div>
                                  <button
                                      type="submit"
                                      class="primary"
                                      ${data.restore_supported === false || data.restore?.status === "pending_restart"
                                          ? "disabled"
                                          : ""}
                                  >
                                      检查备份
                                  </button>
                              </div>
                          </form>`}
            </div>
        </section>`;
    return "";
}
$("#dialog").addEventListener("close", () => {
    if (!$("#dialog").open && modalState.action === "restore") modalState = {};
});

// Translate only exact, documented audit codes. Free-form details remain opaque.
function auditAction(action) {
    const labels = {
        login: "网页登录",
        password_changed: "修改密码",
        sessions_revoked: "退出所有网页登录会话",
        agent_request: "API 访问",
        登记会话: "添加已有会话",
        修改会话默认设置: "修改会话默认设置",
        修改用户角色: "修改 Bot 用户角色",
        退出会话并暂停订阅: "机器人退出会话并暂停订阅",
        "导入 OPML": "导入订阅源（OPML）",
        添加订阅: "添加订阅",
        修改订阅: "修改订阅",
        取消订阅: "取消订阅",
        批量处理订阅: "批量处理订阅",
        更新设置: "更新全局设置",
        "保存运行配置（待重启）": "保存运行配置（待重启）",
        创建连接授权: "创建 API 访问令牌",
        撤销连接授权: "撤销 API 访问令牌",
        修改来源接收者: "修改订阅源接收会话",
        "修改来源 UA": "修改订阅源 User-Agent",
    };
    return Object.hasOwn(labels, action) ? tr(labels[action]) : action;
}

function auditDetail(action, detail) {
    const known = {
        login: { success: "登录成功" },
        password_changed: { "all browser sessions revoked": "全部网页登录会话已撤销" },
        sessions_revoked: { all: "全部网页登录会话已撤销" },
    };
    const values = Object.hasOwn(known, action) ? known[action] : null;
    return values && Object.hasOwn(values, detail) ? tr(values[detail]) : detail;
}
let tableHintId = 0;
const tableHints = new Map();
const tableResize = new ResizeObserver((entries) => entries.forEach(({ target }) => updateTableHint(target)));
function updateTableHint(wrap) {
    const hint = tableHints.get(wrap);
    if (!hint) return;
    const overflow = wrap.clientWidth > 0 && wrap.scrollWidth > wrap.clientWidth + 1;
    hint.hidden = !overflow;
    if (overflow) {
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", tr("可横向滚动的表格"));
        wrap.setAttribute("aria-describedby", hint.id);
    } else {
        wrap.removeAttribute("tabindex");
        wrap.removeAttribute("role");
        wrap.removeAttribute("aria-label");
        wrap.removeAttribute("aria-describedby");
    }
}
function syncTableHints() {
    for (const [wrap, hint] of tableHints)
        if (!wrap.isConnected) {
            tableResize.unobserve(wrap);
            hint.remove();
            tableHints.delete(wrap);
        }
    for (const wrap of $$(".table-wrap")) {
        if (!tableHints.has(wrap)) {
            const hint = document.createElement("p");
            hint.className = "table-scroll-hint";
            hint.id = `table-scroll-hint-${++tableHintId}`;
            hint.textContent =
                "↔ " +
                tr(wrap.querySelector(".table-actions") ? "左右滑动表格，查看右侧管理操作" : "左右滑动查看完整表格");
            wrap.before(hint);
            tableHints.set(wrap, hint);
            tableResize.observe(wrap);
        }
        updateTableHint(wrap);
    }
}
