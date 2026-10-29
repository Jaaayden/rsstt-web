const { test, expect } = require("@playwright/test");

async function login(page, language = "zh-CN") {
    await page.addInitScript((language) => {
        if (!localStorage.getItem("rsstt.language")) localStorage.setItem("rsstt.language", language);
    }, language);
    await page.goto("/");
    await page.locator("#password").fill(process.env.WEB_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator(".layout")).toBeVisible();
}

const settings = (items) =>
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

test("chat type filter has only the three Telegram types; Unknown is a snapshot row label", async ({ page }) => {
    let unknownID;
    // Only the read-only snapshot presentation uses a synthetic missing type.
    // Filtering and relationship behavior are covered through the real API below.
    await page.route("**/api/public", async (route) => {
        const response = await route.fetch(),
            data = await response.json();
        await route.fulfill({ response, json: { ...data, snapshot: { captured_at: "2026-10-27T00:00:00Z" } } });
    });
    await page.route("**/api/targets?*", async (route) => {
        const response = await route.fetch(),
            data = await response.json();
        unknownID = data.items.find((item) => item.id.startsWith("-"))?.id;
        await route.fulfill({
            response,
            json: {
                ...data,
                items: data.items.map((item) => (item.id === unknownID ? { ...item, kind: "unknown" } : item)),
            },
        });
    });
    await login(page);
    await page.goto("/#targets?kind=unknown");
    await expect(page.locator("#kind-filter")).toHaveValue("");
    await expect(page).not.toHaveURL(/kind=unknown/);
    await expect(page.locator("#kind-filter option")).toHaveText(["全部类型", "私聊", "群组", "频道"]);
    const kindCell = () =>
        page.locator(`[data-target-edit="${unknownID}"]`).locator("xpath=ancestor::tr").locator("td").nth(1);
    await expect(kindCell()).toHaveText("未知");
    await expect(page.locator(".page-note")).toContainText("离线快照未记录的会话类型");
    await expect(page.locator(".page-note")).toContainText("联网核验后会归入私聊、群组或频道");
    await page.locator("#language").selectOption("en");
    await expect(kindCell()).toHaveText("Unknown");
    const values = await page
        .locator("#kind-filter option")
        .evaluateAll((options) => options.map((option) => option.value));
    expect(values).toEqual(["", "private", "group", "channel"]);
    await expect(page.locator("#kind-filter")).not.toContainText("Unknown");
    await expect(page.locator(".page-note")).toContainText(
        "Online verification classifies them as private chats, groups, or channels.",
    );
});

test("live API: blocked and departed chats disappear from default subscriptions and receiving choices without losing relationships", async ({
    page,
    baseURL,
}) => {
    await login(page, "en");
    const headers = { Origin: new URL(baseURL).origin },
        blocked = "-1001002",
        departed = "-1001003";
    const originalTargets = (
        await (await page.request.get("/api/targets?visibility=all&include_departed=true&size=100")).json()
    ).items;
    const originalRoles = Object.fromEntries(
        [blocked, departed].map((id) => [id, originalTargets.find((item) => item.id === id).role]),
    );
    const before = {};
    for (const id of [blocked, departed])
        before[id] = (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items;
    const commonFeed = before[blocked].find((sub) => before[departed].some((other) => other.feed_id === sub.feed_id));
    expect(commonFeed).toBeTruthy();
    try {
        expect(
            (await page.request.patch(`/api/targets/${blocked}/role`, { headers, data: { role: "banned" } })).status(),
        ).toBe(200);
        expect(
            (
                await page.request.post(`/api/targets/${departed}/leave`, { headers, data: { confirm: departed } })
            ).status(),
        ).toBe(200);
        const hidden = {};
        for (const id of [blocked, departed])
            hidden[id] = settings(
                (await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items,
            );
        const defaults = await (await page.request.get("/api/subscriptions?size=100")).json();
        expect(defaults.items.some((sub) => [blocked, departed].includes(sub.target))).toBe(false);
        const dailyTargets = await (await page.request.get("/api/targets?visibility=all&size=100")).json();
        expect(dailyTargets.items.some((item) => item.id === departed)).toBe(false);
        const historical = await (
            await page.request.get("/api/targets?visibility=all&include_departed=true&size=100")
        ).json();
        expect(historical.items.find((item) => item.id === departed).membership).toBe("left");

        await page.goto("/#targets");
        await expect(page.locator(`[data-target-edit="${blocked}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-target-edit="${departed}"]`)).toHaveCount(0);
        await page.locator("#visibility-filter").selectOption("banned");
        await expect(page.locator(`[data-target-edit="${blocked}"]`)).toBeVisible();
        await page.locator(`[data-target-subs="${blocked}"]`).click();
        await expect(page.locator(`[data-sub-toggle="${before[blocked][0].id}"]`)).toBeVisible();
        expect(
            (await (await page.request.get(`/api/subscriptions?target=${blocked}&size=100`)).json()).items.every(
                (item) => item.state === 0,
            ),
        ).toBe(true);

        await page.goto("/#subscriptions");
        for (const id of [blocked, departed])
            for (const sub of before[id]) await expect(page.locator(`[data-sub-toggle="${sub.id}"]`)).toHaveCount(0);
        const request = page.waitForRequest((request) => request.url().includes("/api/targets?size=50"));
        await page.locator('[data-action="new-sub"]').click();
        expect(new URL((await request).url()).searchParams.get("visibility")).toBe("unbanned");
        for (const id of [blocked, departed])
            await expect(page.locator(`#target-picker input[value="${id}"]`)).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.locator('[data-action="filter-target"]').click();
        for (const id of [blocked, departed])
            await expect(page.locator(`#target-picker input[value="${id}"]`)).toHaveCount(0);
        await page.keyboard.press("Escape");

        const shown = defaults.items.find(
            (sub) => sub.feed_id === commonFeed.feed_id && ![blocked, departed].includes(sub.target),
        );
        expect(shown).toBeTruthy();
        await page.goto(`/#subscriptions?target=${shown.target}`);
        await page.locator(`[data-sub-edit="${shown.id}"]`).click();
        await page.locator(`[data-feed-recipients="${commonFeed.feed_id}"]`).click();
        await expect(page.getByRole("dialog")).toContainText("the bot has left or been removed from are preserved");
        for (const id of [blocked, departed])
            await expect(page.locator(`#target-picker input[value="${id}"]`)).toHaveCount(0);
        await page.locator("select[name=mode]").selectOption("replace");
        await page.getByRole("button", { name: "Save receiving chats", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("Subscription settings");
        await page.locator("#dialog .dialog-head [data-action=close]").click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        for (const id of [blocked, departed])
            expect(
                settings((await (await page.request.get(`/api/subscriptions?target=${id}&size=100`)).json()).items),
            ).toEqual(hidden[id]);
    } finally {
        // DemoGateway only simulates Telegram; refreshing restores its available
        // metadata without contacting Telegram or modifying a production chat.
        expect((await page.request.post(`/api/targets/${departed}/refresh`, { headers, data: {} })).status()).toBe(200);
        for (const id of [blocked, departed]) {
            expect(
                (
                    await page.request.patch(`/api/targets/${id}/role`, { headers, data: { role: originalRoles[id] } })
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
