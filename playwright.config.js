const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    timeout: 30000,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:8730",
        viewport: { width: 1440, height: 1000 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: ".venv/bin/python -m src.management.demo",
        url: "http://127.0.0.1:8730/api/public",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
