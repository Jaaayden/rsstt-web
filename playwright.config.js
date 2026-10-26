const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    timeout: 30000,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:8747",
        locale: "zh-CN",
        viewport: { width: 1440, height: 1000 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "RSSTT_DEMO_PORT=8747 RSSTT_DEMO_CONFIG=.demo/pr07 .venv/bin/python -m src.management.demo",
        url: "http://127.0.0.1:8747/api/public",
        reuseExistingServer: false,
        timeout: 30000,
    },
});
