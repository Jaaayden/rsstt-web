const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('管理台密码', { exact: true }).fill(process.env.WEB_PASSWORD);
    await page.getByRole('button', { name: /进入管理台/ }).click();
    await expect(page.getByRole('link', { name: '设置', exact: true })).toBeVisible();
});

test('notification configuration and offline explicit test', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('link', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '管理员通知', exact: true }).click();
    await expect(page.getByText('离线模式：所有通知及测试仅模拟，不会外连。')).toBeVisible();
    await page.locator('#notification-policy input[name=enabled]').check();
    const previousPolicy = await page.locator('#notification-policy').elementHandle();
    await page.getByRole('button', { name: '保存策略', exact: true }).click();
    await page.waitForFunction(el => !el.isConnected, previousPolicy);
    const form = page.locator('#notification-channel');
    await form.locator('select').selectOption('webhook');
    await form.locator('input[name=url]').fill('https://example.invalid/secret');
    await form.getByRole('button', { name: '保存渠道', exact: true }).click();
    const channel = page.locator('.notification-test').filter({ hasText: 'webhook' });
    await expect(channel).toContainText('已启用');
    await expect(form.locator('input[name=url]')).toHaveValue('');
    await channel.getByRole('button', { name: '模拟测试' }).click();
    await expect.poll(async () => (await (await page.request.get('/api/notifications/history')).json()).items.some(j => j.status === 'simulated')).toBe(true);
    const config = await (await page.request.get('/api/notifications')).text();
    expect(config).not.toContain('secret');
    expect(errors).toEqual([]);
});
