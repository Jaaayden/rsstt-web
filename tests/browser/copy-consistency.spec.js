const { test, expect } = require("@playwright/test");

async function login(page, language = "zh-CN") {
    await page.addInitScript((language) => localStorage.setItem("rsstt.language", language), language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
}

test("complete English copy distinguishes filters, receiving chats, token scope, and application stages", async ({
    page,
}) => {
    await login(page, "en");
    await page.goto("/#subscriptions");
    await page.getByRole("button", { name: "Filter by chat", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("Filter by chat");
    await expect(page.getByLabel("Choose a chat to view its subscriptions", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator('[data-action="new-sub"]').click();
    await expect(page.getByLabel("Choose a receiving chat", { exact: true })).toBeVisible();
    await expect(page.locator("select[name=send_mode]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/#settings?section=tokens");
    await page.getByRole("button", { name: "Create token", exact: true }).click();
    await expect(page.getByLabel("Choose chats this token can access", { exact: true })).toBeVisible();
    await expect(page.locator("select[name=permission] option")).toHaveText([
        "Read subscriptions",
        "Read & modify subscriptions",
    ]);
    await expect(page.getByRole("dialog")).not.toContainText("Selectallowed");
    await page.keyboard.press("Escape");
    await page.goto("/#targets");
    await page.locator("[data-target-edit]").first().click();
    await expect(page.locator('select[name="lang"] option[value="el"]')).toHaveText("Greek");
    await expect(page.locator('select[name="lang"] option[value="ta"]')).toHaveText("Tamil");
    await expect(page.locator('select[name="lang"] option[value="uz"]')).toHaveText("Uzbek");
    expect(
        await page
            .locator('select[name="lang"] option')
            .evaluateAll((options) => options.every((option) => option.textContent.trim().length > 0)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.goto("/#settings?section=runtime");
    await expect(page.locator("thead")).toContainText("Current process value");
    await expect(page.locator("thead")).toContainText("Saved value for next start");
    await page.locator('[data-runtime-edit="HTTP_TIMEOUT"]').click();
    await expect(page.getByRole("dialog")).toContainText("HTTP request timeout (seconds)");
    await expect(page.getByRole("dialog")).toContainText("This is not a feed check interval or delivery delay.");
    await expect(page.getByRole("dialog")).toContainText("This page does not restart the service.");
    await page.keyboard.press("Escape");
    await page.goto("/#settings?section=notifications");
    await expect(
        page.getByLabel("Notify me when a new user, group, or channel starts using the bot", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Minimum interval between repeat alerts (seconds)", { exact: true })).toBeVisible();
    await page.goto("/#settings?section=backups");
    await expect(
        page.getByText(
            "Back up subscriptions, chats, and console data. Validate a backup, then schedule a restore on the next restart.",
            { exact: true },
        ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate backup", exact: true })).toBeVisible();
    await expect(page.locator("#main")).not.toContainText("Stage restore");
});

for (const language of ["zh-CN", "en"]) {
    test(`desktop chat management actions fit the visible table with long names: ${language}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        // The request still reaches the real API. Synthetic titles stress only layout,
        // leaving filtering/authorization semantics to the live API tests.
        await page.route("**/api/targets?*", async (route) => {
            const response = await route.fetch();
            const data = await response.json();
            if (new URL(route.request().url()).searchParams.get("size") === "50")
                return route.fulfill({ response, json: data });
            await route.fulfill({
                response,
                json: {
                    ...data,
                    items: data.items.map((item) => ({
                        ...item,
                        title: "LongUnbrokenChatNameForDesktopVisibilityAnd中文长名称".repeat(3),
                    })),
                },
            });
        });
        await login(page, language);
        await page.goto("/#targets");
        await expect(page.locator(".chat-table tbody tr")).not.toHaveCount(0);
        const geometry = await page.locator(".chat-table").evaluate((table) => {
            const wrap = table.closest(".table-wrap");
            const right = wrap.getBoundingClientRect().right;
            return {
                overflow: wrap.scrollWidth - wrap.clientWidth,
                right,
                actions: [...table.querySelectorAll(".table-actions button")].map((button) => ({
                    left: button.getBoundingClientRect().left,
                    right: button.getBoundingClientRect().right,
                })),
                padding: getComputedStyle(document.querySelector(".filter-help")).paddingLeft,
            };
        });
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.actions.length).toBeGreaterThan(0);
        for (const box of geometry.actions) expect(box.right).toBeLessThanOrEqual(geometry.right + 1);
        expect(parseFloat(geometry.padding)).toBeGreaterThanOrEqual(14);
        await expect(page.locator('[data-action="register"]')).toHaveText(
            language === "en" ? "Add an existing chat" : "添加已有会话",
        );
    });
}
