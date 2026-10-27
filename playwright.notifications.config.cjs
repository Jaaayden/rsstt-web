const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser',
    testMatch: 'notifications.spec.js',
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:8745' },
    webServer: {
        command: 'DEMO_PORT=8745 .venv/bin/python -m src.management.demo',
        url: 'http://127.0.0.1:8745/api/public',
        reuseExistingServer: false,
        timeout: 30000,
    },
});
