import { html, useState, useAsync, useRoute, Icon, Button, Select, Segmented, Spinner, Empty, Notice, Badge, Pager } from "./ui.js";
import { L, lang, api, qs, num, dateTime, readRoute, setParams, app } from "./core.js";

const CATEGORY = {
    fetch: () => L("抓取", "Fetch"),
    delivery: () => L("推送", "Delivery"),
    notification: () => L("通知", "Notification"),
    system: () => L("系统", "System"),
};

// English for event codes; Chinese comes from the server message.
const EN = {
    "fetch.failed": "Feed fetch failed.",
    "fetch.exception": "The fetch task raised an error before completing.",
    "fetch.timeout": "The fetch task timed out.",
    "fetch.updated": "Fetched; new posts found.",
    "fetch.unchanged": "Fetched; no new posts.",
    "fetch.not_modified": "Feed unchanged (cached).",
    "fetch.empty": "Fetched; the feed has no posts.",
    "fetch.recovered": "Fetching recovered.",
    "fetch.deactivated": "Feed disabled after too many failures.",
    "fetch.deactivation_requested": "Failure limit reached; the feed is being disabled.",
    "fetch.state_save_failed": "Fetched, but saving the feed state failed.",
    "manual.requested": "Manual fetch requested.",
    "manual.completed": "Manual fetch completed.",
    "manual.failed": "Manual fetch or test delivery didn't complete.",
    "manual.cancelled": "Manual fetch interrupted by shutdown.",
    "manual.test_fetched": "Test fetch completed.",
    "manual.test_delivered": "Test post delivered.",
    "delivery.failed": "Telegram delivery failed.",
    "delivery.parse_failed": "Couldn't format the post for delivery.",
    "delivery.unconfirmed": "Telegram didn't confirm the complete delivery.",
    "delivery.deactivated": "Delivery stopped for this chat.",
    "notification.sent": "Notification sent.",
    "notification.simulated": "Offline mode: notification simulated.",
    "notification.retry": "Notification failed; will retry.",
    "notification.failed": "Notification failed repeatedly; gave up.",
    "notification.cancelled": "Notification channel disabled; delivery cancelled.",
    "notification.queue_failed": "Notification task failed.",
    "auth.signed_in": "Administrator signed in.",
    "auth.sign_in_failed": "Sign-in failed.",
    "auth.password_changed": "Console password changed; other sessions signed out.",
    "auth.password_change_rejected": "Password not changed: current password was wrong.",
    "auth.token_issued": "API token created.",
    "auth.token_revoked": "API token revoked.",
    "console.started": "Web console started.",
    "console.stopped": "Web console stopping.",
    "console.request_failed": "A console request failed on the server.",
    "runtime_config.saved": "Runtime configuration saved; restart to apply.",
    "runtime_config.rejected": "Runtime configuration rejected.",
    "runtime_config.read_failed": "Couldn't read the runtime configuration.",
    "backup.exported": "Backup exported.",
    "backup.validated": "Backup checked.",
    "backup.staged": "Restore staged for next restart.",
    "backup.cancelled": "Pending restore cancelled.",
    "metrics.failed": "Statistics recording failed.",
    "metrics.recovered": "Statistics recording recovered.",
};

const CONTEXT = {
    http_status: () => L("HTTP 状态", "HTTP status"),
    duration_ms: () => L("耗时", "Duration"),
    failures: () => L("连续失败", "Consecutive failures"),
    previous_failures: () => L("恢复前连续失败", "Failures before recovery"),
    exception_type: () => L("异常类型", "Exception"),
    stage: () => L("阶段", "Stage"),
    status: () => L("结果", "Result"),
    next_retry_at: () => L("下次重试", "Next retry"),
    next_check_at: () => L("下次检查", "Next check"),
    new_entries: () => L("新文章", "New posts"),
    source_host: () => L("来源主机", "Host"),
    channel: () => L("通知渠道", "Channel"),
    attempt: () => L("尝试次数", "Attempt"),
    retry_after: () => L("限流等待", "Retry after"),
    method: () => L("请求方法", "Method"),
    route: () => L("接口", "Route"),
};
const fmtValue = (key, value) => {
    if (key === "duration_ms") return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
    if (key.endsWith("_at")) return dateTime(value, { seconds: true });
    if (key === "retry_after") return `${value} s`;
    return String(value);
};

const HTTP = {
    400: () => L("请求无效", "bad request"),
    401: () => L("需要登录", "authentication required"),
    403: () =>
        L("网站拒绝访问，可能拦截了机器人（可尝试更换 User-Agent）", "access denied — the site may block bots (try another User-Agent)"),
    404: () => L("地址不存在", "not found"),
    410: () => L("订阅源已被删除", "gone"),
    429: () => L("请求太频繁，被网站限流", "rate limited by the site"),
    500: () => L("网站服务器出错", "server error"),
    502: () => L("网站网关出错", "bad gateway"),
    503: () => L("网站暂时不可用", "service unavailable"),
    504: () => L("网站网关超时", "gateway timeout"),
    520: () => L("网站返回未知错误（常见于 Cloudflare）", "unknown error (often Cloudflare)"),
    521: () => L("网站源站已关闭", "origin down"),
    522: () => L("连接网站源站超时", "origin connection timed out"),
};
const EXCEPTION = [
    [/Timeout/i, () => L("连接超时，网站响应太慢或无法访问", "timed out — the site is slow or unreachable")],
    [/Certificate|SSL/i, () => L("HTTPS 证书有问题", "TLS certificate problem")],
    [/gaierror|DNS|NameResolution/i, () => L("域名解析失败，网址可能写错或网站已下线", "DNS lookup failed — wrong URL or site offline")],
    [/Connector|Connection|Refused|Reset|OSError/i, () => L("无法连接到网站", "couldn't connect to the site")],
    [/XMLSyntax|SAX|Parse|Expat/i, () => L("返回内容不是有效的 RSS/Atom", "the response isn't valid RSS/Atom")],
    [/Flood/i, () => L("Telegram 限流，稍后会重试", "Telegram flood wait; will retry")],
    [
        /ChatWriteForbidden|ChannelPrivate|UserIsBlocked|Forbidden/i,
        () => L("机器人没有在这个会话发消息的权限，或已被移出/屏蔽", "the bot can't post here, or was removed/blocked"),
    ],
];
export function reasonOf(e) {
    const c = e.context || {};
    if (c.http_status && c.http_status >= 400) {
        const phrase =
            HTTP[c.http_status]?.() || (c.http_status >= 500 ? L("网站服务器出错", "server error") : L("请求被拒绝", "request rejected"));
        return `HTTP ${c.http_status} · ${phrase}`;
    }
    const text = `${c.exception_type || ""} ${e.detail || ""}`;
    if (/feed invalid/.test(e.detail || "")) return L("返回内容不是有效的 RSS/Atom", "the response isn't valid RSS/Atom");
    if (/URL invalid/.test(e.detail || "")) return L("订阅地址无效", "invalid feed URL");
    for (const [pattern, label] of EXCEPTION) if (pattern.test(text)) return label();
    return "";
}

export function EventRow({ event: e, hideFeed }) {
    const [open, setOpen] = useState(false);
    const context = Object.entries(e.context || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
    const hasMore = e.detail || context.length;
    const message = lang === "en" ? EN[e.code] || e.message : e.message;
    return html`<div class="event">
        <span class="lvl lvl-${e.level}"></span>
        <div>
            <div class="event-head">
                <b>${message}</b>
                ${e.context?.failures && e.level !== "info"
                    ? html`<${Badge} tone="amber">${L(`第 ${e.context.failures} 次`, `#${e.context.failures}`)}<//>`
                    : null}
            </div>
            ${e.level !== "info" && reasonOf(e) ? html`<div style="margin-top:2px;color:var(--text-2)">${reasonOf(e)}</div>` : null}
            <div class="event-meta">
                <span title=${dateTime(e.at, { seconds: true })}>${dateTime(e.at)}</span>
                · ${CATEGORY[e.category]?.() || e.category}
                ${!hideFeed && e.feed_id
                    ? html` ·
                          <a class="link-btn" style="font-weight:450" href=${"#logs?feed=" + e.feed_id}
                              >${e.feed_title || L(`订阅源 #${e.feed_id}`, `Feed #${e.feed_id}`)}</a
                          >`
                    : null}
                ${e.target_id
                    ? html` ·
                          <a class="link-btn" style="font-weight:450" href=${"#chats?chat=" + e.target_id}
                              >${e.target_title || e.target_id}</a
                          >`
                    : null}
                ${hasMore
                    ? html` ·
                          <button class="link-btn" onClick=${() => setOpen(!open)}>
                              ${open ? L("收起", "Hide") : L("详情", "Details")}
                          </button>`
                    : null}
            </div>
            ${open
                ? html`<dl class="kv">
                      ${e.detail
                          ? html`<dt>${L("技术细节", "Detail")}</dt>
                                <dd class="mono">${e.detail}</dd>`
                          : null}
                      ${context.map(
                          ([k, v]) =>
                              html`<dt>${CONTEXT[k]?.() || k}</dt>
                                  <dd>${fmtValue(k, v)}</dd>`,
                      )}
                      <dt>${L("事件代码", "Event code")}</dt>
                      <dd class="mono">${e.code}</dd>
                  </dl>`
                : null}
        </div>
    </div>`;
}

/* ---------------- fetch runs: one line per check ---------------- */

function seconds(ms) {
    return ms == null ? "—" : L(`${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} 秒`, `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);
}

const clock = (value, withSeconds) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hour12: false }).format(new Date(value));

/** "Nov 2, 04:47 – 09:12" for a stretch of identical checks; the end gets a date only when it is another day. */
function span(from, to) {
    if (new Date(from).toDateString() === new Date(to).toDateString()) return `${dateTime(from)} – ${clock(to)}`;
    return `${dateTime(from)} – ${dateTime(to)}`;
}

export function RunRow({ run: r, hideFeed }) {
    const failed = r.status === "failed" || r.status === "exception";
    const many = r.count > 1;
    const reason = failed ? reasonOf({ level: "error", context: { http_status: r.http_status }, detail: r.detail }) : "";
    const badge = failed
        ? html`<${Badge} tone="red">${L("失败", "Failed")}<//>`
        : r.status === "updated"
          ? html`<${Badge} tone="blue">${L("有新文章", "New posts")}<//>`
          : html`<${Badge} tone="green">${L("成功", "OK")}<//>`;
    const took = many
        ? L(
              `平均耗时 ${seconds(r.duration_ms)}（${seconds(r.duration_min)} – ${seconds(r.duration_max)}）`,
              `Avg ${seconds(r.duration_ms)} (${seconds(r.duration_min)} – ${seconds(r.duration_max)})`,
          )
        : L(`耗时：${seconds(r.duration_ms)}`, `Took ${seconds(r.duration_ms)}`);
    const parts = [];
    if (many) parts.push(failed ? L(`连续失败 ${num(r.count)} 次`, `Failed ${num(r.count)} times in a row`) : L(`共 ${num(r.count)} 次检查`, `${num(r.count)} checks`));
    parts.push(took);
    if (failed) {
        if (r.http_status) parts.push(`HTTP ${r.http_status}`);
    } else if (r.status === "not_modified") {
        parts.push(L("内容没有变化（使用缓存）", "unchanged (cached)"));
    } else if (r.status === "empty") {
        parts.push(L("订阅源里暂时没有文章", "the feed has no posts"));
    } else {
        if (r.entries != null) parts.push(L(`有效 ${num(r.entries)} 条`, `${num(r.entries)} valid`));
        parts.push(L(`新增 ${num(r.new_entries)} 条`, `${num(r.new_entries)} new`));
    }
    return html`<div class="run">
        <div>
            <div class="run-head">
                <b title=${dateTime(r.at, { seconds: true }) + (many ? " – " + dateTime(r.last_at, { seconds: true }) : "")}
                    >${many ? span(r.at, r.last_at) : dateTime(r.at, { seconds: true })}</b
                >
                <span class="muted">${r.manual ? L("手动", "Manual") : L("定时", "Scheduled")}</span>
                ${!hideFeed && r.feed_id
                    ? html`<a class="link-btn" style="font-weight:450" href=${"#logs?view=runs&feed=" + r.feed_id}
                          >${r.feed_title || L(`订阅源 #${r.feed_id}`, `Feed #${r.feed_id}`)}</a
                      >`
                    : null}
            </div>
            <div class="run-meta">${parts.join(" · ")}</div>
            ${failed && reason ? html`<div class="run-meta" style="color:var(--red)">${reason}</div>` : null}
        </div>
        ${badge}
    </div>`;
}

export const RUN_FILTERS = () => [
    ["", L("全部状态", "All")],
    ["updated", L("有新文章", "New posts")],
    ["ok", L("成功", "Succeeded")],
    ["failed", L("失败", "Failed")],
];

/** Every fetch of one feed (feedId) or of all feeds, newest first. Paging and filter live in the caller. */
export function RunsPanel({ feedId, status, page, onPage }) {
    const { data, error, loading } = useAsync(
        () => api((feedId ? `/feeds/${feedId}/fetch-runs` : "/fetch-runs") + qs({ status, page, size: 30 })),
        [feedId, status, page],
    );
    if (error) return html`<${Notice} tone="error">${error.message}<//>`;
    if (!data) return html`<${Spinner} />`;
    return html`
        ${!data.items.length
            ? html`<${Empty} icon="logs" title=${L("还没有抓取记录", "No fetches recorded yet")}>
                  ${app.info.snapshot
                      ? L("离线副本不运行抓取，所以没有记录。", "The offline copy doesn't fetch, so there are no records.")
                      : status
                        ? L("没有符合这个筛选条件的记录。", "Nothing matches this filter.")
                        : L(
                              `从 ${dateTime(data.started_at)} 起记录每次抓取；结果相同的连续检查合并成一行，有变化才新增一行。`,
                              `Every fetch is counted from ${dateTime(data.started_at)} on; identical consecutive checks share a row, and a new row starts when something changes.`,
                          )}<//
              >`
            : html`<div style=${loading ? "opacity:.6" : ""}>
                      ${data.items.map((r) => html`<${RunRow} run=${r} key=${r.id} hideFeed=${!!feedId} />`)}
                  </div>
                  <${Pager} page=${page} size=${data.size} total=${data.total} onPage=${onPage} />
                  <p class="muted" style="margin-top:10px;font-size:12.5px">
                      ${L(
                          `连续相同的结果合并成一行；每个订阅源保留最近 ${data.retention.per_feed} 行、不超过 ${data.retention.days} 天。`,
                          `Identical consecutive checks share a row; the last ${data.retention.per_feed} rows per feed, at most ${data.retention.days} days.`,
                      )}
                  </p>`}
    `;
}

export function Logs() {
    useRoute();
    const { params } = readRoute();
    const category = params.category || "";
    const level = params.level || "";
    const feed = params.feed || "";
    const target = params.target || "";
    const page = Number(params.page || 1);
    const view = params.view === "runs" ? "runs" : "events";
    const { data, error, loading, reload } = useAsync(
        () =>
            view === "runs"
                ? Promise.resolve(null)
                : api((feed ? `/feeds/${feed}/diagnostics` : "/diagnostics") + qs({ category, level, target_id: target, page, size: 40 })),
        [view, category, level, feed, target, page],
    );
    return html`
        <div class="page-head">
            <div>
                <h1>${L("运行日志", "Logs")}</h1>
                <p>
                    ${L(
                        "每次抓取失败、推送异常、通知发送和系统事件都记录在这里，用来判断问题出在哪一步。",
                        "Fetch failures, delivery problems, notifications and system events — to find where things go wrong.",
                    )}
                </p>
            </div>
            <div class="page-actions">
                <${Button} icon="refresh" loading=${loading && !!data} onClick=${() => reload()}>${L("刷新", "Refresh")}<//>
            </div>
        </div>
        <section class="card">
            <div class="toolbar">
                <${Segmented}
                    value=${view}
                    onChange=${(v) => setParams({ view: v === "runs" ? "runs" : "", page: "", status: "" })}
                    options=${[
                        ["events", L("事件", "Events")],
                        ["runs", L("抓取记录", "Fetch runs")],
                    ]}
                />
                ${view === "runs"
                    ? html`<${Select}
                              value=${params.status || ""}
                              onChange=${(v) => setParams({ status: v, page: "" })}
                              options=${RUN_FILTERS()}
                          />
                          ${feed
                              ? html`<span class="chip" style="height:36px"
                                    >${L(`订阅源 #${feed}`, `Feed #${feed}`)}<button
                                        type="button"
                                        aria-label=${L("清除", "Clear")}
                                        onClick=${() => setParams({ feed: "", page: "" })}
                                    >
                                        <${Icon} name="close" size=${12} /></button
                                ></span>`
                              : null}`
                    : html`<${Segmented}
                    value=${category}
                    onChange=${(v) => setParams({ category: v, page: "" })}
                    options=${[["", L("全部", "All")], ...Object.entries(CATEGORY).map(([k, f]) => [k, f()])]}
                />
                <${Select}
                    value=${level}
                    onChange=${(v) => setParams({ level: v, page: "" })}
                    options=${[
                        ["", L("所有级别", "All levels")],
                        ["error", L("仅错误", "Errors only")],
                        ["warning", L("仅警告", "Warnings only")],
                        ["info", L("仅信息", "Info only")],
                    ]}
                />
                ${feed
                    ? html`<span class="chip" style="height:36px"
                          >${data?.feed?.title || L(`订阅源 #${feed}`, `Feed #${feed}`)}<button
                              type="button"
                              aria-label=${L("清除", "Clear")}
                              onClick=${() => setParams({ feed: "", page: "" })}
                          >
                              <${Icon} name="close" size=${12} /></button
                      ></span>`
                    : null}
                ${target
                    ? html`<span class="chip" style="height:36px"
                          >${L("会话", "Chat")} ${target}<button
                              type="button"
                              aria-label=${L("清除", "Clear")}
                              onClick=${() => setParams({ target: "", page: "" })}
                          >
                              <${Icon} name="close" size=${12} /></button
                      ></span>`
                    : null}
                <span class="total">${data ? L(`${num(data.total)} 条`, `${num(data.total)} entries`) : ""}</span>`}
            </div>
            ${view === "runs"
                ? html`<div class="card-body" style="padding-top:4px;padding-bottom:12px">
                      <${RunsPanel} feedId=${feed} status=${params.status || ""} page=${page} onPage=${(p) => setParams({ page: p })} />
                  </div>`
                : html`<div class="card-body" style="padding-top:4px;padding-bottom:4px">
                ${data?.degraded || data?.dropped
                    ? html`<div style="margin:10px 0">
                          <${Notice} tone="warn"
                              >${L(
                                  `日志写入出现问题，本次运行丢弃了 ${data.dropped} 条记录。`,
                                  `Log storage had problems; ${data.dropped} entries were dropped this run.`,
                              )}<//
                          >
                      </div>`
                    : null}
                ${error
                    ? html`<div style="margin:10px 0"><${Notice} tone="error">${error.message}<//></div>`
                    : !data
                      ? html`<${Spinner} />`
                      : !data.items.length
                        ? html`<${Empty} icon="logs" title=${L("没有日志", "No log entries")}>
                              ${app.info.snapshot
                                  ? L(
                                        "离线副本不运行抓取和推送，所以这里只有系统事件。",
                                        "The offline copy doesn't fetch or deliver, so only system events appear.",
                                    )
                                  : L(
                                        `日志保留 ${data.retention.days} 天，从 ${dateTime(data.started_at)} 开始记录。`,
                                        `Kept for ${data.retention.days} days; recording since ${dateTime(data.started_at)}.`,
                                    )}
                          <//>`
                        : html`<div class="timeline" style=${loading ? "opacity:.6" : ""}>
                              ${data.items.map((e) => html`<${EventRow} event=${e} key=${e.id} hideFeed=${!!feed} />`)}
                          </div>`}
            </div>`}
            ${view !== "runs" && data ? html`<${Pager} page=${page} size=${data.size} total=${data.total} onPage=${(p) => setParams({ page: p })} />` : null}
        </section>
        ${view !== "runs" && data
            ? html`<p class="muted" style="margin-top:12px;font-size:12.5px">
                  ${L(
                      `最多保留 ${data.retention.days} 天、${num(data.retention.max_entries)} 条；每个订阅源最多 ${data.retention.per_feed} 条。这里只记录失败、有更新和恢复；每次抓取（包括没有新文章的）请看“抓取记录”。成功推送不逐条记录。`,
                      `Up to ${data.retention.days} days and ${num(data.retention.max_entries)} entries, ${data.retention.per_feed} per feed. Events cover failures, updates and recoveries; every single check, including routine ones, is under Fetch runs. Successful deliveries aren't logged one by one.`,
                  )}
              </p>`
            : null}
    `;
}
