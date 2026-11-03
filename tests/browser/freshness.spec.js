// Data freshness, instant feedback and routing, against the offline demo (real API, no mocks).
const { test, expect } = require("@playwright/test");

const PASSWORD = process.env.WEB_PASSWORD;
const USERNAME = "preview-admin";

async function signIn(page, path = "/") {
    await page.addInitScript(() => localStorage.setItem("rsstt.lang", "zh"));
    await page.goto(path);
    await page.locator("input[name=username]").fill(USERNAME);
    await page.locator("input[name=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
}

/** A change made "elsewhere": same API, outside the page's own state (what a Telegram command does to the database). */
const elsewhere = (page, path, method, body) =>
    page.evaluate(
        async ([path, method, body]) => {
            const response = await fetch("/api" + path, {
                method,
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            });
            return response.json();
        },
        [path, method, body],
    );

/** The other pages' first screens are fetched in the background shortly after sign-in; let that finish before counting requests. */
const afterWarmUp = (page) => page.waitForTimeout(2500);

const firstSub = async (page) => (await elsewhere(page, "/subscriptions?size=1", "GET")).items[0];

const hide = (page, hidden) =>
    page.evaluate((hidden) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
        document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // 401: the sign-in screen asks who you are; 409: the test makes the server refuse a change on purpose.
    page.on("console", (msg) => msg.type() === "error" && !/401|409/.test(msg.text()) && errors.push(msg.text()));
    page.errors = errors;
    page.api = [];
    page.on(
        "request",
        (request) => request.url().includes("/api/") && page.api.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );
});
test.afterEach(async ({ page }) => {
    expect(page.errors, "no script errors").toEqual([]);
});

test("the refresh button pulls in a change made elsewhere and says when it last updated", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    const sub = await firstSub(page);
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText(sub.title);
    await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: "在别处改的标题" });
    try {
        await expect(row).toContainText(sub.title); // nothing has asked for it yet
        await page.locator(".page-actions").getByRole("button", { name: "刷新" }).click();
        await expect(row).toContainText("在别处改的标题");
        await expect(page.locator(".page-actions .refresh small")).toContainText(/更新于\s*刚刚/);
    } finally {
        await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: sub.custom_title });
    }
});

test("coming back to the tab refreshes stale data without a reload", async ({ page }) => {
    await page.clock.install();
    await signIn(page, "/#subscriptions");
    const sub = await firstSub(page);
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText(sub.title);
    await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: "回到页面后看到的标题" });
    try {
        await page.clock.fastForward(12_000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(row).toContainText("回到页面后看到的标题");
    } finally {
        await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: sub.custom_title });
    }
});

test("a focus right after loading does not refetch what is still fresh", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await afterWarmUp(page);
    const before = page.api.length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(300);
    expect(page.api.slice(before)).toEqual([]);
});

test("a visible page refreshes on its own; a hidden one makes no requests", async ({ page }) => {
    await page.clock.install();
    await signIn(page, "/#subscriptions");
    const sub = await firstSub(page);
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText(sub.title);
    await afterWarmUp(page);

    await hide(page, true);
    await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: "后台期间的修改" });
    try {
        const before = page.api.length;
        await page.clock.fastForward(5 * 60_000);
        await page.waitForTimeout(300);
        expect(page.api.slice(before), "hidden tab stays quiet").toEqual([]);
        await expect(row).toContainText(sub.title);

        await hide(page, false); // visible again: catches up immediately
        await expect(row).toContainText("后台期间的修改");

        await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: "轮询看到的修改" });
        await page.clock.fastForward(61_000); // and keeps itself current while it stays visible
        await expect(row).toContainText("轮询看到的修改");
    } finally {
        await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { title: sub.custom_title });
    }
});

test("settings has nothing live: only the sidebar status keeps polling", async ({ page }) => {
    await page.clock.install();
    await signIn(page, "/#settings");
    await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
    await afterWarmUp(page);
    const before = page.api.length;
    await page.clock.fastForward(5 * 60_000);
    await page.waitForTimeout(300);
    expect([...new Set(page.api.slice(before))]).toEqual(["GET /api/status"]);
});

test("typing in search keeps one history entry, waits for the pause, and ignores half-typed IME text", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await afterWarmUp(page);
    const history = await page.evaluate(() => history.length);
    const before = page.api.filter((entry) => entry.startsWith("GET /api/subscriptions")).length;
    await page.locator(".toolbar input[type=search]").pressSequentially("hacker", { delay: 60 });
    await expect(page).toHaveURL(/#subscriptions\?q=hacker/);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => history.length)).toBe(history);
    expect(page.api.filter((entry) => entry.startsWith("GET /api/subscriptions")).length - before).toBe(1);

    // Composition: pinyin typed so far is not a search.
    await page.locator(".toolbar input[type=search]").fill("");
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.locator("tbody tr")).not.toHaveCount(1);
    await page.waitForTimeout(300);
    const searches = page.api.length;
    await page.evaluate(() => {
        const input = document.querySelector(".toolbar input[type=search]");
        input.focus();
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        for (const text of ["j", "ji", "jiq"]) {
            input.value = text;
            input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
        }
    });
    await page.waitForTimeout(600);
    expect(page.api.slice(searches)).toEqual([]);
    await page.evaluate(() => {
        const input = document.querySelector(".toolbar input[type=search]");
        input.value = "机器";
        input.dispatchEvent(new CompositionEvent("compositionend", { data: "机器" }));
    });
    await expect(page).toHaveURL(/q=%E6%9C%BA%E5%99%A8/);
    await expect(page.locator("tbody tr").first()).toContainText("机器之心");
});

test("deep links open the right page, drawer and tab", async ({ page }) => {
    await signIn(page, "/#overview");
    const sub = await firstSub(page);
    await page.goto(`/#subscriptions?sub=${sub.id}&tab=articles`);
    await page.reload();
    await expect(page.locator(".drawer").getByRole("heading", { name: sub.title })).toBeVisible();
    await expect(page.locator(".drawer .tabs [aria-selected=true]")).toContainText("最近文章");
    await page.goto("/#chats?chat=-1001001");
    await page.reload();
    await expect(page.locator(".drawer").getByRole("heading", { name: "技术与创造" })).toBeVisible();
    await page.goto("/#logs?view=runs");
    await page.reload();
    await expect(page.getByRole("radio", { name: "抓取记录" })).toBeChecked();
});

test("a subscription drawer opens on the list row without waiting for the server", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.route("**/api/subscriptions/*", async (route) => {
        if (route.request().method() === "GET" && /\/subscriptions\/\d+$/.test(route.request().url()))
            await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
    });
    await page.locator("tbody tr .cell-title").first().click();
    await expect(page.locator(".drawer").getByLabel("自定义标题")).toBeVisible({ timeout: 800 });
    await expect(page.locator(".drawer .loading")).toHaveCount(0);
});

test("pause and resume show the new state at once and roll back when the server refuses", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    const toggle = drawer.locator(".action-card").first().getByRole("button");
    const label = (await toggle.textContent()).trim();
    const flipped = label === "暂停" ? "恢复" : "暂停";
    await page.route(/\/api\/subscriptions\/\d+$/, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "服务器拒绝了这次修改", code: "CONFLICT" }),
        });
    });
    await toggle.click();
    await expect(toggle).toHaveText(flipped, { timeout: 600 }); // before the server has answered
    await expect(page.locator(".toast", { hasText: "服务器拒绝了这次修改" })).toBeVisible();
    await expect(toggle).toHaveText(label); // rolled back
    await page.unroute(/\/api\/subscriptions\/\d+$/);

    await toggle.click(); // and for real
    await expect(drawer.locator(".action-card").first().getByRole("button")).toHaveText(flipped);
    await expect(page.locator(".toast", { hasText: label === "暂停" ? "已暂停" : "已恢复" })).toBeVisible();
    await toggle.click();
    await expect(drawer.locator(".action-card").first().getByRole("button")).toHaveText(label);
});

test("a change made elsewhere reaches an open form without discarding what is being typed", async ({ page }) => {
    await page.clock.install();
    await signIn(page, "/#subscriptions");
    const sub = await firstSub(page);
    await page.locator("tbody tr .cell-title").first().click();
    const drawer = page.locator(".drawer");
    await drawer.getByLabel("自定义标题").fill("正在输入的标题");
    await expect(drawer.getByText("1 项修改未保存")).toBeVisible();
    await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { tags: "外部标签" });
    try {
        await page.clock.fastForward(12_000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(drawer.getByLabel("自定义 hashtag")).toHaveValue(/外部标签/);
        await expect(drawer.getByLabel("自定义标题")).toHaveValue("正在输入的标题");
        await expect(drawer.getByText("1 项修改未保存")).toBeVisible(); // only the title is the user's own edit
    } finally {
        await elsewhere(page, `/subscriptions/${sub.id}`, "PATCH", { tags: null });
    }
});

test("the overview and chats show how fresh they are and reload on demand", async ({ page }) => {
    await signIn(page, "/#overview");
    await expect(page.locator(".kpi").first()).toBeVisible();
    await expect(page.locator(".page-actions .refresh small")).toContainText("更新于");
    const before = page.api.length;
    await page.locator(".page-actions").getByRole("button", { name: "刷新" }).click();
    await expect.poll(() => page.api.slice(before).filter((entry) => entry === "GET /api/dashboard").length).toBe(1);
    await page.locator(".nav").getByRole("link", { name: "会话" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.locator(".page-actions").getByRole("button", { name: "刷新" })).toBeVisible();
    await page.locator(".nav").getByRole("link", { name: "运行日志" }).click();
    await expect(page.locator(".page-actions").getByRole("button", { name: "刷新" })).toBeVisible();
});

test("a page that was already open shows its last data at once on return", async ({ page }) => {
    await signIn(page, "/#subscriptions");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator(".nav").getByRole("link", { name: "概览" }).click();
    await expect(page.locator(".kpi").first()).toBeVisible();
    await page.route("**/api/subscriptions?*", async (route) => {
        await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
    });
    await page.locator(".nav").getByRole("link", { name: "订阅" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 800 });
});
