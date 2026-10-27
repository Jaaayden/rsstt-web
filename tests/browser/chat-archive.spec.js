const { test, expect } = require("@playwright/test");

async function login(page, language = "zh-CN") {
    await page.addInitScript((language) => localStorage.setItem("rsstt.language", language), language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
}

const subscriptionSettings = (items) =>
    items
        .map(({ id, target, state, options, custom_title, tags }) => ({
            id,
            target,
            state,
            options,
            custom_title,
            tags,
        }))
        .sort((a, b) => a.id - b.id);

test("live API: bulk archive and restore preserve subscriptions, settings, and blocked status", async ({
    page,
    baseURL,
}) => {
    await login(page);
    const headers = { Origin: new URL(baseURL).origin },
        ids = ["10002", "-1001002"];
    const originalTargets = await (await page.request.get("/api/targets?archive=all&visibility=all&size=100")).json();
    const original = Object.fromEntries(ids.map((id) => [id, originalTargets.items.find((item) => item.id === id)]));
    const originalSubs = {};
    for (const id of ids)
        originalSubs[id] = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
    try {
        expect(
            (await page.request.post("/api/targets/archive", { headers, data: { ids, archived: false } })).status(),
        ).toBe(200);
        expect(
            (await page.request.patch("/api/targets/-1001002/role", { headers, data: { role: "banned" } })).status(),
        ).toBe(200);
        const beforeSubs = {};
        for (const id of ids)
            beforeSubs[id] = subscriptionSettings(
                (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
            );
        const beforeTargets = (
            await (await page.request.get("/api/targets?archive=all&visibility=all&size=100")).json()
        ).items.filter((item) => ids.includes(item.id));
        await page.goto("/#targets?visibility=all");
        await expect(page.locator("#archive-filter")).toHaveValue("visible");
        await expect(page.locator('[data-select-chat="1"]')).toBeDisabled();
        await page.locator("#select-chat-page").check();
        await expect(page.locator('[data-select-chat="1"]')).not.toBeChecked();
        expect(await page.locator("[data-select-chat]:checked").count()).toBeGreaterThan(1);
        await page.locator("#select-chat-page").uncheck();
        await page.locator('[data-select-chat="10002"]').check();
        await page.locator('[data-select-chat="-1001002"]').check();
        await page.locator('[data-chat-archive="archive"]').click();
        await expect(page.getByRole("dialog")).toContainText("已启用的订阅继续推送");
        await expect(page.getByRole("dialog")).toContainText("订阅、设置和封禁状态全部保留");
        await page.getByRole("dialog").getByRole("button", { name: "确认归档", exact: true }).click();
        for (const id of ids) await expect(page.locator(`[data-select-chat="${id}"]`)).toHaveCount(0);
        await expect(page.locator(".chat-bulkbar")).toHaveCount(0);
        const daily = await (await page.request.get("/api/targets?visibility=all&size=100")).json();
        expect(daily.items.some((item) => ids.includes(item.id))).toBe(false);
        for (const id of ids)
            expect(
                subscriptionSettings(
                    (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
                ),
            ).toEqual(beforeSubs[id]);

        await page.locator("#archive-filter").selectOption("archived");
        await expect(page.locator("#visibility-filter")).toHaveValue("all");
        for (const id of ids) await expect(page.locator(`[data-select-chat="${id}"]`)).toBeVisible();
        await expect(page).toHaveURL(/archive=archived/);
        await expect(page).toHaveURL(/visibility=all/);
        await page.reload();
        await expect(page.locator("#archive-filter")).toHaveValue("archived");
        await expect(page.locator("#visibility-filter")).toHaveValue("all");
        const archived = await (await page.request.get("/api/targets?archive=archived&visibility=all&size=100")).json();
        for (const before of beforeTargets) {
            const after = archived.items.find((item) => item.id === before.id);
            expect(after).toMatchObject({
                archived: true,
                role: before.role,
                state: before.state,
                lang: before.lang,
                options: before.options,
            });
        }
        await page.locator('[data-select-chat="10002"]').check();
        await page.getByPlaceholder("搜索名称、用户名或 ID").fill("-1001002");
        await expect(page.locator(".chat-bulkbar")).toHaveCount(0);
        await expect(page.locator("tbody tr")).toHaveCount(1);
        await page.getByPlaceholder("搜索名称、用户名或 ID").fill("");
        await expect(page.locator('[data-select-chat="10002"]')).toBeVisible();
        for (const id of ids) await page.locator(`[data-select-chat="${id}"]`).check();
        await page.locator('[data-chat-archive="restore"]').click();
        await expect(page.getByRole("dialog")).toContainText("保留原来的封禁和订阅状态");
        await page.getByRole("dialog").getByRole("button", { name: "确认取消归档", exact: true }).click();
        for (const id of ids) await expect(page.locator(`[data-select-chat="${id}"]`)).toHaveCount(0);
        await page.locator("#archive-filter").selectOption("visible");
        for (const id of ids) await expect(page.locator(`[data-select-chat="${id}"]`)).toBeVisible();
        const restored = await (await page.request.get("/api/targets?archive=all&visibility=all&size=100")).json();
        expect(restored.items.find((item) => item.id === "-1001002").role).toBe("banned");
        for (const id of ids)
            expect(
                subscriptionSettings(
                    (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
                ),
            ).toEqual(beforeSubs[id]);
        await page.locator('[data-select-chat="10002"]').check();
        await page.goto("/#subscriptions");
        await page.goto("/#targets?visibility=all");
        await expect(page.locator(".chat-bulkbar")).toHaveCount(0);
    } finally {
        for (const id of ids) {
            expect(
                (
                    await page.request.post("/api/targets/archive", {
                        headers,
                        data: { ids: [id], archived: Boolean(original[id].archived) },
                    })
                ).status(),
            ).toBe(200);
            expect(
                (
                    await page.request.patch(`/api/targets/${id}/role`, { headers, data: { role: original[id].role } })
                ).status(),
            ).toBe(200);
            for (const sub of originalSubs[id])
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

test("live API: blocked and archived chats are excluded from recipient choices without deleting existing subscriptions", async ({
    page,
    baseURL,
}) => {
    await login(page, "en");
    const headers = { Origin: new URL(baseURL).origin },
        blocked = "-1001002",
        archived = "10002";
    const targets = (await (await page.request.get("/api/targets?archive=all&visibility=all&size=100")).json()).items;
    const originalRoles = Object.fromEntries(
        [blocked, archived].map((id) => [id, targets.find((item) => item.id === id)]),
    );
    const before = {};
    for (const id of [blocked, archived])
        before[id] = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
    const commonFeed = before[blocked].find((sub) => before[archived].some((other) => other.feed_id === sub.feed_id));
    expect(commonFeed).toBeTruthy();
    try {
        expect(
            (await page.request.patch(`/api/targets/${blocked}/role`, { headers, data: { role: "banned" } })).status(),
        ).toBe(200);
        expect(
            (
                await page.request.post("/api/targets/archive", { headers, data: { ids: [archived], archived: true } })
            ).status(),
        ).toBe(200);
        const hiddenBefore = {};
        for (const id of [blocked, archived])
            hiddenBefore[id] = subscriptionSettings(
                (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
            );
        const unscoped = await (await page.request.get("/api/subscriptions?size=100")).json();
        expect(unscoped.items.some((sub) => sub.target === blocked)).toBe(false);
        await page.goto("/#subscriptions");
        await page.locator('[data-action="new-sub"]').click();
        await expect(page.locator(`#target-picker input[value="${blocked}"]`)).toHaveCount(0);
        await expect(page.locator(`#target-picker input[value="${archived}"]`)).toHaveCount(0);
        await page.keyboard.press("Escape");
        const shown = unscoped.items.find(
            (sub) => sub.feed_id === commonFeed.feed_id && ![blocked, archived].includes(sub.target),
        );
        expect(shown).toBeTruthy();
        await page.goto(`/#subscriptions?target=${shown.target}`);
        await page.locator(`[data-sub-edit="${shown.id}"]`).click();
        await page.locator(`[data-feed-recipients="${commonFeed.feed_id}"]`).click();
        await expect(page.getByRole("dialog")).toContainText("Existing subscriptions for blocked or archived chats");
        await expect(page.locator(`#target-picker input[value="${blocked}"]`)).toHaveCount(0);
        await expect(page.locator(`#target-picker input[value="${archived}"]`)).toHaveCount(0);
        await page.locator("select[name=mode]").selectOption("replace");
        await page.getByRole("button", { name: "Save receiving chats", exact: true }).click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        for (const id of [blocked, archived])
            expect(
                subscriptionSettings(
                    (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
                ),
            ).toEqual(hiddenBefore[id]);
    } finally {
        for (const id of [blocked, archived]) {
            expect(
                (
                    await page.request.post("/api/targets/archive", {
                        headers,
                        data: { ids: [id], archived: Boolean(originalRoles[id].archived) },
                    })
                ).status(),
            ).toBe(200);
            expect(
                (
                    await page.request.patch(`/api/targets/${id}/role`, {
                        headers,
                        data: { role: originalRoles[id].role },
                    })
                ).status(),
            ).toBe(200);
            for (const sub of before[id])
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
