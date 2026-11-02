const { test, expect } = require("@playwright/test");

async function login(page, language = "zh-CN") {
    const pub = await (await page.request.get("/api/public")).json();
    expect(pub.demo).toBe(true);
    expect(pub.snapshot).toBeFalsy();
    await page.addInitScript((value) => localStorage.setItem("rsstt.language", value), language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
}
async function subscription(page) {
    await page.goto("/#subscriptions");
    const button = page.locator("[data-sub-edit]").first();
    const id = await button.getAttribute("data-sub-edit");
    const all = (await (await page.request.get("/api/subscriptions?size=100")).json()).items;
    const item = all.find((entry) => String(entry.id) === id);
    await button.click();
    return item;
}
const dialog = (page) => page.getByRole("dialog");
const close = (page) => page.locator("#dialog .dialog-head [data-action=close]").click();
const logResult = { items: [], total: 0, page: 1, size: 20, retention: { days: 30, max_entries: 5000, per_feed: 100 } };

test("nested subscription tools preserve unsaved fields, expanded sections, focus and scroll", async ({ page }) => {
    await page.route("**/api/feeds/*/fetch-options", (route) => route.fulfill({ json: { user_agent: null } }));
    await page.route("**/api/feeds/*/diagnostics?*", (route) =>
        route.fulfill({ json: { ...logResult, feed: { id: "1", title: "Example", errors: 0 } } }),
    );
    await page.route("**/api/diagnostics?*", (route) => route.fulfill({ json: logResult }));
    await login(page);
    await subscription(page);
    const draft = '未保存的标题 <img src=x onerror="window.injected=true">';
    await dialog(page).locator('[name="title"]').fill(draft);
    await dialog(page).locator('[name="tags"]').fill("#keep-draft");
    await dialog(page).locator('[name="send_mode"]').selectOption("2");
    await dialog(page)
        .locator("details")
        .last()
        .evaluate((element) => {
            element.open = true;
        });
    const parentScroll = await dialog(page)
        .locator(".dialog-body")
        .evaluate((element) => {
            element.scrollTop = 140;
            return element.scrollTop;
        });
    await dialog(page)
        .locator("[data-feed-fetch]")
        .evaluate((element) => element.click());
    await expect(dialog(page).locator(".dialog-back")).toContainText("返回订阅设置");
    await dialog(page).locator('[name="user_agent"]').fill("Preview-Agent/1.0");
    await dialog(page).getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("订阅设置");
    await expect(dialog(page).locator('[name="title"]')).toHaveValue(draft);
    await expect(dialog(page).locator('[name="tags"]')).toHaveValue("#keep-draft");
    await expect(dialog(page).locator('[name="send_mode"]')).toHaveValue("2");
    await expect(dialog(page).locator("details").last()).toHaveAttribute("open", "");
    expect(
        await dialog(page)
            .locator(".dialog-body")
            .evaluate((element) => element.scrollTop),
    ).toBe(parentScroll);
    await dialog(page).locator("[data-feed-logs]").click();
    await dialog(page).getByRole("button", { name: "全部相关运行日志", exact: true }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("相关运行日志");
    await page.keyboard.press("Escape");
    await expect(dialog(page).getByRole("heading")).toHaveText("订阅源抓取日志");
    await page.keyboard.press("Escape");
    await expect(dialog(page).getByRole("heading")).toHaveText("订阅设置");
    await expect(dialog(page).locator('[name="title"]')).toHaveValue(draft);
    await expect(dialog(page).locator("[data-feed-logs]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).not.toBeVisible();
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    await page.unrouteAll({ behavior: "wait" });
});

test("chat role save and imported results return to the original chat draft", async ({ page }) => {
    await login(page);
    const original = (await (await page.request.get("/api/targets?q=10002")).json()).items.find(
        (item) => item.id === "10002",
    );
    await page.route("**/api/targets/10002/role", (route) => route.fulfill({ json: { ...original, role: "guest" } }));
    await page.route("**/api/targets/10002/opml", (route) =>
        route.fulfill({ json: { results: [{ url: "https://example.invalid/rss", status: "added" }] } }),
    );
    await page.goto("/#targets");
    await page.locator('[data-target-edit="10002"]').click();
    await dialog(page).locator('[name="sub_limit"]').fill("1234");
    await dialog(page).getByRole("button", { name: "修改角色", exact: true }).click();
    await dialog(page).locator('[name="role"]').selectOption("guest");
    await dialog(page).getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(dialog(page)).toContainText("Bot 用户角色：访客");
    await expect(dialog(page).locator('[name="sub_limit"]')).toHaveValue("1234");
    await dialog(page).getByRole("button", { name: "导入 OPML", exact: true }).click();
    await dialog(page)
        .locator('input[type="file"]')
        .setInputFiles({
            name: "test.opml",
            mimeType: "text/xml",
            buffer: Buffer.from(
                '<opml version="2.0"><body><outline xmlUrl="https://example.invalid/rss"/></body></opml>',
            ),
        });
    await dialog(page).getByRole("button", { name: "导入订阅", exact: true }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("处理完成");
    await expect(dialog(page).locator(".dialog-back")).toContainText("返回会话设置");
    await page.keyboard.press("Escape");
    await expect(dialog(page).locator('[name="sub_limit"]')).toHaveValue("1234");
    await close(page);
    await page.unrouteAll({ behavior: "wait" });
});

test("removing the edited recipient retains a clearly invalid draft with saving disabled", async ({ page }) => {
    await login(page);
    const item = await subscription(page);
    await page.route(`**/api/feeds/${item.feed_id}/recipients`, (route) =>
        route.fulfill({
            json: {
                feed_id: item.feed_id,
                items: route.request().method() === "PUT" ? [] : [{ id: item.id, target: item.target }],
            },
        }),
    );
    await dialog(page).locator('[name="title"]').fill("draft to copy");
    await dialog(page).getByRole("button", { name: "管理接收会话", exact: true }).click();
    await dialog(page).locator('[name="mode"]').selectOption("replace");
    for (const checkbox of await dialog(page).locator('input[name="target-choice"]:checked').all())
        await checkbox.uncheck();
    await dialog(page).getByRole("button", { name: "保存接收会话", exact: true }).click();
    await expect(dialog(page)).toContainText("原订阅已不存在，无法继续保存");
    await expect(dialog(page).locator('[name="title"]')).toHaveValue("draft to copy");
    await expect(dialog(page).getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
    await close(page);
    await page.unrouteAll({ behavior: "wait" });
});

function mockManual(page, onPost, queued = false) {
    return page.route("**/api/subscriptions/*/fetch-now", async (route) => {
        if (route.request().method() === "GET")
            return route.fulfill({
                json: { available: true, simulated: false, affected_recipients: 3, modes: ["updates", "test_latest"] },
            });
        const body = route.request().postDataJSON();
        onPost(body);
        await route.fulfill({
            status: 202,
            json: {
                id: "job-1",
                status: queued ? "queued" : "completed",
                mode: body.mode,
                feed_id: "1",
                subscription_id: "1",
                target_id: "10002",
                simulated: false,
                affected_recipients: body.mode === "test_latest" ? 1 : 3,
                result: queued
                    ? null
                    : {
                          outcome: body.mode === "test_latest" ? "test_delivered" : "updated",
                          new_entries: 1,
                          push_status: body.mode === "test_latest" ? "confirmed" : "submitted",
                          affected_recipients: body.mode === "test_latest" ? 1 : 3,
                      },
            },
        });
    });
}

test("manual modes confirm recipient scope and distinguish submitted updates from confirmed test sending", async ({
    page,
}) => {
    const posts = [];
    await mockManual(page, (body) => posts.push(body));
    await login(page, "en");
    await subscription(page);
    await dialog(page).getByRole("button", { name: "Fetch now", exact: true }).click();
    await expect(dialog(page)).toContainText("3 enabled recipient chats");
    await expect(dialog(page).getByRole("button", { name: "Start task", exact: true })).toBeDisabled();
    await dialog(page).locator('[name="confirm_manual"]').check();
    await dialog(page).getByRole("button", { name: "Start task", exact: true }).click();
    await expect(dialog(page)).toContainText("Delivery is not yet confirmed");
    expect(posts).toEqual([{ mode: "updates", confirm: true }]);
    await dialog(page).getByRole("button", { name: "Choose another action", exact: true }).click();
    await dialog(page).locator('[name="mode"][value="test_latest"]').check();
    await expect(dialog(page)).toContainText("even if it was delivered before");
    await dialog(page).locator('[name="confirm_manual"]').check();
    await dialog(page).getByRole("button", { name: "Start task", exact: true }).click();
    await expect(dialog(page)).toContainText("Telegram confirmed that the message was fully sent");
    expect(posts[1]).toEqual({ mode: "test_latest", confirm: true });
    await close(page);
    await page.unrouteAll({ behavior: "wait" });
});

test("closing a queued manual task stops polling without claiming server cancellation", async ({ page }) => {
    let polls = 0;
    await mockManual(page, () => {}, true);
    await page.route("**/api/fetch-jobs/*", (route) => {
        polls++;
        return route.fulfill({ json: { id: "job-1", status: "running", mode: "updates", simulated: false } });
    });
    await login(page);
    await subscription(page);
    await dialog(page).getByRole("button", { name: "立即抓取", exact: true }).click();
    await dialog(page).locator('[name="confirm_manual"]').check();
    await dialog(page).getByRole("button", { name: "开始执行", exact: true }).click();
    await expect(dialog(page)).toContainText("不会取消已提交的任务");
    await expect.poll(() => polls).toBeGreaterThan(0);
    await close(page);
    const before = polls;
    await page.waitForTimeout(2300);
    expect(polls).toBe(before);
    await page.unrouteAll({ behavior: "wait" });
});

test("real offline demo task and asynchronous article refresh keep every Escape return visible", async ({ page }) => {
    await login(page);
    await page.goto("/#subscriptions?state=1");
    await page.locator("[data-sub-edit]").first().click();
    await dialog(page).locator('[name="title"]').fill("Real demo return draft");
    await dialog(page).getByRole("button", { name: "订阅源请求设置", exact: true }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("订阅源请求设置");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[name="title"]')).toBeVisible();
    await dialog(page).getByRole("button", { name: "最近文章", exact: true }).click();
    await expect(dialog(page).getByRole("button", { name: "刷新文章", exact: true })).toBeVisible();
    await dialog(page).getByRole("button", { name: "立即抓取", exact: true }).click();
    await expect(dialog(page)).toContainText("离线演示仅模拟抓取与推送");
    await dialog(page).locator('[name="mode"][value="test_latest"]').check();
    await dialog(page).locator('[name="confirm_manual"]').check();
    await dialog(page).getByRole("button", { name: "开始执行", exact: true }).click();
    await expect(dialog(page).locator(".manual-job .spread > strong")).toHaveText("任务已完成");
    expect(await dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    // A browser can lose focus during a native-dialog DOM replacement. Escape
    // must still navigate once when the key originates at document.body.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading")).toHaveText("最近文章");
    await expect(dialog(page).getByRole("button", { name: "刷新文章", exact: true })).toBeVisible();
    expect(await dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[name="title"]')).toBeVisible();
    await expect(dialog(page).locator('[name="title"]')).toHaveValue("Real demo return draft");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).not.toBeVisible();
});

test("recent articles show recipient-specific evidence, newer retry failure, and safe plain text on mobile", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockManual(page, () => {});
    const hostile = '<img src=x onerror="window.articleInjected=true">';
    await page.route("**/api/subscriptions/*/articles", (route) =>
        route.fulfill({
            json: {
                feed: { id: "1", title: hostile },
                target: { id: "10002", title: "Reader chat" },
                retention: { per_feed: 20, max_entries: 10000 },
                degraded: false,
                dropped: 0,
                items: [
                    {
                        id: "entry-1",
                        title: hostile,
                        summary: hostile,
                        link: "javascript:alert(1)",
                        fetched_at: "2026-10-29T01:00:00Z",
                        status: "sent",
                        last_sent_at: "2026-10-29T00:00:00Z",
                        last_attempt_at: "2026-10-29T01:00:00Z",
                        last_attempt_status: "failed",
                        source: "test",
                        detail: "RPC_ERROR",
                    },
                    {
                        id: "entry-2",
                        title: "No saved evidence",
                        summary: "Plain summary",
                        link: "https://example.invalid/article",
                        fetched_at: "2026-10-29T01:00:00Z",
                        status: "not_recorded",
                    },
                ],
            },
        }),
    );
    await login(page, "en");
    await subscription(page);
    await dialog(page).locator('[name="title"]').fill("Parent draft after async refresh");
    await dialog(page).getByRole("button", { name: "Recent articles", exact: true }).click();
    await expect(dialog(page)).toContainText("Reader chat");
    await expect(dialog(page)).toContainText("does not mean it was never delivered");
    const first = dialog(page).locator(".recent-article").first();
    await expect(first).toContainText("Delivered");
    await expect(first).toContainText("Latest attempt failed");
    await first.locator("summary").click();
    await expect(first.locator(".article-summary")).toHaveText(hostile);
    await expect(first).toContainText("Last successful delivery");
    await expect(first.locator("a")).toHaveCount(0);
    await expect(dialog(page).locator(".recent-article img")).toHaveCount(0);
    expect(await page.evaluate(() => window.articleInjected)).toBeUndefined();
    await dialog(page).locator(".recent-article").nth(1).locator("summary").click();
    await expect(dialog(page).getByRole("link", { name: "Open original" })).toHaveAttribute(
        "href",
        "https://example.invalid/article",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog(page).getByRole("button", { name: "Fetch now", exact: true }).click();
    await dialog(page).locator('[name="mode"][value="test_latest"]').check();
    await dialog(page).locator('[name="confirm_manual"]').check();
    await dialog(page).getByRole("button", { name: "Start task", exact: true }).click();
    await expect(dialog(page)).toContainText("Telegram confirmed that the message was fully sent");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading")).toHaveText("Recent articles");
    await expect(dialog(page).locator(".recent-article")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading")).toHaveText("Subscription settings");
    await expect(dialog(page).locator('[name="title"]')).toBeVisible();
    await expect(dialog(page).locator('[name="title"]')).toHaveValue("Parent draft after async refresh");
    await close(page);
    await page.unrouteAll({ behavior: "wait" });
});
