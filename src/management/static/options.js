// Delivery formatting options, worded like the bot's own /set menus.
import { html, Field, Select, Input } from "./ui.js";
import { L, minutes } from "./core.js";

export const OPTIONS = [
    {
        key: "notify",
        label: () => L("消息通知", "Notifications"),
        hint: () => L("静音时消息照常推送，但接收者不会收到提醒。", "Muted messages are still delivered, just without an alert."),
        values: () => [
            [1, L("正常", "Normal")],
            [0, L("静音", "Muted")],
        ],
    },
    {
        key: "send_mode",
        label: () => L("发送方式", "Send mode"),
        values: () => [
            [0, L("自动", "Auto")],
            [1, L("强制 Telegraph", "Force Telegraph")],
            [2, L("强制 Telegram 消息", "Force Telegram message")],
            [-1, L("仅标题和来源", "Only title and source")],
        ],
    },
    {
        key: "length_limit",
        label: () => L("长度上限", "Length limit"),
        hint: () =>
            L(
                "仅在“自动”发送方式下生效；超过时改用 Telegraph。0 表示不限。",
                "Auto mode only; longer posts go via Telegraph. 0 = unlimited.",
            ),
        number: [0, 4096],
    },
    {
        key: "link_preview",
        label: () => L("链接预览", "Link preview"),
        values: () => [
            [0, L("自动", "Auto")],
            [1, L("启用", "On")],
            [-1, L("禁用", "Off")],
        ],
    },
    {
        key: "display_media",
        label: () => L("媒体", "Media"),
        values: () => [
            [0, L("启用", "On")],
            [1, L("仅媒体，不含正文", "Media only, no text")],
            [-1, L("禁用", "Off")],
        ],
    },
    {
        key: "display_title",
        label: () => L("文章标题", "Post title"),
        values: () => [
            [0, L("自动", "Auto")],
            [1, L("启用", "On")],
            [-1, L("禁用", "Off")],
        ],
    },
    {
        key: "display_author",
        label: () => L("作者", "Author"),
        values: () => [
            [0, L("自动", "Auto")],
            [1, L("启用", "On")],
            [-1, L("禁用", "Off")],
        ],
    },
    {
        key: "display_via",
        label: () => L("来源", "Source (via)"),
        values: () => [
            [0, L("源标题和链接", "Feed title and link")],
            [1, L("源标题，链接显示为文章标题", "Feed title, link as post title")],
            [-1, L("无源标题，超链接置于结尾", "No feed title, hyperlink at end")],
            [-3, L("无源标题，链接显示为文章标题", "No feed title, link as post title")],
            [-4, L("无源标题，裸 URL 置于结尾", "No feed title, bare URL at end")],
            [-2, L("完全不显示", "Hidden")],
        ],
    },
    {
        key: "display_entry_tags",
        label: () => L("文章自带的 hashtag", "Hashtags from the post"),
        values: () => [
            [-1, L("禁用", "Off")],
            [1, L("启用", "On")],
        ],
    },
    {
        key: "style",
        label: () => L("消息风格", "Message style"),
        values: () => [
            [0, "RSStT"],
            [1, "flowerss"],
        ],
    },
];

export function labelOf(key, value) {
    const option = OPTIONS.find((o) => o.key === key);
    if (!option?.values) return String(value);
    return option.values().find(([v]) => v === value)?.[1] ?? String(value);
}

/** inherit: object of the chat's own values when editing a subscription (-100 = follow chat). */
export function OptionsForm({ values, onChange, inherit }) {
    const set = (key, value) => onChange({ ...values, [key]: value });
    return html`<div class="option-grid">
        ${OPTIONS.map((o) => {
            const follows = inherit && values[o.key] === -100;
            if (o.number) {
                return html`<${Field}
                    label=${o.label()}
                    hint=${follows
                        ? L(
                              `跟随会话默认：${inherit[o.key] || L("不限", "unlimited")}`,
                              `Following chat default: ${inherit[o.key] || "unlimited"}`,
                          )
                        : o.hint?.()}
                >
                    <div class="row">
                        ${inherit
                            ? html`<${Select}
                                  value=${follows ? "inherit" : "custom"}
                                  onChange=${(v) => set(o.key, v === "inherit" ? -100 : (inherit[o.key] ?? 0))}
                                  options=${[
                                      ["inherit", L("跟随会话默认", "Chat default")],
                                      ["custom", L("自定义", "Custom")],
                                  ]}
                              />`
                            : null}
                        ${follows
                            ? null
                            : html`<${Input}
                                  type="number"
                                  min=${o.number[0]}
                                  max=${o.number[1]}
                                  value=${values[o.key]}
                                  onInput=${(v) => set(o.key, v === "" ? 0 : Number(v))}
                              />`}
                    </div>
                <//>`;
            }
            const choices = o.values();
            const options = inherit
                ? [
                      [-100, L(`跟随会话默认（${labelOf(o.key, inherit[o.key])}）`, `Chat default (${labelOf(o.key, inherit[o.key])})`)],
                      ...choices,
                  ]
                : choices;
            return html`<${Field} label=${o.label()} hint=${o.hint?.()}>
                <${Select} value=${values[o.key]} onChange=${(v) => set(o.key, Number(v))} options=${options} />
            <//>`;
        })}
    </div>`;
}

export function IntervalField({ value, onChange, minimal, inheritLabel }) {
    const presets = [5, 10, 15, 30, 60, 120, 360, 720, 1440].filter((m) => m >= (minimal || 1));
    const custom = value != null && !presets.includes(value);
    return html`<${Field}
        label=${L("检查间隔", "Check interval")}
        hint=${L(`多久检查一次更新；最短 ${minimal} 分钟。`, `How often to check for updates; minimum ${minimal} min.`)}
    >
        <div class="row">
            <${Select}
                value=${value == null ? "" : custom ? "custom" : value}
                onChange=${(v) => onChange(v === "" ? null : v === "custom" ? (value ?? minimal) : Number(v))}
                options=${[["", inheritLabel], ...presets.map((m) => [m, minutes(m)]), ["custom", L("自定义…", "Custom…")]]}
            />
            ${custom || (value != null && !presets.includes(value))
                ? html`<${Input}
                          type="number"
                          min=${minimal}
                          max="32767"
                          style="width:110px"
                          value=${value}
                          onInput=${(v) => onChange(v === "" ? null : Number(v))}
                      /><span class="muted">${L("分钟", "min")}</span>`
                : null}
        </div>
    <//>`;
}
