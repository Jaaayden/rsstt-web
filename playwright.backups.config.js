const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser', testMatch: 'backups.spec.js', workers: 1,
    timeout: 30000, reporter: 'list',
    use: {baseURL: 'http://127.0.0.1:8746'},
    webServer: {
        command: 'WEB_PORT=8746 WEB_DEMO_CONFIG=.test-data/backups-browser .venv/bin/python -m src.management.demo',
        url: 'http://127.0.0.1:8746/api/public', reuseExistingServer: false, timeout: 30000,
    },
});
