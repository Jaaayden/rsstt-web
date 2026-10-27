const { test, expect } = require("@playwright/test");
const { loginFeature } = require("./support/live");
test("live API: notification configuration, masked credentials and offline queue", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await loginFeature(page, "notifications", "/#settings?section=notifications");
    await expect(page.getByText("离线模式仅模拟，不会外连。", { exact: true })).toBeVisible();
    const configBefore = await (await page.request.get("/api/notifications")).json();
    expect(configBefore.offline).toBe(true);
    await page.locator("#notification-form input[name=enabled]").check();
    const previous = await page.locator("#notification-form").elementHandle();
    await page.getByRole("button", { name: "保存通知策略", exact: true }).click();
    await page.waitForFunction((el) => !el.isConnected, previous);
    await page.locator('[data-notify-channel="webhook"]').click();
    await page.locator("#dialog input[name=url]").fill("https://example.invalid/secret");
    await page.getByRole("dialog").getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator('[data-notify-test="webhook"]')).toHaveText("模拟测试");
    await page.locator('[data-notify-channel="webhook"]').click();
    await expect(page.locator("#dialog input[name=url]")).toHaveValue("");
    await page.keyboard.press("Escape");
    await page.locator('[data-notify-test="webhook"]').click();
    await page.getByRole("dialog").locator(".dialog-footer button[type=submit]").click();
    await expect
        .poll(async () =>
            (await (await page.request.get("/api/notifications/history")).json()).items.some(
                (j) => j.channel === "webhook" && j.status === "simulated",
            ),
        )
        .toBe(true);
    const config = await (await page.request.get("/api/notifications")).text();
    expect(config).not.toContain("secret");
    expect(errors).toEqual([]);
});
