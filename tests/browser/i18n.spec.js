const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD || "rsstt-local-preview");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#main")).toBeVisible();
});

test("English workflows, persistent locale and unchanged user content", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.locator("#language").selectOption("en");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "Chats & channels", exact: true }).click();
    await page.getByPlaceholder("Search name, username or ID").fill("技术");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("技术与创造");
    await page.getByRole("button", { name: "Manage subscriptions", exact: true }).click();
    await page.getByPlaceholder("Search feed name or RSS URL").fill("Hacker");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page).toHaveURL(/target=-1001001/);
    await expect(page).toHaveURL(/q=Hacker/);
    await page.reload();
    await expect(page.getByPlaceholder("Search feed name or RSS URL")).toHaveValue("Hacker");
    await page.getByRole("button", { name: /Edit Hacker/ }).click();
    await expect(page.getByRole("heading", { name: "Subscription settings" })).toBeVisible();
    await page.getByRole("textbox", { name: "Subscription display name", exact: true }).fill("中文标题保持原样");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByPlaceholder("Search feed name or RSS URL").fill("中文标题保持原样");
    await expect(page.locator("tbody")).toContainText("中文标题保持原样");
    await page.getByRole("button", { name: /Edit 中文标题/ }).click();
    await page.getByRole("textbox", { name: "Subscription display name", exact: true }).fill("");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "API access tokens", exact: true }).click();
    await page.getByRole("button", { name: "Create token", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Token name" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#theme").selectOption("dark");
    await page.reload();
    await expect(page.locator("#theme")).toHaveValue("dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "API access tokens" })).toBeVisible();
    await page.screenshot({ path: "test-results/english-settings.png", fullPage: true });
    expect(errors).toEqual([]);
});

test("destination picker, pagination, safe error fallback and keyboard navigation", async ({ page }) => {
    await page.goto("/#subscriptions?page=2");
    await expect(page.locator(".pager")).toContainText("第 2 /");
    await page.reload();
    await expect(page.locator(".pager")).toContainText("第 2 /");
    await page.getByRole("button", { name: "按会话筛选", exact: true }).click();
    await page
        .locator("#target-picker")
        .getByRole("radio", { name: /技术与创造/ })
        .check();
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.locator(".pager")).toContainText("第 1 /");
    const features = (await (await page.request.get("/api/public")).json()).features;
    if (features?.recipients) {
        const href = await page.getByRole("link", { name: "导出筛选订阅源（OPML）", exact: true }).getAttribute("href");
        const url = new URL(href, page.url());
        expect(url.pathname).toBe("/api/subscriptions/opml");
        expect(url.searchParams.get("target")).toBe("-1001001");
    } else {
        await expect(page.getByRole("link", { name: "导出订阅源（OPML）" })).toHaveAttribute(
            "href",
            "/api/targets/-1001001/opml",
        );
    }
    await page.locator("#language").selectOption("en");
    await page.route("**/api/subscriptions?*", (r) =>
        r.fulfill({ status: 403, json: { error: "sensitive-debug-value", code: "scope_denied" } }),
    );
    await page.reload();
    await expect(page.locator(".page-error")).toContainText("You do not have permission");
    await expect(page.locator(".page-error")).toContainText("scope_denied");
    await expect(page.locator("body")).not.toContainText("sensitive-debug-value");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("long destination names and readable mobile settings in both themes", async ({ page }) => {
    await page.route("**/api/targets?*", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        data.items = data.items.map((i) => ({ ...i, title: "长名称验证·Very long destination name ".repeat(8) }));
        await r.fulfill({ response, json: data });
    });
    await page.goto("/#targets");
    await expect(page.locator("tbody tr")).not.toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["light", "dark"]) {
        await page.locator("#theme").selectOption(theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        const ratio = await page
            .locator(".feed-info strong")
            .first()
            .evaluate((el) => {
                const lum = (c) => {
                    const a = c
                        .match(/[\d.]+/g)
                        .slice(0, 3)
                        .map(Number)
                        .map((v) => {
                            v /= 255;
                            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                        });
                    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
                };
                const f = lum(getComputedStyle(el).color),
                    b = lum(getComputedStyle(el.closest(".panel")).backgroundColor);
                return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
            });
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "更新与订阅" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: "test-results/mobile-settings.png", fullPage: true });
});

test("account security follows the PR1 contract and signs out after password change", async ({ page }) => {
    // Contract fixture: the base branch does not yet contain PR1's auth routes.
    await page.route("**/api/session", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        await r.fulfill({ response, json: { ...data, account_type: "preview_admin" } });
    });
    await page.route("**/api/auth/account", (r) =>
        r.fulfill({ json: { username: "preview-admin", account_type: "preview_admin" } }),
    );
    await page.route("**/api/auth/sessions", (r) =>
        r.fulfill({
            json: { items: [{ id: "session-example", name: "preview-admin", created_at: 1, expires_at: 2 }] },
        }),
    );
    let submitted;
    await page.route("**/api/auth/password", (r) => {
        submitted = r.request().postDataJSON();
        return r.fulfill({ json: { ok: true } });
    });
    await page.goto("/#settings?section=security");
    await expect(page.getByRole("heading", { name: "账户安全" })).toBeVisible();
    await page.getByLabel("当前密码", { exact: true }).fill("old-test-password");
    await page.getByLabel("新密码", { exact: true }).fill("new-test-password-123");
    await page.getByRole("button", { name: "修改密码并退出" }).click();
    await expect(page.locator("#login-form")).toBeVisible();
    expect(submitted).toEqual({ current_password: "old-test-password", new_password: "new-test-password-123" });
});

test("static localization preserves user strings and uses plural rules and stable uppercase codes", async ({
    page,
}) => {
    await page.locator("#language").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const data = await page.evaluate(async () => {
        const m = await import("/assets/i18n.js");
        return {
            copy: m.html`<p>管理订阅 ${"管理订阅"}</p>`,
            one: m.count(1, "subscription"),
            many: m.count(2, "subscription"),
            error: m.errorText({ code: "FORBIDDEN", error: "private detail" }, 403),
            passwordError: m.errorText({ code: "CURRENT_PASSWORD_INCORRECT" }, 400),
            loginError: m.errorText({ code: "INVALID_CREDENTIALS" }, 401),
        };
    });
    expect(data.copy).toBe("<p>Manage subscriptions 管理订阅</p>");
    expect(data.one).toBe("1 subscription");
    expect(data.many).toBe("2 subscriptions");
    expect(data.error).toContain("(FORBIDDEN)");
    expect(data.error).not.toContain("private detail");
    expect(data.passwordError).toBe(
        "The current password is incorrect. Your password was not changed. (CURRENT_PASSWORD_INCORRECT)",
    );
    expect(data.loginError).toBe("Incorrect password. Try again. (INVALID_CREDENTIALS)");
});

test("overflow hint exposes mobile management actions and disappears when the table fits", async ({ page }) => {
    await page.goto("/#targets");
    await expect(page.locator("tbody tr")).not.toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const hint = page.getByText("↔ 左右滑动表格，查看右侧管理操作", { exact: true });
    await expect(hint).toBeVisible();
    const region = page.getByRole("region", { name: "可横向滚动的表格" });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
    });
    await expect(page.locator("[data-target-subs]").first()).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(hint).toBeHidden();
});

test("audit localization translates exact codes while preserving free-form details", async ({ page }) => {
    await page.route("**/api/dashboard", async (route) => {
        const response = await route.fetch(),
            data = await response.json();
        data.activity = [
            { action: "login", detail: "success", at: "2026-10-26T00:00:00Z" },
            { action: "创建API 访问令牌", detail: "success", at: "2026-10-26T00:00:00Z" },
            { action: "custom_action", detail: "登录成功", at: "2026-10-26T00:00:00Z" },
            { action: "sessions_revoked", detail: "all", at: "2026-10-26T00:00:00Z" },
        ];
        await route.fulfill({ response, json: data });
    });
    await page.goto("/#dashboard");
    await page.reload();
    const rows = page.locator(".activity-row");
    await expect(rows.nth(0)).toContainText("网页登录");
    await expect(rows.nth(0)).toContainText("登录成功");
    await expect(rows.nth(1).locator("small")).toHaveText("success");
    await expect(rows.nth(3)).toContainText("全部网页登录会话已撤销");
    await page.locator("#language").selectOption("en");
    await expect(rows.nth(0)).toContainText("Browser sign-in");
    await expect(rows.nth(0)).toContainText("Signed in successfully");
    await expect(rows.nth(1).locator("small")).toHaveText("success");
    await expect(rows.nth(2).locator("small")).toHaveText("登录成功");
});
