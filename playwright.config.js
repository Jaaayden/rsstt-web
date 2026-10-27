const { defineConfig } = require("@playwright/test");
const { randomBytes } = require("node:crypto");
const { mkdirSync, mkdtempSync } = require("node:fs");
const { resolve } = require("node:path");
process.env.WEB_PASSWORD ||= randomBytes(24).toString("hex");
process.env.WEB_PORT ||= "8741";
mkdirSync(".test-data", { recursive: true });
process.env.WEB_DEMO_CONFIG ||= mkdtempSync(resolve(".test-data/browser-"));
const origin = `http://127.0.0.1:${process.env.WEB_PORT}`;
module.exports = defineConfig({
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    timeout: 30000,
    reporter: "list",
    use: {
        baseURL: origin,
        locale: "zh-CN",
        viewport: { width: 1440, height: 1000 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: ".venv/bin/python -m src.management.demo",
        url: origin + "/api/public",
        reuseExistingServer: false,
        timeout: 30000,
    },
});
