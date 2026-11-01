// Shared runtime: language, theme, API client, routing and formatting.
import { businessError } from "./error-messages.js";

const storage = {
    get(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
        } catch {
            /* private mode: preferences simply are not remembered */
        }
    },
};

/* ---------- tiny global store ---------- */
const listeners = new Set();
export const app = { session: null, info: { features: {} }, bot: null };
export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
export function emit() {
    listeners.forEach((fn) => fn());
}

/* ---------- language ---------- */
const savedLang = storage.get("rsstt.lang");
export let lang = savedLang ? (savedLang === "en" ? "en" : "zh") : (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh";
document.documentElement.lang = lang === "en" ? "en" : "zh-CN";

/** Inline bilingual copy: L("会话", "Chats"). */
export const L = (zh, en) => (lang === "en" ? en : zh);
export const locale = () => (lang === "en" ? "en-US" : "zh-CN");

export function setLang(value) {
    storage.set("rsstt.lang", value);
    lang = value;
    document.documentElement.lang = value === "en" ? "en" : "zh-CN";
    emit();
}

/* ---------- theme ---------- */
export let theme = storage.get("rsstt.theme") || "system";
export function applyTheme(value = theme) {
    theme = value;
    storage.set("rsstt.theme", value === "system" ? null : value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    emit();
}
applyTheme(theme);

/* ---------- toasts ---------- */
let toastId = 0;
export const toasts = [];
export function toast(text, kind = "ok") {
    const id = ++toastId;
    toasts.push({ id, text, kind });
    emit();
    setTimeout(
        () => {
            const index = toasts.findIndex((t) => t.id === id);
            if (index >= 0) toasts.splice(index, 1);
            emit();
        },
        kind === "error" ? 6500 : 3500,
    );
}

/* ---------- API ---------- */
export class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function explain(data, status) {
    const known = businessError(data, lang);
    if (known) return known;
    if (data && typeof data.error === "string" && data.error) return data.error;
    if (status === 401) return L("登录已过期，请重新登录。", "Your session has expired. Please sign in again.");
    if (status === 403) return L("没有权限执行这个操作。", "You don't have permission to do that.");
    if (status === 404) return L("内容不存在，可能已被删除。", "Not found. It may have been deleted.");
    if (status === 413) return L("文件或请求太大。", "The file or request is too large.");
    if (status >= 500) return L("服务器出错了，请查看运行日志。", "Server error. Check the runtime logs.");
    if (status === 0) return L("无法连接到管理台，请检查网络或服务是否在运行。", "Can't reach the console. Is the service running?");
    return L("请求失败。", "Request failed.");
}

export async function api(path, { method = "GET", body, raw = false, headers = {} } = {}) {
    let response;
    try {
        response = await fetch("/api" + path, {
            method,
            credentials: "same-origin",
            headers: { ...(body !== undefined && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...headers },
            body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
        });
    } catch {
        throw new ApiError(explain(null, 0), 0, "NETWORK");
    }
    if (response.status === 401 && path !== "/login" && app.session) {
        app.session = null;
        emit();
    }
    if (raw && response.ok) return response;
    let data = null;
    try {
        data = await response.json();
    } catch {
        /* non-JSON error page */
    }
    if (!response.ok) throw new ApiError(explain(data, response.status), response.status, data?.code);
    return data;
}

export const qs = (params) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, value);
    const text = search.toString();
    return text ? "?" + text : "";
};

export async function download(path, fallbackName, options) {
    const response = await api(path, { ...options, raw: true });
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- routing: #page?key=value ---------- */
export function readRoute() {
    const [page, search = ""] = location.hash.replace(/^#\/?/, "").split("?");
    return { page: page || "overview", params: Object.fromEntries(new URLSearchParams(search)) };
}
export function go(page, params = {}) {
    const next = "#" + page + qs(params);
    if (location.hash !== next) location.hash = next;
}
export function setParams(params, { replace = true } = {}) {
    const { page, params: current } = readRoute();
    const merged = { ...current, ...params };
    for (const key of Object.keys(merged)) if (merged[key] === "" || merged[key] == null) delete merged[key];
    const next = "#" + page + qs(merged);
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
    window.dispatchEvent(new Event("routechange"));
}

/* ---------- formatting ---------- */
export const num = (value) => (value == null ? "—" : new Intl.NumberFormat(locale()).format(value));
export function compact(value) {
    if (value == null) return "—";
    return new Intl.NumberFormat(locale(), { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
export function dateTime(value, { seconds = false } = {}) {
    if (!value) return "—";
    const date = new Date(typeof value === "number" ? value * 1000 : value);
    if (Number.isNaN(date.getTime())) return "—";
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale(), {
        year: sameYear ? undefined : "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: seconds ? "2-digit" : undefined,
        hour12: false,
    }).format(date);
}
export function ago(value) {
    if (!value) return "—";
    const date = new Date(typeof value === "number" ? value * 1000 : value);
    const diff = (date.getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    if (abs < 45) return L("刚刚", "just now");
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
    return dateTime(value);
}
export function duration(seconds) {
    if (seconds == null) return "—";
    const d = Math.floor(seconds / 86400),
        h = Math.floor((seconds % 86400) / 3600),
        m = Math.floor((seconds % 3600) / 60);
    if (d) return L(`${d} 天 ${h} 小时`, `${d}d ${h}h`);
    if (h) return L(`${h} 小时 ${m} 分`, `${h}h ${m}m`);
    return L(`${m} 分钟`, `${m}m`);
}
export function minutes(value) {
    if (value == null) return "—";
    if (value % 1440 === 0) return L(`${value / 1440} 天`, `${value / 1440}d`);
    if (value % 60 === 0) return L(`${value / 60} 小时`, `${value / 60}h`);
    return L(`${value} 分钟`, `${value} min`);
}
export function host(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url || "";
    }
}

/* ---------- domain vocabulary ---------- */
export const KIND = {
    private: () => L("私聊", "Private"),
    group: () => L("群组", "Group"),
    channel: () => L("频道", "Channel"),
    unknown: () => L("频道或群组", "Channel or group"),
};
export const ROLE = {
    manager: () => L("所有者", "Owner"),
    admin: () => L("管理员", "Admin"),
    user: () => L("用户", "User"),
    guest: () => L("访客", "Guest"),
    banned: () => L("已封禁", "Blocked"),
};
export const kindOf = (chat) => (chat.kind === "unknown" && Number(chat.id) > 0 ? "private" : chat.kind || "unknown");
