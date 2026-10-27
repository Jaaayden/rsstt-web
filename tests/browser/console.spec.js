const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD || "rsstt-local-preview");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.getByRole("heading", { name: "运行概况" })).toBeVisible();
});

test("dashboard, navigation, search and compact settings", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    await expect(page.getByRole("img", { name: /最近 14 天|按本地时间显示的统计趋势/ })).toBeVisible();
    await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
    await page.getByRole("link", { name: "会话与频道", exact: true }).click();
    await expect(page.getByRole("heading", { name: "会话与频道" })).toBeVisible();
    await page.getByPlaceholder("搜索名称、用户名或 ID").fill("技术");
    await expect(page.getByRole("row").filter({ hasText: "技术与创造" })).toHaveCount(1);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "管理订阅", exact: true }).click();
    await expect(page.getByRole("heading", { name: "全部订阅" })).toBeVisible();
    await expect(page.getByText("当前会话：技术与创造")).toBeVisible();
    await page.getByPlaceholder("搜索订阅源名称或 RSS 地址").fill("Hacker");
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
    await page.getByRole("textbox", { name: "订阅源地址（RSS/Atom）" }).fill(url);
    await page.getByRole("dialog").getByRole("button", { name: "添加订阅", exact: true }).click();
    await expect(page.getByRole("heading", { name: "处理完成", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("link", { name: "全部订阅", exact: true }).click();
    await page.getByPlaceholder("搜索订阅源名称或 RSS 地址").fill(url);
    let row = page.getByRole("row").filter({ hasText: url });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /编辑/ }).click();
    await page.getByRole("textbox", { name: "此订阅的显示名称" }).fill("网页端验收订阅");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(row).toContainText("网页端验收订阅");
    await row.getByRole("button", { name: /暂停/ }).click();
    await expect(row).toContainText("已暂停");
    await row.getByRole("button", { name: /恢复/ }).click();
    await expect(row).toContainText("已启用");
    await row.getByRole("button", { name: /取消订阅/ }).click();
    await page.getByRole("dialog").locator(".dialog-footer button[type=submit]").click();
    await expect(page.getByText("没有符合条件的订阅", { exact: true })).toBeVisible();
});

test("scoped token creation, display once, and revocation", async ({ page }) => {
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "API 访问令牌", exact: true }).click();
    await page.getByRole("button", { name: "创建令牌", exact: true }).click();
    const name = `浏览器测试 ${Date.now()}`;
    await page.getByRole("textbox", { name: "令牌名称" }).fill(name);
    await page
        .locator("#target-picker")
        .getByRole("checkbox", { name: /技术与创造/ })
        .check();
    await page.getByRole("dialog").getByRole("button", { name: "创建令牌", exact: true }).click();
    await expect(page.locator("#token-secret")).toHaveText(/^rst_/);
    await page.getByRole("button", { name: "我已妥善保存", exact: true }).click();
    const row = page.locator(".token-row").filter({ hasText: name });
    await expect(row).toContainText("1 个指定会话");
    await row.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("dialog").locator(".dialog-footer button[type=submit]").click();
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
    await page.route("**/api/statistics?*", (route) => route.fulfill({ json: { available: false, buckets: [] } }));
    await page.reload();
    await expect(page.locator(".demo-banner")).toContainText("真实数据离线预览");
    await expect(page.locator(".demo-banner")).toContainText("修改仅保存在本地");
    await expect(page.locator(".stat").filter({ hasText: "累计成功推送（篇次）" }).locator(".stat-value")).toHaveText(
        "—",
    );
    await expect(page.getByText("没有历史统计", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /最近 14 天|按本地时间显示的统计趋势/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("account security revokes sessions and rotates the persistent password", async ({ page, request, baseURL }) => {
    const original = process.env.WEB_PASSWORD;
    const next = original + "1";
    const headers = { Origin: new URL(baseURL).origin };
    try {
        await page.getByRole("link", { name: "设置", exact: true }).click();
        await page.getByRole("button", { name: "账户安全", exact: true }).click();
        await expect(page.getByText(/preview-admin/)).toBeVisible();
        await page.getByRole("button", { name: "退出所有网页登录会话", exact: true }).click();
        await page.getByRole("dialog").locator(".dialog-footer button[type=submit]").click();
        await expect(page.locator("#login-form")).toBeVisible();
        await page.getByLabel("管理台密码", { exact: true }).fill(original);
        await page.getByRole("button", { name: /进入管理台/ }).click();
        await expect(page.getByRole("heading", { name: "账户安全", exact: true })).toBeVisible();
        await page.getByLabel("当前密码", { exact: true }).fill("incorrect-current-password");
        await page.getByLabel("新密码", { exact: true }).fill(next);
        await page.getByRole("button", { name: "修改密码并退出" }).click();
        await expect(page.locator("#password-form .error")).toHaveText(
            "当前密码不正确，密码未修改。 (CURRENT_PASSWORD_INCORRECT)",
        );
        await expect(page.locator("#login-form")).toHaveCount(0);
        expect(await page.evaluate(async () => (await fetch("/api/session")).status)).toBe(200);
        await page.getByLabel("当前密码", { exact: true }).fill(original);
        await page.getByLabel("新密码", { exact: true }).fill(next);
        await page.getByRole("button", { name: "修改密码并退出" }).click();
        await expect(page.locator("#login-form")).toBeVisible();
        await page.getByLabel("管理台密码", { exact: true }).fill(original);
        await page.getByRole("button", { name: /进入管理台/ }).click();
        await expect(page.locator("#login-form .error")).toHaveText("密码不正确，请重试。 (INVALID_CREDENTIALS)");
        await page.getByLabel("管理台密码", { exact: true }).fill(next);
        await page.getByRole("button", { name: /进入管理台/ }).click();
        await expect(page.getByRole("link", { name: "设置", exact: true })).toBeVisible();
    } finally {
        // The isolated API fixture works even if a browser assertion failed or
        // its session was revoked. Do not depend on a UI-set success flag:
        // the password mutation may have committed before the assertion failed.
        const login = await request.post("/api/login", { headers, data: { password: next } });
        if (login.status() === 200) {
            const restored = await request.post("/api/auth/password", {
                headers,
                data: { current_password: next, new_password: original },
            });
            expect(restored.status(), "restore original password after security test").toBe(200);
        } else {
            // A failure before rotation must still leave the original usable.
            expect(login.status(), "cleanup login status").toBe(401);
        }
        const verified = await request.post("/api/login", { headers, data: { password: original } });
        expect(verified.status(), "original password remains usable by subsequent specs").toBe(200);
        const logout = await request.post("/api/logout", { headers });
        expect(logout.status()).toBe(200);
    }
});

test("active usage and bounded hourly/day trends", async ({ page }) => {
    await expect(page.getByText("活跃会话", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "24 小时", exact: true })).toHaveAttribute("aria-pressed", "true");
    const response = page.waitForResponse(
        (r) => r.url().includes("/api/statistics?") && r.url().includes("granularity=day"),
    );
    await page.getByRole("button", { name: "7 天", exact: true }).click();
    const result = await (await response).json();
    expect(result.buckets).toHaveLength(7);
    await expect(page.getByRole("button", { name: "7 天", exact: true })).toHaveAttribute("aria-pressed", "true");
});
