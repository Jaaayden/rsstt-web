// Reuse the authenticated test harness with a dedicated PR02 port and fresh database.
process.env.WEB_PORT = "8742";
module.exports = require("./playwright.config.js");
