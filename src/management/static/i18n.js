import { english, runtimeCopy } from "./messages.js";
import { businessError } from "./error-messages.js";
const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {}
};
export const locale = read("rsstt.language") || (navigator.language.startsWith("zh") ? "zh-CN" : "en");
// Translate static source text only; interpolated values pass through unchanged.
const keys = Object.keys(english).sort((a, b) => b.length - a.length);
const pattern = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
export const tr = (text) =>
    locale === "en" && /[\u3400-\u9fff]/.test(text) ? String(text).replace(pattern, (key) => english[key]) : text;
export const html = (parts, ...values) =>
    parts.reduce((out, part, i) => out + tr(part) + (i < values.length ? values[i] : ""), "");
export function setLocale(value) {
    write("rsstt.language", value === "en" ? "en" : "zh-CN");
    location.reload();
}
export function setTheme(value) {
    const theme = ["light", "dark"].includes(value) ? value : "system";
    write("rsstt.theme", theme);
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("#theme").forEach((el) => {
        el.value = theme;
    });
}
const errors = {
    400: ["请求内容无效，请检查输入。", "Invalid request. Check your input."],
    401: ["登录已失效，请重新登录。", "Your session expired. Sign in again."],
    403: ["没有执行此操作的权限。", "You do not have permission for this action."],
    404: ["记录不存在或已被删除。", "This record was not found or has been removed."],
    409: ["当前状态不允许执行此操作。", "This action is not allowed in the current state."],
    413: ["提交内容过大，请减少内容。", "The request is too large. Reduce its size."],
    429: ["操作过于频繁，请稍后重试。", "Too many requests. Try again shortly."],
    503: ["服务暂不可用，请稍后重试。", "The service is temporarily unavailable. Try again shortly."],
};
export function errorText(data, status) {
    const code = typeof data.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(data.code) ? data.code : `http_${status}`;
    const credentialErrors = {
        INVALID_CREDENTIALS: ["密码不正确，请重试。", "Incorrect password. Try again."],
        CURRENT_PASSWORD_INCORRECT: [
            "当前密码不正确，密码未修改。",
            "The current password is incorrect. Your password was not changed.",
        ],
        NEW_PASSWORD_INVALID: [
            "新密码需为 16–512 个字符，密码未修改。",
            "Use 16–512 characters for the new password. Your password was not changed.",
        ],
    };
    if (credentialErrors[code]) return credentialErrors[code][locale === "en" ? 1 : 0] + ` (${code})`;
    const specific = status < 500 ? businessError(data, locale) : null;
    if (specific) return specific + ` (${code})`;
    const statuses = {
        INVALID_REQUEST: 400,
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        UNSUPPORTED_MEDIA_TYPE: 400,
        RATE_LIMITED: 429,
        PAYLOAD_TOO_LARGE: 413,
        INVALID_ROUTE: 404,
        REQUEST_FAILED: 500,
        INTERNAL_ERROR: 500,
    };
    const known = statuses[code] || (/^http_\d+$/.test(code) ? Number(code.slice(5)) : status);
    return (
        (errors[known] || ["操作未完成，请稍后重试。", "The request failed. Try again shortly."])[
            locale === "en" ? 1 : 0
        ] + ` (${code})`
    );
}
document.querySelector(".initial").textContent = locale === "en" ? "Connecting to console…" : "正在连接管理台…";
document.documentElement.lang = locale;
document.title = locale === "en" ? "RSStT · Subscription console" : "RSStT · 订阅管理台";
document.querySelector(".skip").textContent = locale === "en" ? "Skip to main content" : "跳到主要内容";
setTheme(read("rsstt.theme"));
// Controls are re-created when signing in or changing routes.
new MutationObserver(() => {
    const theme = document.querySelector("#theme");
    if (theme && theme.value !== document.documentElement.dataset.theme)
        theme.value = document.documentElement.dataset.theme;
}).observe(document.getElementById("app"), { childList: true, subtree: true });

const units = {
    destination: ["个会话", "chat", "chats"],
    subscription: ["条订阅", "subscription", "subscriptions"],
    selectedDestination: ["个指定会话", "selected chat", "selected chats"],
    feed: ["个订阅源", "feed", "feeds"],
    day: ["天", "day", "days"],
};
export function count(value, unit) {
    const labels = units[unit];
    const word = locale === "en" ? labels[new Intl.PluralRules(locale).select(value) === "one" ? 1 : 2] : labels[0];
    return `${new Intl.NumberFormat(locale).format(value)} ${word}`;
}
const messages = {
    pager: ["共 {total} 条 · 第 {page} / {pages} 页", "{total} items · Page {page} of {pages}"],
    attentionThreshold: [
        "连续抓取失败达到 {count} 次的已启用订阅",
        "Enabled subscriptions with at least {count} consecutive fetch failures",
    ],
    fetchFailures: ["连续抓取失败 {count} 次", "{count} consecutive fetch failures"],
    recordedChats: [
        "已记录 {total} 个会话，其中 {unknown} 个类型待核验",
        "{total} recorded chats; {unknown} have unverified types",
    ],
    discoveredTotal: ["累计新发现文章 {count} 篇", "{count} new entries discovered in total"],
    deliveryPoint: ["{time} · 成功推送 {count} 篇次", "{time} · {count} successful deliveries"],
    backupCreated: ["备份创建时间：{time}", "Backup created: {time}"],
    resultCounts: [
        "操作完成 {completed} 条，已订阅跳过 {skipped} 条，失败 {failed} 条。请按失败原因处理后重试。",
        "{completed} completed, {skipped} already subscribed and skipped, {failed} failed. Resolve the reported causes before retrying.",
    ],
    lastVerified: ["状态更新时间：{time}", "State updated: {time}"],
    chatEnabledCount: ["共 {total} 条订阅，启用 {enabled} 条", "Subscriptions: {total}; enabled: {enabled}"],
    stopServiceConfirm: [
        "停止为“{name}”提供服务：暂停全部订阅并拒绝常规命令，保留订阅和设置。解除封禁后需手动恢复订阅；不会自动让机器人退出群组或频道。",
        "Stop service for “{name}”: pause all subscriptions and reject regular commands while preserving subscriptions and settings. Unblocking still requires subscriptions to be resumed manually. This does not remove the bot from a group or channel.",
    ],
    chatActivityTitle: ["会话记录 · {name}", "Chat activity · {name}"],
    activityActor: ["发起人：{actor}", "Actor: {actor}"],
    activityChanges: ["查看 {count} 项设置变更", "View setting changes ({count})"],
    pickerSummary: ["找到 {total} 个会话", "{total} chats found"],
    pickerSelected: ["已选择 {count} 个", "{count} selected"],
    loading: ["正在加载{page}…", "Loading {page}…"],
    enabledSubs: ["已启用 {count} 条", "{count} enabled"],
    selectedSubs: ["已选择 {count} 条订阅", "{count} subscriptions selected"],
};
export function message(key, values) {
    return messages[key][locale === "en" ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
}

export function runtimeText(key) {
    const row = runtimeCopy[key];
    return row ? { label: row[locale === "en" ? 1 : 0], help: row[locale === "en" ? 3 : 2] } : { label: key, help: "" };
}
