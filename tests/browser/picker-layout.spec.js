const { test, expect } = require("@playwright/test");

// These tests exercise real Chromium layout and native form interactions.
// Only picker list responses use synthetic long names; they do not validate
// target-list authorization or backend filtering, which have separate tests.
const samples = [
    { id: "50101", title: "很长的中文会话名称用于检查窄屏文字是否仍然可以正常换行与选择", kind: "private" },
    {
        id: "-10050102",
        title: "A very long English group name with words that must stay readable on a narrow screen",
        kind: "group",
    },
    {
        id: "-10050103",
        title: "🛰️📚 LongUnbrokenChannelNameThatMustNotPushTheTypeOrRadioControlOutsideItsRow",
        kind: "channel",
    },
];

async function expectHealthyRows(page, multiple) {
    const dialog = page.getByRole("dialog");
    const rows = dialog.locator(".target-choice");
    await expect(rows).toHaveCount(samples.length);
    await expect(dialog.locator("#picker-search")).toBeVisible();
    const geometry = await rows.evaluateAll((elements) =>
        elements.map((row) => {
            const box = (el) => {
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            };
            const name = row.querySelector(".target-choice-name");
            const kind = row.querySelector(".target-choice-kind");
            return {
                row: box(row),
                input: box(row.querySelector("input")),
                main: box(row.querySelector(".target-choice-main")),
                name: box(name),
                kind: box(kind),
                kindWrap: getComputedStyle(kind).whiteSpace,
                readable: name.scrollWidth <= name.clientWidth + 1 || Boolean(name.title),
            };
        }),
    );
    for (const item of geometry) {
        expect(item.input.width).toBeGreaterThanOrEqual(16);
        expect(item.input.width).toBeLessThanOrEqual(22);
        expect(item.input.height).toBeLessThanOrEqual(22);
        expect(item.row.height).toBeGreaterThanOrEqual(44);
        expect(item.main.width).toBeGreaterThan(100);
        expect(item.name.width).toBeGreaterThan(70);
        expect(item.input.right).toBeLessThanOrEqual(item.main.left);
        expect(item.name.right).toBeLessThanOrEqual(item.kind.left);
        expect(item.kind.right).toBeLessThanOrEqual(item.row.right);
        expect(item.kindWrap).toBe("nowrap");
        expect(item.readable).toBeTruthy();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const controls = rows.locator(`input[type="${multiple ? "checkbox" : "radio"}"]`);
    await expect(controls).toHaveCount(samples.length);
    // Clicking a readable name selects the row through the native label.
    await rows.first().locator(".target-choice-name").click();
    await expect(controls.first()).toBeChecked();
    if (multiple) {
        await controls.nth(1).focus();
        await page.keyboard.press("Space");
        await expect(controls.nth(1)).toBeChecked();
        await expect(controls.first()).toBeChecked();
    } else {
        await controls.first().focus();
        await page.keyboard.press("ArrowDown");
        await expect(controls.nth(1)).toBeChecked();
        await expect(controls.first()).not.toBeChecked();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
}

for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"]) {
        for (const language of ["zh-CN", "en"]) {
            test(`picker layout and native selection: ${width}px, ${theme}, ${language}`, async ({ page }) => {
                await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
                await page.addInitScript(
                    ({ theme, language }) => {
                        localStorage.setItem("rsstt.theme", theme);
                        localStorage.setItem("rsstt.language", language);
                    },
                    { theme, language },
                );
                await page.route("**/api/targets?*", async (route) => {
                    if (new URL(route.request().url()).searchParams.get("size") !== "50") return route.fallback();
                    await route.fulfill({ json: { items: samples, page: 1, size: 50, total: samples.length } });
                });
                await page.goto("/");
                await page.locator("#password").fill(process.env.WEB_PASSWORD);
                await page.locator("#login-form button[type=submit]").click();
                await expect(page.locator(".layout")).toBeVisible();
                await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
                await page.goto("/#subscriptions");
                const filter = page.locator('[data-action="filter-target"]');
                await filter.click();
                await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(
                    language === "en" ? "Filter by chat" : "按会话筛选",
                );
                await expectHealthyRows(page, false);
                await expect(filter).toBeFocused();

                const add = page.locator('[data-action="new-sub"]');
                await add.click();
                await expectHealthyRows(page, false);
                await expect(add).toBeFocused();

                await page.goto("/#settings?section=tokens");
                const create = page.locator('[data-action="new-token"]');
                await create.click();
                await expectHealthyRows(page, true);
                await expect(create).toBeFocused();
            });
        }
    }
}
