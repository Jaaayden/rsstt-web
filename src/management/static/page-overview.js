import { html, useState, useAsync, useRef, Icon, Button, Segmented, Spinner, RefreshButton, Empty, Notice, Badge } from "./ui.js";
import { L, api, qs, num, compact, ago, dateTime, go, app, emit, locale, prefetch } from "./core.js";

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

function Trend({ buckets, granularity }) {
    const [hover, setHover] = useState(null);
    const box = useRef();
    const W = 1000,
        H = 200,
        top = 10,
        bottom = 22,
        left = 0;
    const max = Math.max(4, ...buckets.map((b) => Math.max(b.delivered || 0, b.fetched || 0)));
    const nice = Math.pow(10, Math.floor(Math.log10(max)));
    const ceiling = Math.ceil(max / nice) * nice;
    const n = buckets.length;
    const step = (W - left) / n;
    const y = (v) => top + (H - top - bottom) * (1 - v / ceiling);
    const fmt = new Intl.DateTimeFormat(
        locale(),
        granularity === "hour" ? { hour: "2-digit", minute: "2-digit", hour12: false } : { month: "numeric", day: "numeric" },
    );
    const full = new Intl.DateTimeFormat(
        locale(),
        granularity === "hour"
            ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
            : { year: "numeric", month: "short", day: "numeric" },
    );
    const labelEvery = Math.ceil(n / 8);
    const points = buckets
        .map((b, i) => (b.availability === "unavailable" || b.fetched == null ? null : `${left + step * i + step / 2},${y(b.fetched)}`))
        .filter(Boolean)
        .join(" ");
    function move(e) {
        const rect = box.current.getBoundingClientRect();
        const index = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
        setHover(index);
    }
    const hb = hover != null ? buckets[hover] : null;
    return html`<div class="chart" ref=${box} onMouseMove=${move} onMouseLeave=${() => setHover(null)}>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${L("推送趋势图", "Delivery trend chart")}>
            ${[0, 0.5, 1].map(
                (f) =>
                    html`<line
                        class="grid-line"
                        x1="0"
                        x2=${W}
                        y1=${y(ceiling * f)}
                        y2=${y(ceiling * f)}
                        vector-effect="non-scaling-stroke"
                    />`,
            )}
            ${hover != null
                ? html`<rect class="hover-col" x=${left + step * hover} y=${top} width=${step} height=${H - top - bottom} />`
                : null}
            ${buckets.map((b, i) => {
                const gap = b.availability === "unavailable" || b.delivered == null;
                const v = gap ? 0 : b.delivered;
                const h = gap ? 3 : Math.max(v ? 2 : 0, H - bottom - y(v));
                return html`<rect
                    class="bar ${gap ? "gap" : ""}"
                    x=${left + step * i + step * 0.18}
                    width=${step * 0.64}
                    y=${H - bottom - h}
                    height=${h}
                    rx="1.5"
                />`;
            })}
            ${points ? html`<polyline class="line" points=${points} vector-effect="non-scaling-stroke" />` : null}
        </svg>
        <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between" class="axis-labels">
            ${buckets.map((b, i) =>
                i % labelEvery === 0
                    ? html`<span
                          class="muted"
                          style=${`position:absolute;left:${((i + 0.5) / n) * 100}%;transform:translateX(-50%);font-size:11px`}
                          >${fmt.format(new Date(b.start))}</span
                      >`
                    : null,
            )}
        </div>
        <span class="muted" style="position:absolute;top:-4px;right:0;font-size:11px">${num(ceiling)}</span>
        ${hb
            ? html`<div class="chart-tip" style=${`left:${Math.min(88, Math.max(12, ((hover + 0.5) / n) * 100))}%`}>
                  <b>${full.format(new Date(hb.start))}</b>
                  ${hb.availability === "unavailable"
                      ? L("这段时间没有记录", "No data recorded for this period")
                      : html`<div class="legend" style="display:grid;gap:3px">
                            <span><i style="background:var(--blue)"></i>${L("成功推送", "Delivered")} <b>${num(hb.delivered)}</b></span>
                            <span><i style="background:var(--accent)"></i>${L("新文章", "New entries")} <b>${num(hb.fetched)}</b></span>
                            ${hb.failed
                                ? html`<span
                                      ><i style="background:var(--red)"></i>${L("抓取失败", "Fetch failures")}
                                      <b>${num(hb.failed)}</b></span
                                  >`
                                : null}
                            ${hb.availability === "partial"
                                ? html`<span class="muted">${L("本时段记录不完整", "Partial period")}</span>`
                                : null}
                        </div>`}
              </div>`
            : null}
    </div>`;
}

function TrendCard() {
    const [range, setRange] = useState("day");
    const path = () => "/statistics" + qs(windowQuery(range));
    const { data, loading, error } = useAsync(() => api(path()), [range], { key: path, live: true, floor: 5 * 60_000 });
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
    const { data, error, reload } = useAsync(
        async () => {
            const d = await api("/dashboard");
            app.bot = d.bot;
            app.uptime = d.uptime_seconds;
            app.attention = d.counts.attention;
            app.statusAt = Date.now(); // the sidebar needs no /status of its own while this is fresh
            emit();
            return d;
        },
        [],
        { key: "/dashboard", live: true },
    );
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
                <${RefreshButton} />
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

/** Fetched when the pointer reaches the nav link, so the page can open without waiting. */
export const warm = () => (prefetch("/dashboard"), prefetch("/statistics" + qs(windowQuery("day"))));
