const { test, expect } = require("@playwright/test");

async function login(page, language = "zh-CN") {
    const pub = await (await page.request.get("/api/public")).json();
    expect(pub.demo, "仅对独立离线演示执行浏览器测试").toBe(true);
    expect(pub.snapshot, "不得修改真实数据快照").toBeFalsy();
    expect(pub.features.chat_activity).toBe(true);
    await page.addInitScript((value) => localStorage.setItem("rsstt.language", value), language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
    await page.goto("/#targets");
}

async function openActivity(page, id = "10002") {
    if (await page.getByRole("dialog").isVisible())
        await page.locator("#dialog .dialog-head [data-action=close]").click();
    await page.locator(`[data-target-edit="${id}"]`).click();
    await page.locator(`[data-target-activity="${id}"]`).click();
}

test("live API: service control blocks and pauses without leaving, preserves settings, and records the changes", async ({
    page,
    baseURL,
}) => {
    await login(page);
    const id = "-1001002",
        headers = { Origin: new URL(baseURL).origin };
    const original = (await (await page.request.get("/api/targets?visibility=all&size=100")).json()).items.find(
        (item) => item.id === id,
    );
    const subscriptions = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
    expect(subscriptions.some((sub) => sub.state === 1)).toBe(true);
    try {
        // The deployment manager cannot be blocked through the new shortcut.
        await page.locator('[data-target-edit="1"]').click();
        await expect(page.locator("[data-stop-service]")).toHaveCount(0);
        await expect(page.getByRole("dialog")).toContainText("机器人管理者受保护");
        await page.keyboard.press("Escape");
        await page.locator(`[data-target-edit="${id}"]`).click();
        await expect(page.getByRole("heading", { name: "服务控制", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "推送默认值", exact: true })).toBeVisible();
        await expect(page.getByRole("dialog")).toContainText("有启用订阅");
        await page.locator(`[data-stop-service="${id}"]`).click();
        await expect(page.getByRole("dialog")).toContainText("暂停全部订阅并拒绝常规命令");
        await expect(page.getByRole("dialog")).toContainText("不会自动让机器人退出群组或频道");
        await page.getByRole("button", { name: "确认停止服务并封禁", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("heading", { name: "服务控制", exact: true })).toBeVisible();
        await page.locator("#dialog .dialog-head [data-action=close]").click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(page.locator("#toast")).toContainText("可切换到“已封禁”查看");
        await expect(page.locator(`[data-target-edit="${id}"]`)).toHaveCount(0);
        const stopped = (await (await page.request.get("/api/targets?visibility=banned&size=100")).json()).items.find(
            (item) => item.id === id,
        );
        expect(stopped.role).toBe("banned");
        expect(stopped.membership).toBe(original.membership);
        expect(stopped.options).toEqual(original.options);
        const paused = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
        expect(paused.map((sub) => sub.id)).toEqual(subscriptions.map((sub) => sub.id));
        expect(paused.every((sub) => sub.state === 0)).toBe(true);
        const history = await (await page.request.get(`/api/targets/${id}/activity?page=1&size=20`)).json();
        const event = history.items.find((item) => item.action === "role.update");
        expect(event.source).toBe("web");
        expect(event.outcome).toBe("completed");
        expect(event.changes.some((change) => change.field === "state" && change.after === -1)).toBe(true);

        await page.locator("#visibility-filter").selectOption("banned");
        await openActivity(page, id);
        await expect(page.locator(".chat-activity-entry").first()).toContainText("Bot 用户角色");
        await page.locator(".chat-activity-entry").first().locator("summary").click();
        await expect(page.locator(".chat-activity-entry").first().locator(".change-table")).toContainText("已封禁");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("dialog")).toContainText("解除封禁后不会自动恢复订阅");
        await page.locator(`[data-role-target="${id}"]`).click();
        await page.locator("select[name=role]").selectOption(original.role);
        await page.getByRole("button", { name: "保存角色", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("heading", { name: "服务控制", exact: true })).toBeVisible();
        await page.locator("#dialog .dialog-head [data-action=close]").click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(page.locator("#toast")).toContainText("订阅仍保持暂停");
        expect(
            (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items.every(
                (sub) => sub.state === 0,
            ),
        ).toBe(true);
    } finally {
        expect(
            (await page.request.patch(`/api/targets/${id}/role`, { headers, data: { role: original.role } })).status(),
        ).toBe(200);
        for (const sub of subscriptions)
            expect(
                (
                    await page.request.patch(`/api/subscriptions/${sub.id}`, { headers, data: { state: sub.state } })
                ).status(),
            ).toBe(200);
    }
});

test("chat activity safely renders known labels, opaque codes, API sources, setting changes, and pagination on mobile", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const hostile = '<img src=x onerror="window.auditInjected=true">',
        pages = [];
    await page.route("**/api/targets/10002/activity?*", async (route) => {
        const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"));
        pages.push(pageNumber);
        await route.fulfill({
            json: {
                page: pageNumber,
                size: 20,
                total: 21,
                degraded: false,
                items:
                    pageNumber === 1
                        ? [
                              {
                                  id: 3,
                                  at: "2026-10-27T12:00:00Z",
                                  source: "agent",
                                  actor: hostile,
                                  action: "settings.update",
                                  outcome: "completed",
                                  changes: [
                                      { entity: "subscription", id: 9, field: "state", before: 1, after: 0 },
                                      { entity: "user", field: "membership", before: "joined", after: "available" },
                                      { entity: "user", field: hostile, before: hostile, after: "正常提示" },
                                  ],
                                  truncated: true,
                              },
                              {
                                  id: 2,
                                  at: "2026-10-27T11:00:00Z",
                                  source: "bot",
                                  actor: "10002",
                                  action: "callback.unknown_未来功能",
                                  outcome: "denied",
                                  changes: [],
                              },
                              {
                                  id: 1,
                                  at: "2026-10-27T10:00:00Z",
                                  source: "web",
                                  actor: "administrator",
                                  action: "添加订阅",
                                  outcome: "error",
                                  changes: [],
                              },
                          ]
                        : [],
            },
        });
    });
    await login(page, "en");
    await openActivity(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toContainText("Chat activity");
    await expect(dialog).toContainText("Ordinary chat messages and secrets are not recorded");
    const entries = page.locator(".chat-activity-entry");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toContainText("API");
    await expect(entries.nth(0)).toContainText("Completed");
    await expect(entries.nth(1)).toContainText("Denied");
    await expect(entries.nth(1)).toContainText("callback.unknown_未来功能");
    // Unknown action codes and field/value text are opaque, even if they match UI copy.
    await expect(entries.nth(2).locator("strong")).toHaveText("添加订阅");
    await expect(entries.nth(2)).toContainText("Failed");
    await entries.nth(0).locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(entries.nth(0).locator("details")).toHaveAttribute("open", "");
    await expect(entries.nth(0).locator(".change-table")).toContainText("Enabled");
    await expect(entries.nth(0).locator(".change-table")).toContainText("Paused");
    await expect(entries.nth(0)).toContainText("Joined; sending access unverified");
    await expect(entries.nth(0)).toContainText("正常提示");
    await expect(entries.nth(0)).toContainText(hostile);
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => window.auditInjected)).toBeUndefined();
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog).toContainText("No activity recorded for this chat yet");
    expect(pages).toEqual([1, 2]);
    await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(entries).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(dialog.locator("[data-target-activity]")).toBeVisible();
    await dialog.locator(".dialog-head [data-action=close]").click();
    await expect(dialog).not.toBeVisible();
});

test("chat activity distinguishes empty history, unavailable storage, and retryable request errors", async ({
    page,
}) => {
    let mode = "empty";
    await page.route("**/api/targets/10002/activity?*", async (route) => {
        if (mode === "error")
            return route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", error: "internal-secret" } });
        await route.fulfill({
            json: { items: [], total: 0, page: 1, size: 20, degraded: mode === "degraded" },
        });
    });
    await login(page);
    await openActivity(page);
    await expect(page.getByRole("dialog")).toContainText("尚无此会话的操作记录");
    await expect(page.getByRole("dialog")).toContainText("升级前的交互和设置变更无法从旧日志补回");
    await expect(page.locator("[data-activity-page]").first()).toBeDisabled();
    await expect(page.locator("[data-activity-page]").nth(1)).toBeDisabled();
    await page.keyboard.press("Escape");
    mode = "degraded";
    await openActivity(page);
    await expect(page.getByRole("dialog")).toContainText("会话记录存储暂不可用");
    await expect(page.getByRole("dialog")).toContainText("当前没有可显示的会话记录");
    await page.keyboard.press("Escape");
    mode = "error";
    await openActivity(page);
    await expect(page.getByRole("dialog")).toContainText("服务暂不可用");
    await expect(page.getByRole("dialog")).not.toContainText("internal-secret");
    mode = "empty";
    await page.getByRole("button", { name: "重试加载记录", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("尚无此会话的操作记录");
});

test("joined membership and first-use notifications explain the actual evidence and delivery prerequisites", async ({
    page,
}) => {
    await page.route("**/api/targets?*", async (route) => {
        const response = await route.fetch(),
            data = await response.json();
        await route.fulfill({
            response,
            json: {
                ...data,
                items: data.items.map((item) =>
                    item.id === "10002" ? { ...item, membership: "joined", active_subscriptions: 0 } : item,
                ),
            },
        });
    });
    await login(page, "en");
    const row = page.locator('[data-target-edit="10002"]').locator("xpath=ancestor::tr");
    await expect(row).toContainText("Joined; sending access unverified");
    await expect(row).toContainText("State updated:");
    await expect(row).toContainText("0 enabled");
    await page.locator('[data-target-edit="10002"]').click();
    await expect(page.getByRole("dialog")).toContainText("No enabled subscriptions yet");
    await expect(page.locator('[data-stop-service="10002"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/#settings?section=notifications");
    await expect(page.getByLabel("Notify me about new chat access attempts", { exact: true })).toBeVisible();
    await expect(page.locator("#notification-form")).toContainText("first private interaction");
    await expect(page.locator("#notification-form")).toContainText("Denied new access attempts");
    await expect(page.locator("#notification-form")).toContainText("at least one notification channel");
});
