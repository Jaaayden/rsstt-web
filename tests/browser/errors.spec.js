const { test, expect } = require("@playwright/test");

test("banned subscriptions explain the reason and remedy in single and batch actions", async ({ page, baseURL }) => {
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#password")).toHaveCount(0);
    const target = "-1001002";
    const headers = { Origin: new URL(baseURL).origin };
    const original = await (await page.request.get(`/api/subscriptions?target=${target}&size=100`)).json();
    expect(original.items.length).toBeGreaterThan(0);
    const id = original.items[0].id;
    try {
        expect((await page.request.patch(`/api/targets/${target}/role`, { headers, data: { role: "banned" } })).status()).toBe(200);
        await page.goto(`/#subscriptions?target=${target}`);
        await page.locator(`[data-sub-toggle="${id}"]`).click();
        await expect(page.locator("#toast")).toContainText("该会话已被封禁，无法恢复订阅");
        await expect(page.locator("#toast")).toContainText("请先在会话设置中解除封禁");
        await expect(page.locator("#toast")).not.toContainText("数据已变化");
        await page.locator(`[data-select="${id}"]`).check();
        await page.locator('[data-batch="resume"]').click();
        await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
        await expect(page.locator(".result-list")).toContainText("该会话已被封禁，无法恢复订阅");
        await page.keyboard.press("Escape");
        await page.locator("#language").selectOption("en");
        await page.locator(`[data-sub-toggle="${id}"]`).click();
        await expect(page.locator("#toast")).toContainText("This chat is banned");
        await expect(page.locator("#toast")).toContainText("Unban it");
        const after = await (await page.request.get(`/api/subscriptions?target=${target}&size=100`)).json();
        expect(after.items.every(item => item.state === 0)).toBeTruthy();
    } finally {
        expect((await page.request.patch(`/api/targets/${target}/role`, { headers, data: { role: "user" } })).status()).toBe(200);
        for (const sub of original.items) {
            expect((await page.request.patch(`/api/subscriptions/${sub.id}`, { headers, data: { state: sub.state } })).status()).toBe(200);
        }
    }
});

test("business errors preserve actionable details and hide unknown internal data", async ({ page }) => {
    await page.goto("/");
    const data = await page.evaluate(async () => {
        const { errorText } = await import("/assets/i18n.js");
        const { businessError } = await import("/assets/error-messages.js");
        return {
            validation: errorText({ code: "INVALID_REQUEST", error: "更新间隔不能小于 10 分钟。" }, 400),
            offline: errorText({ code: "CONFLICT", error: "离线预览使用快照中的会话名称，无法实时同步 Telegram 名称与权限。" }, 409),
            unknown: errorText({ code: "CONFLICT", error: "private-secret-do-not-show" }, 409),
            internal: errorText({ code: "INTERNAL_ERROR", error: "更新间隔不能小于 10 分钟。" }, 500),
            english: businessError({ error: "更新间隔不能小于 10 分钟。" }, "en"),
            untrustedField: businessError({ error: "private-secret必须是整数。" }, "zh-CN"),
        };
    });
    expect(data.validation).toContain("不能小于 10 分钟");
    expect(data.offline).toContain("离线预览");
    expect(data.unknown).not.toContain("private-secret");
    expect(data.unknown).not.toContain("刷新");
    expect(data.internal).not.toContain("10");
    expect(data.english).toContain("at least 10 minutes");
    expect(data.untrustedField).toBeNull();
});
