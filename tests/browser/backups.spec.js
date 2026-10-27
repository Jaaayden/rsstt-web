const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const { loginFeature } = require("./support/live");
test("live API: backup download, preflight, restart staging and cancellation", async ({ page }) => {
    await loginFeature(page, "backups", "/#settings?section=backups");
    await expect(page.getByRole("heading", { name: "备份与恢复", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载备份", exact: true }).click();
    const download = await downloadPromise,
        file = await download.path();
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    expect(data.manifest.version).toBe(1);
    expect(data.data["console.credentials"]).toBeUndefined();
    await page.locator("input[name=backup]").setInputFiles(file);
    await page.getByRole("button", { name: "检查备份", exact: true }).click();
    await expect(page.getByRole("heading", { name: "确认下次重启时恢复此备份", exact: true })).toBeVisible();
    await page.locator("input[name=confirm_restore]").check();
    await page.getByRole("button", { name: "安排重启后恢复", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".notice.warning")).toContainText("恢复已安排，当前数据尚未替换");
    expect((await (await page.request.get("/api/backups")).json()).restore).toMatchObject({
        status: "pending_restart",
        applied: false,
    });
    await page.getByRole("button", { name: "取消已安排的恢复", exact: true }).click();
    await page.getByRole("dialog").locator(".dialog-footer button[type=submit]").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "取消已安排的恢复", exact: true })).toHaveCount(0);
    expect((await (await page.request.get("/api/backups")).json()).restore.status).toBe("none");
});
