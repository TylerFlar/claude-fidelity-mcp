#!/usr/bin/env node
/**
 * Opens a VISIBLE browser for manual Fidelity login.
 * Log in yourself, complete 2FA, then the script detects success and saves the session.
 *
 * Usage:
 *   npx tsx src/scripts/manual-login.ts
 */

import { firefox } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const sessionDir =
  process.env.BROWSER_DATA_DIR ??
  process.env.FIDELITY_SESSION_DIR ??
  path.join(os.homedir(), ".fidelity-mcp");
const sessionTitle = process.env.FIDELITY_SESSION_TITLE ?? "default";
const sessionPath = path.join(sessionDir, `fidelity_session_${sessionTitle}.json`);

console.log(`\n=== Fidelity Manual Login ===`);
console.log(`A Firefox window will open. Log in manually and complete any 2FA.`);
console.log(`Session will be saved to: ${sessionPath}\n`);

fs.mkdirSync(sessionDir, { recursive: true });

const browser = await firefox.launch({ headless: false });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
});

const page = await context.newPage();
await page.goto("https://digital.fidelity.com/prgw/digital/login/full-page", {
  waitUntil: "domcontentloaded",
});

console.log("Waiting for you to log in...");
console.log("(Watching for portfolio/summary URL — or close the browser to abort)\n");

const TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 2000;
const start = Date.now();
let success = false;

while (Date.now() - start < TIMEOUT_MS) {
  if (context.pages().length === 0) {
    console.log("Browser closed. Aborting.");
    break;
  }

  const currentUrl = page.url();
  if (currentUrl.includes("summary") || currentUrl.includes("portfolio")) {
    console.log(`Detected successful login! URL: ${currentUrl}`);
    await page.waitForTimeout(3000);
    success = true;
    break;
  }

  await new Promise(r => setTimeout(r, POLL_MS));
}

if (success) {
  const state = await context.storageState();
  fs.writeFileSync(sessionPath, JSON.stringify(state, null, 2));
  console.log(`\nSession saved to ${sessionPath}`);
  console.log("You can close the browser now.");
} else if (Date.now() - start >= TIMEOUT_MS) {
  console.log("Timed out waiting for login.");
}

try {
  await page.waitForEvent("close", { timeout: 60000 });
} catch {
  // timeout or already closed
}

await browser.close().catch(() => {});
console.log("Done.");
