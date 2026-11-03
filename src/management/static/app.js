// Application shell: sign-in, navigation and page routing.
import { html, render, useState, useEffect, Icon, Mark, Button, Field, Input, Toasts, ModalHost, useRoute, Notice } from "./ui.js";
import {
    L,
    lang,
    setLang,
    theme,
    applyTheme,
    app,
    api,
    subscribe,
    emit,
    readRoute,
    toast,
    duration,
    dateTime,
    registerLive,
    resetCache,
} from "./core.js";
import { Overview, warm as warmOverview } from "./page-overview.js";
import { Chats, warm as warmChats } from "./page-chats.js";
import { Subscriptions, warm as warmSubscriptions } from "./page-subscriptions.js";
import { Logs, warm as warmLogs } from "./page-logs.js";
import { Settings, warm as warmSettings } from "./page-settings.js";

const PAGES = {
    overview: { icon: "overview", label: () => L("概览", "Overview"), view: Overview, warm: warmOverview },
    chats: { icon: "chats", label: () => L("会话", "Chats"), view: Chats, warm: warmChats },
    subscriptions: { icon: "feeds", label: () => L("订阅", "Subscriptions"), view: Subscriptions, warm: warmSubscriptions },
    logs: { icon: "logs", label: () => L("运行日志", "Logs"), view: Logs, warm: warmLogs },
    settings: { icon: "settings", label: () => L("设置", "Settings"), view: Settings, warm: warmSettings },
};

function Prefs() {
    // The language button names the language you switch TO; appearance is an explicit choice.
    return html`<div class="prefs">
        <button
            class="pref"
            lang=${lang === "en" ? "zh-CN" : "en"}
            title=${lang === "en" ? "切换为中文" : "Switch to English"}
            onClick=${() => setLang(lang === "en" ? "zh" : "en")}
        >
            <${Icon} name="globe" size=${14} />${lang === "en" ? "中文" : "English"}
        </button>
        <label class="pref pref-select" title=${L("外观", "Appearance")}>
            <${Icon} name=${theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} size=${14} />
            <select aria-label=${L("外观", "Appearance")} value=${theme} onChange=${(e) => applyTheme(e.currentTarget.value)}>
                <option value="system" selected=${theme === "system"}>${L("跟随系统", "System")}</option>
                <option value="light" selected=${theme === "light"}>${L("浅色", "Light")}</option>
                <option value="dark" selected=${theme === "dark"}>${L("深色", "Dark")}</option>
            </select>
            <${Icon} name="down" size=${12} />
        </label>
    </div>`;
}

function Login({ info }) {
    const [username, setUsername] = useState(() => {
        try {
            return localStorage.getItem("rsstt.user") || "";
        } catch {
            return "";
        }
    });
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            await api("/login", { method: "POST", body: { username: username.trim(), password } });
            try {
                localStorage.setItem("rsstt.user", username.trim());
            } catch {
                /* private mode */
            }
            resetCache();
            app.session = await api("/session");
            location.hash ||= "#overview";
            window.dispatchEvent(new Event("routechange"));
            document.dispatchEvent(new Event("rsstt:session"));
        } catch (err) {
            setError(err.status === 401 ? L("账号或密码不正确。", "Incorrect username or password.") : err.message);
        } finally {
            setBusy(false);
        }
    }
    return html`<div class="login">
        <section class="login-art">
            <a class="brand" href="#"
                ><${Mark} size=${34} /><span><b>RSStT Web</b><small>RSS → Telegram</small></span></a
            >
            <div>
                <h1>${L("订阅、会话与推送，一处掌握。", "Feeds, chats and deliveries — in one place.")}</h1>
                <p>
                    ${L(
                        "管理 RSS-to-Telegram-Bot 的订阅源、接收会话和推送状态，机器人命令照常可用。",
                        "Manage feeds, recipients and delivery for your RSS-to-Telegram bot. Bot commands keep working as before.",
                    )}
                </p>
                <div class="flow" aria-hidden="true">
                    <span class="flow-node"><${Icon} name="feeds" size=${22} /></span><span class="flow-line"></span>
                    <${Mark} size=${52} /><span class="flow-line"></span>
                    <span class="flow-node"><${Icon} name="send" size=${22} /></span>
                </div>
            </div>
            <footer>RSS-to-Telegram-Bot · AGPL-3.0</footer>
        </section>
        <section class="login-form">
            <div class="login-prefs"><${Prefs} /></div>
            <form onSubmit=${submit}>
                <div>
                    <h2>${L("登录管理台", "Sign in")}</h2>
                    <p class="lead">
                        ${L(
                            "第一次登录：账号是 admin（演示实例是 preview-admin），密码是部署时设置的 WEB_PASSWORD。登录后可以在“设置 → 账号”里修改。",
                            "First sign-in: the username is admin (preview-admin on the demo) and the password is the WEB_PASSWORD from deployment. Change both under Settings → Account.",
                        )}
                    </p>
                </div>
                ${info.snapshot
                    ? html`<${Notice} tone="warn"
                          >${L(
                              "这是真实数据的离线副本，修改只保存在本机，不影响线上机器人。",
                              "Offline copy of real data. Changes stay local and don't affect the live bot.",
                          )}<//
                      >`
                    : info.demo
                      ? html`<${Notice}
                            >${L(
                                "演示实例：使用示例数据，不连接 Telegram。",
                                "Demo instance with sample data; not connected to Telegram.",
                            )}<//
                        >`
                      : null}
                <${Field} label=${L("账号", "Username")}>
                    <${Input}
                        name="username"
                        autocomplete="username"
                        autocapitalize="none"
                        autocorrect="off"
                        spellcheck="false"
                        placeholder=${info.demo ? "preview-admin" : "admin"}
                        value=${username}
                        onInput=${setUsername}
                        autofocus=${!username}
                        required
                    />
                <//>
                <${Field} label=${L("密码", "Password")} error=${error}>
                    <${Input}
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        value=${password}
                        onInput=${setPassword}
                        autofocus=${!!username}
                        required
                    />
                <//>
                <${Button} kind="primary" size="lg" type="submit" loading=${busy} disabled=${!username.trim() || !password}>${L("登录", "Sign in")}<//>
                <${Version} version=${info.version} />
            </form>
        </section>
    </div>`;
}

/** "RSStT Web 1.4.0 · abc1234": hover for the full commit, click to copy (for bug reports). */
function Version({ version, build }) {
    if (!version) return null;
    const text = `RSStT Web ${version}${build ? ` · ${build.slice(0, 7)}` : ""}`;
    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            toast(L(`已复制 ${text}`, `Copied ${text}`));
        } catch {
            toast(L("浏览器不允许写入剪贴板", "The browser blocked clipboard access"), "error");
        }
    }
    return html`<button type="button" class="version-tag" title=${(build ? build + " · " : "") + L("点击复制", "Click to copy")} onClick=${copy}>
        ${text}
    </button>`;
}

function BotCard() {
    const bot = app.bot || {};
    const info = app.info;
    const state = info.snapshot || info.demo ? "preview" : bot.connected ? "online" : "offline";
    const status = info.snapshot
        ? L("离线数据副本", "Offline data copy")
        : info.demo
          ? L("演示模式", "Demo mode")
          : bot.connected
            ? L("运行中", "Running") + (app.uptime ? " · " + duration(app.uptime) : "")
            : L("未连接 Telegram", "Disconnected");
    return html`<div class="bot-card">
        <span class="status-dot ${state}"></span>
        <div>
            <b>${bot.username ? "@" + bot.username : bot.name || "RSStT"}</b>
            <small>${status}</small>
        </div>
    </div>`;
}

function Shell() {
    useRoute();
    const [menu, setMenu] = useState(false);
    const { page } = readRoute();
    const current = PAGES[page] ? page : "overview";
    const View = PAGES[current].view;
    useEffect(() => setMenu(false), [current]);
    useEffect(() => {
        // The sidebar's bot state and failure badge. /status is tiny, so it follows the pages' refresh but never faster than once a minute,
        // and not at all while the overview (which carries the same numbers) has just loaded.
        const tick = async (minAge = 0) => {
            if (minAge && Date.now() - (app.statusAt || 0) < minAge) return;
            app.statusAt = Date.now();
            try {
                const s = await api("/status");
                Object.assign(app, { bot: s.bot, uptime: s.uptime_seconds, attention: s.attention });
                emit();
            } catch {
                /* shown on next successful poll */
            }
        };
        tick();
        return registerLive({ reload: tick, floor: 55000 });
    }, []);
    useEffect(() => {
        // Once the page in front is up, quietly fetch the first screen of the others so a first visit is as quick as a return visit.
        const timer = setTimeout(
            () => !document.hidden && Object.entries(PAGES).forEach(([key, p]) => key !== current && p.warm?.()),
            1500,
        );
        return () => clearTimeout(timer);
    }, []);
    useEffect(() => {
        document.title = `${PAGES[current].label()} · RSStT Web`;
    }, [current, lang]);
    async function logout() {
        try {
            await api("/logout", { method: "POST" });
        } catch {
            /* already gone */
        }
        app.session = null;
        resetCache();
        document.dispatchEvent(new Event("rsstt:session"));
    }
    const info = app.info;
    return html`<div class="shell ${menu ? "menu-open" : ""}">
        <aside class="sidebar">
            <a class="brand" href="#overview"
                ><${Mark} size=${32} /><span><b>RSStT Web</b><small>RSS → Telegram</small></span></a
            >
            <nav class="nav">
                ${Object.entries(PAGES).map(
                    ([key, p]) =>
                        html`<a
                            href=${"#" + key}
                            class=${key === current ? "on" : ""}
                            aria-current=${key === current ? "page" : undefined}
                            onPointerEnter=${p.warm}
                            onFocus=${p.warm}
                            ontouchstart=${p.warm}
                        >
                            <${Icon} name=${p.icon} size=${17} />${p.label()}
                            ${key === "subscriptions" && app.attention
                                ? html`<span class="count" title=${L("连续抓取失败的订阅", "Subscriptions with repeated fetch failures")}
                                      >${app.attention}</span
                                  >`
                                : null}
                        </a>`,
                )}
            </nav>
            <div class="sidebar-foot">
                <${BotCard} />
                <${Prefs} />
                <button class="pref btn-ghost btn" onClick=${logout}>
                    <${Icon} name="logout" size=${14} />${L("退出登录", "Sign out")}
                </button>
                <${Version} version=${app.session?.version} build=${app.session?.build} />
            </div>
        </aside>
        ${menu ? html`<div class="scrim" onClick=${() => setMenu(false)}></div>` : null}
        <div class="main">
            <header class="topbar">
                <button class="icon-btn" aria-label=${L("打开菜单", "Open menu")} onClick=${() => setMenu(true)}>
                    <${Icon} name="menu" size=${18} />
                </button>
                <${Mark} size=${24} /><b>${PAGES[current].label()}</b>
            </header>
            ${info.snapshot
                ? html`<div class="banner">
                      <${Icon} name="info" />${L(
                          `真实数据离线副本（${dateTime(info.snapshot.captured_at)} 导出）：修改仅保存在本机，不会抓取 RSS 或发送 Telegram 消息。`,
                          `Offline copy of real data (exported ${dateTime(info.snapshot.captured_at)}). Changes stay local; no RSS fetching or Telegram messages.`,
                      )}
                  </div>`
                : info.demo
                  ? html`<div class="banner">
                        <${Icon} name="info" />${L(
                            "演示模式：示例数据，不连接 Telegram。",
                            "Demo mode: sample data, not connected to Telegram.",
                        )}
                    </div>`
                  : null}
            <main class="page" id="main"><${View} key=${current + lang} /></main>
        </div>
    </div>`;
}

function Root() {
    const [, force] = useState(0);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const update = () => force((n) => n + 1);
        const unsubscribe = subscribe(update);
        document.addEventListener("rsstt:session", update);
        (async () => {
            // Independent, so they travel together (index.html already asked for both while the scripts loaded).
            const [info, session] = await Promise.allSettled([api("/public"), api("/session")]);
            app.info = info.status === "fulfilled" ? info.value : { features: {} };
            app.session = session.status === "fulfilled" ? session.value : null;
            setReady(true);
        })();
        return () => {
            unsubscribe();
            document.removeEventListener("rsstt:session", update);
        };
    }, []);
    if (!ready) return html`<div class="boot"><span class="spinner"></span></div>`;
    return html`${app.session ? html`<${Shell} key=${lang} />` : html`<${Login} info=${app.info} key=${lang} />`}<${ModalHost} /><${Toasts} />`;
}

render(html`<${Root} />`, document.getElementById("app"));
