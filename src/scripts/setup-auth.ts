#!/usr/bin/env node
/**
 * First-time Fidelity authentication setup.
 *
 * If FIDELITY_TOTP_SECRET is set — fully automated headless login.
 * If not — prompts for 2FA code interactively via stdin.
 *
 * Usage:
 *   node dist/scripts/setup-auth.js
 *   # or via npm:
 *   npm run setup
 */

import * as readline from "readline/promises";
import { login, submit2FACode } from "../auth.js";
import { closeBrowser } from "../browser.js";
import type { FidelityConfig } from "../types.js";
import * as path from "path";
import * as os from "os";

const config: FidelityConfig = {
  headless: process.env.FIDELITY_HEADLESS !== "false",
  sessionDir:
    process.env.BROWSER_DATA_DIR ??
    process.env.FIDELITY_SESSION_DIR ??
    path.join(os.homedir(), ".fidelity-mcp"),
  sessionTitle: process.env.FIDELITY_SESSION_TITLE,
  debug: process.env.FIDELITY_DEBUG === "true",
  timeout: parseInt(process.env.FIDELITY_TIMEOUT ?? "30000", 10),
};

const username = process.env.FIDELITY_USERNAME;
const password = process.env.FIDELITY_PASSWORD;
const totpSecret = process.env.FIDELITY_TOTP_SECRET;

if (!username || !password) {
  console.error(
    "Error: FIDELITY_USERNAME and FIDELITY_PASSWORD must be set."
  );
  process.exit(1);
}

console.log(`Session directory: ${config.sessionDir}`);
console.log(`Headless: ${config.headless}`);
console.log(`TOTP: ${totpSecret ? "configured (automatic)" : "not set (interactive)"}`);
console.log("Starting login...\n");

try {
  const result = await login(config, username, password, totpSecret);

  if (result.success) {
    console.log("Login successful! Session saved.");
    await closeBrowser();
    process.exit(0);
  }

  if (result.needsSms2FA) {
    console.log(result.message);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const code = await rl.question("Enter your 2FA code: ");
    rl.close();

    const smsResult = await submit2FACode(code.trim());
    await closeBrowser();

    if (smsResult.success) {
      console.log("Login successful! Session saved.");
      process.exit(0);
    } else {
      console.error(`2FA submission failed: ${smsResult.message}`);
      process.exit(1);
    }
  }

  // Login failed without 2FA prompt
  console.error(`Login failed: ${result.message}`);
  await closeBrowser();
  process.exit(1);
} catch (e) {
  console.error("Fatal error during setup:", e);
  await closeBrowser().catch(() => {});
  process.exit(1);
}
