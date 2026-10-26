const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "一切动态，尽在眼前。" })).toBeVisible();
});

test("dashboard, navigation, search and compact settings", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    await expect(page.getByRole("img", { name: /最近 14 天/ })).toBeVisible();
    await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
    await page.getByRole("link", { name: "会话与频道", exact: true }).click();
    await expect(page.getByRole("heading", { name: "会话与频道" })).toBeVisible();
    await page.getByPlaceholder("搜索名称、用户名或 ID").fill("技术");
    await expect(page.getByRole("row").filter({ hasText: "技术与创造" })).toHaveCount(1);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "查看订阅", exact: true }).click();
    await expect(page.getByRole("heading", { name: "全部订阅" })).toBeVisible();
    await expect(page.getByText("当前目的地：技术与创造")).toBeVisible();
    await page.getByPlaceholder("搜索名称或网址").fill("Hacker");
    await expect(page.getByRole("row").filter({ hasText: "Hacker News" })).toHaveCount(1);
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "更新与订阅" })).toBeVisible();
    await page.getByRole("button", { name: "实例信息", exact: true }).click();
    await expect(page.getByText("离线演示", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/settings.png", fullPage: true });
    expect(errors).toEqual([]);
});

test("add, customize, pause, resume and delete through the real API", async ({ page }) => {
    await page.getByRole("button", { name: "添加订阅", exact: true }).click();
    await page
        .locator("#target-picker")
        .getByRole("radio", { name: /技术与创造/ })
        .check();
    const url = `https://preview.example.org/test-${Date.now()}.rss`;
    await page.getByRole("textbox", { name: "RSS 地址" }).fill(url);
    await page.getByRole("dialog").getByRole("button", { name: "添加订阅", exact: true }).click();
    await expect(page.getByRole("heading", { name: "处理完成", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("link", { name: "全部订阅", exact: true }).click();
    await page.getByPlaceholder("搜索名称或网址").fill(url);
    let row = page.getByRole("row").filter({ hasText: url });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /编辑/ }).click();
    await page.getByRole("textbox", { name: "自定义标题" }).fill("网页端验收订阅");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(row).toContainText("网页端验收订阅");
    await row.getByRole("button", { name: /暂停/ }).click();
    await expect(row).toContainText("已暂停");
    await row.getByRole("button", { name: /恢复/ }).click();
    await expect(row).toContainText("更新中");
    await row.getByRole("button", { name: /取消订阅/ }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("没有匹配的订阅", { exact: true })).toBeVisible();
});

test("scoped token creation, display once, and revocation", async ({ page }) => {
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "连接授权", exact: true }).click();
    await page.getByRole("button", { name: "创建授权", exact: true }).click();
    const name = `浏览器测试 ${Date.now()}`;
    await page.getByRole("textbox", { name: "授权名称" }).fill(name);
    await page
        .locator("#target-picker")
        .getByRole("checkbox", { name: /技术与创造/ })
        .check();
    await page.getByRole("dialog").getByRole("button", { name: "创建授权", exact: true }).click();
    await expect(page.locator("#token-secret")).toHaveText(/^rst_/);
    await page.getByRole("button", { name: "已保存", exact: true }).click();
    const row = page.locator(".token-row").filter({ hasText: name });
    await expect(row).toContainText("1 个指定会话");
    await row.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(row).toHaveCount(0);
});

test("mobile layout, keyboard dialog, and dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
    await page.getByRole("button", { name: "展开导航" }).click();
    await page.getByRole("link", { name: "全部订阅", exact: true }).click();
    await expect(page.getByRole("heading", { name: "全部订阅" })).toBeVisible();
    await page.getByRole("button", { name: "添加订阅", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const contrast = await page
        .locator(".table-feed strong")
        .first()
        .evaluate((element) => {
            const luminance = (color) => {
                const channels = color
                    .match(/[\d.]+/g)
                    .slice(0, 3)
                    .map(Number)
                    .map((v) => {
                        v /= 255;
                        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                    });
                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            };
            const foreground = luminance(getComputedStyle(element).color);
            const background = luminance(getComputedStyle(element.closest(".panel")).backgroundColor);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: "test-results/mobile-dark.png", fullPage: true });
});

test("snapshot preview distinguishes real copies from unavailable history", async ({ page }) => {
    await page.route("**/api/public", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.snapshot = { captured_at: "2026-10-26T16:10:00+00:00" };
        await route.fulfill({ response, json: data });
    });
    await page.route("**/api/dashboard", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.statistics = { available: false, totals: { fetched: null, delivered: null, failed: null }, daily: [] };
        await route.fulfill({ response, json: data });
    });
    await page.reload();
    await expect(page.locator(".demo-banner")).toContainText("真实数据离线预览");
    await expect(page.locator(".demo-banner")).toContainText("修改仅保存在本地");
    await expect(page.locator(".stat").filter({ hasText: "累计推送" }).locator(".stat-value")).toHaveText("—");
    await expect(page.getByText("没有历史统计", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /最近 14 天/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
