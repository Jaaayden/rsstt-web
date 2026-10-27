import { english } from "./messages.js";
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
    409: ["数据已变化，请刷新后重试。", "The data changed. Refresh and try again."],
    413: ["提交内容过大，请减少内容。", "The request is too large. Reduce its size."],
    429: ["操作过于频繁，请稍后重试。", "Too many requests. Try again shortly."],
    503: ["服务暂不可用，请稍后重试。", "The service is temporarily unavailable. Try again shortly."],
};
export function errorText(data, status) {
    const code = typeof data.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(data.code) ? data.code : `http_${status}`;
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
    destination: ["个目的地", "destination", "destinations"],
    subscription: ["条订阅", "subscription", "subscriptions"],
    selectedDestination: ["个指定会话", "selected destination", "selected destinations"],
    day: ["天", "day", "days"],
};
export function count(value, unit) {
    const labels = units[unit];
    const word = locale === "en" ? labels[new Intl.PluralRules(locale).select(value) === "one" ? 1 : 2] : labels[0];
    return `${new Intl.NumberFormat(locale).format(value)} ${word}`;
}
const messages = {
    pager: ["共 {total} 条 · 第 {page} / {pages} 页", "{total} items · Page {page} of {pages}"],
};
export function message(key, values) {
    return messages[key][locale === "en" ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
}
