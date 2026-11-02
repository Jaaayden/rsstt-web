// Per-feed proxy editing, shared by the subscription drawer, the batch dialog and the add dialog.
import { html, Segmented, Input, Notice } from "./ui.js";
import { L } from "./core.js";
import { reasonOf } from "./page-logs.js";

export const emptyProxy = () => ({ mode: "inherit", url: "" });

/** Request value for a draft: undefined = leave as is, null = follow the global setting, "direct", or a proxy URL. */
export function proxyValue(draft, saved) {
    if (draft.mode === "inherit") return saved && saved.mode !== "inherit" ? null : undefined;
    if (draft.mode === "direct") return saved?.mode === "direct" ? undefined : "direct";
    const url = draft.url.trim();
    return url ? url : undefined; // custom with an empty box keeps the saved address
}

export const proxyChanged = (draft, saved) => proxyValue(draft, saved) !== undefined;
export const proxyReady = (draft, saved) => draft.mode !== "custom" || draft.url.trim() !== "" || saved?.mode === "custom";

export function savedText(saved) {
    if (!saved || saved.mode === "inherit") return L("跟随全局设置", "Following the global setting");
    if (saved.mode === "direct") return L("直连（不使用代理）", "Direct (no proxy)");
    return L(`使用代理 ${saved.scheme}://${saved.host}`, `Using proxy ${saved.scheme}://${saved.host}`);
}

export function ProxyField({ draft, onChange, saved, globalLabel }) {
    return html`<div class="stack" style="gap:10px">
        <${Segmented}
            value=${draft.mode}
            onChange=${(mode) => onChange({ ...draft, mode })}
            options=${[
                ["inherit", globalLabel || L("跟随全局", "Global setting")],
                ["direct", L("直连", "Direct")],
                ["custom", L("使用代理", "Use a proxy")],
            ]}
        />
        ${draft.mode === "custom"
            ? html`<${Input}
                  type="password"
                  autocomplete="off"
                  class="mono"
                  placeholder=${saved?.mode === "custom"
                      ? L("留空保持不变；填写则更换", "Empty keeps the saved one; type to replace")
                      : "socks5://主机:端口   或   http://用户名:密码@主机:端口"}
                  value=${draft.url}
                  onInput=${(url) => onChange({ ...draft, url })}
              />`
            : null}
        <span class="muted" style="font-size:12.5px">
            ${draft.mode === "custom"
                ? L(
                      "支持 http、socks4、socks5、socks5h。地址可能含密码，保存后不会再显示。",
                      "http, socks4, socks5 and socks5h. The address may contain a password and is never shown again.",
                  )
                : draft.mode === "direct"
                  ? L(
                        "即使在“运行配置”里设置了全局代理，这个源也直接连接。",
                        "Connects directly even when a global proxy is set under Runtime.",
                    )
                  : L(
                        "使用“运行配置”里的全局代理规则；没有设置全局代理就直接连接。",
                        "Follows the global proxy rules under Runtime; direct when none is set.",
                    )}
        </span>
    </div>`;
}

/** Outcome of POST /feeds/{id}/proxy-test, in plain language. */
export function ProxyTestResult({ result }) {
    if (!result) return null;
    if (result.ok)
        return html`<${Notice} title=${L("抓取成功", "Fetched successfully")}>
            ${result.entries != null
                ? L(
                      `HTTP ${result.status}，读到 ${result.entries} 篇文章，耗时 ${result.duration_ms} 毫秒。`,
                      `HTTP ${result.status}, ${result.entries} posts, ${result.duration_ms} ms.`,
                  )
                : L(
                      `HTTP ${result.status}（内容没有变化），耗时 ${result.duration_ms} 毫秒。`,
                      `HTTP ${result.status} (not modified), ${result.duration_ms} ms.`,
                  )}
        <//>`;
    const reason = reasonOf({
        level: "error",
        context: { http_status: result.status, exception_type: result.exception_type },
        detail: result.reason,
    });
    return html`<${Notice} tone="error" title=${L("抓取失败", "Fetch failed")}>
        ${reason || L("无法完成请求。", "The request could not be completed.")}
        ${result.duration_ms ? html` <span class="muted">(${result.duration_ms} ms)</span>` : null}
    <//>`;
}
