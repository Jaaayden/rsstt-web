import { html, useState, useEffect, useAsync, useRef, Icon, Button, Segmented, Spinner, Empty, Notice, Badge } from "./ui.js";
import { L, api, qs, num, compact, ago, dateTime, go, app, emit, locale } from "./core.js";

const RANGES = {
    day: { label: () => L("24 小时", "24 hours"), granularity: "hour", hours: 24 },
    week: { label: () => L("7 天", "7 days"), granularity: "hour", hours: 168 },
    month: { label: () => L("30 天", "30 days"), granularity: "day" },
};

function windowQuery(range) {
    const spec = RANGES[range];
    if (spec.granularity === "day") return { granularity: "day" };
    const end = new Date();
    end.setUTCMinutes(0, 0, 0);
    end.setUTCHours(end.getUTCHours() + 1);
    const start = new Date(end.getTime() - spec.hours * 3600e3);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
    return { granularity: "hour", start: iso(start), end: iso(end) };
}

const HOUR_GROUPS = [1, 2, 3, 4, 6, 8, 12, 24];
const DAY_GROUPS = [1, 2, 3, 5, 6, 10, 15];
const GROUP_PX = 22;

// Merge neighbouring buckets so every column keeps room for its three bars on narrow screens.
function groupBuckets(buckets, granularity, width) {
    const n = buckets.length;
    const sizes = granularity === "hour" ? HOUR_GROUPS : DAY_GROUPS;
    const size = sizes.find((s) => n % s === 0 && width / (n / s) >= GROUP_PX) ?? [...sizes].reverse().find((s) => n % s === 0) ?? 1;
    const groups = [];
    for (let i = 0; i < n; i += size) {
        const part = buckets.slice(i, i + size);
        const known = part.filter((b) => b.availability !== "unavailable" && b.delivered != null);
        const sum = (key) => known.reduce((total, b) => total + (b[key] || 0), 0);
        groups.push({
            start: part[0].start,
            last: part[part.length - 1].start,
            end: part[part.length - 1].end,
            unavailable: !known.length,
            partial: known.length > 0 && (known.length < part.length || known.some((b) => b.availability === "partial")),
            delivered: sum("delivered"),
            fetched: sum("fetched"),
            failed: sum("failed"),
        });
    }
    return { groups, size };
}

// 0, half and full scale on round numbers: 4, 6, 8, 10, 20, 40, 60 ...
function niceCeiling(max) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, max))));
    for (const step of [2, 4, 6, 8, 10]) if (step * magnitude >= max && step * magnitude >= 4) return step * magnitude;
    return 10 * magnitude;
}

const SERIES = [
    ["delivered", () => L("成功推送", "Delivered"), "var(--blue)"],
    ["fetched", () => L("新文章", "New entries"), "var(--accent)"],
    ["failed", () => L("抓取失败", "Fetch failures"), "var(--red)"],
];

function Trend({ buckets, granularity }) {
    const [hover, setHover] = useState(null);
    const [width, setWidth] = useState(640);
    const plot = useRef();
    useEffect(() => {
        const node = plot.current;
        if (!node || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    useEffect(() => setHover(null), [buckets]);
    const { groups, size } = groupBuckets(buckets, granularity, width);
    const n = groups.length;
    const ceiling = niceCeiling(Math.max(0, ...groups.map((g) => Math.max(g.delivered, g.fetched, g.failed))));
    const hourly = granularity === "hour";
    const spansDays = hourly && buckets.length > 24;
    const zone = hourly ? {} : { timeZone: "UTC" };
    const axis = new Intl.DateTimeFormat(
        locale(),
        hourly
            ? spansDays
                ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
                : { hour: "2-digit", minute: "2-digit", hour12: false }
            : { ...zone, month: "numeric", day: "numeric" },
    );
    const full = new Intl.DateTimeFormat(
        locale(),
        hourly
            ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
            : { ...zone, year: "numeric", month: "short", day: "numeric" },
    );
    const clock = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / (spansDays ? 84 : hourly ? 56 : 48)))));
    const pick = (event) => {
        const rect = plot.current.getBoundingClientRect();
        return Math.min(n - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * n)));
    };
    const onKey = (event) => {
        const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (event.key === "Escape") return setHover(null);
        if (event.key === "Home" || event.key === "End") setHover(event.key === "Home" ? 0 : n - 1);
        else if (move) setHover(Math.min(n - 1, Math.max(0, (hover ?? (move > 0 ? -1 : n)) + move)));
        else return;
        event.preventDefault();
    };
    const g = hover != null ? groups[hover] : null;
    const span = (group) =>
        size === 1
            ? full.format(new Date(group.start))
            : hourly
              ? `${full.format(new Date(group.start))} – ${clock.format(new Date(group.end))}`
              : `${full.format(new Date(group.start))} – ${full.format(new Date(group.last))}`;
    const percent = (v) => (v / ceiling) * 100;
    return html`<div class="chart">
        <div class="chart-y" aria-hidden="true">
            ${[0, 0.5, 1].map((f) => html`<span style=${`bottom:${f * 100}%`}>${num(ceiling * f)}</span>`)}
        </div>
        <div
            class="chart-plot"
            ref=${plot}
            tabindex="0"
            role="img"
            aria-label=${L("推送趋势图", "Delivery trend chart")}
            onPointerMove=${(e) => e.pointerType === "mouse" && setHover(pick(e))}
            onPointerDown=${(e) => e.pointerType !== "mouse" && setHover((cur) => (cur === pick(e) ? null : pick(e)))}
            onPointerLeave=${(e) => e.pointerType === "mouse" && setHover(null)}
            onKeyDown=${onKey}
            onBlur=${() => setHover(null)}
        >
            ${[0, 0.5, 1].map((f) => html`<i class="grid-line" style=${`bottom:${f * 100}%`}></i>`)}
            <div class="chart-cols" style=${`grid-template-columns:repeat(${n},minmax(0,1fr))`}>
                ${groups.map(
                    (group, i) => html`<div class="chart-col ${hover === i ? "on" : ""}">
                        ${group.unavailable
                            ? html`<i class="bar gap"></i>`
                            : SERIES.map(
                                  ([key, , color]) =>
                                      html`<i
                                          class="bar"
                                          style=${`height:${group[key] ? `max(3px,${percent(group[key])}%)` : "0"};background:${color}`}
                                      ></i>`,
                              )}
                    </div>`,
                )}
            </div>
            ${g
                ? html`<div class="chart-tip" style=${`left:${Math.min(86, Math.max(14, ((hover + 0.5) / n) * 100))}%`}>
                      <b>${span(g)}</b>
                      ${g.unavailable
                          ? L("这段时间没有记录", "No data recorded for this period")
                          : html`<div class="legend" style="display:grid;gap:3px">
                                ${SERIES.filter(([key]) => key !== "failed" || g.failed).map(
                                    ([key, label, color]) =>
                                        html`<span><i style=${`background:${color}`}></i>${label()} <b>${num(g[key])}</b></span>`,
                                )}
                                ${g.partial ? html`<span class="muted">${L("本时段记录不完整", "Partial period")}</span>` : null}
                            </div>`}
                  </div>`
                : null}
        </div>
        <div class="chart-x" aria-hidden="true">
            ${groups.map((group, i) =>
                i % labelEvery === 0
                    ? html`<span style=${`left:${((i + 0.5) / n) * 100}%`}>${axis.format(new Date(group.start))}</span>`
                    : null,
            )}
        </div>
        ${size > 1
            ? html`<div class="chart-note muted">
                  ${hourly
                      ? L(`每 ${size} 小时合并为一列`, `Every ${size} hours are combined into one column`)
                      : L(`每 ${size} 天合并为一列`, `Every ${size} days are combined into one column`)}
              </div>`
            : null}
        <span class="visually-hidden" aria-live="polite"
            >${g && !g.unavailable
                ? `${span(g)}: ${SERIES.map(([key, label]) => `${label()} ${g[key]}`).join(", ")}`
                : ""}</span
        >
    </div>`;
}

function TrendCard() {
    const [range, setRange] = useState("day");
    const { data, loading, error } = useAsync(() => api("/statistics" + qs(windowQuery(range))), [range]);
    const sums = data?.buckets?.reduce(
        (acc, b) => ({
            delivered: acc.delivered + (b.delivered || 0),
            fetched: acc.fetched + (b.fetched || 0),
            failed: acc.failed + (b.failed || 0),
        }),
        { delivered: 0, fetched: 0, failed: 0 },
    );
    return html`<section class="card">
        <div class="card-head">
            <div>
                <h2>${L("推送趋势", "Delivery trend")}</h2>
                <div class="sub">
                    ${RANGES[range].granularity === "hour"
                        ? L("按小时统计，显示本地时间", "Hourly, in your local time")
                        : L("按天统计（UTC 日期）", "Daily (UTC dates)")}
                </div>
            </div>
            <${Segmented} size="sm" value=${range} onChange=${setRange} options=${Object.entries(RANGES).map(([k, v]) => [k, v.label()])} />
        </div>
        <div class="card-body">
            ${error
                ? html`<${Notice} tone="error">${error.message}<//>`
                : !data
                  ? html`<${Spinner} />`
                  : data.available === false
                    ? html`<${Empty} icon="overview" title=${L("离线副本没有历史统计", "No history in the offline copy")}
                          >${L(
                              "原版机器人不记录每小时推送数据，统计会在启用管理台后开始积累。",
                              "The original bot doesn't record hourly deliveries; statistics start accumulating once the console is enabled.",
                          )}<//
                      >`
                    : html`<div class="chart-sum">
                              <div>
                                  <small
                                      ><span class="legend"
                                          ><span><i style="background:var(--blue)"></i>${L("成功推送", "Delivered")}</span></span
                                      ></small
                                  ><b>${num(sums.delivered)}</b>
                              </div>
                              <div>
                                  <small
                                      ><span class="legend"
                                          ><span><i style="background:var(--accent)"></i>${L("新文章", "New entries")}</span></span
                                      ></small
                                  ><b>${num(sums.fetched)}</b>
                              </div>
                              <div>
                                  <small
                                      ><span class="legend"
                                          ><span><i style="background:var(--red)"></i>${L("抓取失败", "Fetch failures")}</span></span
                                      ></small
                                  ><b>${num(sums.failed)}</b>
                              </div>
                          </div>
                          <div style=${loading ? "opacity:.5" : ""}>
                              <${Trend} buckets=${data.buckets} granularity=${data.granularity} />
                          </div>`}
        </div>
    </section>`;
}

const ACTIVITY = {
    login: () => L("登录了管理台", "Signed in"),
    password_changed: () => L("修改了管理台密码", "Changed the console password"),
    sessions_revoked: () => L("退出了所有网页登录", "Signed out all browser sessions"),
    agent_request: () => L("API 请求", "API request"),
};

function groupByFeed(subs) {
    const groups = new Map();
    for (const s of subs) {
        const g = groups.get(s.feed_id) || { sub: s, chats: [] };
        g.chats.push(s.target_title);
        groups.set(s.feed_id, g);
    }
    return [...groups.values()];
}

export function Overview() {
    const { data, error, reload } = useAsync(async () => {
        const d = await api("/dashboard");
        app.bot = d.bot;
        app.uptime = d.uptime_seconds;
        app.attention = d.counts.attention;
        emit();
        return d;
    }, []);
    if (error && !data)
        return html`<${Notice} tone="error" action=${html`<${Button} size="sm" onClick=${() => reload()}>${L("重试", "Retry")}<//>`}
            >${error.message}<//
        >`;
    if (!data) return html`<${Spinner} />`;
    const c = data.counts;
    const known = data.usage.known;
    const active = data.usage.active;
    const totals = data.statistics.totals || {};
    const parts = [
        ["private", L("私聊", "Private"), "var(--blue)"],
        ["group", L("群组", "Groups"), "var(--violet)"],
        ["channel", L("频道", "Channels"), "var(--accent)"],
        ["unknown", L("频道或群组", "Channel/group"), "#c26a2b"],
    ].filter(([k]) => active[k]);
    return html`
        <div class="page-head">
            <div>
                <h1>${L("概览", "Overview")}</h1>
                <p>
                    ${L(
                        "机器人正在为哪些会话服务、订阅是否健康、推送了多少内容。",
                        "Who the bot serves, how healthy the feeds are, and how much it delivers.",
                    )}
                </p>
            </div>
            <div class="page-actions">
                <${Button} icon="plus" kind="primary" onClick=${() => go("subscriptions", { add: 1 })}
                    >${L("添加订阅", "Add subscription")}<//
                >
            </div>
        </div>

        <div class="kpis">
            <a class="kpi" href="#chats">
                <div class="kpi-label"><${Icon} name="users" />${L("服务中的会话", "Chats served")}</div>
                <div class="kpi-value">${num(active.total)}</div>
                <div class="split">
                    ${parts.map(
                        ([k, , color]) =>
                            html`<span style=${`width:${(active[k] / Math.max(1, active.total)) * 100}%;background:${color}`}></span>`,
                    )}
                </div>
                <div class="kpi-meta" style="margin-top:10px">
                    ${parts.map(
                        ([k, label, color]) =>
                            html`<span
                                ><i
                                    class="dot"
                                    style=${`display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px;background:${color}`}
                                ></i
                                >${label} <b>${active[k]}</b></span
                            >`,
                    )}
                </div>
                <div class="kpi-meta" style="margin-top:4px">
                    ${L(`有启用订阅的会话；共记录 ${known.total} 个`, `chats with active subscriptions; ${known.total} known`)}
                </div>
            </a>
            <a class="kpi" href="#subscriptions">
                <div class="kpi-label"><${Icon} name="feeds" />${L("订阅", "Subscriptions")}</div>
                <div class="kpi-value">
                    ${num(c.active)}<span class="muted" style="font-size:16px;font-weight:500"> / ${num(c.subscriptions)}</span>
                </div>
                <div class="kpi-meta">
                    <span>${L("启用", "enabled")} <b>${num(c.active)}</b></span>
                    <span>${L("暂停", "paused")} <b>${num(c.subscriptions - c.active)}</b></span>
                    <span>${L("订阅源", "feeds")} <b>${num(c.feeds)}</b></span>
                </div>
            </a>
            <div class="kpi">
                <div class="kpi-label"><${Icon} name="send" />${L("累计推送", "Total deliveries")}</div>
                <div class="kpi-value">${data.statistics.available === false ? "—" : compact(totals.delivered)}</div>
                <div class="kpi-meta">
                    ${data.statistics.available === false
                        ? html`<span>${L("离线副本无此数据", "Not available offline")}</span>`
                        : html`<span>${L("新文章", "new entries")} <b>${compact(totals.fetched)}</b></span
                              ><span>${L("自", "since")} ${dateTime(data.started_at)}</span>`}
                </div>
            </div>
            <a class="kpi ${c.attention ? "warn" : ""}" href="#subscriptions?status=attention">
                <div class="kpi-label"><${Icon} name="alert" />${L("需要处理", "Needs attention")}</div>
                <div class="kpi-value">${num(c.attention)}</div>
                <div class="kpi-meta">
                    <span
                        >${L(
                            `连续抓取失败 ≥ ${data.threshold} 次的启用订阅`,
                            `enabled subscriptions failing ≥ ${data.threshold} times in a row`,
                        )}</span
                    >
                </div>
            </a>
        </div>

        <div class="grid grid-main">
            <${TrendCard} />
            <section class="card">
                <div class="card-head">
                    <div>
                        <h2>${L("抓取异常", "Fetch problems")}</h2>
                        <div class="sub">${L("连续失败次数最多的订阅", "Subscriptions with the most consecutive failures")}</div>
                    </div>
                    ${c.attention ? html`<a class="link-btn" href="#subscriptions?status=attention">${L("全部", "View all")}</a>` : null}
                </div>
                <div class="list" style="margin-top:8px">
                    ${data.attention.length
                        ? groupByFeed(data.attention)
                              .slice(0, 6)
                              .map(
                                  ({ sub: s, chats }) =>
                                      html`<button
                                          class="list-row"
                                          onClick=${() => go("subscriptions", { status: "attention", sub: s.id, tab: "logs" })}
                                      >
                                          <span class="feed-icon error">${[...(s.title || "?")][0]}</span>
                                          <span class="grow"
                                              ><span class="title">${s.title}</span
                                              ><span class="meta"
                                                  >${chats.length > 1
                                                      ? L(
                                                            `${chats[0]} 等 ${chats.length} 个会话`,
                                                            `${chats[0]} and ${chats.length - 1} more`,
                                                        )
                                                      : chats[0]}</span
                                              ></span
                                          >
                                          <${Badge} tone="red">${L(`失败 ${s.errors} 次`, `${s.errors} failures`)}<//>
                                      </button>`,
                              )
                        : html`<${Empty} icon="check" title=${L("一切正常", "All good")}
                              >${L("没有连续抓取失败的订阅。", "No subscriptions are failing repeatedly.")}<//
                          >`}
                </div>
            </section>
        </div>

        <section class="card" style="margin-top:16px">
            <div class="card-head"><h2>${L("最近的管理操作", "Recent admin activity")}</h2></div>
            <div class="list" style="margin-top:8px">
                ${data.activity.length
                    ? data.activity.map(
                          (a) =>
                              html`<div class="list-row">
                                  <span class="grow"
                                      ><span class="title">${ACTIVITY[a.action]?.() || a.action}</span
                                      ><span class="meta"
                                          >${a.actor}${a.detail && a.detail !== "success" ? " · " + a.detail : ""}</span
                                      ></span
                                  >
                                  <span class="muted" title=${dateTime(a.at)}>${ago(a.at)}</span>
                              </div>`,
                      )
                    : html`<${Empty} icon="clock" title=${L("还没有操作记录", "No activity yet")} />`}
            </div>
        </section>
    `;
}
