const { test, expect } = require("@playwright/test");
const { loginFeature } = require("./support/live");
test("live API: target URL, recipients, User-Agent and filtered export", async ({ page }) => {
    await loginFeature(page, "recipients", "/#subscriptions?target=-1001001&q=Hacker");
    await expect(page.getByText("当前目的地：技术与创造")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByPlaceholder("搜索名称或网址")).toHaveValue("Hacker");
    await page.locator("[data-sub-edit]").click();
    await page.getByRole("button", { name: "接收目的地", exact: true }).click();
    await page.locator("select[name=mode]").selectOption("append");
    await page
        .locator("#target-picker")
        .getByRole("checkbox", { name: /每日设计灵感/ })
        .check();
    await page.getByRole("button", { name: "保存接收目的地", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.locator("[data-sub-edit]").click();
    await page.getByRole("button", { name: "来源抓取设置", exact: true }).click();
    await page.getByRole("textbox", { name: "User-Agent", exact: true }).fill("OfflineBrowser/3");
    await page.getByRole("dialog").getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.locator("[data-sub-edit]").click();
    await page.getByRole("button", { name: "来源抓取设置", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "User-Agent", exact: true })).toHaveValue("OfflineBrowser/3");
    await page.getByRole("textbox", { name: "User-Agent", exact: true }).fill("");
    await page.getByRole("dialog").getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.locator("tbody input[type=checkbox]").check();
    await expect(page.getByRole("link", { name: "导出所选" })).toHaveAttribute("href", /ids=\d+/);
    const exported = page.getByRole("link", { name: "导出筛选结果" });
    await expect(exported).toHaveAttribute("href", /target=-1001001/);
    const xml = await page.request.get(await exported.getAttribute("href"));
    expect(xml.ok()).toBe(true);
    expect(await xml.text()).toContain("<opml");
    await page.getByRole("button", { name: "清除会话筛选 ×" }).click();
    await page.getByRole("button", { name: "选择目的地" }).click();
    await page
        .locator("#target-picker")
        .getByRole("radio", { name: /每日设计灵感/ })
        .check();
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(page.getByText("当前目的地：每日设计灵感")).toBeVisible();
    await expect(page).toHaveURL(/target=-1001004/);
    await expect(page.locator("tbody tr")).toHaveCount(1);
});
