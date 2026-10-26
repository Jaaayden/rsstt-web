const { test, expect } = require("@playwright/test");
// Real API tests: no routing mocks. Missing capabilities skip only on older bases.
async function loginFeature(page, feature, route = "/") {
    const response = await page.request.get("/api/public");
    expect(response.ok()).toBe(true);
    const pub = await response.json();
    test.skip(!pub.features?.[feature], `未安装 ${feature} 后端，跳过此实连用例`);
    expect(pub.demo, "实连浏览器测试仅允许离线演示").toBe(true);
    expect(pub.snapshot, "实连写入测试不得使用真实数据快照").toBeFalsy();
    await page.goto(route);
    await page.locator("#password").fill(process.env.WEB_PASSWORD || "rsstt-local-preview");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#main")).toBeVisible();
}
module.exports = { loginFeature };
