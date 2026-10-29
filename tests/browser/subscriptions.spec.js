const { test, expect } = require("@playwright/test");
const { loginFeature } = require("./support/live");
test("live API: target URL, recipients, 请求标识（User-Agent） and filtered export", async ({ page }) => {
    await loginFeature(page, "recipients", "/#subscriptions?target=-1001001&q=Hacker");
    await expect(page.getByText("当前会话：技术与创造")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByPlaceholder("搜索订阅源名称或 RSS 地址")).toHaveValue("Hacker");
    await page.locator("[data-sub-edit]").click();
    await page.getByRole("button", { name: "管理接收会话", exact: true }).click();
    await page.locator("select[name=mode]").selectOption("append");
    await page
        .locator("#target-picker")
        .getByRole("checkbox", { name: /每日设计灵感/ })
        .check();
    await page.getByRole("button", { name: "保存接收会话", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("订阅设置");
    await page.getByRole("button", { name: "订阅源请求设置", exact: true }).click();
    await page.getByRole("textbox", { name: "请求标识（User-Agent）", exact: true }).fill("OfflineBrowser/3");
    await page.getByRole("dialog").getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("订阅设置");
    await page.getByRole("button", { name: "订阅源请求设置", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "请求标识（User-Agent）", exact: true })).toHaveValue(
        "OfflineBrowser/3",
    );
    await page.getByRole("textbox", { name: "请求标识（User-Agent）", exact: true }).fill("");
    await page.getByRole("dialog").getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("订阅设置");
    await page.locator("#dialog .dialog-head [data-action=close]").click();
    await page.locator("tbody input[type=checkbox]").check();
    await expect(page.getByRole("link", { name: "导出所选订阅源（OPML）" })).toHaveAttribute("href", /ids=\d+/);
    const exported = page.getByRole("link", { name: "导出筛选订阅源（OPML）" });
    await expect(exported).toHaveAttribute("href", /target=-1001001/);
    const xml = await page.request.get(await exported.getAttribute("href"));
    expect(xml.ok()).toBe(true);
    expect(await xml.text()).toContain("<opml");
    await page.getByRole("button", { name: "清除会话筛选 ×" }).click();
    await page.getByRole("button", { name: "按会话筛选" }).click();
    await page
        .locator("#target-picker")
        .getByRole("radio", { name: /每日设计灵感/ })
        .check();
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(page.getByText("当前会话：每日设计灵感")).toBeVisible();
    await expect(page).toHaveURL(/target=-1001004/);
    await expect(page.locator("tbody tr")).toHaveCount(1);
});
