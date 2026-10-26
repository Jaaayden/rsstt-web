const { test, expect } = require("@playwright/test");
// These are UI contract tests. Actual cross-PR backend tests run after composition.
test.beforeEach(async ({ page }) => {
    await page.route("**/api/public", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        await r.fulfill({
            response,
            json: {
                ...data,
                features: {
                    security: true,
                    runtime: true,
                    notifications: true,
                    backups: true,
                    recipients: true,
                    statistics: true,
                },
            },
        });
    });
    await page.route("**/api/session", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        await r.fulfill({ response, json: { ...data, account_type: "preview_admin" } });
    });
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD || "rsstt-local-preview");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#main")).toBeVisible();
});

test("source recipients, filtered export and global User-Agent inheritance", async ({ page }) => {
    await page.route("**/api/subscriptions?*", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        await r.fulfill({ response, json: { ...data, items: data.items.map((i) => ({ ...i, feed_id: 777 })) } });
    });
    let recipients, fetchOptions;
    await page.route("**/api/feeds/777/recipients", (r) => {
        if (r.request().method() === "PUT") recipients = r.request().postDataJSON();
        return r.fulfill({ json: { feed_id: 777, scope: "all", items: [{ target: "-1001001" }] } });
    });
    await page.route("**/api/feeds/777/fetch-options", (r) => {
        if (r.request().method() === "PATCH") fetchOptions = r.request().postDataJSON();
        return r.fulfill({ json: { feed_id: 777, user_agent: null, inherits_global: true } });
    });
    await page.goto("/#subscriptions?q=Hacker");
    await expect(page.getByRole("link", { name: "导出筛选结果" })).toHaveAttribute("href", /q=Hacker/);
    await page.locator("[data-sub-edit]").first().click();
    await page.getByRole("button", { name: "接收目的地", exact: true }).click();
    await expect(page.locator('input[value="-1001001"]')).toBeChecked();
    await page.locator('input[value="1"]').check();
    await page.getByRole("button", { name: "保存接收目的地" }).click();
    expect(recipients).toEqual({ mode: "append", targets: ["-1001001", "1"] });
    await page.locator("[data-sub-edit]").first().click();
    await page.getByRole("button", { name: "来源抓取设置" }).click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    expect(fetchOptions).toEqual({ user_agent: null });
});

test("hourly statistics distinguish unavailable, partial and known zero", async ({ page }) => {
    await page.route("**/api/dashboard", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        const kinds = { private: 1, channel: 1, group: 0, unknown: 1, total: 3 };
        await r.fulfill({
            response,
            json: { ...data, usage: { known: kinds, active: kinds, active_subscriptions: 3 } },
        });
    });
    let granularity;
    await page.route("**/api/statistics?*", (r) => {
        granularity = new URL(r.request().url()).searchParams.get("granularity");
        return r.fulfill({
            json: {
                available: true,
                timezone: "UTC",
                granularity,
                buckets: [
                    { start: "2026-10-26T01:00:00Z", availability: "unavailable", fetched: null, delivered: null },
                    { start: "2026-10-26T02:00:00Z", availability: "available", fetched: 0, delivered: 0 },
                    { start: "2026-10-26T03:00:00Z", availability: "partial", fetched: 2, delivered: 3 },
                ],
            },
        });
    });
    await page.goto("/#dashboard");
    await page.reload();
    await expect(page.getByRole("img", { name: "按本地时间显示的统计趋势" })).toBeVisible();
    expect(granularity).toBe("hour");
    await page.getByText("查看统计数据", { exact: true }).click();
    const rows = page.locator(".chart-wrap tbody tr");
    await expect(rows.nth(0)).toContainText("—");
    await expect(rows.nth(1)).toContainText("0");
    await expect(rows.nth(2)).toContainText("部分");
    await page.getByRole("button", { name: "7 天", exact: true }).click();
    await expect.poll(() => granularity).toBe("day");
    await expect(page.getByRole("img", { name: "按 UTC 日聚合的统计趋势" })).toBeVisible();
    await expect(page.getByText("按 UTC 日聚合（00:00–24:00 UTC）", { exact: true })).toBeVisible();
    await page.getByText("查看统计数据", { exact: true }).click();
    await expect(page.locator(".chart-wrap tbody tr").first().locator("td").first()).toHaveText("2026/10/26 UTC");
    await page.screenshot({ path: "test-results/hourly-statistics.png", fullPage: true });
});

test("runtime configuration remains pending restart and hides stored secrets", async ({ page }) => {
    let patch;
    const data = {
        pending_restart: false,
        deployment_only: ["MANAGER", "WEB_PASSWORD"],
        items: [
            {
                key: "HTTP_TIMEOUT",
                type: "integer",
                min: 1,
                max: 300,
                sensitive: false,
                value: null,
                effective_value: "30",
                source: "deployment_or_default",
                pending_restart: false,
            },
            {
                key: "TOKEN",
                type: "string",
                sensitive: true,
                configured: true,
                effective_configured: true,
                source: "web",
                pending_restart: false,
            },
        ],
    };
    await page.route("**/api/runtime-config", (r) => {
        if (r.request().method() === "PATCH") {
            patch = r.request().postDataJSON();
            data.pending_restart = true;
            data.items[0].pending_restart = true;
        }
        return r.fulfill({ json: data });
    });
    await page.goto("/#settings");
    await page.getByRole("button", { name: "运行配置", exact: true }).click();
    await expect(page.getByText("已配置（不回显）")).toBeVisible();
    await page.locator('[data-runtime-edit="HTTP_TIMEOUT"]').click();
    await page.getByLabel("配置值", { exact: true }).fill("45");
    await page.getByRole("button", { name: "保存并等待重启" }).click();
    expect(patch).toEqual({ HTTP_TIMEOUT: 45 });
    await expect(page.getByText("待重启", { exact: true }).first()).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "HTTP_TIMEOUT" })).toContainText("30");
});

test("notification policy and explicit offline simulation", async ({ page }) => {
    let policy, testBody;
    const config = {
        offline: true,
        degraded: false,
        policy: { enabled: true, threshold: 3, cooldown: 3600, new_users: true },
        channels: { bark: { enabled: true, configured: true } },
    };
    await page.route("**/api/notifications", (r) => {
        if (r.request().method() === "PATCH") policy = r.request().postDataJSON();
        return r.fulfill({ json: config });
    });
    await page.route("**/api/notifications/history", (r) => r.fulfill({ json: { items: [] } }));
    await page.route("**/api/notifications/test", (r) => {
        testBody = r.request().postDataJSON();
        return r.fulfill({ json: { ok: true, simulated: true } });
    });
    await page.goto("/#settings?section=notifications");
    await page.getByLabel("连续失败阈值").fill("5");
    await page.getByRole("button", { name: "保存通知策略" }).click();
    expect(policy.policy.threshold).toBe(5);
    await page.getByRole("button", { name: "模拟测试" }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    expect(testBody).toEqual({ channel: "bark" });
    await expect(page.locator("#toast")).toContainText("仅模拟");
});

test("backup restore preserves raw upload, defaults to retaining credentials and stages only", async ({ page }) => {
    let staged, preflight;
    const raw = '{"sample":"test-only"}\n';
    const info = { sqlite: true, restore: { status: "none" }, max_bytes: 32 * 1024 * 1024 };
    await page.route("**/api/backups", (r) => r.fulfill({ json: info }));
    await page.route("**/api/backups/preflight?*", (r) => {
        preflight = { raw: r.request().postData(), url: r.request().url() };
        return r.fulfill({
            json: {
                sha256: "test-sha256",
                created_at: "2026-10-26T00:00:00Z",
                counts: { subscriptions: 2 },
                status: "validated",
            },
        });
    });
    await page.route("**/api/backups/restore?*", (r) => {
        staged = { raw: r.request().postData(), sha: r.request().headers()["x-backup-sha256"] };
        info.restore = { status: "pending_restart", applied: false };
        return r.fulfill({ status: 202, json: { status: "pending_restart", applied: false } });
    });
    await page.goto("/#settings?section=backups");
    await page
        .locator("input[name=backup]")
        .setInputFiles({ name: "test.json", mimeType: "application/json", buffer: Buffer.from(raw) });
    await page.getByRole("button", { name: "预检备份" }).click();
    await expect(page.getByText("保留当前凭据和配置。")).toBeVisible();
    expect(preflight.raw).toBe(raw);
    expect(preflight.url).toContain("admin_credentials=false");
    await page.getByRole("button", { name: "暂存恢复任务" }).click();
    expect(staged).toBeUndefined();
    await page.locator("input[name=confirm_restore]").check();
    await page.getByRole("button", { name: "暂存恢复任务" }).click();
    await expect(page.getByRole("button", { name: "取消待恢复任务" })).toBeVisible();
    expect(staged).toEqual({ raw, sha: "test-sha256" });
    await expect(page.locator(".notice.warning")).toContainText("尚未应用");
});

test("role protection and Bot language remain separate from console language", async ({ page }) => {
    let rolePatch, defaultPatch;
    await page.route("**/api/targets?*", async (r) => {
        const response = await r.fetch();
        const data = await response.json();
        await r.fulfill({
            response,
            json: {
                ...data,
                items: data.items.map((i) => ({
                    ...i,
                    lang: "zh-Hans",
                    role: i.id === "1" ? "manager" : "user",
                    role_protected: i.id === "1",
                })),
            },
        });
    });
    await page.route("**/api/targets/10002/role", (r) => {
        rolePatch = r.request().postDataJSON();
        return r.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/targets/10002", (r) => {
        defaultPatch = r.request().postDataJSON();
        return r.fulfill({ json: { ok: true } });
    });
    await page.goto("/#targets");
    await page.locator('[data-target-edit="1"]').click();
    await expect(page.getByText("管理者受保护")).toBeVisible();
    await expect(page.getByRole("button", { name: "修改角色" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator('[data-target-edit="10002"]').click();
    await page.getByLabel("Bot 语言").fill("en");
    await page.getByRole("button", { name: "保存默认设置" }).click();
    expect(defaultPatch.lang).toBe("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.locator('[data-target-edit="10002"]').click();
    await page.getByRole("button", { name: "修改角色" }).click();
    await page.locator("select[name=role]").selectOption("banned");
    await page.getByRole("button", { name: "保存角色" }).click();
    expect(rolePatch).toEqual({ role: "banned" });
});

test("backup capability disables unsupported restore while preserving export and legacy behavior", async ({ page }) => {
    const info = { sqlite: true, restore_supported: false, restore: { status: "none" } };
    await page.route("**/api/backups", (route) => route.fulfill({ json: info }));
    await page.goto("/#settings?section=backups");
    await expect(page.getByRole("button", { name: "预检备份", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "下载备份", exact: true })).toBeEnabled();
    await expect(page.getByText("当前平台不支持恢复预检与自动恢复，仍可导出备份。", { exact: true })).toBeVisible();
    await page.locator("#language").selectOption("en");
    await expect(page.getByRole("button", { name: "Validate backup", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Download backup", exact: true })).toBeEnabled();
    await expect(
        page.getByText(
            "This platform does not support restore validation or automatic restoration. Backup export remains available.",
            { exact: true },
        ),
    ).toBeVisible();
    info.restore_supported = true;
    await page.reload();
    await expect(page.getByRole("button", { name: "Validate backup", exact: true })).toBeEnabled();
    delete info.restore_supported;
    await page.reload();
    await expect(page.getByRole("button", { name: "Validate backup", exact: true })).toBeEnabled();
});
