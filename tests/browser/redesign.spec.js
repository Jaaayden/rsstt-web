const { test, expect } = require("@playwright/test");

// Exercise reachability at small viewport boundaries, using a separate demo
// database from Playwright's webServer. Do not run writes against a snapshot.
async function login(page, { language = "zh-CN", theme = "light" } = {}) {
    const response = await page.request.get("/api/public");
    expect(response.ok()).toBe(true);
    const info = await response.json();
    expect(info.demo, "UI regression tests require the isolated offline demo").toBe(true);
    expect(info.snapshot, "UI regression tests must not modify a real-data snapshot").toBeFalsy();
    await page.addInitScript(
        ({ language, theme }) => {
            localStorage.setItem("rsstt.language", language);
            localStorage.setItem("rsstt.theme", theme);
        },
        { language, theme },
    );
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.getByRole("main")).toBeVisible();
}

async function expectNoPageOverflow(page) {
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(1);
}

async function revealControl(control) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 0.95 });
}

const variants = [
    {
        language: "zh-CN",
        theme: "light",
        openNavigation: "展开导航",
        settingsNavigation: "设置栏目",
        pages: [
            ["targets", "会话与频道", "会话与频道"],
            ["subscriptions", "全部订阅", "全部订阅"],
            ["dashboard", "仪表盘", "运行概况"],
            ["settings", "设置", "设置"],
        ],
        sections: [
            ["general", "更新与订阅", "更新与订阅"],
            ["tokens", "API 访问令牌", "API 访问令牌"],
            ["runtime", "运行配置", "运行配置"],
            ["notifications", "通知", "通知"],
            ["backups", "备份与恢复", "备份与恢复"],
            ["instance", "实例信息", "实例信息"],
            ["security", "账户安全", "账户安全"],
        ],
        createToken: "创建令牌",
        tokenName: "令牌名称",
        cancel: "取消",
    },
    {
        language: "en",
        theme: "dark",
        openNavigation: "Open navigation",
        settingsNavigation: "Settings sections",
        pages: [
            ["targets", "Chats & channels", "Chats & channels"],
            ["subscriptions", "All subscriptions", "All subscriptions"],
            ["dashboard", "Dashboard", "Overview"],
            ["settings", "Settings", "Settings"],
        ],
        sections: [
            ["general", "Updates & subscriptions", "Updates & subscriptions"],
            ["tokens", "API access tokens", "API access tokens"],
            ["runtime", "Runtime configuration", "Runtime configuration"],
            ["notifications", "Notifications", "Notifications"],
            ["backups", "Backup & restore", "Backup & restore"],
            ["instance", "Instance", "Instance"],
            ["security", "Account security", "Account security"],
        ],
        createToken: "Create token",
        tokenName: "Token name",
        cancel: "Cancel",
    },
];

for (const variant of variants) {
    test(`360px navigation reaches every page and settings section: ${variant.language}, ${variant.theme}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await login(page, variant);
        for (const [route, navigationLabel, title] of variant.pages) {
            // Opening the drawer makes the workspace inert. Keep this reference
            // available only to inspect its expanded state while it is inert.
            const menu = page.getByRole("button", {
                name: variant.openNavigation,
                exact: true,
                includeHidden: true,
            });
            await revealControl(menu);
            await menu.click();
            await expect(menu).toHaveAttribute("aria-expanded", "true");
            await page.getByRole("link", { name: navigationLabel, exact: true }).click();
            await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(title);
            await expect(menu).toHaveAttribute("aria-expanded", "false");
            await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
            await expect(page.locator('a[aria-current="page"]')).toHaveAttribute("href", `#${route}`);
            await expectNoPageOverflow(page);
        }
        for (const [section, label, contentHeading] of variant.sections) {
            const navigation = page.getByRole("navigation", { name: variant.settingsNavigation, exact: true });
            const button = navigation.getByRole("button", { name: label, exact: true });
            // Clicking an already selected section starts another async render
            // with identical headings. Inspect it directly; otherwise use the
            // click's built-in scrolling/retry and wait for the new heading.
            if (new URLSearchParams(page.url().split("?")[1]).get("section") !== section) await button.click();
            await expect.poll(() => new URLSearchParams(page.url().split("?")[1]).get("section")).toBe(section);
            await expect(
                page.getByRole("main").getByRole("heading", { name: contentHeading, level: 2, exact: true }),
            ).toBeVisible();
            await expect(button).toHaveAttribute("aria-current", "page");
            // Do not scroll the selected item from the test: rendering must
            // keep the current settings section in the visible navigation.
            await expect(button).toBeInViewport({ ratio: 0.95 });
            await expectNoPageOverflow(page);
        }
        await page.reload();
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(variant.pages.at(-1)[2]);
        await expect(page.locator("#language")).toHaveValue(variant.language);
        await expect(page.locator("#theme")).toHaveValue(variant.theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme", variant.theme);
        await expectNoPageOverflow(page);
    });

    test(`short landscape picker keeps distant choices and footer usable: ${variant.language}, ${variant.theme}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        const items = Array.from({ length: 24 }, (_, index) => ({
            id: String(-10081000 - index),
            kind: index % 2 ? "group" : "channel",
            title: `Reading chat ${index + 1} · 中文名称 LongUnbrokenChatNameForSmallScreens${"x".repeat(50)}`,
        }));
        await page.route("**/api/targets?*", async (route) => {
            if (new URL(route.request().url()).searchParams.get("size") !== "50") return route.fallback();
            await route.fulfill({ json: { items, page: 1, size: 50, total: items.length } });
        });
        await login(page, variant);
        await page.goto("/#settings?section=tokens");
        const create = page.getByRole("button", { name: variant.createToken, exact: true });
        await create.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("textbox", { name: variant.tokenName, exact: true }).fill("Landscape layout check");
        const lastChoice = dialog.getByRole("checkbox", { name: /^Reading chat 24 ·/ });
        await revealControl(lastChoice);
        await lastChoice.check();
        await expect(lastChoice).toBeChecked();
        await expectNoPageOverflow(page);
        expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        const cancel = dialog.getByRole("button", { name: variant.cancel, exact: true });
        await revealControl(cancel);
        await cancel.click();
        await expect(dialog).not.toBeVisible();
        await expect(create).toBeFocused();
    });
}

test("keyboard dialog excludes background controls and returns focus after a desktop-to-mobile resize", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto("/#subscriptions");
    const filter = page.getByRole("button", { name: "按会话筛选", exact: true });
    await filter.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "关闭", exact: true }).first();
    const apply = dialog.getByRole("button", { name: "应用筛选", exact: true });
    await close.focus();
    // Chromium may move from a native dialog into browser chrome at a tab
    // boundary. The invariant is that page controls behind the modal never
    // receive focus, rather than requiring a browser-specific wrap target.
    for (const key of ["Shift+Tab", ...Array(8).fill("Tab")]) {
        await page.keyboard.press(key);
        const focus = await dialog.evaluate((element) => ({
            documentFocused: document.hasFocus(),
            insideDialog: element.contains(document.activeElement),
            activeTag: document.activeElement?.tagName,
        }));
        expect(focus.documentFocused && !focus.insideDialog, JSON.stringify(focus)).toBe(false);
    }
    await close.focus();
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(dialog).toBeVisible();
    await revealControl(apply);
    await expectNoPageOverflow(page);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(filter).toBeFocused();
    const menu = page.getByRole("button", { name: "展开导航", exact: true, includeHidden: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const navigation = page.getByRole("complementary", { name: "主导航", exact: true });
    await expect(navigation.getByRole("link", { name: "仪表盘", exact: true })).toBeFocused();
    // An inert workspace must reject even programmatic focus attempts on its
    // controls; role enumeration alone does not establish this browser behavior.
    await filter.focus();
    expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    for (let step = 0; step < 9; step++) {
        await page.keyboard.press("Tab");
        expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await expect(page.getByRole("main")).toBeVisible();
    await menu.click();
    await page.locator(".nav-scrim").click();
    await expect(menu).toBeFocused();
    await expect(page.getByRole("main")).toBeVisible();
    await menu.click();
    await navigation.getByRole("link", { name: "全部订阅", exact: true }).click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("main")).toBeVisible();
    await menu.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("main")).toBeVisible();
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await filter.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(filter).toBeFocused();
});

test("mobile runtime table keeps its edit action reachable without expanding the page", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await login(page, { language: "en", theme: "light" });
    await page.goto("/#settings?section=runtime");
    const row = page.getByRole("row").filter({ hasText: "HTTP_TIMEOUT" });
    await expect(row).toHaveCount(1);
    const edit = row.getByRole("button", { name: "Edit", exact: true });
    await revealControl(edit);
    await expectNoPageOverflow(page);
    await edit.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("HTTP_TIMEOUT");
    const value = dialog.getByRole("spinbutton");
    await revealControl(value);
    await value.focus();
    await expect(value).toBeFocused();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await revealControl(cancel);
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(edit).toBeFocused();
    await expectNoPageOverflow(page);
});
