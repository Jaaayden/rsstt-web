const { test, expect } = require("@playwright/test");

test("live API: blocked visibility and activity filters compose with URL, search, type, and pagination", async ({
    page,
    baseURL,
}) => {
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#main")).toBeVisible();
    const headers = { Origin: new URL(baseURL).origin };
    const bannedTarget = "-1001002",
        inactiveTarget = "-1001003",
        activeTarget = "10002";
    const ids = [bannedTarget, inactiveTarget, activeTarget];
    const original = await (await page.request.get("/api/targets?size=100&visibility=all")).json();
    const roles = Object.fromEntries(original.items.filter((i) => ids.includes(i.id)).map((i) => [i.id, i.role]));
    const subscriptions = {};
    for (const id of ids)
        subscriptions[id] = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
    expect(subscriptions[activeTarget].length).toBeGreaterThan(0);
    try {
        for (const id of ids)
            expect(
                (await page.request.patch(`/api/targets/${id}/role`, { headers, data: { role: "user" } })).status(),
            ).toBe(200);
        for (const sub of subscriptions[inactiveTarget])
            expect(
                (await page.request.patch(`/api/subscriptions/${sub.id}`, { headers, data: { state: 0 } })).status(),
            ).toBe(200);
        expect(
            (
                await page.request.patch(`/api/subscriptions/${subscriptions[activeTarget][0].id}`, {
                    headers,
                    data: { state: 1 },
                })
            ).status(),
        ).toBe(200);
        expect(
            (
                await page.request.patch(`/api/targets/${bannedTarget}/role`, { headers, data: { role: "banned" } })
            ).status(),
        ).toBe(200);
        await page.goto("/#targets");
        await expect(page.locator("#visibility-filter")).toHaveValue("unbanned");
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toHaveCount(0);
        await expect(page).toHaveURL(/visibility=unbanned/);

        await page.locator("#visibility-filter").selectOption("banned");
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toBeVisible();
        await expect(page.locator(`[data-target-edit="${activeTarget}"]`)).toHaveCount(0);
        await page.reload();
        await expect(page.locator("#visibility-filter")).toHaveValue("banned");
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toBeVisible();

        await page.locator("#visibility-filter").selectOption("active");
        await expect(page.locator(`[data-target-edit="${activeTarget}"]`)).toBeVisible();
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-target-edit="${inactiveTarget}"]`)).toHaveCount(0);
        await page.locator("#visibility-filter").selectOption("inactive");
        await expect(page.locator(`[data-target-edit="${inactiveTarget}"]`)).toBeVisible();
        await expect(page.locator(`[data-target-edit="${activeTarget}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toHaveCount(0);

        await page.locator("#visibility-filter").selectOption("all");
        await page.locator("#kind-filter").selectOption("channel");
        await page.getByPlaceholder("搜索名称、用户名或 ID").fill(bannedTarget);
        await expect(page.locator("tbody tr")).toHaveCount(1);
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toBeVisible();
        await expect(page).toHaveURL(/kind=channel/);
        await expect(page).toHaveURL(/visibility=all/);
        await page.reload();
        await expect(page.locator("#kind-filter")).toHaveValue("channel");
        await expect(page.getByPlaceholder("搜索名称、用户名或 ID")).toHaveValue(bannedTarget);
        await page.goto("/#targets?page=2&visibility=all");
        await page.locator("#visibility-filter").selectOption("banned");
        await expect(page).not.toHaveURL(/page=2/);
        await expect(page.locator(`[data-target-edit="${bannedTarget}"]`)).toBeVisible();
        await page.goBack();
        await expect(page.locator("#visibility-filter")).toHaveValue("all");
        const after = await (await page.request.get(`/api/subscriptions?target=${bannedTarget}&size=100`)).json();
        expect(after.items.map((i) => i.id).sort()).toEqual(subscriptions[bannedTarget].map((i) => i.id).sort());
        expect(after.items.every((i) => i.state === 0)).toBeTruthy();

        await page.goto("/#targets");
        await page.locator(`[data-target-edit="${activeTarget}"]`).click();
        await page.getByRole("button", { name: "修改角色", exact: true }).click();
        await page.locator("select[name=role]").selectOption("banned");
        await page.getByRole("button", { name: "保存角色", exact: true }).click();
        await expect(page.locator(`[data-target-edit="${activeTarget}"]`)).toHaveCount(0);
        await expect(page.locator("#toast")).toContainText("会话已封禁，订阅已暂停。可切换到“已封禁”查看。");
        await expect(page.getByRole("dialog")).toContainText("解除封禁后不会自动恢复订阅");
        await page.locator("#dialog .dialog-head [data-action=close]").click();
        await page.locator("#visibility-filter").selectOption("banned");
        await page.locator(`[data-target-edit="${activeTarget}"]`).click();
        await page.getByRole("button", { name: "修改角色", exact: true }).click();
        await page.locator("select[name=role]").selectOption("user");
        await page.getByRole("button", { name: "保存角色", exact: true }).click();
        await expect(page.locator("#toast")).toContainText("会话已解除封禁，订阅仍保持暂停。请在管理订阅中手动恢复。");
        const unblocked = await (await page.request.get(`/api/subscriptions?target=${activeTarget}&size=100`)).json();
        expect(unblocked.items.every((i) => i.state === 0)).toBeTruthy();
    } finally {
        for (const id of ids) {
            expect(
                (await page.request.patch(`/api/targets/${id}/role`, { headers, data: { role: roles[id] } })).status(),
            ).toBe(200);
            for (const sub of subscriptions[id])
                expect(
                    (
                        await page.request.patch(`/api/subscriptions/${sub.id}`, {
                            headers,
                            data: { state: sub.state },
                        })
                    ).status(),
                ).toBe(200);
        }
    }
});
