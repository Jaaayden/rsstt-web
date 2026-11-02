// End-to-end checks against the offline demo (real API, no mocks).
const { test, expect } = require("@playwright/test");

const PASSWORD = process.env.WEB_PASSWORD;

async function signIn(page, path = "/") {
    await page.addInitScript(() => localStorage.setItem("rsstt.lang", "zh"));
    await page.goto(path);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => msg.type() === "error" && !/401/.test(msg.text()) && errors.push(msg.text()));
    page.errors = errors;
});
test.afterEach(async ({ page }) => {
    expect(page.errors, "no script errors").toEqual([]);
});

test("rejects a wrong password, then signs in", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rsstt.lang", "zh"));
    await page.goto("/");
    await page.getByLabel("密码").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText("密码不正确")).toBeVisible();
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
});

test("signs in when opened through localhost instead of WEB_ORIGIN", async ({ page, baseURL }) => {
    const local = baseURL.replace("127.0.0.1", "localhost");
    await signIn(page, local + "/");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
});

test("every page renders", async ({ page }) => {
    await signIn(page);
    for (const [nav, heading] of [
        ["会话", "会话"],
        ["订阅", "订阅"],
        ["运行日志", "运行日志"],
        ["设置", "设置"],
        ["概览", "概览"],
    ]) {
        await page.locator(".nav").getByRole("link", { name: nav }).click();
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await page.getByRole("radio", { name: "7 天" }).click();
    await expect(page.locator(".chart svg")).toBeVisible();
});

test("blocking asks first and cancelling keeps the role", async ({ page }) => {
    await signIn(page, "/#chats");
    await page
        .getByRole("row", { name: /研究小组/ })
        .getByRole("button", { name: "管理" })
        .click();
    const drawer = page.locator(".drawer");
    await expect(drawer.getByRole("heading", { name: "研究小组" })).toBeVisible();
    await drawer.getByText("已封禁", { exact: true }).click();
    await expect(page.locator(".modal")).toContainText("封禁“研究小组”");
    await page.locator(".modal").getByRole("button", { name: "取消" }).click();
    await expect(drawer.locator('input[name="role"]:checked')).toHaveCount(1);
    await expect(drawer.locator(".list-row", { hasText: "用户" }).first().locator("input")).toBeChecked();
    // Confirm for real this time.
    await drawer.getByText("已封禁", { exact: true }).click();
    await page.locator(".modal").getByRole("button", { name: "封禁" }).click();
    await expect(page.getByText("已封禁", { exact: true }).last()).toBeVisible();
    await expect(drawer.locator(".facts")).toContainText("0");
    // Blocked chats drop out of the default list and recipient pickers.
    await drawer.getByRole("button", { name: "关闭" }).click();
    await expect(page.getByRole("row", { name: /研究小组/ })).toHaveCount(0);
    // Unblock again to keep the demo usable.
    await page.goto("/#chats?visibility=banned");
    await page
        .getByRole("row", { name: /研究小组/ })
        .getByRole("button", { name: "管理" })
        .click();
    await page.locator(".drawer").getByText("用户", { exact: true }).click();
    await expect(page.locator(".drawer .badge", { hasText: "当前" })).toBeVisible();
});

test("subscription drawer keeps unsaved edits per tab and saves", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    await drawer.getByLabel("自定义标题").fill("E2E 标题");
    await expect(drawer.getByText("1 项修改未保存")).toBeVisible();
    // Switching tabs with unsaved changes asks first; cancelling stays put.
    await drawer.getByRole("tab", { name: "接收会话" }).click();
    await page.locator(".modal").getByRole("button", { name: "取消" }).click();
    await expect(drawer.getByLabel("自定义标题")).toHaveValue("E2E 标题");
    await drawer.getByRole("button", { name: "保存" }).click();
    await expect(page.locator(".toast", { hasText: "已保存" })).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "E2E 标题" })).toBeVisible();
    // Other tabs load.
    for (const tab of ["接收会话", "最近文章", "抓取", "日志"]) {
        await drawer.getByRole("tab", { name: new RegExp(tab) }).click();
        await expect(drawer.locator(".loading")).toHaveCount(0);
    }
    await drawer.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator(".drawer")).toHaveCount(0);
});

test("edit recipients of a shared feed", async ({ page }) => {
    await signIn(page, "/#subscriptions?q=机器之心");
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    await drawer.getByRole("tab", { name: "接收会话" }).click();
    await expect(drawer.getByRole("button", { name: "编辑接收会话" })).toBeVisible();
    const before = await drawer.locator(".panel .list-row").count();
    expect(before).toBeGreaterThan(0);
    await drawer.getByRole("button", { name: "编辑接收会话" }).click();
    await drawer.locator(".picker-control input").click();
    const option = drawer.locator(".picker-option:not(.on)").first();
    await option.click();
    await drawer.locator(".picker-control input").press("Escape");
    await expect(drawer.locator(".picker-menu")).toHaveCount(0);
    await drawer.getByRole("button", { name: "保存接收会话" }).click();
    await expect(page.locator(".toast", { hasText: "接收会话已更新" })).toBeVisible();
    await expect(drawer.locator(".panel .list-row")).toHaveCount(before + 1);
});

test("manual fetch reports a result", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await page.locator("tbody tr .cell-title").first().click();
    await page.locator(".drawer").getByRole("tab", { name: "抓取" }).click();
    await page.locator(".drawer").getByRole("button", { name: "立即检查" }).click();
    await page.locator(".modal").getByRole("button", { name: "立即检查" }).click();
    await expect(page.locator(".drawer .notice")).toContainText("完成");
});

test("per-feed proxy: save, keep the credentials hidden, batch apply", async ({ page }) => {
    await signIn(page, "/#subscriptions?q=机器之心");
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    await drawer.getByRole("tab", { name: "抓取" }).click();
    await expect(drawer.getByText("跟随全局设置")).toBeVisible();
    await drawer.getByRole("radio", { name: "使用代理" }).click();
    await drawer.locator('input[type="password"]').fill("socks5://e2e-user:e2e-secret@proxy.example.net:1080");
    await drawer.getByRole("button", { name: "保存" }).first().click();
    await expect(drawer.getByText("使用代理 socks5://proxy.example.net:1080")).toBeVisible();
    // The password is never shown again, neither on the page nor in the API.
    await expect(page.locator("body")).not.toContainText("e2e-secret");
    const api = await page.request.get("/api/feeds/" + (await page.evaluate(() => location.hash.match(/sub=(\d+)/)[1])) + "/fetch-options");
    expect(JSON.stringify(await api.json())).not.toContain("e2e-secret");
    // The control starts from what is saved, and "Direct" is a separate, explicit choice.
    await expect(drawer.getByRole("radio", { name: "使用代理" })).toHaveAttribute("aria-checked", "true");
    await drawer.getByRole("radio", { name: "直连" }).click();
    await drawer.getByRole("button", { name: "保存" }).first().click();
    await expect(drawer.getByText("直连（不使用代理）")).toBeVisible();
    await drawer.getByRole("button", { name: "关闭" }).click();
    // Batch: select every row of the filtered list and set one proxy for their feeds.
    await page.getByRole("checkbox", { name: "全选" }).check();
    await page.locator(".batchbar").getByRole("button", { name: "代理" }).click();
    await expect(page.locator(".modal")).toContainText("个订阅源");
    await page.locator(".modal").getByRole("radio", { name: "跟随全局" }).click();
    await page.locator(".modal").getByRole("button", { name: "应用" }).click();
    await expect(page.locator(".toast", { hasText: "个订阅源，下次抓取生效" })).toBeVisible();
});

test("batch bar: fetch now, interval and copy URLs", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, "/#subscriptions?q=机器之心");
    await page.getByRole("checkbox", { name: "全选" }).check();
    const bar = page.locator(".batchbar");
    await bar.getByRole("button", { name: "复制地址" }).click();
    await expect(page.locator(".toast", { hasText: "个地址" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https?:\/\//);
    await bar.getByRole("button", { name: "间隔" }).click();
    await page.locator(".modal").getByRole("button", { name: "应用" }).click();
    await expect(page.locator(".toast", { hasText: "检查间隔" })).toBeVisible();
    await page.getByRole("checkbox", { name: "全选" }).check();
    await bar.getByRole("button", { name: "立即抓取" }).click();
    await expect(page.locator(".modal")).toContainText("逐个进行");
    await page.locator(".modal").getByRole("button", { name: "开始抓取" }).click();
    await expect(page.locator(".modal")).toContainText("完成：成功");
    await page.locator(".modal").getByRole("button", { name: "完成" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
});

test("fetch runs: every check is listed with time, duration and counts", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    await drawer.getByRole("tab", { name: /日志/ }).click();
    await expect(drawer.locator(".run").first()).toContainText("耗时");
    await expect(drawer.locator(".run").first()).toContainText(/有效 \d+ 条|HTTP|内容没有变化/);
    await drawer.getByRole("radio", { name: "事件与推送" }).click();
    await expect(drawer.locator(".timeline, .empty").first()).toBeVisible();
    await drawer.getByRole("radio", { name: "抓取记录" }).click();
    await drawer.getByRole("button", { name: "关闭" }).click();
    // The global page has the same view with a status filter.
    await page.goto("/#logs?view=runs");
    await expect(page.locator(".run").first()).toBeVisible();
    await page.locator(".toolbar select").first().selectOption("failed");
    await expect(page.locator(".run .badge-red").first()).toBeVisible();
});

test("add subscriptions shows per-URL results", async ({ page }) => {
    await signIn(page, "/#subscriptions?add=1");
    const modal = page.locator(".modal");
    await modal.locator(".picker-control input").click();
    await modal.locator(".picker-option").first().click();
    await modal.getByLabel("RSS 地址").fill("https://e2e.example.com/feed.xml");
    await modal.getByRole("button", { name: "订阅" }).click();
    await expect(page.locator(".toast", { hasText: "已添加" })).toBeVisible();
});

test("notifications: enable delivery via this bot", async ({ page }) => {
    await signIn(page, "/#settings?section=notifications");
    const row = page.locator(".list-row", { hasText: "通过本机器人发给我" });
    await row.getByRole("button", { name: "启用" }).click();
    await expect(row.getByText("已启用")).toBeVisible();
    await row.getByRole("button", { name: "发送测试" }).click();
    await expect(page.locator(".toast").last()).toContainText("模拟");
});

test("settings sections load", async ({ page }) => {
    await signIn(page, "/#settings");
    for (const name of ["订阅规则", "运行配置", "备份与恢复", "API 访问", "账户与安全"]) {
        await page.locator(".subnav").getByRole("button", { name }).click();
        await expect(page.locator(".settings-layout .card").first()).toBeVisible();
        await expect(page.locator(".notice-error")).toHaveCount(0);
    }
});

test("switches language and theme", async ({ page }) => {
    await signIn(page);
    // The button names the language it switches to.
    await page.locator(".sidebar").getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("button", { name: "中文" })).toBeVisible();
    await page.locator(".sidebar").getByLabel("Appearance").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".sidebar").getByLabel("Appearance").selectOption("system");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("phone layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page);
    for (const route of ["#overview", "#chats", "#subscriptions", "#logs", "#settings"]) {
        await page.goto("/" + route);
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, route).toBeLessThanOrEqual(0);
    }
    await page.getByRole("button", { name: "打开菜单" }).click();
    await expect(page.locator(".sidebar")).toBeInViewport();
});
