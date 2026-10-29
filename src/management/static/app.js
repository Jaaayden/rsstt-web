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
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M9.5 2h5l.5 3 2 .8 2.5-1.5 2.5 4.4-2.3 1.9v2.8l2.3 1.9-2.5 4.4-2.5-1.5-2 .8-.5 3h-5l-.5-3-2-.8-2.5 1.5L2 15.3l2.3-1.9v-2.8L2 8.7l2.5-4.4L7 5.8 9 5Z",
    plus: "M12 5v14 M5 12h14",
    diagnostics: "M7 3h10l4 4v14H3V3h4Z M17 3v5h4 M7 12h10 M7 16h6 M7 7h4",
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
    diagnostics: tr("运行日志"),
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
    logCategory: "",
    logLevel: "",
    logFeed: "",
    logTarget: "",
    selected: new Set(),
    items: [],
    serial: 0,
};
let modalState = {},
    modalFrame = null,
    modalHistory = [],
    modalReturnFocus = null,
    toastTimer,
    searchTimer,
    pickerSerial = 0,
    menuReturnFocus = null;
const mobileNavigation = window.matchMedia("(max-width: 820px)");

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
const empty = (title, description, symbol = "rss") =>
    html`<div class="empty">
        ${icon(symbol, 26)}<strong>${esc(title)}</strong>
        <p>${esc(description)}</p>
    </div>`;

function setMenu(open, { restoreFocus = true } = {}) {
    const sidebar = $(".sidebar"),
        workspace = $(".workspace"),
        trigger = $(".topbar .mobile-menu"),
        wasOpen = document.body.classList.contains("menu-open");
    const isOpen = Boolean(open && mobileNavigation.matches && sidebar && workspace && !$("#dialog")?.open);
    if (isOpen && !wasOpen) menuReturnFocus = trigger;
    document.body.classList.toggle("menu-open", isOpen);
    if (workspace) workspace.inert = isOpen;
    if (sidebar) sidebar.inert = mobileNavigation.matches && !isOpen;
    const scrim = $(".nav-scrim");
    if (scrim) scrim.hidden = !isOpen;
    const skip = $(".skip");
    if (skip) skip.inert = isOpen;
    $$(".mobile-menu").forEach((element) => element.setAttribute("aria-expanded", String(isOpen)));
    if (isOpen && !wasOpen) $(".sidebar .nav a")?.focus({ preventScroll: true });
    if (!isOpen) {
        const target = menuReturnFocus?.isConnected ? menuReturnFocus : trigger;
        menuReturnFocus = null;
        if (wasOpen && restoreFocus && !$("#dialog")?.open && target?.getClientRects().length)
            target.focus({ preventScroll: true });
    }
}

function shell() {
    setMenu(false, { restoreFocus: false });
    $("#app").innerHTML = html`<div class="layout">
        <aside id="primary-navigation" class="sidebar" aria-label="主导航">
            <div class="sidebar-head">
                <a class="brand" href="#dashboard" aria-label="RSStT Web · ${tr("仪表盘")}">
                    <img src="/assets/mark.svg" alt="" />
                    <span class="brand-wordmark"
                        ><strong>RSStT Web</strong><small class="brand-caption">RSS 到 Telegram</small></span
                    >
                </a>
                <button class="quiet mobile-menu" data-action="menu" aria-label="关闭导航">${icon("close", 18)}</button>
            </div>
            <div class="sidebar-section">
                <div class="nav-label">工作空间</div>
                <nav class="nav">
                    ${Object.entries(labels)
                        .filter(([key]) => key !== "diagnostics" || S.features.diagnostics)
                        .map(
                            ([key, label]) =>
                                html`<a href="#${key}" data-nav="${key}"
                                    >${icon({ targets: "chats", subscriptions: "rss" }[key] || key)}<span
                                        >${label}</span
                                    ></a
                                >`,
                        )
                        .join("")}
                </nav>
            </div>
            <div class="sidebar-bottom">
                <div class="instance">
                    <span class="instance-label">实例模式</span>
                    <strong class="instance-heading"
                        ><span class="dot"></span>${S.snapshot
                            ? tr("真实数据离线预览")
                            : S.demo
                              ? tr("离线预览实例")
                              : tr("管理实例")}</strong
                    ><small class="instance-meta"
                        >${S.snapshot
                            ? tr("真实数据副本 · 修改仅在本地")
                            : S.demo
                              ? tr("示例数据 · 不发送 Telegram 消息")
                              : tr("管理台已登录")}</small
                    >
                </div>
                <div class="profile">
                    <div class="profile-copy">
                        <span class="small">管理台管理员</span>
                        <p class="muted micro">${S.demo ? tr("本地预览") : tr("管理台会话")}</p>
                    </div>
                    <button class="quiet" data-action="logout" title="退出登录" aria-label="退出登录">
                        ${icon("exit", 16)}退出登录
                    </button>
                </div>
            </div>
        </aside>
        <button class="nav-scrim" type="button" data-action="menu" aria-label="关闭导航" tabindex="-1" hidden></button>
        <div class="workspace">
            <header class="topbar">
                <div class="breadcrumb workspace-context">
                    <button
                        class="quiet mobile-menu"
                        data-action="menu"
                        aria-label="展开导航"
                        aria-controls="primary-navigation"
                        aria-expanded="false"
                    >
                        ${icon("menu")}</button
                    ><span class="workspace-label">工作空间</span>${icon("chevron", 12)}<strong
                        id="breadcrumb"
                    ></strong>
                </div>
                <div class="topbar-meta">
                    <div class="date">
                        ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date())}
                    </div>
                    ${preferences()}
                </div>
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
    setMenu(false, { restoreFocus: false });
}

function header(title, description, button = "") {
    return html`<div class="page-title">
        <div class="page-heading">
            <h1>${title}</h1>
            <p class="page-description">${description}</p>
        </div>
        ${button ? html`<div class="page-actions">${button}</div>` : ""}
    </div>`;
}
const targetKindName = (item) => kindName[item.kind] || tr("未知");
const newButton = () => html`<button class="primary" data-action="new-sub">${icon("plus", 16)}添加订阅</button>`;
const credit = () =>
    html`<footer class="credit">
        <span>RSStT Web</span
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
            "feedLogs",
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
            $("#breadcrumb").textContent =
                labels.subscriptions + (S.target ? " / " + (data.items[0]?.target_title || S.target) : "");
            html = subscriptions(data);
        }
        if (S.route === "diagnostics") {
            const data = await api("/diagnostics?" + diagnosticsQuery());
            html = diagnosticsPage(data);
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
        syncSettingsNavigation();
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
        t = d.statistics.totals,
        knownBuckets = d.trend?.buckets?.filter((row) => row.availability !== "unavailable") || [];
    const periodTotal = (key) => {
        const values = knownBuckets.map((row) => row[key]).filter(Number.isFinite);
        return values.length ? values.reduce((total, value) => total + value, 0) : null;
    };
    const cards = [
        {
            key: "delivery",
            icon: "send",
            label: tr("累计成功推送（篇次）"),
            value: t.delivered,
            primary: true,
            foot: S.snapshot ? tr("快照不含历史推送统计") : message("discoveredTotal", { count: n(t.fetched) }),
        },
        {
            key: "subscriptions",
            icon: "rss",
            label: tr("订阅总数"),
            value: c.subscriptions,
            foot: html`<span
                    >${message("enabledSubs", { count: n(d.usage?.active_subscriptions ?? c.active) })} ·
                    ${count(c.feeds, "feed")}</span
                >
                <p class="hint">${tr("同一订阅源推送到两个会话，计两条订阅。")}</p>`,
        },
        {
            key: "chats",
            icon: "chats",
            label: d.usage ? tr("活跃会话") : tr("已知会话"),
            value: d.usage ? d.usage.active.total : c.users + c.groups + c.channels,
            foot: d.usage
                ? html`<span
                          >${message("recordedChats", {
                              total: n(d.usage.known.total),
                              unknown: n(d.usage.known.unknown),
                          })}</span
                      >
                      <details class="stat-details">
                          <summary>会话分类</summary>
                          <dl class="chat-breakdown">
                              ${["private", "group", "channel", "unknown"]
                                  .map(
                                      (kind) =>
                                          html`<div>
                                              <dt>${kindName[kind] || tr("未知")}</dt>
                                              <dd>
                                                  ${n(d.usage.active[kind])}<span> / ${n(d.usage.known[kind])}</span>
                                              </dd>
                                          </div>`,
                                  )
                                  .join("")}
                          </dl>
                          <span class="hint">有启用订阅 / 已记录会话</span>
                          <p class="hint">${tr("活跃会话未被封禁，且至少有一条已启用订阅，其订阅源也已启用。")}</p>
                      </details>`
                : S.snapshot
                  ? html`${n(c.channels + c.groups)} 个群组/频道 · ${n(c.users)} 个私聊`
                  : html`${n(c.channels)} 个频道 · ${n(c.groups)} 个群组 · ${n(c.users)} 个私聊`,
        },
        {
            key: "attention",
            icon: "alert",
            label: tr("抓取异常"),
            value: c.attention,
            foot: message("attentionThreshold", { count: n(d.threshold) }),
        },
    ];
    return html`<div class="dashboard-page">
        ${header(tr("运行概况"), tr("查看订阅启用情况、抓取异常和推送统计。"), newButton())}
        <div class="overview-status">
            <div class="overview-context">
                <span class="bot-symbol">${icon("rss", 15)}</span><strong>${esc(d.bot.name || "RSStT")}</strong>${d.bot
                    .username
                    ? html`<span class="mono">@${esc(d.bot.username)}</span>`
                    : ""}
            </div>
            <div class="overview-state">
                ${pill(
                    S.demo ? tr("未连接 Telegram") : d.bot.connected ? tr("机器人在线") : tr("机器人离线"),
                    S.demo || !d.bot.connected ? "gray" : "",
                )}<span class="refresh-note">页面可见时每分钟刷新</span>
            </div>
        </div>
        ${!d.bot.connected && !S.demo
            ? html`<div class="notice warning dashboard-notice">
                  ${icon("alert", 16)}<span>机器人当前未连接 Telegram，订阅推送暂不可用。</span>
              </div>`
            : ""}
        ${d.metrics_error
            ? html`<div class="notice warning dashboard-notice">
                  ${icon("alert", 16)}<span>${esc(d.metrics_error)}</span>
              </div>`
            : ""}
        <section class="stats" aria-label="运行概况">
            ${cards
                .map(
                    (card) =>
                        html`<article
                            class="stat stat-${card.key} ${card.primary ? "stat-primary" : ""} ${card.key ===
                                "attention" && card.value
                                ? "warning"
                                : ""}"
                        >
                            <div class="stat-head"><span>${card.label}</span>${icon(card.icon, 18)}</div>
                            <div class="stat-value-row"><div class="stat-value">${n(card.value)}</div></div>
                            <div class="stat-foot">${card.foot}</div>
                        </article>`,
                )
                .join("")}
        </section>
        <section class="panel trend-panel">
            <div class="panel-head">
                <div class="section-heading">
                    <h2>抓取与推送趋势</h2>
                    <p>
                        ${d.trend?.granularity === "hour"
                            ? tr("每小时新发现文章（篇）与成功推送（篇次），按本地时间显示")
                            : d.trend
                              ? tr("每天新发现文章（篇）与成功推送（篇次），按 UTC 日聚合")
                              : tr("每天发现的新文章，以及成功送达的篇次")}
                    </p>
                </div>
                <div class="segmented" aria-label="趋势时间范围">
                    ${(d.usage ? [24, 7, 30] : [7, 14, 30])
                        .map((value) => {
                            const selected = d.usage && S.granularity === "hour" ? value === 24 : S.period === value;
                            return html`<button
                                data-period="${value}"
                                class="${selected ? "active" : ""}"
                                aria-pressed="${selected}"
                            >
                                ${d.usage && value === 24 ? tr("24 小时") : count(value, "day")}
                            </button>`;
                        })
                        .join("")}
                </div>
            </div>
            ${d.trend?.available
                ? html`<div class="trend-summary">
                      <span class="trend-summary-label">所选时段 · 已记录合计</span>
                      <div><span>成功推送（篇次）</span><strong>${n(periodTotal("delivered"))}</strong></div>
                      <div><span>新发现文章</span><strong>${n(periodTotal("fetched"))}</strong></div>
                      ${d.trend.buckets.some((row) => row.availability !== "available")
                          ? pill(tr("含未记录或不完整时段"), "gray")
                          : ""}
                  </div>`
                : ""}
            <div class="chart-wrap">
                <div class="chart-meta">
                    <span><i class="legend"></i>成功推送（篇次）</span
                    ><span><i class="legend secondary"></i>新发现文章</span
                    ><span class="chart-timezone"
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
                <p class="chart-note">
                    ${tr("新发现文章按订阅源计数；同一文章推送给多个会话，分别计为成功推送篇次。")}
                </p>
            </div>
            <div class="chart-footer">
                <span
                    >${d.trend
                        ? tr("小时趋势保留 31 天，日趋势保留 90 天；累计值持续保留。")
                        : S.snapshot
                          ? tr("订阅与失败次数来自快照，不会自动更新")
                          : (S.demo ? tr("示例统计") : tr("开始记录于 ") + dateText(d.started_at)) +
                            tr(" · 累计值持续保留，趋势保留 90 天")}</span
                >
            </div>
        </section>
        <div class="dashboard-lower">
            <section class="panel attention-panel">
                <div class="panel-head">
                    <div class="section-heading">
                        <h2>抓取异常 <span class="section-count">${n(c.attention)}</span></h2>
                        <p>连续失败达到阈值的订阅</p>
                    </div>
                    <button class="text-link" data-action="attention">查看异常订阅 ${icon("arrow", 13)}</button>
                </div>
                ${d.attention.length
                    ? html`<div class="attention-list">
                          ${d.attention
                              .map(
                                  (item) =>
                                      html`<div class="attention-row">
                                          ${feedMark(item.title)}
                                          <div class="feed-info">
                                              <strong>${esc(item.title)}</strong
                                              ><small>${esc(item.target_title)}</small>
                                          </div>
                                          ${pill(message("fetchFailures", { count: n(item.errors) }), "warn")}
                                          ${S.features.diagnostics && item.feed_id
                                              ? html`<button class="text-link small" data-feed-logs="${item.feed_id}">
                                                    抓取日志
                                                </button>`
                                              : ""}
                                      </div>`,
                              )
                              .join("")}
                      </div>`
                    : empty(tr("目前没有需要检查的订阅"), tr("偶发失败会自动重试，连续失败达到阈值后显示。"))}
            </section>
            <section class="panel activity-panel">
                <div class="panel-head">
                    <div class="section-heading">
                        <h2>最近操作</h2>
                        <p>管理台记录</p>
                    </div>
                    ${icon("clock", 17)}
                </div>
                <div class="activity">
                    ${d.activity.length
                        ? d.activity
                              .slice(0, 4)
                              .map(
                                  (item) =>
                                      html`<div class="activity-row">
                                          <div class="activity-icon">${icon("check", 14)}</div>
                                          <div class="activity-copy">
                                              <p>${esc(auditAction(item.action))}</p>
                                              <small>${esc(auditDetail(item.action, item.detail))}</small>
                                          </div>
                                          <time>${esc(dateText(item.at))}</time>
                                      </div>`,
                              )
                              .join("")
                        : empty(tr("还没有操作记录"), tr("你在管理台中的修改会出现在这里。"))}
                </div>
            </section>
        </div>
    </div>`;
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
                <stop stop-color="var(--accent)" stop-opacity=".16" />
                <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
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
            stroke="var(--accent)"
            stroke-width="2.2"
            vector-effect="non-scaling-stroke"
        />
        <path
            d="${line("fetched")}"
            fill="none"
            class="fetched"
            stroke="var(--chart-secondary)"
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
        html`<section class="panel chats-panel">
                <div class="toolbar toolbar-chats">
                    <div class="toolbar-main">
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
                        )}
                    </div>
                    <div class="toolbar-secondary"><span class="count">${count(d.total, "destination")}</span></div>
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
                                      <th class="row-actions-heading" scope="col">操作</th>
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
                                                  <td class="row-actions-cell">
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
                          "chats",
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
        html`<section class="panel subscriptions-panel">
            <div class="toolbar toolbar-subscriptions">
                <div class="toolbar-main">
                    ${searchBox()}${select(
                        "status-filter",
                        [
                            ["", tr("全部状态")],
                            ["1", tr("已启用")],
                            ["0", tr("已暂停")],
                        ],
                        S.status,
                    )}<button data-action="filter-target" class="small">${icon("chats", 14)}按会话筛选</button>
                    <button
                        data-action="toggle-attention"
                        class="${S.attention ? "primary" : ""} small"
                        aria-pressed="${S.attention}"
                    >
                        ${icon("alert", 14)}仅看抓取异常
                    </button>
                </div>
                <div class="toolbar-secondary">
                    ${d.items.some((i) => i.feed_id)
                        ? html`<a
                              class="button-link"
                              href="${filteredExportURL()}"
                              download
                              title="${tr("导出当前筛选的全部页，相同 RSS 地址合并；不含接收会话与推送设置。")}"
                              >导出筛选订阅源（OPML）</a
                          >`
                        : S.target
                          ? html`<a
                                class="button-link"
                                href="/api/targets/${encodeURIComponent(S.target)}/opml"
                                download
                                >导出订阅源（OPML）</a
                            >`
                          : ""}${S.target
                        ? tr('<button class="quiet small" data-action="clear-target">清除会话筛选 ×</button>')
                        : ""}<span class="count">${count(d.total, "subscription")}</span>
                </div>
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
                      <table class="subscription-table">
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
                                  <th class="row-actions-heading" scope="col">操作</th>
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
                                                          ${S.features.articles
                                                              ? html`<button
                                                                    type="button"
                                                                    class="text-link small feed-articles-link"
                                                                    data-sub-articles="${item.id}"
                                                                >
                                                                    最近文章
                                                                </button>`
                                                              : ""}
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
                                              <td class="row-actions-cell">
                                                  <div class="table-actions">
                                                      <button
                                                          class="action-toggle"
                                                          data-sub-toggle="${item.id}"
                                                          title="${item.state ? tr("暂停订阅") : tr("恢复订阅")}"
                                                          aria-label="${item.state
                                                              ? tr("暂停订阅")
                                                              : tr("恢复订阅")} ${esc(item.title)}"
                                                      >
                                                          ${icon(item.state ? "pause" : "play", 15)}${item.state
                                                              ? tr("暂停")
                                                              : tr("恢复")}</button
                                                      ><button
                                                          class="action-edit"
                                                          data-sub-edit="${item.id}"
                                                          aria-label="编辑 ${esc(item.title)}"
                                                      >
                                                          ${icon("edit", 15)}编辑</button
                                                      >${S.features.diagnostics && item.feed_id
                                                          ? html`<button
                                                                data-feed-logs="${item.feed_id}"
                                                                aria-label="抓取日志 ${esc(item.title)}"
                                                            >
                                                                ${icon("diagnostics", 15)}抓取日志
                                                            </button>`
                                                          : ""}<button
                                                          class="action-unsubscribe"
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

const diagnosticCategories = {
    fetch: "订阅源抓取",
    delivery: "Telegram 推送",
    notification: "管理员通知",
    system: "系统运行",
};
const diagnosticLevels = { info: "信息", warning: "警告", error: "错误" };
const diagnosticEvents = {
    "fetch.failed": "订阅源抓取失败。",
    "fetch.recovered": "订阅源抓取已恢复。",
    "fetch.not_modified": "订阅源未发生变化，使用缓存。",
    "fetch.empty": "抓取成功，订阅源暂时没有文章。",
    "fetch.unchanged": "抓取成功，没有新文章。",
    "fetch.updated": "抓取成功，发现新文章。",
    "fetch.deactivation_requested": "连续抓取失败达到上限，已触发停用处理。",
    "fetch.deactivated": "订阅源已停用，相关订阅已暂停。",
    "fetch.state_save_failed": "抓取结果已返回，但订阅状态保存失败。",
    "fetch.exception": "抓取任务发生异常，未完成本次检查。",
    "fetch.timeout": "抓取任务超时，未完成本次检查。",
    "delivery.parse_failed": "文章解析失败，未能生成推送内容。",
    "delivery.failed": "Telegram 推送失败。",
    "delivery.unconfirmed": "Telegram 未确认完整发送，不能计为成功推送。",
    "delivery.blocked": "机器人无法向此会话发送消息。",
    "delivery.deactivated": "多次无法发送，已停止向此会话提供服务。",
    "delivery.timeout": "Telegram 推送任务超时。",
    "delivery.exception": "Telegram 推送任务发生异常。",
    "delivery.stopped": "推送已停止。",
    "delivery.rate_limited": "Telegram 限流，等待后重试。",
    "delivery.rate_limit_exhausted": "Telegram 限流重试已达上限，本条消息未完成发送。",
    "delivery.transport_retry": "Telegram 服务异常，正在按重试规则处理。",
    "delivery.transport_failed": "Telegram 发送重试已达上限，本条消息未完成发送。",
    "notification.retry": "通知投递失败，已安排重试。",
    "notification.failed": "通知投递连续失败，已停止重试。",
    "notification.sent": "通知已发送。",
    "notification.simulated": "离线模式：已模拟通知投递。",
    "notification.cancelled": "通知渠道已停用，取消本次投递。",
    "notification.queue_failed": "通知任务处理失败。",
    "metrics.failed": "统计记录写入失败。",
    "metrics.recovered": "统计记录已恢复。",
    "membership.rate_limited": "Telegram 限流，会话状态核验已暂停。",
    "membership.failed": "无法核验会话状态，已保留上次已知状态。",
    "membership.scan_failed": "启动时的会话状态核验未完成。",
    "membership.observe_failed": "处理会话状态变更时发生错误。",
    "backup.failed": "备份或恢复准备失败。",
    "backup.exported": "备份文件已生成。",
    "backup.staged": "恢复任务已暂存，等待重启后应用。",
    "backup.validated": "备份预检通过。",
    "backup.cancelled": "已取消待恢复任务。",
    "console.request_failed": "网页管理操作发生后台异常。",
    "console.started": "网页管理台已启动。",
    "console.stopped": "网页管理台正在正常停止。",
    "runtime_config.saved": "运行配置已保存，等待重启生效。",
    "runtime_config.read_failed": "无法读取运行配置，请检查配置文件。",
    "runtime_config.rejected": "运行配置未保存，请检查配置项。",
    "auth.sign_in_failed": "管理台登录失败，请检查密码或稍后重试。",
    "auth.signed_in": "管理员已登录网页管理台。",
    "auth.password_change_rejected": "管理台密码未修改：当前密码不正确。",
    "auth.password_changed": "管理台密码已修改，原有网页登录已失效。",
    "auth.token_issued": "API 访问令牌已创建。",
    "auth.token_revoked": "API 访问令牌已撤销。",
    "backup.restore_failed": "备份恢复失败；请检查维护日志与回退副本。",
    "backup.restored": "备份已在启动前恢复。",
    "backup.restore_result_unavailable": "无法读取上次备份恢复结果。",
    "manual.requested": "已提交手动抓取任务。",
    "manual.completed": "手动抓取检查已完成。",
    "manual.cancelled": "实例停止，手动抓取任务已中断。",
    "manual.failed": "手动抓取或测试推送未完成。",
    "manual.test_fetched": "测试抓取已完成。",
    "manual.test_delivered": "测试文章已确认推送。",
};
const diagnosticFields = {
    http_status: "HTTP 状态",
    duration_ms: "请求耗时",
    failures: "连续失败次数",
    next_retry_at: "已安排的下次重试",
    next_check_at: "下次检查",
    source_host: "来源主机",
    exception_type: "异常类型",
    attempt: "本次投递尝试",
    channel: "通知渠道",
    new_entries: "新发现文章数",
    stage: "发生环节",
    status: "处理结果",
    method: "请求方法",
    route: "接口路径",
    retry_after_seconds: "需等待",
};
const diagnosticValues = {
    request: "请求订阅源",
    parse: "解析内容",
    process: "处理抓取结果",
    persist: "保存订阅状态",
    manual: "手动抓取",
    send: "发送消息",
    queue: "处理通知队列",
    cached: "缓存未变化",
    empty: "暂无文章",
    unchanged: "没有新文章",
    updated: "发现新文章",
    failed: "失败",
    recovered: "已恢复",
    deactivated: "已停用",
    pending: "等待重试",
    sent: "已发送",
    simulated: "离线模拟",
    cancelled: "已取消",
    unconfirmed: "未确认完整送达",
    metrics: "记录统计",
    membership: "核验会话状态",
    export: "导出备份",
    validate: "校验备份",
    write_private: "保存恢复任务",
    preflight: "预检备份",
    restore: "恢复备份",
};
const diagnosticDate = (value) => (value && !Number.isNaN(new Date(value).getTime()) ? dateText(value) : tr("未记录"));
function diagnosticReason(item) {
    const context = item.context || {},
        status = Number(context.http_status),
        type = String(context.exception_type || "");
    if (item.level === "info") return "";
    if (item.code === "delivery.stopped") {
        if (context.status === "unconfirmed") return tr("发送被停止，可能已有部分消息送达。");
        if (context.status === "failed") return tr("发送已停止，本篇未发送。");
    }
    const httpReasons = {
        401: "来源要求身份认证，请检查订阅地址的授权是否有效。",
        403: "来源拒绝访问，可能需要调整来源授权、User-Agent 或访问网络。",
        404: "来源地址不存在，请检查订阅地址是否已迁移或删除。",
        410: "来源已删除此地址，请更换有效的订阅地址。",
        429: "来源限制请求频率，请等待重试并检查抓取间隔。",
    };
    if (item.category === "fetch" && httpReasons[status]) return tr(httpReasons[status]);
    if (status >= 500) return tr("远端服务器返回错误，请稍后重试或检查对应服务。");
    if (/DNS|NameResolution|gaierror/i.test(type)) return tr("域名解析失败，请检查域名和 DNS 连接。");
    if (/Certificate|SSL|TLS/i.test(type)) return tr("安全连接失败，请检查远端证书和系统时间。");
    if (/Timeout/i.test(type) || item.code?.endsWith(".timeout"))
        return tr("等待响应超时，请检查网络连接或远端响应速度。");
    if (/Connector|Connect|Disconnect|Socket/i.test(type)) return tr("网络连接失败，请检查远端服务、代理和网络连接。");
    if (/InvalidURL/i.test(type)) return tr("地址格式无效，请检查配置的地址。");
    if (context.stage === "parse" || item.code === "delivery.parse_failed")
        return tr("返回内容无法解析为有效订阅或文章，请检查来源格式。");
    return "";
}

function diagnosticDetails(item) {
    const rows = Object.entries(item.context || {}).filter(
        ([key, value]) => Object.hasOwn(diagnosticFields, key) && value !== null && value !== "",
    );
    return html`<div class="diagnostic-details">
        <dl class="diagnostic-context">
            <div>
                <dt>事件代码</dt>
                <dd class="mono">${esc(item.code)}</dd>
            </div>
            ${rows
                .map(
                    ([key, value]) =>
                        html`<div>
                            <dt>${tr(diagnosticFields[key])}</dt>
                            <dd class="${["source_host", "exception_type", "route"].includes(key) ? "mono" : ""}">
                                ${esc(
                                    ["next_retry_at", "next_check_at"].includes(key)
                                        ? diagnosticDate(value)
                                        : key === "duration_ms"
                                          ? n(value) + " ms"
                                          : key === "retry_after_seconds"
                                            ? n(value) + " s"
                                            : ["stage", "status"].includes(key) &&
                                                Object.hasOwn(diagnosticValues, value)
                                              ? tr(diagnosticValues[value])
                                              : value,
                                )}
                            </dd>
                        </div>`,
                )
                .join("")}
        </dl>
        ${item.detail ? html`<pre class="diagnostic-technical">${esc(item.detail)}</pre>` : ""}
    </div>`;
}
function diagnosticTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return esc(tr("未记录"));
    return html`<time title="${esc(diagnosticDate(value))}"
        ><strong
            >${esc(
                new Intl.DateTimeFormat(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                }).format(date),
            )}</strong
        ><small>${esc(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date))}</small></time
    >`;
}
function diagnosticEntries(data, feedLinks = true) {
    if (!data.items?.length)
        return empty(
            tr("暂无符合条件的运行日志"),
            tr("日志从启用此版本后开始记录，旧的失败次数无法还原为历史日志。可调整筛选或等待下一次实际任务。"),
            "diagnostics",
        );
    return html`<div class="diagnostic-list">
        <div class="diagnostic-list-head" aria-hidden="true">
            <span>时间</span><span>订阅源 / 会话</span><span>事件与原因</span><span>级别</span><span></span>
        </div>
        ${data.items
            .map((item) => {
                const context = item.context || {},
                    reason = diagnosticReason(item);
                const category = tr(diagnosticCategories[item.category] || "系统运行");
                const heading = Object.hasOwn(diagnosticEvents, item.code)
                    ? tr(diagnosticEvents[item.code])
                    : item.message || item.code;
                const sourceTitle =
                    item.feed_title ||
                    item.target_title ||
                    (item.feed_id
                        ? tr("订阅源 #") + item.feed_id
                        : item.target_id
                          ? tr("会话 #") + item.target_id
                          : category);
                return html`<article
                    class="diagnostic-entry diagnostic-${["info", "warning", "error"].includes(item.level)
                        ? item.level
                        : "info"}"
                >
                    <details>
                        <summary class="diagnostic-summary" aria-label="${tr("查看日志详情")} · ${esc(heading)}">
                            <span class="diagnostic-time">${diagnosticTime(item.at)}</span>
                            <span class="diagnostic-source"
                                ><strong title="${esc(sourceTitle)}">${esc(sourceTitle)}</strong
                                ><small
                                    >${esc(category)}${item.feed_id
                                        ? html` · #${esc(item.feed_id)}`
                                        : item.target_id
                                          ? html` · ${esc(item.target_id)}`
                                          : ""}</small
                                ></span
                            >
                            <span class="diagnostic-event"
                                ><strong>${esc(heading)}</strong
                                ><small
                                    >${Number(context.http_status) > 0
                                        ? html`<b class="diagnostic-http">HTTP ${esc(context.http_status)}</b>`
                                        : ""}${esc(reason || context.exception_type || item.detail || "")}</small
                                ></span
                            >
                            <span class="diagnostic-severity"
                                >${pill(
                                    tr(diagnosticLevels[item.level] || "信息"),
                                    item.level === "error" ? "danger" : item.level === "warning" ? "warn" : "gray",
                                )}</span
                            ><span class="diagnostic-expand">${icon("chevron", 14)}</span>
                        </summary>
                        <div class="diagnostic-expanded">
                            ${reason ? html`<p class="diagnostic-reason">${esc(reason)}</p>` : ""}
                            <div class="diagnostic-facts">
                                ${item.feed_id
                                    ? html`<span
                                          >订阅源 <strong>${esc(item.feed_title || item.feed_id)}</strong> · ID
                                          ${esc(item.feed_id)}</span
                                      >`
                                    : ""}
                                ${item.target_id
                                    ? html`<span
                                          >会话 <strong>${esc(item.target_title || item.target_id)}</strong> · ID
                                          ${esc(item.target_id)}</span
                                      >`
                                    : ""}
                                ${context.duration_ms !== undefined
                                    ? html`<span>${n(context.duration_ms)} ms</span>`
                                    : ""}
                                ${context.failures !== undefined
                                    ? html`<span>${message("fetchFailures", { count: n(context.failures) })}</span>`
                                    : ""}
                            </div>
                            ${context.next_retry_at
                                ? html`<p class="hint">
                                      已安排的下次重试：${esc(diagnosticDate(context.next_retry_at))}
                                  </p>`
                                : ""}
                            ${context.next_check_at
                                ? html`<p class="hint">下次检查：${esc(diagnosticDate(context.next_check_at))}</p>`
                                : ""}
                            ${diagnosticDetails(item)}
                            ${feedLinks && item.feed_id
                                ? html`<div>
                                      <button
                                          class="text-link small"
                                          data-feed-logs="${esc(item.feed_id)}"
                                          aria-label="查看抓取日志 ${esc(item.feed_title || item.feed_id)}"
                                      >
                                          查看抓取日志 ${icon("arrow", 13)}
                                      </button>
                                  </div>`
                                : ""}
                        </div>
                    </details>
                </article>`;
            })
            .join("")}
    </div>`;
}
function diagnosticNotice(data) {
    return html`${data.degraded
        ? html`<p class="notice warning" role="alert">
              运行日志存储暂时异常，当前记录可能不完整。请检查磁盘和服务进程日志。
          </p>`
        : ""}${data.dropped
        ? html`<p class="notice warning">${message("logsDropped", { count: n(data.dropped) })}</p>`
        : ""}`;
}
function diagnosticRetention(data) {
    const retention = data.retention || {};
    return html`<details class="diagnostic-policy">
        <summary>记录范围与保留策略</summary>
        <p class="diagnostic-retention hint">
            ${message("logRetention", {
                days: n(retention.days || 30),
                total: n(retention.max_entries || 5000),
                feed: n(retention.per_feed || 100),
            })}${data.started_at
                ? html`<br />开始记录：${esc(diagnosticDate(data.started_at))}`
                : ""}<br />日志按需刷新；不记录普通聊天正文、请求正文或凭证。
        </p>
    </details>`;
}
function diagnosticPager(data, modalView = false) {
    const page = data.page || 1,
        size = data.size || 30,
        total = data.total || 0;
    return html`<div class="pager">
        <span
            >${message("pager", {
                total: n(total),
                page: n(page),
                pages: n(Math.max(1, Math.ceil(total / size))),
            })}</span
        >
        <div class="inline">
            <button
                type="button"
                ${modalView === "related"
                    ? "data-related-log-page"
                    : modalView
                      ? "data-feed-log-page"
                      : "data-page"}="${page - 1}"
                ${page <= 1 ? "disabled" : ""}
            >
                上一页</button
            ><button
                type="button"
                ${modalView === "related"
                    ? "data-related-log-page"
                    : modalView
                      ? "data-feed-log-page"
                      : "data-page"}="${page + 1}"
                ${page * size >= total ? "disabled" : ""}
            >
                下一页
            </button>
        </div>
    </div>`;
}
function diagnosticsQuery() {
    const params = new URLSearchParams({ page: S.page, size: 30 });
    for (const [key, value] of Object.entries({
        category: S.logCategory,
        level: S.logLevel,
        feed_id: S.logFeed,
        target_id: S.logTarget,
    }))
        if (value) params.set(key, value);
    return params;
}

function diagnosticsPage(data) {
    return (
        header(
            tr("运行日志"),
            tr("查看抓取、推送、管理员通知与系统运行的结果和异常原因。"),
            html`<button data-action="logs-refresh">${icon("refresh", 15)}刷新日志</button>`,
        ) +
        html`<section class="panel diagnostics-panel">
            <div class="toolbar diagnostics-toolbar">
                <div class="toolbar-main">
                    <label
                        >日志类别<select id="log-category">
                            <option value="">全部类别</option>
                            ${Object.entries(diagnosticCategories)
                                .map(
                                    ([value, title]) =>
                                        html`<option value="${value}" ${S.logCategory === value ? "selected" : ""}>
                                            ${tr(title)}
                                        </option>`,
                                )
                                .join("")}
                        </select></label
                    ><label
                        >严重程度<select id="log-level">
                            <option value="">全部级别</option>
                            ${Object.entries(diagnosticLevels)
                                .map(
                                    ([value, title]) =>
                                        html`<option value="${value}" ${S.logLevel === value ? "selected" : ""}>
                                            ${tr(title)}
                                        </option>`,
                                )
                                .join("")}
                        </select></label
                    >
                </div>
                <div class="toolbar-secondary">
                    ${S.logFeed
                        ? html`<span class="diagnostic-scope">订阅源 ID <strong>${esc(S.logFeed)}</strong></span>`
                        : ""}${S.logTarget
                        ? html`<span class="diagnostic-scope">会话 ID <strong>${esc(S.logTarget)}</strong></span>`
                        : ""}${S.logFeed || S.logTarget || S.logCategory || S.logLevel
                        ? html`<button class="quiet small" data-action="logs-clear">清除日志筛选</button>`
                        : ""}
                </div>
            </div>
            <div class="diagnostics-body">
                ${diagnosticNotice(data)}${diagnosticEntries(data)}${diagnosticRetention(data)}
            </div>
            ${diagnosticPager(data)}
        </section>`
    );
}
async function showFeedLogs(feedId, page = 1) {
    const context = { action: "feed-logs", feedId: String(feedId), page: Math.max(1, page || 1) };
    modalState = context;
    modal(tr("订阅源抓取日志"), html`<p role="status">正在加载抓取日志…</p>`);
    try {
        const data = await api(
            `/feeds/${encodeURIComponent(context.feedId)}/diagnostics?` +
                new URLSearchParams({ category: "fetch", page: context.page, size: 20 }),
        );
        if (modalState !== context || !$("#dialog").open) return;
        const feed = data.feed || {};
        modal(
            tr("订阅源抓取日志"),
            html`<div class="feed-log-summary">
                    <strong>${esc(feed.title || context.feedId)}</strong
                    ><span class="hint">订阅源 ID ${esc(feed.id || context.feedId)}</span>
                    <div class="inline">
                        ${feed.errors
                            ? pill(message("fetchFailures", { count: n(feed.errors) }), "warn")
                            : pill(tr("当前没有连续抓取失败"), "gray")}${feed.state === 0
                            ? pill(tr("来源已停用"), "warn")
                            : ""}
                    </div>
                    <p class="hint">
                        ${feed.next_check_time
                            ? tr(feed.errors ? "已安排的下次重试：" : "下次检查：") +
                              esc(diagnosticDate(feed.next_check_time))
                            : tr("未记录单独的延后重试时间；实际检查由当前调度决定。")}
                    </p>
                    ${feed.errors && !data.total && !data.items?.length
                        ? html`<p class="notice warning">
                              当前只有连续失败次数，没有保存当时的错误原因。下一次实际抓取后会开始显示诊断记录。
                          </p>`
                        : ""}
                </div>
                ${diagnosticNotice(data)}${diagnosticEntries(data, false)}${diagnosticPager(
                    data,
                    true,
                )}${diagnosticRetention(data)}`,
            html`<button type="button" data-related-feed-logs="${esc(context.feedId)}">全部相关运行日志</button
                ><button type="button" data-action="feed-logs-retry">${icon("refresh", 15)}刷新日志</button
                ><button type="button" data-action="close">关闭</button>`,
        );
        $("#dialog [data-action=close]").focus({ preventScroll: true });
    } catch (error) {
        if (modalState !== context || !$("#dialog").open) return;
        if (error.status === 401) {
            $("#dialog").close();
            S.session = null;
            return login();
        }
        modal(
            tr("订阅源抓取日志"),
            html`<p class="notice warning" role="alert">${esc(error.message)}</p>
                <button type="button" data-action="feed-logs-retry">重新加载抓取日志</button>`,
        );
    }
}
async function showRelatedLogs(scope, page = 1) {
    const context = { action: "related-logs", ...scope, id: scope.targetId, page };
    modalState = context;
    modal(tr("相关运行日志"), html`<p role="status">正在加载运行日志…</p>`);
    try {
        const query = new URLSearchParams({ page, size: 20 });
        if (scope.feedId) query.set("feed_id", scope.feedId);
        if (scope.targetId) query.set("target_id", scope.targetId);
        const data = await api("/diagnostics?" + query);
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            tr("相关运行日志"),
            html`${diagnosticNotice(data)}${diagnosticEntries(data, false)}${diagnosticPager(
                data,
                "related",
            )}${diagnosticRetention(data)}`,
            html`<button type="button" data-related-log-page="${page}">${icon("refresh", 15)}刷新日志</button
                ><button type="button" data-action="close">关闭</button>`,
        );
    } catch (error) {
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            tr("相关运行日志"),
            html`<p class="notice warning" role="alert">${esc(error.message)}</p>
                <button type="button" data-related-log-page="${page}">重新加载</button>`,
        );
    }
}
async function showTargetSubscriptions(id, page = 1) {
    const context = { action: "target-subscriptions", id: String(id), page };
    context.onResume = () => {
        if (context.refreshNeeded) showTargetSubscriptions(id, page);
    };
    modalState = context;
    modal(tr("此会话的订阅"), html`<p role="status">正在加载订阅…</p>`);
    try {
        const data = await api("/subscriptions?" + new URLSearchParams({ target: id, page, size: 20 }));
        if (modalState !== context || !$("#dialog").open) return;
        context.items = data.items;
        modal(
            tr("此会话的订阅"),
            html`<p class="hint">${esc(data.items[0]?.target_title || id)}</p>
                ${data.items.length
                    ? html`<div class="target-subscription-list">
                          ${data.items
                              .map(
                                  (item) =>
                                      html`<div class="target-subscription-row">
                                          <div>
                                              <strong>${esc(item.title)}</strong>
                                              <p class="hint">
                                                  ${item.state ? tr("已启用") : tr("已暂停")}${item.errors
                                                      ? " · " + message("fetchFailures", { count: n(item.errors) })
                                                      : ""}
                                              </p>
                                          </div>
                                          <button type="button" data-sub-edit="${item.id}">编辑</button>
                                      </div>`,
                              )
                              .join("")}
                      </div>`
                    : empty(tr("暂无订阅"), tr("可以导入 OPML，为此会话添加订阅。"))}${targetSubscriptionsPager(data)}`,
            html`<button type="button" data-import-target="${esc(id)}">导入 OPML</button
                ><button type="button" data-action="close">关闭</button>`,
        );
    } catch (error) {
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            tr("此会话的订阅"),
            html`<p class="notice warning" role="alert">${esc(error.message)}</p>
                <button type="button" data-target-sub-page="${page}">重新加载</button>`,
        );
    }
}
function targetSubscriptionsPager(data) {
    const page = data.page || 1,
        size = data.size || 20;
    return html`<div class="pager">
        <span
            >${message("pager", {
                total: n(data.total),
                page: n(page),
                pages: n(Math.max(1, Math.ceil(data.total / size))),
            })}</span
        >
        <div class="inline">
            <button type="button" data-target-sub-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button
            ><button type="button" data-target-sub-page="${page + 1}" ${page * size >= data.total ? "disabled" : ""}>
                下一页
            </button>
        </div>
    </div>`;
}
const manualErrors = {
    MANUAL_FETCH_CONFIRM_REQUIRED: "请先确认本次操作的接收范围。",
    MANUAL_FETCH_BANNED: "此会话已被封禁，无法抓取或推送。请先解除封禁。",
    MANUAL_FETCH_DEPARTED: "机器人已退出此会话，无法向其推送。",
    MANUAL_FETCH_PAUSED: "此订阅已暂停，请先恢复订阅。",
    MANUAL_FETCH_INACTIVE: "此订阅源已停用，请先恢复相关订阅。",
    MANUAL_FETCH_OFFLINE:
        "真实数据离线预览不会访问订阅源或发送 Telegram 消息。请在运行中的管理实例或独立测试机器人上使用此功能。",
    MANUAL_FETCH_STOPPING: "实例正在停止，暂时无法执行抓取。",
    MANUAL_FETCH_BUSY: "此订阅源正在抓取，请等待当前任务完成。",
    MANUAL_FETCH_LIMIT: "手动任务已达到并发上限，请等待已有任务完成。",
    MANUAL_FETCH_JOB_NOT_FOUND: "任务记录已过期或不存在，请重新检查。",
    MANUAL_FETCH_FAILED: "抓取或推送未完成，请查看相关日志中的具体原因。",
    MANUAL_FETCH_TIMEOUT: "本次任务超时，请查看相关日志后重试。",
    MANUAL_FETCH_CANCELLED: "本次任务已取消。",
    MANUAL_FETCH_EMPTY: "订阅源没有可用于测试推送的文章。",
    MANUAL_FETCH_RATE_LIMITED: "接收会话正在等待 Telegram 限流恢复，本次没有进行抓取。",
    MANUAL_FETCH_NO_RECIPIENTS: "此来源当前没有启用的接收会话，无法提交推送。",
    MANUAL_PUSH_UNCONFIRMED: "Telegram 未确认测试文章完整送达，请查看相关日志。",
    MANUAL_PUSH_STOPPED: "发送已停止，请查看最近文章和运行日志中的实际推送状态。",
};
const manualError = (data) => {
    if (
        data.code === "MANUAL_PUSH_STOPPED" &&
        ["发送已停止，本篇未发送。", "发送被停止，可能已有部分消息送达。"].includes(data.error)
    )
        return tr(data.error);
    return tr(manualErrors[data.code] || "") || data.error || data.reason || tr("操作未完成，请稍后重试。");
};
function activeManual(context) {
    return modalState === context && $("#dialog").open;
}
async function showManualFetch(item) {
    const context = {
        action: "manual-fetch",
        item,
        mode: "updates",
        confirmed: false,
        job: null,
        workSerial: 0,
        pollCount: 0,
    };
    context.onHide = () => {
        clearTimeout(context.pollTimer);
        context.workSerial++;
        context.polling = false;
    };
    context.onResume = () => {
        if (context.needsRender) {
            context.needsRender = false;
            renderManualFetch(context);
        }
        if (!context.capabilities) loadManualCapabilities(context);
        else if (["queued", "running"].includes(context.job?.status)) pollManualFetch(context);
    };
    modalState = context;
    renderManualFetch(context);
    await loadManualCapabilities(context);
}
async function loadManualCapabilities(context) {
    const serial = context.workSerial;
    try {
        const data = await api(`/subscriptions/${context.item.id}/fetch-now`);
        if (!activeManual(context) || serial !== context.workSerial) return;
        context.capabilities = data;
        context.loadError = null;
        renderManualFetch(context);
    } catch (error) {
        if (!activeManual(context) || serial !== context.workSerial) return;
        context.loadError = manualError({ code: error.code, error: error.message });
        renderManualFetch(context);
    }
}
function manualJobContent(context) {
    const job = context.job,
        result = job.result || {};
    const statusLabels = {
        queued: "任务已排队",
        running: "正在抓取与处理",
        completed: "任务已完成",
        failed: "任务未完成",
    };
    let explanation = "";
    if (job.simulated) explanation = "这是离线模拟结果，没有访问订阅源，也没有发送 Telegram 消息。";
    else if (job.status === "completed" && job.mode === "test_latest" && result.push_status === "confirmed")
        explanation = "Telegram 已确认完整发送，请到当前接收会话查看。";
    else if (result.push_status === "submitted")
        explanation = "新文章已提交给现有推送流程。这不代表已经送达，请到接收会话或运行日志确认。";
    else if (["not_modified", "empty", "unchanged"].includes(result.outcome))
        explanation = "本次检查没有发现可推送的新文章。";
    else if (["queued", "running"].includes(job.status))
        explanation = "任务由服务器继续执行。返回或关闭窗口只会停止页面查询，不会取消已提交的任务。";
    return html`<section class="manual-job" aria-live="polite">
        <div class="spread">
            <strong>${tr(statusLabels[job.status] || "任务状态未知")}</strong>${pill(
                job.simulated
                    ? tr("离线模拟")
                    : job.status === "failed"
                      ? tr("未完成")
                      : ["queued", "running"].includes(job.status)
                        ? tr("处理中")
                        : tr("已处理"),
                job.status === "failed" ? "warn" : "gray",
            )}
        </div>
        ${explanation ? html`<p>${tr(explanation)}</p>` : ""}${job.error || job.status === "failed"
            ? html`<p class="notice warning" role="alert">${esc(manualError(job))}</p>`
            : ""}${job.status === "completed"
            ? html`<dl class="manual-result">
                  <div>
                      <dt>发现新文章</dt>
                      <dd>${n(result.new_entries ?? null)}</dd>
                  </div>
                  <div>
                      <dt>涉及接收会话</dt>
                      <dd>${n(result.affected_recipients ?? job.affected_recipients ?? null)}</dd>
                  </div>
              </dl>`
            : ""}${context.pollError
            ? html`<p class="notice warning" role="alert">${esc(context.pollError)}</p>`
            : ""}${context.pollCount >= 90 && ["queued", "running"].includes(job.status)
            ? html`<p class="hint">任务仍在执行，已暂停自动查询。可刷新状态继续查看。</p>`
            : ""}
    </section>`;
}
function renderManualFetch(context) {
    if (modalState !== context) return;
    const caps = context.capabilities,
        mode = context.mode,
        locked = Boolean(context.job || context.submitting),
        ready = caps?.available && !locked;
    const recipients = caps?.affected_recipients ?? null;
    if (["completed", "failed"].includes(context.job?.status))
        for (const frame of modalHistory)
            if (frame.state.action === "recent-articles") frame.state.refreshNeeded = true;
    const confirmLabel =
        mode === "test_latest"
            ? message("manualTestConfirm", { name: context.item.target_title })
            : message("manualUpdatesConfirm", { count: n(recipients) });
    const body = html`<div class="manual-source">
            <strong>${esc(context.item.title)}</strong>
            <p class="hint">接收会话：${esc(context.item.target_title)}</p>
        </div>
        ${caps?.simulated ? html`<p class="notice">离线演示仅模拟抓取与推送，不会连接订阅源或 Telegram。</p>` : ""}
        ${!caps && !context.loadError ? html`<p role="status">正在检查可执行操作和接收范围…</p>` : ""}
        ${context.loadError
            ? html`<p class="notice warning" role="alert">${esc(context.loadError)}</p>
                  <button type="button" data-manual-retry>重新检查可用性</button>`
            : ""}
        ${caps && !caps.available ? html`<p class="notice warning" role="alert">${esc(manualError(caps))}</p>` : ""}
        ${context.job
            ? manualJobContent(context)
            : html`<div class="manual-modes">
                      <label class="manual-mode ${mode === "updates" ? "selected" : ""}"
                          ><input
                              type="radio"
                              name="mode"
                              value="updates"
                              ${mode === "updates" ? "checked" : ""}
                              ${!ready ? "disabled" : ""}
                          /><span
                              ><strong>检查更新并推送</strong
                              ><small
                                  >遵循正常去重规则，只推送新发现的文章。此来源由多个会话共享时，影响所有启用的接收会话。</small
                              >${caps
                                  ? html`<b>${message("manualRecipientCount", { count: n(recipients) })}</b>`
                                  : ""}</span
                          ></label
                      >
                      <label class="manual-mode ${mode === "test_latest" ? "selected" : ""}"
                          ><input
                              type="radio"
                              name="mode"
                              value="test_latest"
                              ${mode === "test_latest" ? "checked" : ""}
                              ${!ready ? "disabled" : ""}
                          /><span
                              ><strong>测试推送最新一篇</strong
                              ><small
                                  >仅推送到当前接收会话。即使这篇文章已经推送过，也会再次发送；不改变正常检查的去重记录。</small
                              ></span
                          ></label
                      >
                  </div>
                  ${caps?.available
                      ? html`<label class="inline-label manual-confirm"
                            ><input
                                type="checkbox"
                                name="confirm_manual"
                                required
                                ${context.confirmed ? "checked" : ""}
                                ${locked ? "disabled" : ""}
                            /><span>${esc(confirmLabel)}</span></label
                        >`
                      : ""}`}`;
    const footer = context.job
        ? html`${context.job.feed_id && S.features.diagnostics
                  ? html`<button type="button" data-feed-logs="${esc(context.job.feed_id)}">查看相关抓取日志</button>`
                  : ""}<button type="button" data-manual-refresh ${context.polling ? "disabled" : ""}>刷新状态</button
              >${["completed", "failed"].includes(context.job.status)
                  ? html`<button type="button" data-manual-reset>重新选择操作</button>`
                  : ""}<button type="button" data-action="back">
                  ${modalHistory.length ? modalParentLabel(modalHistory.at(-1)) : tr("关闭")}
              </button>`
        : html`<button type="button" data-action="close">取消</button
              ><button class="primary" type="submit" ${!ready || !context.confirmed ? "disabled" : ""}>
                  ${context.submitting ? tr("正在提交…") : tr("开始执行")}
              </button>`;
    modal(tr("立即抓取"), body, footer);
}
async function submitManualFetch(context, formData) {
    if (!context.capabilities?.available || context.submitting || context.job) return;
    if (!formData.has("confirm_manual")) throw new Error(tr("请先确认本次操作的接收范围。"));
    context.submitting = true;
    context.pollError = null;
    renderManualFetch(context);
    const serial = context.workSerial;
    try {
        const job = await api(`/subscriptions/${context.item.id}/fetch-now`, {
            method: "POST",
            body: { mode: context.mode, confirm: true },
        });
        context.job = job;
        context.submitting = false;
        if (!activeManual(context)) {
            context.needsRender = true;
            return;
        }
        renderManualFetch(context);
        if (["queued", "running"].includes(job.status))
            context.pollTimer = setTimeout(() => pollManualFetch(context), 1000);
    } catch (error) {
        context.submitting = false;
        context.loadError = manualError({ code: error.code, error: error.message });
        if (!activeManual(context)) {
            context.needsRender = true;
            return;
        }
        renderManualFetch(context);
    }
}
async function pollManualFetch(context) {
    if (!activeManual(context) || !context.job || context.polling) return;
    const serial = context.workSerial;
    context.currentPoll = serial;
    context.polling = true;
    context.pollCount++;
    try {
        const job = await api(`/fetch-jobs/${encodeURIComponent(context.job.id)}`);
        if (!activeManual(context) || serial !== context.workSerial) return;
        context.job = job;
        context.pollError = null;
        context.polling = false;
        renderManualFetch(context);
        if (["queued", "running"].includes(job.status) && context.pollCount < 90)
            context.pollTimer = setTimeout(() => pollManualFetch(context), 2000);
    } catch (error) {
        if (!activeManual(context) || serial !== context.workSerial) return;
        context.pollError = error.message;
        context.polling = false;
        renderManualFetch(context);
    } finally {
        if (context.currentPoll === serial) context.polling = false;
    }
}

function safeArticleLink(value) {
    if (typeof value !== "string" || value.length > 4096 || /[\s\\]/.test(value)) return "";
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
}
const articleStatuses = {
    queued: "等待发送",
    sent: "已推送",
    failed: "推送失败",
    unconfirmed: "结果未确认",
    not_recorded: "暂无推送记录",
};
const knownArticleReasons = new Set([
    "文章解析失败，未能生成推送内容。",
    "发送已停止，本篇未发送。",
    "发送被停止，可能已有部分消息送达。",
    "实例重启中断了上次推送，无法确认是否送达。",
]);
function articleContent(item) {
    const link = safeArticleLink(item.link),
        retry = item.status === "sent" && item.last_attempt_status && item.last_attempt_status !== "sent";
    const retryLabels = { queued: "正在重新发送", failed: "最近一次尝试失败", unconfirmed: "最近一次结果未确认" };
    const sources = { scheduled: "正常检查", manual: "手动检查", test: "测试推送", demo: "离线演示" };
    return html`<article class="recent-article">
        <details>
            <summary class="recent-article-heading">
                <div>
                    <strong>${esc(item.title || tr("无标题文章"))}</strong
                    ><small>抓取时间：${esc(diagnosticDate(item.fetched_at))}</small>
                </div>
                <span class="article-badges"
                    >${pill(
                        tr(articleStatuses[item.status] || "暂无推送记录"),
                        item.status === "sent"
                            ? "success"
                            : ["failed", "unconfirmed"].includes(item.status)
                              ? "warn"
                              : "gray",
                    )}${retry
                        ? pill(tr(retryLabels[item.last_attempt_status] || "最近一次结果未确认"), "warn")
                        : ""}</span
                >${icon("chevron", 14)}
            </summary>
            <div class="recent-article-body">
                <p class="article-summary">${esc(item.summary || tr("没有可显示的文本摘要。"))}</p>
                <dl class="diagnostic-context">
                    ${item.published_at
                        ? html`<div>
                              <dt>发布时间</dt>
                              <dd>${esc(diagnosticDate(item.published_at))}</dd>
                          </div>`
                        : ""}${item.last_sent_at
                        ? html`<div>
                              <dt>最近成功推送</dt>
                              <dd>${esc(diagnosticDate(item.last_sent_at))}</dd>
                          </div>`
                        : ""}${item.last_attempt_at
                        ? html`<div>
                              <dt>最近发送尝试</dt>
                              <dd>${esc(diagnosticDate(item.last_attempt_at))}</dd>
                          </div>`
                        : ""}${item.source && Object.hasOwn(sources, item.source)
                        ? html`<div>
                              <dt>触发方式</dt>
                              <dd>${tr(sources[item.source])}</dd>
                          </div>`
                        : ""}
                </dl>
                ${item.detail
                    ? html`<p class="hint">
                          ${esc(knownArticleReasons.has(item.detail) ? tr(item.detail) : item.detail)}
                      </p>`
                    : ""}${link
                    ? html`<a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer"
                          >打开原文 ${icon("arrow", 13)}</a
                      >`
                    : ""}
            </div>
        </details>
    </article>`;
}
async function showRecentArticles(item) {
    const context = { action: "recent-articles", item, id: String(item.id) };
    context.onResume = () => {
        if (context.refreshNeeded) showRecentArticles(item);
    };
    modalState = context;
    modal(tr("最近文章"), html`<p role="status">正在加载最近文章…</p>`);
    try {
        const data = await api(`/subscriptions/${item.id}/articles`);
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            tr("最近文章"),
            html`<div class="article-scope">
                    <strong>${esc(data.feed?.title || item.title)}</strong>
                    <p>
                        接收会话：<strong>${esc(data.target?.title || item.target_title)}</strong> · ID
                        ${esc(data.target?.id || item.target)}
                    </p>
                    <p class="hint">以下状态仅对应此接收会话；“暂无推送记录”不代表从未推送。</p>
                </div>
                ${data.degraded || data.dropped
                    ? html`<p class="notice warning" role="alert">
                          文章记录暂时不完整，请稍后刷新并检查磁盘和服务进程日志。
                      </p>`
                    : ""}${data.items?.length
                    ? html`<div class="recent-article-list">${data.items.map(articleContent).join("")}</div>`
                    : empty(tr("尚无最近文章记录"), tr("从启用后成功抓取开始记录；历史推送状态无法补回。"))}
                <p class="hint article-retention">
                    ${message("articleRetention", { count: n(data.retention?.per_feed || 20) })}
                    ${tr("从启用后成功抓取开始记录；历史推送状态无法补回。")}
                </p>`,
            html`${S.features.manual_fetch
                    ? html`<button type="button" data-manual-fetch="${item.id}">立即抓取</button>`
                    : ""}<button type="button" data-article-refresh>刷新文章</button
                ><button type="button" data-action="close">关闭</button>`,
        );
    } catch (error) {
        if (modalState !== context || !$("#dialog").open) return;
        modal(
            tr("最近文章"),
            html`<p class="notice warning" role="alert">${esc(error.message)}</p>
                <button type="button" data-article-refresh>重新加载</button>`,
        );
    }
}

function settings(d, tokens, security, feature) {
    const o = d.options;
    const groups = [
        {
            label: tr("订阅与推送"),
            items: [
                ["general", "rss", tr("更新与订阅"), tr("检查间隔与订阅限制")],
                ...(S.features.notifications ? [["notifications", "alert", tr("通知"), tr("故障与新会话提醒")]] : []),
            ],
        },
        {
            label: tr("实例与数据"),
            items: [
                ...(S.features.runtime ? [["runtime", "settings", tr("运行配置"), tr("连接、网络与系统参数")]] : []),
                ...(S.features.backups ? [["backups", "down", tr("备份与恢复"), tr("导出数据与恢复备份")]] : []),
                ["instance", "chats", tr("实例信息"), tr("连接状态与实例信息")],
            ],
        },
        {
            label: tr("访问与安全"),
            items: [
                ["tokens", "key", tr("API 访问令牌"), tr("Agent 与外部应用授权")],
                ...(["console_admin", "preview_admin"].includes(S.session.account_type)
                    ? [["security", "user", tr("账户安全"), tr("密码与登录会话")]]
                    : []),
            ],
        },
    ];
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
            <div class="form-body session-list">
                <h2>网页登录会话</h2>
                <p>${n(sessions.items.length)} ${tr("个有效的网页登录会话")}</p>
                <button class="danger" data-action="revoke-sessions">退出所有网页登录会话</button>
            </div>
        </section>`;
    }
    return (
        header(tr("设置"), tr("管理订阅默认值、通知、运行配置和访问安全。")) +
        html`<div class="settings">
            <nav class="settings-nav" aria-label="设置栏目">
                ${groups
                    .map(
                        (group) =>
                            html`<div class="settings-group">
                                <p class="settings-group-label">${group.label}</p>
                                ${group.items
                                    .map(
                                        ([key, i, label, hint]) =>
                                            html`<button
                                                data-settings="${key}"
                                                class="${S.settings === key ? "active" : ""}"
                                                aria-label="${esc(label)}"
                                                ${S.settings === key ? 'aria-current="page"' : ""}
                                            >
                                                ${icon(i, 17)}<span class="settings-nav-copy"
                                                    ><strong>${label}</strong><small>${hint}</small></span
                                                >${icon("chevron", 12)}
                                            </button>`,
                                    )
                                    .join("")}
                            </div>`,
                    )
                    .join("")}
            </nav>
            <div class="settings-content">${content}</div>
        </div>`
    );
}

function modalKey(state) {
    return [state.action, state.item?.id ?? state.feedId ?? state.id ?? state.channel ?? ""].join(":");
}
function modalParentLabel(frame) {
    const labels = {
        "edit-sub": "返回订阅设置",
        "edit-target": "返回会话设置",
        "target-subscriptions": "返回会话订阅",
        "feed-logs": "返回抓取日志",
        "related-logs": "返回运行日志",
        "manual-fetch": "返回手动抓取",
        "recent-articles": "返回最近文章",
        recipients: "返回接收会话设置",
        import: "返回导入订阅",
        "new-sub": "返回添加订阅",
    };
    return tr(labels[frame.state.action] || "返回上一页");
}
function pauseModal(frame) {
    if (!frame) return;
    frame.scrollTop = $(".dialog-body", frame.node)?.scrollTop || 0;
    frame.focus = frame.node.contains(document.activeElement) ? document.activeElement : frame.focus;
    if (frame.focus?.dataset) {
        const entry = Object.entries(frame.focus.dataset)[0];
        if (entry)
            frame.focusSelector = `[data-${entry[0].replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(entry[1])}"]`;
    }
    if (!frame.focusSelector && frame.focus?.name)
        frame.focusSelector = `[name="${CSS.escape(frame.focus.name)}"]${["radio", "checkbox"].includes(frame.focus.type) ? `[value="${CSS.escape(frame.focus.value)}"]` : ""}`;
    if ($("#target-picker", frame.node)) clearTimeout(searchTimer);
    frame.state.onHide?.();
}
function backModal() {
    if (!modalHistory.length) return closeModal();
    pauseModal(modalFrame);
    modalFrame = modalHistory.pop();
    modalState = modalFrame.state;
    $("#dialog").replaceChildren(modalFrame.node);
    $(".dialog-body", modalFrame.node).scrollTop = modalFrame.scrollTop || 0;
    const focus = modalFrame.focus?.isConnected
        ? modalFrame.focus
        : modalFrame.focusSelector
          ? $(modalFrame.focusSelector, modalFrame.node) || $("#dialog [data-action=close]")
          : $("#dialog [data-action=close]");
    focus?.focus({ preventScroll: true });
    modalState.onResume?.();
    if ($("#target-picker") && !$("#target-picker").children.length)
        targetPicker(modalState.multiple).catch((e) => toast(e.message));
}
function closeModal() {
    pauseModal(modalFrame);
    for (const frame of modalHistory) frame.state.onHide?.();
    modalFrame = null;
    modalHistory = [];
    modalState = {};
    $("#dialog").close();
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
    else $("#main")?.focus({ preventScroll: true });
    modalReturnFocus = null;
}
function finishModal() {
    if (modalHistory.length) backModal();
    else closeModal();
}
function modalItem(id, type) {
    const states = [modalState, ...modalHistory.map((frame) => frame.state)];
    const direct = states.find((state) => state.action === type && String(state.item?.id) === String(id));
    if (direct) return direct.item;
    if (type === "edit-sub") {
        const article = states.find(
            (state) =>
                ["recent-articles", "manual-fetch"].includes(state.action) && String(state.item?.id) === String(id),
        );
        if (article) return article.item;
    }
    for (const state of states) {
        const item = state.items?.find((entry) => String(entry.id) === String(id));
        if (item) return item;
    }
    return S.items.find((entry) => String(entry.id) === String(id));
}
function syncTargetFrames(item) {
    if (!item?.id) return;
    for (const frame of [...modalHistory, modalFrame].filter(Boolean)) {
        if (frame.state.action !== "edit-target" || String(frame.state.item.id) !== String(item.id)) continue;
        frame.state.item = item;
        const controls = $(".service-controls", frame.node);
        if (controls) {
            const template = document.createElement("template");
            template.innerHTML = chatServiceControls(item);
            controls.replaceWith(template.content);
        }
        $("#dialog-title", frame.node).textContent = item.title;
    }
}
function invalidateRemovedSubscriptions(result) {
    if (!Array.isArray(result.items) || result.items.some((item) => item.id === undefined)) return;
    const ids = new Set(result.items.map((item) => String(item.id)));
    for (const frame of modalHistory) {
        const state = frame.state;
        if (
            state.action !== "edit-sub" ||
            String(state.item.feed_id) !== String(result.feed_id) ||
            ids.has(String(state.item.id))
        )
            continue;
        state.invalid = true;
        const note = document.createElement("p");
        note.className = "notice warning";
        note.setAttribute("role", "alert");
        note.textContent = tr(
            "当前接收会话已取消此订阅，原订阅已不存在，无法继续保存。表单草稿仍保留供复制；请返回会话订阅选择其他订阅。",
        );
        $(".dialog-body", frame.node).prepend(note);
        $$("button[type=submit],[data-manual-fetch],[data-sub-articles]", frame.node).forEach(
            (button) => (button.disabled = true),
        );
    }
}
function modal(
    title,
    body,
    footer = tr('<button type="button" data-action="close">关闭</button>'),
    { replace = false } = {},
) {
    if (document.body.classList.contains("menu-open")) setMenu(false, { restoreFocus: false });
    const d = $("#dialog");
    const previous = modalFrame,
        samePage = d.open && previous && modalKey(previous.state) === modalKey(modalState);
    if (d.open && modalFrame) {
        pauseModal(modalFrame);
        if (!replace && modalKey(modalFrame.state) !== modalKey(modalState)) modalHistory.push(modalFrame);
    } else {
        modalHistory = [];
        modalReturnFocus = document.activeElement;
    }
    const parent = modalHistory.at(-1),
        backLabel = parent ? modalParentLabel(parent) : "";
    d.innerHTML = html`<form id="modal-form" class="modal-form">
        <div class="dialog-head">
            <div class="dialog-heading">
                ${parent
                    ? html`<button type="button" class="dialog-back" data-action="back" aria-keyshortcuts="Escape">
                          ${icon("chevron", 13)}${esc(backLabel)}<kbd>Esc</kbd>
                      </button>`
                    : ""}
                <h2 id="dialog-title">${esc(title)}</h2>
            </div>
            <button type="button" class="quiet" data-action="close" aria-label="关闭窗口" title="关闭整个窗口">
                ${icon("close", 19)}
            </button>
        </div>
        <div class="dialog-body">
            ${body}
            <p class="dialog-error" role="alert"></p>
        </div>
        <div class="dialog-footer">${footer}</div>
    </form>`;
    if (parent)
        $$(".dialog-footer [data-action=close]", d).forEach((button) => {
            if (button.textContent.trim() === tr("取消")) {
                button.dataset.action = "back";
                button.textContent = backLabel;
            } else if (button.textContent.trim() === tr("关闭")) button.textContent = tr("关闭窗口");
        });
    modalFrame = { state: modalState, title, node: d.firstElementChild };
    if (!d.open) d.showModal();
    syncTableHints();
    if (!d.contains(document.activeElement)) {
        const previousControl = samePage && previous.focusSelector ? $(previous.focusSelector, d) : null;
        (previousControl || $(".dialog-head .dialog-back", d) || $(".dialog-head [data-action=close]", d))?.focus({
            preventScroll: true,
        });
    }
    if (samePage) $(".dialog-body", d).scrollTop = previous.scrollTop || 0;
}
const saveFooter = (text) =>
    html`<button type="button" class="quiet" data-action="close">取消</button
        ><button class="primary" type="submit">${text}</button>`;
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
                ? html`<div class="sub-editor-tools">
                      <div class="sub-editor-tool-group">
                          <span>内容与推送</span>
                          ${S.features.articles
                              ? html`<button type="button" data-sub-articles="${item.id}">最近文章</button>`
                              : ""}
                          ${S.features.manual_fetch
                              ? html`<button type="button" data-manual-fetch="${item.id}">
                                    ${icon("refresh", 14)}立即抓取
                                </button>`
                              : ""}
                          ${S.features.diagnostics
                              ? html`<button type="button" data-feed-logs="${item.feed_id}">查看抓取日志</button>`
                              : ""}
                      </div>
                      <div class="sub-editor-tool-group">
                          <span>订阅源设置</span
                          ><button type="button" data-feed-recipients="${item.feed_id}">管理接收会话</button
                          ><button type="button" data-feed-fetch="${item.feed_id}">订阅源请求设置</button>
                      </div>
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
                  "clock",
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
            <button type="button" data-modal-target-subs="${item.id}">管理此会话订阅</button>
            ${S.features.chat_activity
                ? html`<button type="button" data-target-activity="${item.id}">查看会话记录</button>`
                : ""}${S.features.diagnostics
                ? html`<button type="button" data-target-logs="${item.id}">查看推送与运行日志</button>`
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
        undefined,
        { replace: true },
    );
}

document.addEventListener("click", async (event) => {
    if (event.target.closest('.sidebar a[href^="#"]') && document.body.classList.contains("menu-open")) {
        setMenu(false, { restoreFocus: false });
        $("#main")?.focus({ preventScroll: true });
    }
    const b = event.target.closest("button,[data-target-subs]");
    if (!b || b.disabled) return;
    const d = b.dataset;
    try {
        if (d.action === "close") {
            closeModal();
            return;
        }
        if (d.action === "back") return backModal();
        if (d.action === "menu") {
            setMenu(!document.body.classList.contains("menu-open"));
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
        if (d.subArticles) return showRecentArticles(modalItem(d.subArticles, "edit-sub"));
        if (Object.hasOwn(d, "articleRefresh")) return showRecentArticles(modalState.item);
        if (d.manualFetch) return showManualFetch(modalItem(d.manualFetch, "edit-sub"));
        if (Object.hasOwn(d, "manualRetry")) return loadManualCapabilities(modalState);
        if (Object.hasOwn(d, "manualRefresh")) {
            modalState.pollCount = 0;
            return pollManualFetch(modalState);
        }
        if (Object.hasOwn(d, "manualReset")) {
            modalState.job = null;
            modalState.confirmed = false;
            modalState.capabilities = null;
            modalState.pollCount = 0;
            renderManualFetch(modalState);
            return loadManualCapabilities(modalState);
        }
        if (d.feedLogs) return showFeedLogs(d.feedLogs);
        if (d.feedLogPage) return showFeedLogs(modalState.feedId, Number(d.feedLogPage));
        if (d.relatedLogPage)
            return showRelatedLogs(
                { feedId: modalState.feedId, targetId: modalState.targetId },
                Number(d.relatedLogPage),
            );
        if (d.modalTargetSubs) return showTargetSubscriptions(d.modalTargetSubs);
        if (d.targetSubPage) return showTargetSubscriptions(modalState.id, Number(d.targetSubPage));
        if (d.action === "feed-logs-retry") return showFeedLogs(modalState.feedId, modalState.page);
        if (d.action === "logs-refresh") return render(true);
        if (d.action === "logs-clear") {
            S.logCategory = S.logLevel = S.logFeed = S.logTarget = "";
            S.page = 1;
            return render(true);
        }
        if (d.targetLogs || d.relatedFeedLogs) {
            const params = new URLSearchParams(
                d.targetLogs ? { target_id: d.targetLogs } : { feed_id: d.relatedFeedLogs },
            );
            if ($("#dialog").open)
                return showRelatedLogs(d.relatedFeedLogs ? { feedId: d.relatedFeedLogs } : { targetId: d.targetLogs });
            location.hash = "diagnostics?" + params;
            return;
        }
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
            const item = modalItem(d.stopService, "edit-target");
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
                modalItem(d.targetActivity, "edit-target")?.title || d.targetActivity,
            );
        }
        if (d.activityPage) {
            return showChatActivity(modalState.id, modalState.title, Number(d.activityPage));
        }
        if (d.roleTarget) {
            const item = modalItem(d.roleTarget, "edit-target");
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
            const parent = modalState;
            b.disabled = true;
            const result = await api(`/feeds/${d.feedRecipients}/recipients`);
            b.disabled = false;
            if (parent !== modalState || !$("#dialog").open) return;
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
            const parent = modalState;
            b.disabled = true;
            const result = await api(`/feeds/${d.feedFetch}/fetch-options`);
            b.disabled = false;
            if (parent !== modalState || !$("#dialog").open) return;
            modalState = { action: "feed-fetch", feedId: d.feedFetch };
            modal(
                tr("订阅源请求设置"),
                html`<p class="mono small">${esc(modalHistory.at(-1)?.state.item?.url || parent.item?.url || "")}</p>
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
        if (d.subEdit) return editSub(modalItem(d.subEdit, "edit-sub"));
        if (d.targetEdit) return editTarget(modalItem(d.targetEdit, "edit-target"));
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
            const parent = modalState;
            b.disabled = true;
            const item = await api(html`/targets/${d.refreshTarget}/refresh`, { method: "POST", body: {} });
            b.disabled = false;
            toast(tr("会话名称与机器人访问权限已更新"));
            if (parent === modalState) syncTargetFrames(item);
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
    if (modalState.action === "manual-fetch" && t.name === "mode") {
        modalState.mode = t.value;
        modalState.confirmed = false;
        renderManualFetch(modalState);
        $(`#dialog [name=mode][value="${CSS.escape(t.value)}"]`)?.focus({ preventScroll: true });
        return;
    }
    if (modalState.action === "manual-fetch" && t.name === "confirm_manual") {
        modalState.confirmed = t.checked;
        $("#dialog button[type=submit]").disabled = !t.checked;
        return;
    }
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
    if (t.id === "log-category" || t.id === "log-level") {
        S[t.id === "log-category" ? "logCategory" : "logLevel"] = t.value;
        S.page = 1;
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
        if (m.action === "manual-fetch") return await submitManualFetch(m, f);
        if (m.action === "stop-service") {
            const updated = await api(`/targets/${m.id}/role`, { method: "PATCH", body: { role: "banned" } });
            syncTargetFrames(updated);
            toast(tr("服务已停止并封禁，订阅已暂停。可切换到“已封禁”查看；解除封禁后需手动恢复订阅。"));
        }
        if (m.action === "role") {
            const wasBanned = modalItem(m.id, "edit-target")?.role === "banned";
            const updated = await api(`/targets/${m.id}/role`, { method: "PATCH", body: { role: f.get("role") } });
            syncTargetFrames(updated);
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
                finishModal();
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
            const recipients = await api(`/feeds/${m.feedId}/recipients`, {
                method: "PUT",
                body: { mode: f.get("mode"), targets: [...m.chosen] },
            });
            invalidateRemovedSubscriptions(recipients);
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
            if (m.invalid) throw new Error(tr("此订阅已取消，无法保存。请返回上一级选择其他订阅。"));
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
            const target = modalItem(m.id, "edit-target");
            if (target) syncTargetFrames({ ...target, membership: "left", active_subscriptions: 0 });
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
                { replace: true },
            );
            render(true);
            return;
        }
        if (m.action === "revoke") {
            await api(html`/tokens/${m.id}`, { method: "DELETE" });
            toast(tr("令牌已撤销"));
        }
        if (modalState !== m) return render(true);
        for (const frame of modalHistory)
            if (frame.state.action === "target-subscriptions") frame.state.refreshNeeded = true;
        if (result) resultModal(result);
        else finishModal();
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
    if ($("#dialog").open) closeModal();
    const next = location.hash.slice(1).split("?")[0] || "dashboard";
    S.route = labels[next] ? next : "dashboard";
    if (S.route === "diagnostics" && !S.features.diagnostics) S.route = "dashboard";
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
    S.logCategory = ["fetch", "delivery", "notification", "system"].includes(params.get("category"))
        ? params.get("category")
        : "";
    S.logLevel = ["info", "warning", "error"].includes(params.get("level")) ? params.get("level") : "";
    S.logFeed = /^\d+$/.test(params.get("feed_id") || "") ? params.get("feed_id") : "";
    S.logTarget = /^-?\d+$/.test(params.get("target_id") || "") ? params.get("target_id") : "";
    S.settings = ["general", "tokens", "instance", "security", "runtime", "notifications", "backups"].includes(
        params.get("section"),
    )
        ? params.get("section")
        : "general";
    S.selected.clear();
    setMenu(false, { restoreFocus: false });
    if (S.session) render();
}
window.addEventListener("hashchange", route);
function login() {
    if ($("#dialog").open) closeModal();
    setMenu(false, { restoreFocus: false });
    $("#app").innerHTML = html`<div class="login">
        <section class="login-brand" aria-label="RSStT Web">
            <div class="brand">
                <img src="/assets/mark.svg" alt="" /><span class="brand-wordmark"
                    ><strong>RSStT Web</strong><small class="brand-caption">RSS 到 Telegram</small></span
                >
            </div>
            <div class="login-brand-copy">
                <p class="login-brand-label">订阅、会话与推送</p>
                <h2>信息流，<br />尽在掌握。</h2>
                <p>${tr("从订阅源到 Telegram，在同一个工作空间管理每一次抵达。")}</p>
            </div>
            <div class="login-graphic" aria-hidden="true">
                <div class="relay-node relay-source">${icon("rss", 26)}<span>RSS</span></div>
                <span class="relay-line"></span>
                <div class="relay-node relay-hub"><img src="/assets/mark.svg" alt="" /><span>RSStT</span></div>
                <span class="relay-line"></span>
                <div class="relay-node relay-receiver">${icon("send", 26)}<span>Telegram</span></div>
            </div>
            <p class="login-brand-footer">RSS-to-Telegram-Bot · AGPL-3.0</p>
        </section>
        <section class="login-main">
            <div class="login-preferences">${preferences()}</div>
            <form id="login-form" class="login-card">
                <div class="login-form-heading">
                    <span class="login-form-label">管理台登录</span>
                    <h1>欢迎回来</h1>
                    <p>输入密码，管理此实例的订阅和会话。</p>
                </div>
                ${S.demo
                    ? html`<div class="notice">
                          ${S.snapshot ? tr("真实数据副本 · 修改仅在本地") : tr("离线预览实例")}
                      </div>`
                    : ""}
                <div class="login-field">
                    <label for="password">管理台密码</label
                    ><input
                        id="password"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        required
                        autofocus
                    />
                </div>
                <p class="error" role="alert"></p>
                <button type="submit" class="primary">进入管理台 ${icon("arrow", 16)}</button>
            </form>
            <p class="login-footnote">管理台访问需要此实例的管理员密码。</p>
        </section>
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
        category: S.route === "diagnostics" ? S.logCategory : "",
        level: S.route === "diagnostics" ? S.logLevel : "",
        feed_id: S.route === "diagnostics" ? S.logFeed : "",
        target_id: S.route === "diagnostics" ? S.logTarget : "",
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
    if (!mobileNavigation.matches || !document.body.classList.contains("menu-open") || $("#dialog")?.open) return;
    if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false);
        return;
    }
    if (event.key === "Tab") {
        const sidebar = $(".sidebar");
        const controls = $$(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            sidebar,
        ).filter(
            (element) =>
                !element.closest("[inert]") &&
                element.getClientRects().length &&
                getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0],
            last = controls.at(-1),
            current = document.activeElement;
        if (!controls.length) return;
        if (!sidebar.contains(current) || (event.shiftKey ? current === first : current === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
    }
});
mobileNavigation.addEventListener("change", () => {
    const current = document.activeElement,
        focusWasInSidebar = $(".sidebar")?.contains(current);
    setMenu(false, { restoreFocus: false });
    if ($("#dialog")?.open) return;
    if (mobileNavigation.matches && focusWasInSidebar) $(".topbar .mobile-menu")?.focus({ preventScroll: true });
    else if (!mobileNavigation.matches && current?.matches(".mobile-menu"))
        $(".sidebar .nav a.active")?.focus({ preventScroll: true });
});
let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        syncSettingsNavigation();
        if (S.session && S.route === "dashboard" && !$("#dialog").open) render(true);
    }, 200);
});

document.querySelector(".skip").addEventListener("click", (event) => {
    event.preventDefault();
    const main = $("#main") || $("#password");
    main?.focus();
});

function syncSettingsNavigation() {
    const nav = $(".settings-nav"),
        active = nav?.querySelector('[aria-current="page"]');
    if (!active || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect(),
        activeBox = active.getBoundingClientRect();
    nav.scrollLeft += activeBox.left - navBox.left - (navBox.width - activeBox.width) / 2;
}

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
            <path class="delivered" d="${line("delivered")}" fill="none" stroke="var(--accent)" stroke-width="2" />
            <path class="fetched" d="${line("fetched")}" fill="none" stroke="var(--chart-secondary)" stroke-width="2" />
            ${rows
                .map(
                    (r, i) =>
                        html`${r.delivered === null
                            ? ""
                            : html`<circle
                                  cx="${x(i)}"
                                  cy="${y(r.delivered)}"
                                  r="${r.availability === "partial" ? 4 : 2}"
                                  fill="${r.availability === "partial" ? "var(--panel)" : "var(--accent)"}"
                                  stroke="var(--accent)"
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
        return html`<section class="panel runtime-panel">
            <div class="panel-head">
                <div>
                    <h2>运行配置</h2>
                    <p>保存后在下次重启时生效，本页不会自动重启服务。</p>
                </div>
                ${data.pending_restart ? pill(tr("待重启"), "warn") : ""}
            </div>
            <div class="table-wrap">
                <table class="runtime-table">
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
        return html`<section class="panel notifications-panel">
            <div class="panel-head">
                <div>
                    <h2>通知</h2>
                    <p>订阅源抓取故障与新增使用会话通知</p>
                    ${data.degraded ? html`<p class="notice warning">通知存储异常，请检查服务日志。</p>` : ""}
                </div>
                ${data.offline ? pill(tr("离线模式仅模拟，不会外连。"), "gray") : ""}
            </div>
            <form id="notification-form" class="form-body stack notification-policy">
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
            <div class="form-body notification-channels">
                <div class="section-heading">
                    <h3>通知渠道</h3>
                    <p>${tr("配置接收通知的服务，再发送测试通知确认连接。")}</p>
                </div>
                ${["bark", "telegram", "webhook", "ntfy"]
                    .map(
                        (channel) =>
                            html`<article class="notification-channel">
                                <div class="notification-channel-title">
                                    <strong
                                        >${esc(
                                            { bark: "Bark", telegram: "Telegram", webhook: "Webhook", ntfy: "ntfy" }[
                                                channel
                                            ],
                                        )}</strong
                                    >
                                    ${pill(tr(data.channels[channel]?.enabled ? "已启用" : "未启用"), "gray")}
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
                            </article>`,
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
        return html`<section class="panel backups-panel">
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
                          <div class="backup-forms">
                              <form id="backup-export-form" class="stack backup-form">
                                  <h2>导出备份</h2>
                                  <p class="hint">
                                      默认不导出凭据。备份始终不包含机器人 Token、Telegram 登录会话和部署环境配置。
                                  </p>
                                  ${backupOptions(data.components)}
                                  <p class="error" role="alert"></p>
                                  <div><button type="submit">下载备份</button></div>
                              </form>
                              <form id="backup-restore-form" class="stack backup-form">
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
                                          ${data.restore_supported === false ||
                                          data.restore?.status === "pending_restart"
                                              ? "disabled"
                                              : ""}
                                      >
                                          检查备份
                                      </button>
                                  </div>
                              </form>
                          </div>`}
            </div>
        </section>`;
    return "";
}
$("#dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    if (modalHistory.length) backModal();
    else closeModal();
});
document.addEventListener(
    "keydown",
    (event) => {
        if (event.key !== "Escape" || !$("#dialog").open) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (modalHistory.length) backModal();
        else closeModal();
    },
    true,
);
$("#dialog").addEventListener("close", () => {
    if (!$("#dialog").open && modalFrame) closeModal();
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
