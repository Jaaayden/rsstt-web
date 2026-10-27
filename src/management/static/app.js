import { locale, tr, html, setLocale, setTheme, errorText, count, message } from "./i18n.js";
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
                <div class="nav-label">工作空间</div>
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
                        <span class="small">管理员</span>
                        <p class="muted micro">${S.demo ? tr("本地预览") : tr("管理台会话")}</p>
                    </div>
                    <button class="quiet" data-action="logout" title="退出登录" aria-label="退出登录">
                        ${icon("exit", 16)}退出
                    </button>
                </div>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <div class="breadcrumb">
                    <button class="quiet mobile-menu" data-action="menu" aria-label="展开导航" aria-expanded="false">
                        ${icon("menu")}</button
                    ><span>工作空间</span>${icon("chevron", 12)}<strong id="breadcrumb"></strong>
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
                    targets: "DESTINATIONS",
                    subscriptions: "SUBSCRIPTIONS",
                    settings: "PREFERENCES",
                }[S.route]}
            </div>
            <h1>${title}</h1>
            <p>${description}</p>
        </div>
        ${button}
    </div>`;
}
const targetKindName = (item) =>
    String(item.id).startsWith("-") && ![50, 51].includes(item.state) && item.membership !== "available"
        ? tr("群组/频道（未核验）")
        : kindName[item.kind] || tr("群组/频道（未核验）");
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
    if (!quiet) $("#main").innerHTML = html`<div class="loading" role="status">正在加载${labels[S.route]}…</div>`;
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
            tr("订阅关系"),
            c.subscriptions,
            html`<em>${n(d.usage?.active_subscriptions ?? c.active)}</em> 个${S.snapshot
                    ? tr("已启用")
                    : tr("正在更新")}
                · ${n(c.feeds)} 个独立来源`,
        ],
        [
            "chats",
            d.usage ? tr("活跃目的地") : tr("已知会话"),
            d.usage ? d.usage.active.total : c.users + c.groups + c.channels,
            d.usage
                ? html`已知 ${n(d.usage.known.total)} · 未核验类型 ${n(d.usage.known.unknown)}
                      <details>
                          <summary>目的地分类</summary>
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
                              .join("")}<span>活跃 / 已知</span>
                      </details>`
                : S.snapshot
                  ? html`${n(c.channels + c.groups)} 个群组/频道 · ${n(c.users)} 个私聊`
                  : html`${n(c.channels)} 个频道 · ${n(c.groups)} 个群组 · ${n(c.users)} 个私聊`,
        ],
        [
            "send",
            tr("累计推送"),
            t.delivered,
            S.snapshot ? tr("原版没有累计统计") : html`累计抓取 <em>${n(t.fetched)}</em> 篇新内容`,
        ],
        ["alert", tr("需要检查"), c.attention, html`连续失败 ${d.threshold} 次后提醒`],
    ];
    return (
        header(tr("一切动态，尽在眼前。"), tr("看看订阅的近况，让值得阅读的内容持续抵达。"), newButton()) +
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
                        <h2>内容流动</h2>
                        <p>
                            ${d.trend?.granularity === "hour"
                                ? tr("每小时的新内容与成功推送，按本地时间显示")
                                : d.trend
                                  ? tr("每天的新内容与成功推送，按 UTC 日聚合")
                                  : tr("每天发现的新内容，以及成功送达的篇次")}
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
                    <div class="chart-meta">
                        <span><i class="legend"></i>成功推送</span><span><i class="legend orange"></i>新内容</span
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
                          ? empty(tr("没有历史统计"), tr("原版未记录累计推送和每日趋势，无法从订阅快照还原。"))
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
                        <h2>需要检查 <span class="muted small">${n(c.attention)}</span></h2>
                        <button class="text-link" data-action="attention">查看全部 ${icon("arrow", 13)}</button>
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
                                          ${pill(html`连续失败 ${item.errors} 次`, "warn")}
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

function searchBox(placeholder = tr("搜索名称或网址")) {
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
    html`<select id="${id}" aria-label="${id === "kind-filter" ? tr("会话类型") : tr("订阅状态")}">
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
            tr("管理机器人已知的接收目的地，以及各自的订阅和推送偏好。"),
            html`<button class="primary" data-action="register">${icon("plus", 16)}登记会话</button>`,
        ) +
        html`<section class="panel">
                <div class="toolbar">
                    ${searchBox(tr("搜索名称、用户名或 ID"))}${select(
                        "kind-filter",
                        [
                            ["", tr("全部类型")],
                            ["channel", tr("频道")],
                            ["group", S.snapshot ? tr("群组/待分类") : tr("群组")],
                            ["private", tr("私聊")],
                        ],
                        S.kind,
                    )}<span class="count">${count(d.total, "destination")}</span>
                </div>
                ${d.items.length
                    ? html`<div class="table-wrap">
                          <table>
                              <thead>
                                  <tr>
                                      <th>会话</th>
                                      <th>类型</th>
                                      <th>订阅数</th>
                                      <th>需要检查</th>
                                      <th>访问状态</th>
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
                                                              <strong>${esc(item.title)}</strong
                                                              ><small
                                                                  >${item.username
                                                                      ? "@" + esc(item.username) + " · "
                                                                      : ""}${esc(item.id)}</small
                                                              >
                                                          </div>
                                                      </div>
                                                  </td>
                                                  <td>${targetKindName(item)}</td>
                                                  <td class="mono">${n(item.subscriptions)}</td>
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
                                                                    available: tr("可用"),
                                                                    known: tr("已识别"),
                                                                    left: tr("已退出"),
                                                                    unknown: tr("待同步"),
                                                                    snapshot: tr("离线快照"),
                                                                }[item.membership] || tr("待同步"),
                                                          item.membership === "available" && item.state !== -1
                                                              ? ""
                                                              : "gray",
                                                      )}
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
                          tr("还没有匹配的会话"),
                          tr("机器人与用户互动后会留下记录；也可以登记已知的会话 ID。"),
                      )}${pager(d)}
            </section>
            <p class="muted small page-note">
                ${S.snapshot
                    ? tr(
                          "会话名称来自 Telegram 本地缓存，可能已过时；缺失名称显示 ID；未明确区分类型的显示为“群组/频道”，当前权限未联网验证。",
                      )
                    : tr(
                          "会话列表来自 RSStT 记录；名称和权限在手动同步或添加订阅时更新。机器人需先在 Telegram 中加入频道或群组。",
                      )}
            </p>`
    );
}

function subscriptions(d) {
    return (
        header(
            S.attention ? tr("需要检查的订阅") : tr("全部订阅"),
            S.target
                ? html`当前目的地：${esc(d.items[0]?.target_title || S.target)}`
                : tr("在一张列表里查看、筛选和调整所有订阅。"),
            newButton(),
        ) +
        html`<section class="panel">
            <div class="toolbar">
                ${searchBox()}${select(
                    "status-filter",
                    [
                        ["", tr("全部状态")],
                        ["1", S.snapshot ? tr("已启用") : tr("更新中")],
                        ["0", tr("已暂停")],
                    ],
                    S.status,
                )}<button data-action="filter-target" class="small">${icon("chats", 14)}选择目的地</button
                >${d.items.some((i) => i.feed_id)
                    ? html`<a class="button-link" href="${filteredExportURL()}" download>导出筛选结果</a>`
                    : S.target
                      ? html`<a class="button-link" href="/api/targets/${encodeURIComponent(S.target)}/opml" download
                            >导出 OPML</a
                        >`
                      : ""}<button data-action="toggle-attention" class="${S.attention ? "primary" : ""} small">
                    ${icon("alert", 14)}需要检查</button
                >${S.target
                    ? tr('<button class="quiet small" data-action="clear-target">清除会话筛选 ×</button>')
                    : ""}<span class="count">${count(d.total, "subscription")}</span>
            </div>
            ${S.selected.size
                ? html`<div class="bulkbar">
                      <span>已选择 ${S.selected.size} 条</span><button data-batch="pause">暂停</button
                      ><button data-batch="resume">恢复</button
                      ><button class="danger" data-batch="delete">取消订阅</button>${d.items.some((i) => i.feed_id)
                          ? html`<a class="button-link" href="${filteredExportURL([...S.selected])}" download
                                >导出所选</a
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
                                  <th>订阅内容</th>
                                  <th>目的地</th>
                                  <th>状态</th>
                                  <th>间隔</th>
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
                                                            ? html`失败 ${item.errors} 次`
                                                            : S.snapshot
                                                              ? tr("已启用")
                                                              : tr("更新中"),
                                                      item.state === 0 ? "gray" : item.errors ? "warn" : "",
                                                  )}
                                              </td>
                                              <td class="muted">${n(item.effective_interval)} 分钟</td>
                                              <td>
                                                  <div class="table-actions">
                                                      <button
                                                          data-sub-toggle="${item.id}"
                                                          title="${item.state ? tr("暂停") : tr("恢复")}"
                                                          aria-label="${item.state ? tr("暂停") : tr("恢复")} ${esc(
                                                              item.title,
                                                          )}"
                                                      >
                                                          ${icon(item.state ? "pause" : "play", 15)}${item.state
                                                              ? tr("暂停")
                                                              : tr("恢复")}</button
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
                      S.attention ? tr("目前没有需要检查的订阅") : tr("没有匹配的订阅"),
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
                    <p>新订阅使用的默认值，以及管理台提醒方式</p>
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
                    tr("每个目的地的默认上限，-1 表示不限。"),
                    -1,
                )}${settingRow(
                    "attention_threshold",
                    tr("需要检查的失败次数"),
                    tr("仅改变管理台提醒，不改变上游重试和停用策略。"),
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
                    <h2>连接授权</h2>
                    <p>允许外部应用通过 API 管理选定的会话</p>
                </div>
                <button class="primary" data-action="new-token">${icon("plus", 14)}创建授权</button>
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
                                          ${pill(t.permission === "write" ? tr("读写") : tr("只读"), "gray")}
                                      </p>
                                      <small
                                          >${t.targets === null
                                              ? tr("全部会话（含今后新增）")
                                              : html`${count(t.targets.length, "selectedDestination")}`}
                                          · ${dateText(t.expires_at * 1000)} 到期</small
                                      >
                                  </div>
                                  <button class="danger" data-revoke="${esc(t.id)}">撤销</button>
                              </div>`,
                      )
                      .join("")
                : empty(tr("还没有连接授权"), tr("未来接入 FeedLantern 时，在这里创建专用授权。"))}
            <div class="form-body">
                <div class="notice">
                    授权只允许访问指定会话的订阅，不包含管理台设置、创建授权或退出频道等管理员操作。完整密钥只显示一次。
                </div>
                ${S.features.security
                    ? html`<p>
                          <a class="text-link" href="/api/openapi.json" download="rsstt-openapi.json"
                              >下载 Agent API 契约</a
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
                        <dd>${S.snapshot ? tr("原版无历史统计") : tr("独立 SQLite · 累计值永久保留")}</dd>
                    </div>
                </dl>
                <div class="notice">
                    机器人 Token、Telegram API
                    凭证、代理与管理台密码通过部署环境配置。修改这些配置后重启实例即可生效。管理台不会读取或显示这些密钥。
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
                <p class="hint">至少 16 个字符。修改后所有网页登录会话将退出，Agent 授权保持有效。</p>
                <p class="error" role="alert"></p>
                <div><button type="submit" class="primary">修改密码并退出</button></div>
            </form>
            <div class="form-body">
                <h2>网页登录会话</h2>
                <p>${n(sessions.items.length)} ${tr("个活动会话")}</p>
                <button class="danger" data-action="revoke-sessions">退出所有网页登录</button>
            </div>
        </section>`;
    }
    return (
        header(tr("设置"), tr("熟悉的管理方式，按需调整。")) +
        html`<div class="settings">
            <nav class="settings-nav" aria-label="设置栏目">
                ${[
                    ["general", "settings", tr("更新与订阅")],
                    ["tokens", "key", tr("连接授权")],
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
        tr("通知方式"),
        [
            [1, tr("正常通知")],
            [0, tr("静默发送")],
        ],
    ],
    send_mode: [
        tr("发送方式"),
        [
            [0, tr("自动选择")],
            [-1, tr("仅链接")],
            [1, "Telegraph"],
            [2, tr("Telegram 消息")],
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
        tr("媒体内容"),
        [
            [0, tr("显示")],
            [1, tr("仅媒体")],
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
        tr("来源"),
        [
            [0, tr("源标题与链接")],
            [1, tr("源标题与文章标题链接")],
            [-1, tr("结尾超链接，无源标题")],
            [-2, tr("完全隐藏")],
            [-3, tr("文章标题链接，无源标题")],
            [-4, tr("结尾完整网址，无源标题")],
        ],
    ],
    display_entry_tags: [
        tr("条目标签"),
        [
            [1, tr("显示")],
            [-1, tr("隐藏")],
        ],
    ],
    style: [
        tr("排版样式"),
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
                >更新间隔（分钟）<input
                    type="number"
                    name="interval"
                    min="1"
                    max="32767"
                    placeholder="默认"
                    value="${o.interval ?? ""}" /></label
            >${field("send_mode", ...formatLabels.send_mode)}
        </div>
        <details>
            <summary>更多推送与排版设置</summary>
            <div class="field-grid">
                ${Object.entries(formatLabels)
                    .filter(([k]) => k !== "send_mode")
                    .map(([k, [l, v]]) => field(k, l, v))
                    .join("")}<label
                    >Telegraph 长度阈值<input
                        name="length_limit"
                        type="number"
                        min="${isSub ? -100 : 0}"
                        max="4096"
                        value="${o.length_limit}"
                    /><span class="hint">0 为自动${isSub ? tr("，-100 为继承会话默认值") : ""}。</span></label
                >
            </div>
        </details>`;
}

async function targetPicker(multiple = false) {
    const serial = ++pickerSerial;
    const context = modalState;
    modalState.multiple = multiple;
    modalState.chosen = new Set(modalState.chosen || []);
    const data = await api("/targets?size=50&q=" + encodeURIComponent($("#picker-search")?.value || ""));
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
                          />${icon(kindIcon[i.kind], 15)}${esc(i.title)}<small>${kindName[i.kind]}</small></label
                      >`,
              )
              .join("")
        : empty(tr("没有匹配的会话"), tr("先在「会话与频道」中登记。"));
    $("#picker-hint").textContent = html`匹配 ${data.total}
    个会话${data.total > 50 ? tr("，先显示前 50 个，请继续搜索缩小范围") : ""}${multiple
        ? html` · 已选 ${modalState.chosen.size} 个`
        : ""}`;
}
const pickerHtml = (multiple) =>
    html`<label
            >选择${multiple ? tr("允许管理的会话") : tr("接收会话")}<input
                id="picker-search"
                placeholder="搜索会话名称、用户名或 ID"
                autocomplete="off"
        /></label>
        <div class="target-choices" id="target-picker"></div>
        <span class="hint" id="picker-hint"></span>`;

async function newSub() {
    modalState = { action: "new-sub", chosen: S.target ? [S.target] : [] };
    modal(
        tr("添加订阅"),
        pickerHtml(false) +
            html`<label
                >RSS 地址<textarea
                    name="urls"
                    required
                    placeholder="https://example.com/feed.xml&#10;可以粘贴多个地址，每行一个"
                ></textarea
                ><span class="hint"
                    >每次最多 100
                    个。已存在的订阅会自动跳过，保留原来的设置。${S.snapshot
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
                      <button type="button" data-feed-recipients="${item.feed_id}">接收目的地</button
                      ><button type="button" data-feed-fetch="${item.feed_id}">来源抓取设置</button>
                  </div>`
                : ""}<label
                >自定义标题<input
                    name="title"
                    value="${esc(item.custom_title || "")}"
                    maxlength="1024"
                    placeholder="使用订阅源原标题" /></label
            ><label
                >附加标签<input
                    name="tags"
                    value="${esc(item.tags || "")}"
                    maxlength="255"
                    placeholder="以空格分隔" /></label
            >${formatFields(item.options, true)}`,
        saveFooter(tr("保存设置")),
    );
}
function editTarget(item) {
    modalState = { action: "edit-target", item };
    modal(
        item.title,
        html`<div class="spread">
                <span class="muted mono small">${esc(item.id)} · ${targetKindName(item)}</span
                ><button type="button" data-refresh-target="${item.id}" class="small">
                    ${icon("refresh", 13)}同步名称与权限
                </button>
            </div>
            <div class="inline">
                <a class="text-link" href="/api/targets/${item.id}/opml" download>导出 OPML</a
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
                /><span class="hint">-1 表示不限，留空则继承实例设置。</span></label
            >${item.role
                ? html`<div class="spread">
                      <span>用户角色：${esc(roleName(item.role))}</span>${item.role_protected
                          ? html`<span class="hint">管理者受保护</span>`
                          : html`<button type="button" data-role-target="${item.id}">修改角色</button>`}
                  </div>`
                : ""}${item.lang !== undefined
                ? html`<label
                      >Bot 语言<input name="lang" value="${esc(item.lang || "null")}" maxlength="16" /><span
                          class="hint"
                          >例如 zh-Hans、en；null 使用自动语言。与管理台界面语言独立。</span
                      ></label
                  >`
                : ""}${formatFields(item.options, false)}${item.id.startsWith("-")
                ? html`<div class="spread">
                      <span class="hint">退出后保留订阅记录，并暂停更新。</span
                      ><button type="button" class="danger small" data-leave-target="${item.id}">退出会话</button>
                  </div>`
                : ""}`,
        saveFooter(tr("保存默认设置")),
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
        saveFooter(tr("确认")),
    );
}
function resultModal(result) {
    const failed = result.results.filter((r) => r.status === "failed" || r.ok === false).length;
    modalState = { action: "done" };
    modal(
        failed ? tr("处理完成，部分条目未成功") : tr("处理完成"),
        html`<div class="notice">
                ${result.results.length - failed} 条完成，${failed} 条失败。失败条目可修正后重新提交。
            </div>
            <div class="result-list">
                ${result.results
                    .map(
                        (r) =>
                            html`<div class="result-item">
                                ${pill(
                                    r.status === "existing"
                                        ? tr("已存在")
                                        : r.status === "failed" || r.ok === false
                                          ? tr("失败")
                                          : tr("完成"),
                                    r.status === "failed" || r.ok === false ? "warn" : "",
                                )}
                                <div>
                                    ${esc(r.url || tr("订阅 #") + r.id)}${r.message || r.error
                                        ? html`<small>${esc(errorText(r, 400))}</small>`
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
                tr("退出所有网页登录"),
                tr("所有网页登录会话将失效。Agent 授权保持有效。"),
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
        if (d.roleTarget) {
            const item = S.items.find((i) => i.id === d.roleTarget);
            modalState = { action: "role", id: item.id };
            modal(
                tr("修改角色"),
                html`<p>${esc(item.title)}</p>
                    <label
                        >用户角色<select name="role">
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
                    <p class="hint">角色影响机器人权限。管理者不能在此降级或封禁。</p>
                    <p class="hint">
                        封禁会暂停订阅，解封不会自动恢复。管理员角色不授予网页登录或管理者专属命令权限。
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
                html`<p class="mono">${esc(item.key)}</p>
                    <p class="notice">保存后待重启，不会立即改变当前进程。</p>
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
                    >${item.sensitive ? html`<p class="hint">密钥不回显；留空保留现有值。</p>` : ""}<label
                        class="inline-label"
                        ><input type="checkbox" name="reset" />恢复部署默认值</label
                    >`,
                saveFooter(tr("保存并等待重启")),
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
                    <p class="hint">密钥不回显；留空保留现有值。</p>
                    ${fields
                        .map(
                            (key) =>
                                html`<label
                                    >${esc(key)}<input
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
            return confirmation(tr("取消待恢复任务"), tr("取消已暂存的恢复任务，现有数据保持不变。"), "cancel-restore");
        if (d.feedRecipients) {
            const result = await api(`/feeds/${d.feedRecipients}/recipients`);
            modalState = {
                action: "recipients",
                feedId: d.feedRecipients,
                chosen: result.items.map((i) => String(i.target)),
            };
            modal(
                tr("接收目的地"),
                html`<p class="notice">同一来源只抓取一次。已有目的地的推送设置保持不变。</p>
                    <label
                        >修改方式<select name="mode">
                            <option value="append">仅添加接收目的地</option>
                            <option value="replace">替换当前授权范围内的目的地</option>
                        </select></label
                    >${pickerHtml(true)}
                    <p class="hint">替换会移除未选目的地的订阅。当前授权范围外的订阅保持不变。</p>`,
                saveFooter(tr("保存接收目的地")),
            );
            await targetPicker(true);
            return;
        }
        if (d.feedFetch) {
            const result = await api(`/feeds/${d.feedFetch}/fetch-options`);
            modalState = { action: "feed-fetch", feedId: d.feedFetch };
            modal(
                tr("来源抓取设置"),
                html`<p class="notice">此设置影响该来源的所有接收目的地。</p>
                    <label
                        >User-Agent<input
                            name="user_agent"
                            maxlength="512"
                            value="${esc(result.user_agent || "")}"
                            placeholder="继承全局默认值"
                    /></label>
                    <p class="hint">仅支持可打印 ASCII 字符；留空恢复全局设置。</p>`,
                saveFooter(tr("保存设置")),
            );
            return;
        }
        if (d.action === "filter-target") {
            modalState = { action: "filter-target", chosen: S.target ? [S.target] : [] };
            modal(tr("选择目的地"), pickerHtml(false), saveFooter(tr("应用筛选")));
            await targetPicker();
            return;
        }
        if (d.action === "new-sub") return await newSub();
        if (d.action === "register") {
            modalState = { action: "register" };
            modal(
                tr("登记已有会话"),
                tr(
                    '<p class="muted small">请先在 Telegram 中让用户启动机器人，或将机器人加入频道 / 群组并授予发布权限。</p><label>Telegram 会话 ID<input name="id" required placeholder="例如 -1001234567890" inputmode="numeric"></label>',
                ),
                saveFooter(tr("验证并登记")),
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
                条订阅执行「${{ pause: tr("暂停"), resume: tr("恢复"), delete: tr("取消订阅") }[d.batch]}」？`,
                "batch",
                { batchAction: d.batch, ids: [...S.selected] },
            );
        if (d.refreshTarget) {
            b.disabled = true;
            const item = await api(html`/targets/${d.refreshTarget}/refresh`, { method: "POST", body: {} });
            toast(tr("名称与权限已同步"));
            editTarget(item);
            return render(true);
        }
        if (d.leaveTarget)
            return confirmation(
                tr("退出会话"),
                tr("机器人退出后，订阅将暂停。重新加入需要在 Telegram 中操作。"),
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
                tr("创建连接授权"),
                html`<label>授权名称<input name="name" required maxlength="80" placeholder="例如 FeedLantern" /></label>
                    <div class="field-grid">
                        <label
                            >权限<select name="permission">
                                <option value="read">只读</option>
                                <option value="write">读写订阅</option>
                            </select></label
                        ><label
                            >有效天数<input name="days" type="number" value="90" min="1" max="365" required
                        /></label>
                    </div>
                    ${pickerHtml(true)}<label class="inline-label"
                        ><input type="checkbox" name="all_targets" />允许全部会话，包括今后新增的会话</label
                    >`,
                saveFooter(tr("创建授权")),
            );
            await targetPicker(true);
            return;
        }
        if (d.revoke)
            return confirmation(tr("撤销连接授权"), tr("使用这个授权的外部应用将立即失去访问权限。"), "revoke", {
                id: d.revoke,
            });
        if (d.action === "copy-token") {
            await navigator.clipboard.writeText($("#token-secret").textContent);
            toast(tr("已复制授权密钥"));
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
                tr("确认恢复预检"),
                html`<p class="notice">预检通过不代表已经恢复。提交后将在正常重启时应用，覆盖现有订阅数据。</p>
                    <p>${esc(dateText(summary.created_at))}</p>
                    <div class="table-wrap">
                        <table>
                            <tbody>
                                ${Object.entries(summary.counts)
                                    .map(
                                        ([key, value]) =>
                                            html`<tr>
                                                <th>${esc(key)}</th>
                                                <td>${n(value)}</td>
                                            </tr>`,
                                    )
                                    .join("")}
                            </tbody>
                        </table>
                    </div>
                    <p>
                        ${Object.values(flags).some(Boolean)
                            ? tr("将覆盖选定的敏感组件。")
                            : tr("保留当前凭据和配置。")}
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
                        />我确认暂存恢复任务，并将在重启前备份当前数据。</label
                    >`,
                saveFooter(tr("暂存恢复任务")),
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
        if (m.action === "role") {
            await api(`/targets/${m.id}/role`, { method: "PATCH", body: { role: f.get("role") } });
            toast(tr("角色已保存"));
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
            toast(result.simulated ? tr("离线模式仅模拟，不会外连。") : tr("测试通知已加入队列。"));
        }
        if (m.action === "cancel-restore") await api("/backups/pending", { method: "DELETE" });
        if (m.action === "restore") {
            await rawAPI("/backups/restore?" + m.query, m.raw, { "X-Backup-SHA256": m.sha });
            m.raw = null;
            toast(tr("恢复任务已暂存，尚未应用。请正常重启实例。"));
        }
        if (m.action === "recipients") {
            await api(`/feeds/${m.feedId}/recipients`, {
                method: "PUT",
                body: { mode: f.get("mode"), targets: [...m.chosen] },
            });
            S.selected.clear();
            toast(tr("接收目的地已保存"));
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
            toast(tr("已退出会话并暂停订阅"));
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
                tr("保存连接密钥"),
                html`<p class="muted small">完整密钥只在这里显示一次。复制到需要连接的应用中，并妥善保存。</p>
                    <div class="secret" id="token-secret">${esc(r.token)}</div>`,
                html`<button type="button" data-action="copy-token">复制密钥</button
                    ><button type="button" class="primary" data-action="close">已保存</button>`,
            );
            render(true);
            return;
        }
        if (m.action === "revoke") {
            await api(html`/tokens/${m.id}`, { method: "DELETE" });
            toast(tr("授权已撤销"));
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
    S.kind = params.get("kind") || "";
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
        $("#app").innerHTML = html`<div class="initial">无法连接管理台：${esc(e.message)}。请刷新页面重试。</div>`;
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
    return html`<p class="muted small">未记录的时间段显示为空，不计为零。空心点表示尚未完整的时间段。</p>
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
                                  ><title>${esc(bucketTime(r.start))} · ${n(r.delivered)}</title></circle
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
                            <th>${data.granularity === "day" ? tr("UTC 日期") : tr("开始时间")}</th>
                            <th>新内容</th>
                            <th>成功推送</th>
                            <th>数据状态</th>
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
                                                { available: "完整", partial: "部分", unavailable: "不可用" }[
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
    tr({ manager: "管理者", admin: "管理员", user: "用户", guest: "访客", banned: "已封禁" }[role] || role);
const backupKeys = ["agent_tokens", "admin_credentials", "runtime_config", "notification_secrets"];
const backupLabels = {
    agent_tokens: "Agent 授权",
    admin_credentials: "网页登录凭据",
    runtime_config: "运行配置",
    notification_secrets: "通知密钥",
};
function backupOptions(components, restore = false) {
    return html`<details>
        <summary>${restore ? tr("敏感组件选项（默认保留当前值）") : tr("可选组件（默认不包含）")}</summary>
        ${backupKeys
            .map(
                (key) =>
                    html`<label class="inline-label"
                        ><input type="checkbox" name="${key}" ${components?.[key]?.length ? "" : "disabled"} />${tr(
                            backupLabels[key],
                        )}${components?.[key]?.length ? "" : html` <span class="hint">未安装此组件</span>`}</label
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
                    <p>保存后待重启，不会立即改变当前进程。</p>
                </div>
                ${data.pending_restart ? pill(tr("待重启"), "warn") : ""}
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>配置项</th>
                            <th>当前生效值</th>
                            <th>状态</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.items
                            .map(
                                (item) =>
                                    html`<tr>
                                        <td class="mono">${esc(item.key)}</td>
                                        <td>
                                            ${item.sensitive
                                                ? tr(item.effective_configured ? "已配置（不回显）" : "未设置")
                                                : esc(item.effective_value ?? "—")}
                                        </td>
                                        <td>
                                            ${item.pending_restart
                                                ? pill(tr("待重启"), "warn")
                                                : tr(item.source === "web" ? "网页配置" : "部署默认值")}
                                        </td>
                                        <td><button data-runtime-edit="${esc(item.key)}">编辑</button></td>
                                    </tr>`,
                            )
                            .join("")}
                    </tbody>
                </table>
            </div>
            <details class="form-body">
                <summary>仅部署时设置</summary>
                <p class="mono small">${data.deployment_only.map(esc).join(" · ")}</p>
            </details>
        </section>`;
    if (key === "notifications")
        return html`<section class="panel">
            <div class="panel-head">
                <div>
                    <h2>通知</h2>
                    <p>来源故障与新用户提醒</p>
                    ${data.degraded ? html`<p class="notice warning">通知存储异常，请检查服务日志。</p>` : ""}
                </div>
                ${data.offline ? pill(tr("离线模式仅模拟，不会外连。"), "gray") : ""}
            </div>
            <form id="notification-form" class="form-body stack">
                <label class="inline-label"
                    ><input type="checkbox" name="enabled" ${data.policy.enabled ? "checked" : ""} />启用通知</label
                ><label class="inline-label"
                    ><input
                        type="checkbox"
                        name="new_users"
                        ${data.policy.new_users ? "checked" : ""}
                    />提醒新用户与会话</label
                >
                <div class="field-grid">
                    <label
                        >连续失败阈值<input
                            type="number"
                            name="threshold"
                            min="1"
                            max="100"
                            value="${data.policy.threshold}"
                            required /></label
                    ><label
                        >冷却时间（秒）<input
                            type="number"
                            name="cooldown"
                            min="1"
                            max="604800"
                            value="${data.policy.cooldown}"
                            required
                    /></label>
                </div>
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
            ${data.history?.length
                ? html`<details class="form-body">
                      <summary>最近通知记录</summary>
                      <div class="table-wrap">
                          <table>
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
                                                                  pending: "等待发送",
                                                                  sent: "已发送",
                                                                  failed: "失败",
                                                                  simulated: "已模拟",
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
                    <p>一致快照；恢复预检后，在重启时应用。</p>
                </div>
            </div>
            <div class="form-body stack">
                ${!data.sqlite
                    ? html`<p class="notice">当前数据库不支持此备份方式。</p>`
                    : html`${data.restore?.status === "succeeded"
                              ? html`<p class="notice">上次恢复已在启动时应用。</p>`
                              : data.restore?.status === "failed"
                                ? html`<p class="notice warning">
                                      上次恢复失败。请检查服务日志与回退记录，再决定下一步。
                                  </p>`
                                : ""}${data.restore?.status === "pending_restart"
                              ? html`<div class="notice warning">
                                    恢复任务已暂存，尚未应用。请正常重启实例。<button data-action="cancel-restore">
                                        取消待恢复任务
                                    </button>
                                </div>`
                              : ""}
                          <form id="backup-export-form" class="stack">
                              <h2>导出备份</h2>
                              <p class="hint">默认不导出凭据。机器人 Token 和 Telegram session 始终不包含。</p>
                              ${backupOptions(data.components)}
                              <p class="error" role="alert"></p>
                              <div><button type="submit">下载备份</button></div>
                          </form>
                          <hr />
                          <form id="backup-restore-form" class="stack">
                              <h2>恢复备份</h2>
                              ${data.restore_supported === false
                                  ? html`<p class="notice">当前平台不支持恢复预检与自动恢复，仍可导出备份。</p>`
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
                                      预检备份
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
    const known = {
        login: "网页登录",
        password_changed: "修改密码",
        sessions_revoked: "撤销网页登录会话",
        agent_request: "Agent 请求",
    };
    const legacy = new Set([
        "登记会话",
        "修改会话默认设置",
        "修改用户角色",
        "退出会话并暂停订阅",
        "导入 OPML",
        "添加订阅",
        "修改订阅",
        "取消订阅",
        "批量处理订阅",
        "更新设置",
        "保存运行配置（待重启）",
        "创建连接授权",
        "撤销连接授权",
        "修改来源接收者",
        "修改来源 UA",
    ]);
    return Object.hasOwn(known, action) ? tr(known[action]) : legacy.has(action) ? tr(action) : action;
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
