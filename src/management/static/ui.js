// Reusable interface primitives.
import { html, render, useState, useEffect, useRef, useCallback, useMemo } from "./vendor-preact.js";
import {
    L,
    api,
    qs,
    toasts,
    KIND,
    kindOf,
    emit,
    ago,
    cached,
    isFresh,
    registerLive,
    refreshLive,
    sync,
    syncStart,
    syncDone,
    subscribeSync,
} from "./core.js";

export { html, render, useState, useEffect, useRef, useCallback, useMemo };

/* ---------- icons (24px grid, stroke) ---------- */
const PATHS = {
    overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
    chats: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z",
    feeds: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
    logs: "M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3",
    settings:
        "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    plus: "M12 5v14M5 12h14",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
    close: "M18 6 6 18M6 6l12 12",
    check: "M20 6 9 17l-5-5",
    chevron: "m9 18 6-6-6-6",
    down: "m6 9 6 6 6-6",
    back: "m15 18-6-6 6-6",
    more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
    send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    refresh: "M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5",
    pause: "M10 4H6v16h4zM18 4h-4v16h4z",
    play: "m6 3 14 9-14 9z",
    trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
    external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
    ban: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    menu: "M3 6h18M3 12h18M3 18h18",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    monitor: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 21h8M12 17v4",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
    key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    server: "M20 2H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM20 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2zM6 6h.01M6 18h.01",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
    zap: "M13 2 3 14h9l-1 8 10-12h-9z",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
};
export const Icon = ({ name, size = 16, class: cls = "" }) =>
    html`<svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true">
        <path d=${PATHS[name] || PATHS.info} />
    </svg>`;

/* ---------- brand mark ---------- */
export const Mark = ({ size = 32 }) => html`<img class="mark" src="/assets/mark.svg" width=${size} height=${size} alt="" />`;

/* ---------- buttons & inputs ---------- */
export function Button({ kind = "secondary", size, icon, children, loading, class: cls = "", ...rest }) {
    return html`<button
        type="button"
        class="btn btn-${kind} ${size ? "btn-" + size : ""} ${cls} ${loading ? "is-loading" : ""}"
        disabled=${rest.disabled || loading}
        ...${rest}
    >
        ${loading ? html`<span class="spinner" aria-hidden="true"></span>` : icon ? html`<${Icon} name=${icon} />` : null}
        ${children != null && children !== "" ? html`<span>${children}</span>` : null}
    </button>`;
}

export const IconButton = ({ icon, label, ...rest }) =>
    html`<button type="button" class="icon-btn" title=${label} aria-label=${label} ...${rest}><${Icon} name=${icon} /></button>`;

export function Field({ label, hint, error, children, inline, setting }) {
    return html`<label class="field ${inline ? "field-inline" : ""}" data-setting=${setting}>
        ${label ? html`<span class="field-label">${label}</span>` : null} ${children}
        ${error ? html`<span class="field-error">${error}</span>` : hint ? html`<span class="field-hint">${hint}</span>` : null}
    </label>`;
}

export const Input = ({ value, onInput, class: cls = "", ...rest }) =>
    html`<input class="input ${cls}" value=${value ?? ""} onInput=${(e) => onInput?.(e.currentTarget.value)} ...${rest} />`;

export const Textarea = ({ value, onInput, ...rest }) =>
    html`<textarea class="input textarea" value=${value ?? ""} onInput=${(e) => onInput?.(e.currentTarget.value)} ...${rest}></textarea>`;

export function Select({ value, onChange, options, class: cls = "", ...rest }) {
    return html`<span class="select ${cls}">
        <select value=${String(value ?? "")} onChange=${(e) => onChange?.(e.currentTarget.value)} ...${rest}>
            ${options.map(([v, label]) => html`<option value=${String(v)} selected=${String(v) === String(value ?? "")}>${label}</option>`)}
        </select>
        <${Icon} name="down" size=${14} />
    </span>`;
}

export function Switch({ checked, onChange, label, description, disabled }) {
    return html`<label class="switch-row ${disabled ? "is-disabled" : ""}">
        <span class="switch-text">
            <span class="switch-label">${label}</span>
            ${description ? html`<span class="switch-desc">${description}</span>` : null}
        </span>
        <input
            type="checkbox"
            role="switch"
            class="switch"
            checked=${!!checked}
            disabled=${disabled}
            onChange=${(e) => onChange(e.currentTarget.checked)}
        />
    </label>`;
}

export function Segmented({ value, onChange, options, size }) {
    return html`<div class="segmented ${size ? "segmented-" + size : ""}" role="radiogroup">
        ${options.map(
            ([v, label]) =>
                html`<button
                    type="button"
                    role="radio"
                    aria-checked=${String(v) === String(value)}
                    class=${String(v) === String(value) ? "on" : ""}
                    onClick=${() => onChange(v)}
                >
                    ${label}
                </button>`,
        )}
    </div>`;
}

export function SearchInput({ value, onInput, placeholder, delay = 250 }) {
    const [text, setText] = useState(value || "");
    const timer = useRef();
    const composing = useRef(false);
    useEffect(() => setText(value || ""), [value]);
    useEffect(() => () => clearTimeout(timer.current), []);
    // Wait for the user to stop typing, and never search half-composed pinyin/kana. (Lowercase names: Preact only maps the
    // handful of events the DOM has `on…` properties for, so `onCompositionEnd` would listen for an event that never fires.)
    const schedule = (next) => {
        clearTimeout(timer.current);
        if (!composing.current) timer.current = setTimeout(() => onInput(next), delay);
    };
    return html`<label class="search">
        <${Icon} name="search" />
        <input
            type="search"
            value=${text}
            placeholder=${placeholder}
            onInput=${(e) => {
                setText(e.currentTarget.value);
                schedule(e.currentTarget.value);
            }}
            oncompositionstart=${() => {
                composing.current = true;
                clearTimeout(timer.current);
            }}
            oncompositionend=${(e) => {
                composing.current = false;
                schedule(e.currentTarget.value);
            }}
        />
    </label>`;
}

/* ---------- display ---------- */
export const Badge = ({ tone = "neutral", children, dot }) =>
    html`<span class="badge badge-${tone}">${dot ? html`<i class="dot"></i>` : null}${children}</span>`;

export const Spinner = ({ label }) =>
    html`<div class="loading"><span class="spinner"></span>${label ? html`<span>${label}</span>` : null}</div>`;

/** Placeholder rows while a list loads for the first time; keeps the layout from jumping. */
export const Skeleton = ({ rows = 6 }) =>
    html`<div class="skeleton" aria-busy="true" aria-label=${L("加载中", "Loading")}>
        ${Array.from({ length: rows }, (_, i) => html`<div class="skeleton-row" key=${i}><i></i><span></span><span></span></div>`)}
    </div>`;

/** Reloads everything live on this page and says how old it is. */
export function RefreshButton() {
    const [, force] = useState(0);
    useEffect(() => {
        const off = subscribeSync(() => force((n) => n + 1));
        const tick = setInterval(() => force((n) => n + 1), 20000);
        return () => (off(), clearInterval(tick));
    }, []);
    return html`<span class="refresh">
        ${sync.at
            ? html`<small class="muted" title=${new Date(sync.at).toLocaleString()}
                  >${L("更新于", "Updated")} ${ago(sync.at / 1000)}</small
              >`
            : null}
        <${Button} icon="refresh" loading=${sync.manual && sync.busy > 0} onClick=${() => refreshLive(0, { manual: true })}
            >${L("刷新", "Refresh")}<//
        >
    </span>`;
}

export const Empty = ({ icon = "feeds", title, children, action }) =>
    html`<div class="empty">
        <div class="empty-icon"><${Icon} name=${icon} size=${22} /></div>
        <strong>${title}</strong>
        ${children ? html`<p>${children}</p>` : null} ${action || null}
    </div>`;

export const Notice = ({ tone = "info", title, children, action }) =>
    html`<div class="notice notice-${tone}">
        <${Icon} name=${tone === "info" ? "info" : "alert"} />
        <div>${title ? html`<strong>${title}</strong>` : null}${children ? html`<div>${children}</div>` : null}</div>
        ${action || null}
    </div>`;

export function ChatAvatar({ chat, size = 32 }) {
    const kind = kindOf(chat);
    const title = chat.title || chat.target_title || "?";
    const glyph = chat.named === false ? "?" : [...title.trim()][0]?.toUpperCase() || "#";
    return html`<span class="avatar avatar-${kind}" style=${`--s:${size}px`} aria-hidden="true">${glyph}</span>`;
}

export const KindBadge = ({ chat }) => {
    const kind = kindOf(chat);
    return html`<span class="kind kind-${kind}">${KIND[kind]()}</span>`;
};

export function Pager({ page, size, total, onPage }) {
    const pages = Math.max(1, Math.ceil(total / size));
    if (total <= size) return null;
    return html`<div class="pager">
        <span class="muted"
            >${L(
                `第 ${(page - 1) * size + 1}–${Math.min(total, page * size)} 条，共 ${total} 条`,
                `${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}`,
            )}</span
        >
        <div class="pager-buttons">
            <${IconButton} icon="back" label=${L("上一页", "Previous")} disabled=${page <= 1} onClick=${() => onPage(page - 1)} />
            <span class="pager-num">${page} / ${pages}</span>
            <${IconButton} icon="chevron" label=${L("下一页", "Next")} disabled=${page >= pages} onClick=${() => onPage(page + 1)} />
        </div>
    </div>`;
}

export function Copy({ text, label }) {
    const [done, setDone] = useState(false);
    return html`<button
        type="button"
        class="copy"
        title=${L("复制", "Copy")}
        onClick=${async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(text);
                setDone(true);
                setTimeout(() => setDone(false), 1200);
            } catch {
                /* clipboard blocked */
            }
        }}
    >
        <span class="mono">${label ?? text}</span><${Icon} name=${done ? "check" : "copy"} size=${12} />
    </button>`;
}

/* ---------- overlays ---------- */
function useEscape(onClose, active = true) {
    useEffect(() => {
        if (!active) return;
        const handler = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose, active]);
}

export function Drawer({ open, onClose, title, subtitle, head, children, footer, wide }) {
    useEscape(onClose, open && !document.querySelector(".modal-backdrop"));
    const panel = useRef();
    useEffect(() => {
        if (open) panel.current?.focus({ preventScroll: true });
    }, [open]);
    if (!open) return null;
    return html`<div class="drawer-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
        <aside class="drawer ${wide ? "drawer-wide" : ""}" role="dialog" aria-modal="true" tabindex="-1" ref=${panel}>
            <header class="drawer-head">
                <div class="drawer-title">
                    ${head || null}
                    <div>
                        <h2>${title}</h2>
                        ${subtitle ? html`<div class="drawer-sub">${subtitle}</div>` : null}
                    </div>
                </div>
                <${IconButton} icon="close" label=${L("关闭", "Close")} onClick=${onClose} />
            </header>
            <div class="drawer-body">${children}</div>
            ${footer ? html`<footer class="drawer-foot">${footer}</footer>` : null}
        </aside>
    </div>`;
}

export function Tabs({ value, onChange, tabs }) {
    return html`<nav class="tabs" role="tablist">
        ${tabs.map(
            ([key, label, badge]) =>
                html`<button
                    type="button"
                    role="tab"
                    aria-selected=${key === value}
                    class=${key === value ? "on" : ""}
                    onClick=${() => onChange(key)}
                >
                    ${label}${badge ? html`<span class="tab-badge">${badge}</span>` : null}
                </button>`,
        )}
    </nav>`;
}

export function Modal({ title, children, footer, onClose, size }) {
    useEscape(onClose);
    return html`<div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
        <div class="modal ${size ? "modal-" + size : ""}" role="dialog" aria-modal="true">
            <header class="modal-head">
                <h3>${title}</h3>
                <${IconButton} icon="close" label=${L("关闭", "Close")} onClick=${onClose} />
            </header>
            <div class="modal-body">${children}</div>
            ${footer ? html`<footer class="modal-foot">${footer}</footer>` : null}
        </div>
    </div>`;
}

/* Imperative confirm dialog: await confirm({...}) → true/false */
let modalHost = null;
export function ModalHost() {
    const [node, setNode] = useState(null);
    modalHost = setNode;
    return node;
}
export function confirm({ title, body, ok = L("确认", "Confirm"), danger, typed }) {
    return new Promise((resolve) => {
        function View() {
            const [text, setText] = useState("");
            const close = (value) => {
                modalHost(null);
                resolve(value);
            };
            const blocked = typed && text.trim() !== String(typed);
            return html`<${Modal}
                title=${title}
                onClose=${() => close(false)}
                footer=${html`<${Button} onClick=${() => close(false)}>${L("取消", "Cancel")}<//>
                    <${Button} kind=${danger ? "solid-danger" : "primary"} disabled=${blocked} onClick=${() => close(true)}>${ok}<//>`}
            >
                <div class="confirm-body">${body}</div>
                ${typed
                    ? html`<${Field} label=${L(`输入 ${typed} 以确认`, `Type ${typed} to confirm`)}>
                          <${Input} value=${text} onInput=${setText} autofocus class="mono" />
                      <//>`
                    : null}
            <//>`;
        }
        modalHost(html`<${View} />`);
    });
}
export function openModal(render) {
    return new Promise((resolve) => {
        const close = (value) => {
            modalHost(null);
            resolve(value);
        };
        modalHost(render(close));
    });
}

export function Toasts() {
    return html`<div class="toasts" role="status" aria-live="polite">
        ${toasts.map(
            (t) =>
                html`<div class="toast toast-${t.kind}" key=${t.id}>
                    <${Icon} name=${t.kind === "error" ? "alert" : "check"} /><span>${t.text}</span>
                </div>`,
        )}
    </div>`;
}

/* ---------- data hooks ---------- */
const sameData = (a, b) => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));

/**
 * Load data for a view.
 *  - `key`: the GET path `fn` requests (or a function returning it, for paths that move with time).
 *    A remembered response is shown at once and refreshed behind it.
 *  - `initial`: data already at hand (e.g. the list row for a drawer), shown while the first request runs.
 *  - `live`: also refresh when the tab regains focus, on a slow timer while visible, and from the refresh button.
 *    `floor` keeps slow-changing data (hourly charts) from being refetched more often than that many ms, except by the button.
 * A refresh that returns the same data keeps the identical object, so nothing re-renders and drafts built on it are not reset.
 */
export function useAsync(fn, deps, { key, initial, live = false, floor = 0 } = {}) {
    const keyOf = () => (typeof key === "function" ? key() : key);
    const [state, setState] = useState(() => {
        const hit = keyOf() && cached(keyOf());
        return hit ? { loading: false, data: hit.data, error: null } : { loading: initial == null, data: initial ?? null, error: null };
    });
    const serial = useRef(0);
    const loadedAt = useRef(0);
    const reload = useCallback(async (quiet, minAge = 0) => {
        if (minAge && Date.now() - loadedAt.current < minAge) return;
        const id = ++serial.current;
        if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
        if (live) syncStart();
        let ok = false;
        try {
            const data = await fn();
            ok = true;
            if (id === serial.current) {
                loadedAt.current = Date.now();
                setState((s) =>
                    sameData(s.data, data)
                        ? s.loading || s.error
                            ? { loading: false, data: s.data, error: null }
                            : s
                        : { loading: false, data, error: null },
                );
            }
        } catch (error) {
            if (id === serial.current) setState((s) => ({ loading: false, data: s.data, error: minAge > 0 && s.data ? s.error : error }));
        } finally {
            if (live) syncDone(ok);
        }
    }, deps);
    useEffect(() => {
        // Anything already known for this key goes on screen at once; only a first load with nothing to show spins.
        const hit = keyOf() && cached(keyOf());
        if (hit) {
            loadedAt.current = hit.at;
            setState((s) => (sameData(s.data, hit.data) ? s : { loading: false, data: hit.data, error: null }));
        }
        reload(!!hit, hit && isFresh(hit, 3000) ? Infinity : 0);
    }, [reload]);
    useEffect(() => (live ? registerLive({ reload: (minAge) => reload(true, minAge), floor }) : undefined), [live, reload]);
    return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data: typeof data === "function" ? data(s.data) : data })) };
}

/**
 * Form state seeded from a record that can change underneath it (live refresh, a Telegram command).
 * When it does, fields the user has not touched follow the new values and fields they have edited keep their edit,
 * so saving never writes back a stale copy of what changed elsewhere.
 */
export function useDraft(base) {
    const [draft, setDraft] = useState(base);
    const seen = useRef(JSON.stringify(base));
    const sig = JSON.stringify(base);
    useEffect(() => {
        if (seen.current === sig) return;
        const old = JSON.parse(seen.current);
        seen.current = sig;
        setDraft((d) => Object.fromEntries(Object.keys(base).map((k) => [k, d[k] === old[k] ? base[k] : d[k]])));
    }, [sig]);
    return [draft, setDraft];
}

/** `useAsync` for one GET path: cached, deduplicated, optionally live. */
export function useGet(path, { maxAge = 0, ...options } = {}) {
    return useAsync(() => api(path, { maxAge }), [path], { key: path, ...options });
}

export function useRoute() {
    const [, force] = useState(0);
    useEffect(() => {
        const update = () => force((n) => n + 1);
        window.addEventListener("hashchange", update);
        window.addEventListener("routechange", update);
        window.addEventListener("popstate", update);
        return () => {
            window.removeEventListener("hashchange", update);
            window.removeEventListener("routechange", update);
            window.removeEventListener("popstate", update);
        };
    }, []);
}

/* ---------- chat picker (searchable, multi or single) ---------- */
export function ChatPicker({ value = [], onChange, multiple = true, exclude = [], placeholder }) {
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [known, setKnown] = useState({});
    const box = useRef();
    useEffect(() => {
        let alive = true;
        api("/targets" + qs({ q, visibility: "unbanned", size: 30 }))
            .then((data) => {
                if (!alive) return;
                setItems(data.items);
                setKnown((k) => ({ ...k, ...Object.fromEntries(data.items.map((c) => [c.id, c])) }));
            })
            .catch(() => {});
        return () => (alive = false);
    }, [q]);
    useEffect(() => {
        const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    const toggle = (chat) => {
        setKnown((k) => ({ ...k, [chat.id]: chat }));
        if (!multiple) {
            onChange(chat.id, chat);
            setOpen(false);
            return;
        }
        onChange(selected.includes(chat.id) ? selected.filter((id) => id !== chat.id) : [...selected, chat.id]);
    };
    const visible = items.filter((c) => !exclude.includes(c.id));
    const current = !multiple && selected[0] ? known[selected[0]] : null;
    return html`<div class="picker ${open ? "is-open" : ""}" ref=${box}>
        <div class="picker-control" onClick=${() => setOpen(true)}>
            ${multiple
                ? selected.map(
                      (id) =>
                          html`<span class="chip"
                              >${known[id]?.title || id}<button
                                  type="button"
                                  aria-label=${L("移除", "Remove")}
                                  onClick=${(e) => (e.stopPropagation(), onChange(selected.filter((x) => x !== id)))}
                              >
                                  <${Icon} name="close" size=${12} /></button
                          ></span>`,
                  )
                : current
                  ? html`<span class="picker-current"><${ChatAvatar} chat=${current} size=${20} />${current.title}</span>`
                  : null}
            <input
                value=${q}
                placeholder=${selected.length && !multiple
                    ? ""
                    : placeholder || L("搜索会话名称、用户名或 ID", "Search chats by name, username or ID")}
                onFocus=${() => setOpen(true)}
                onInput=${(e) => setQ(e.currentTarget.value)}
                onKeyDown=${(e) => {
                    if (e.key === "Escape" && open) {
                        e.stopPropagation();
                        setOpen(false);
                    }
                }}
            />
            <${Icon} name="down" size=${14} />
        </div>
        ${open
            ? html`<div class="picker-menu">
                  ${visible.length
                      ? visible.map(
                            (chat) =>
                                html`<button
                                    type="button"
                                    class="picker-option ${selected.includes(chat.id) ? "on" : ""}"
                                    onClick=${() => toggle(chat)}
                                >
                                    <${ChatAvatar} chat=${chat} size=${24} />
                                    <span class="picker-text"
                                        ><b>${chat.title}</b
                                        ><small>${chat.username ? "@" + chat.username : chat.id} · ${KIND[kindOf(chat)]()}</small></span
                                    >
                                    ${selected.includes(chat.id) ? html`<${Icon} name="check" />` : null}
                                </button>`,
                        )
                      : html`<div class="picker-empty">${L("没有匹配的会话", "No matching chats")}</div>`}
              </div>`
            : null}
    </div>`;
}

export { emit };
