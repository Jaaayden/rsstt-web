const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser', testMatch: '*.spec.js', workers: 1,
    use: {baseURL: 'http://127.0.0.1:8742'}, reporter: 'list',
    webServer: {
        command: 'RSSTT_DEMO_PORT=8742 RSSTT_DEMO_CONFIG=.demo/pr02 .venv/bin/python -m src.management.demo',
        url: 'http://127.0.0.1:8742/api/public', reuseExistingServer: false,
    },
});
