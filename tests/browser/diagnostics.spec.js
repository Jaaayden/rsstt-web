const { test, expect } = require("@playwright/test");

const recordedAt = "2026-10-28T09:00:00Z";
const retention = { days: 30, max_entries: 5000, per_feed: 100 };
const result = (items, extra = {}) => ({
    items,
    page: 1,
    size: 30,
    total: items.length,
    retention,
    started_at: recordedAt,
    degraded: false,
    dropped: 0,
    ...extra,
});
const failure = (extra = {}) => ({
    id: 2,
    at: recordedAt,
    category: "fetch",
    level: "error",
    code: "fetch.failed",
    message: "订阅源抓取失败。",
    detail: "HTTP 403",
    feed_id: "1",
    target_id: null,
    context: {
        http_status: 403,
        duration_ms: 250,
        failures: 40,
        next_retry_at: "2026-10-28T12:00:00Z",
        source_host: "rss.example.test",
        stage: "request",
        status: "failed",
    },
    ...extra,
});

async function login(page, language = "zh-CN") {
    const pub = await (await page.request.get("/api/public")).json();
    expect(pub.demo, "只允许在独立离线演示运行").toBe(true);
    expect(pub.snapshot, "不得修改真实快照").toBeFalsy();
    await page.route("**/api/public", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        await route.fulfill({ response, json: { ...data, features: { ...data.features, diagnostics: true } } });
    });
    await page.addInitScript((value) => localStorage.setItem("rsstt.language", value), language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
}

test("runtime logs show actionable causes, filter and paginate, and safely render technical data on mobile", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = [];
    const hostile = '<img src=x onerror="window.logInjected=true">';
    await page.route("**/api/diagnostics?*", async (route) => {
        const params = new URL(route.request().url()).searchParams;
        requests.push(Object.fromEntries(params));
        const pageNumber = Number(params.get("page"));
        await route.fulfill({
            json: result(
                [
                    failure({
                        detail: hostile,
                        feed_title: hostile,
                        target_id: "10002",
                        target_title: hostile,
                        context: { ...failure().context, source_host: hostile },
                    }),
                    failure({ id: 1, level: "info", code: "fetch.recovered", context: { status: "recovered" } }),
                ],
                { page: pageNumber, total: 31, degraded: true, dropped: 3 },
            ),
        });
    });
    await login(page, "en");
    await page.goto("/#diagnostics?feed_id=1");
    await expect(page.locator("h1")).toHaveText("Runtime logs");
    const entry = page.locator(".diagnostic-entry").first();
    await expect(entry).toContainText("The source refused access");
    await expect(entry).toContainText("HTTP 403");
    await expect(entry).toContainText("40 consecutive fetch failures");
    await expect(entry).toContainText("Scheduled retry");
    await expect(page.locator("#main")).toContainText("Log storage is temporarily unavailable");
    await expect(page.locator("#main")).toContainText("3 records were not saved");
    await entry.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(entry.locator(".diagnostic-context")).toContainText("Request feed");
    await expect(entry.locator(".diagnostic-context")).toContainText(hostile);
    await expect(entry.locator("pre")).toHaveText(hostile);
    await expect(entry.locator(".diagnostic-facts")).toContainText(hostile);
    await expect(page.locator(".diagnostic-entry img")).toHaveCount(0);
    expect(await page.evaluate(() => window.logInjected)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#log-category").selectOption("fetch");
    await page.locator("#log-level").selectOption("error");
    await expect
        .poll(() => requests.at(-1))
        .toMatchObject({ feed_id: "1", category: "fetch", level: "error", page: "1" });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.page).toBe("2");
    await page.getByRole("button", { name: "Refresh logs", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Runtime logs");
    await page.getByRole("button", { name: "Clear log filters", exact: true }).click();
    await expect.poll(() => requests.at(-1)).toEqual({ page: "1", size: "30" });
    await page.unrouteAll({ behavior: "wait" });
});

test("a legacy failure count without saved history is explained without inventing causes", async ({ page }) => {
    await page.route("**/api/feeds/*/diagnostics?*", async (route) => {
        await route.fulfill({
            json: result([], {
                size: 20,
                feed: { id: "1", title: "Legacy feed", errors: 40, state: 1, next_check_time: null },
            }),
        });
    });
    await login(page, "en");
    await page.goto("/#subscriptions");
    await page.locator("[data-feed-logs]").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("40 consecutive fetch failures");
    await expect(dialog).toContainText("the original causes were not saved");
    await expect(dialog).toContainText("No deferred retry time is recorded");
    await expect(dialog.locator(".diagnostic-entry")).toHaveCount(0);
    await expect(dialog).not.toContainText("HTTP 403");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
});

test("fetch log loading can retry and opens the feed's related runtime logs", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/feeds/*/diagnostics?*", async (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3];
        attempts++;
        if (attempts === 1)
            return route.fulfill({ status: 503, json: { error: "Unavailable", code: "REQUEST_FAILED" } });
        await route.fulfill({
            json: result([failure()], {
                size: 20,
                feed: { id, title: "Example feed", errors: 40, state: 1, next_check_time: "2026-10-28T12:00:00Z" },
            }),
        });
    });
    await page.route("**/api/diagnostics?*", async (route) => route.fulfill({ json: result([failure()]) }));
    await login(page);
    await page.goto("/#subscriptions");
    const sourceId = await page.locator("[data-feed-logs]").first().getAttribute("data-feed-logs");
    await page.locator("[data-feed-logs]").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert").first()).toBeVisible();
    await dialog.getByRole("button", { name: "重新加载抓取日志", exact: true }).click();
    await expect(dialog).toContainText("来源拒绝访问");
    await expect(dialog.locator(".diagnostic-entry")).toContainText("HTTP 403");
    await dialog.getByRole("button", { name: "全部相关运行日志", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#diagnostics\\?feed_id=${sourceId}$`));
    await expect(page.locator("h1")).toHaveText("运行日志");
    await page.unrouteAll({ behavior: "wait" });
});

test("cache scheduling is labelled as a next check and chat logs retain their chat filter", async ({ page }) => {
    let chatFilter;
    await page.route("**/api/feeds/*/diagnostics?*", async (route) => {
        await route.fulfill({
            json: result(
                [
                    failure({
                        level: "info",
                        code: "fetch.not_modified",
                        context: { http_status: 304, next_check_at: "2026-10-28T12:00:00Z", status: "cached" },
                    }),
                ],
                {
                    size: 20,
                    feed: {
                        id: "1",
                        title: "Cache example",
                        errors: 0,
                        state: 1,
                        next_check_time: "2026-10-28T12:00:00Z",
                    },
                },
            ),
        });
    });
    await page.route("**/api/diagnostics?*", async (route) => {
        chatFilter = new URL(route.request().url()).searchParams.get("target_id");
        await route.fulfill({
            json: result([
                failure({
                    category: "delivery",
                    code: "delivery.rate_limited",
                    target_id: "10002",
                    target_title: "Reader chat",
                    context: { retry_after_seconds: 30, status: "pending" },
                }),
            ]),
        });
    });
    await login(page, "en");
    await page.goto("/#subscriptions");
    await page.locator("[data-feed-logs]").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Next check");
    await expect(dialog).not.toContainText("Scheduled retry");
    await page.keyboard.press("Escape");
    await page.goto("/#targets");
    await page.locator('[data-target-edit="10002"]').click();
    await dialog.locator('[data-target-logs="10002"]').click();
    await expect(page.locator("h1")).toHaveText("Runtime logs");
    await expect.poll(() => chatFilter).toBe("10002");
    await expect(page.locator(".diagnostic-entry")).toContainText("Reader chat");
    await page.locator(".diagnostic-entry summary").click();
    await expect(page.locator(".diagnostic-context")).toContainText("Retry after");
    await expect(page.locator(".diagnostic-context")).toContainText("30 s");
    await page.unrouteAll({ behavior: "wait" });
});
