const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("#password").fill("rsstt-local-preview");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#main")).toBeVisible();
});

test("English workflows, persistent locale and unchanged user content", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.locator("#language").selectOption("en");
    await expect(page.getByRole("heading", { name: "Your feeds at a glance." })).toBeVisible();
    await page.getByRole("link", { name: "Chats & channels", exact: true }).click();
    await page.getByPlaceholder("Search name, username or ID").fill("技术");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("技术与创造");
    await page.getByRole("button", { name: "Manage subscriptions", exact: true }).click();
    await page.getByPlaceholder("Search name or URL").fill("Hacker");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page).toHaveURL(/target=-1001001/);
    await expect(page).toHaveURL(/q=Hacker/);
    await page.reload();
    await expect(page.getByPlaceholder("Search name or URL")).toHaveValue("Hacker");
    await page.getByRole("button", { name: /Edit Hacker/ }).click();
    await expect(page.getByRole("heading", { name: "Subscription settings" })).toBeVisible();
    await page.getByRole("textbox", { name: "Custom title" }).fill("中文标题保持原样");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByPlaceholder("Search name or URL").fill("中文标题保持原样");
    await expect(page.locator("tbody")).toContainText("中文标题保持原样");
    await page.getByRole("button", { name: /Edit 中文标题/ }).click();
    await page.getByRole("textbox", { name: "Custom title" }).fill("");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection access", exact: true }).click();
    await page.getByRole("button", { name: "Create access token", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Token name" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#theme").selectOption("dark");
    await page.reload();
    await expect(page.locator("#theme")).toHaveValue("dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Connection access" })).toBeVisible();
    await page.screenshot({ path: "test-results/english-settings.png", fullPage: true });
    expect(errors).toEqual([]);
});

test("destination picker, pagination, safe error fallback and keyboard navigation", async ({ page }) => {
    await page.goto("/#subscriptions?page=2");
    await expect(page.locator(".pager")).toContainText("第 2 /");
    await page.reload();
    await expect(page.locator(".pager")).toContainText("第 2 /");
    await page.getByRole("button", { name: "选择目的地", exact: true }).click();
    await page
        .locator("#target-picker")
        .getByRole("radio", { name: /技术与创造/ })
        .check();
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.locator(".pager")).toContainText("第 1 /");
    await expect(page.getByRole("link", { name: "导出 OPML" })).toHaveAttribute("href", "/api/targets/-1001001/opml");
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
        };
    });
    expect(data.copy).toBe("<p>Manage subscriptions 管理订阅</p>");
    expect(data.one).toBe("1 subscription");
    expect(data.many).toBe("2 subscriptions");
    expect(data.error).toContain("(FORBIDDEN)");
    expect(data.error).not.toContain("private detail");
});
