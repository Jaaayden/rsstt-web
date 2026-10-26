const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser', workers: 1, timeout: 30000,
    use: { baseURL: 'http://127.0.0.1:8743', viewport: {width:1440,height:1000} },
    webServer: {
        command: 'RSSTT_DEMO_PORT=8743 RSSTT_DEMO_CONFIG=.test-data/pr03 .venv/bin/python -m src.management.demo',
        url: 'http://127.0.0.1:8743/api/public', reuseExistingServer: false,
    },
});
