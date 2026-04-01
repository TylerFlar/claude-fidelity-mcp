import * as OTPAuth from "otpauth";
import type { Page } from "playwright";
import {
  initBrowser,
  waitForLoadingComplete,
  waitForLoadingCompleteDouble,
  saveSession,
} from "./browser.js";
import type { FidelityConfig, LoginResult } from "./types.js";

const LOGIN_URL =
  "https://digital.fidelity.com/prgw/digital/login/full-page";
const SUMMARY_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/summary";

export async function login(
  config: FidelityConfig,
  username: string,
  password: string,
  totpSecret?: string
): Promise<LoginResult> {
  const page = await initBrowser(config);

  // Navigate to login page (double navigation to handle redirects)
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Fill credentials
  const usernameField = page.getByLabel("Username", { exact: true });
  await usernameField.waitFor({ state: "visible", timeout: config.timeout });
  await usernameField.fill(username);

  const passwordField = page.getByLabel("Password", { exact: true });
  await passwordField.fill(password);

  // Click login
  await page.getByRole("button", { name: "Log in" }).click();

  // Wait for loading
  await waitForLoadingCompleteDouble(page, config.timeout);

  // Check if we landed on summary (no 2FA needed)
  if (page.url().includes("summary")) {
    await saveSession();
    return {
      success: true,
      needsSms2FA: false,
      message: "Login successful. No 2FA required.",
    };
  }

  // Still on login page - 2FA required
  if (page.url().includes("login")) {
    return await handle2FA(page, config, totpSecret);
  }

  return {
    success: false,
    needsSms2FA: false,
    message: `Unexpected URL after login: ${page.url()}`,
  };
}

async function handle2FA(
  page: Page,
  config: FidelityConfig,
  totpSecret?: string
): Promise<LoginResult> {
  // Wait for 2FA widget
  try {
    await page.waitForSelector("#dom-widget div", {
      state: "visible",
      timeout: 15000,
    });
  } catch {
    return {
      success: false,
      needsSms2FA: false,
      message: "2FA widget did not appear. Login may have failed.",
    };
  }

  // Check if TOTP authenticator code is requested
  const totpHeading = page.getByRole("heading", {
    name: "Enter the code from your",
  });

  if (totpSecret) {
    try {
      await totpHeading.waitFor({ state: "visible", timeout: 5000 });

      // Generate TOTP code
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecret),
        digits: 6,
        period: 30,
      });
      const code = totp.generate();

      // Fill code
      const codeInput = page.getByPlaceholder("XXXXXX");
      await codeInput.fill(code);

      // Check "Don't ask me again"
      try {
        const rememberLabel = page
          .locator("label")
          .filter({ hasText: "Don't ask me again on this" });
        if (await rememberLabel.isVisible()) {
          await rememberLabel.click();
        }
      } catch {
        // Optional checkbox
      }

      // Submit
      await page.getByRole("button", { name: "Continue" }).click();

      // Wait for redirect to summary
      await page.waitForURL("**/portfolio/summary", {
        timeout: config.timeout,
      });
      await waitForLoadingComplete(page);
      await saveSession();

      return {
        success: true,
        needsSms2FA: false,
        message: "Login successful with TOTP authentication.",
      };
    } catch (e) {
      return {
        success: false,
        needsSms2FA: false,
        message: `TOTP authentication failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // No TOTP secret - try to fall back to SMS
  try {
    // Check for "Try another way" link (push notification page)
    const tryAnotherWay = page.getByRole("link", { name: "Try another way" });
    if (await tryAnotherWay.isVisible({ timeout: 3000 })) {
      // Check "Don't ask me again" first
      try {
        const rememberLabel = page
          .locator("label")
          .filter({ hasText: "Don't ask me again on this" });
        if (await rememberLabel.isVisible()) {
          await rememberLabel.click();
        }
      } catch {
        // Optional
      }
      await tryAnotherWay.click();
      await page.waitForTimeout(2000);
    }
  } catch {
    // Not on push notification page
  }

  // Try to click "Text me the code"
  try {
    const textMeBtn = page.getByRole("button", { name: "Text me the code" });
    await textMeBtn.waitFor({ state: "visible", timeout: 5000 });
    await textMeBtn.click();
    await page.waitForTimeout(2000);

    // Click the code input to focus it
    const codeInput = page.getByPlaceholder("XXXXXX");
    await codeInput.click();

    return {
      success: true,
      needsSms2FA: true,
      message:
        "SMS code sent. Use fidelity_submit_2fa tool to enter the code.",
    };
  } catch {
    // Check if TOTP is required but no secret was provided
    try {
      if (await totpHeading.isVisible()) {
        return {
          success: false,
          needsSms2FA: false,
          message:
            "Authenticator app code required but no TOTP secret provided. Set FIDELITY_TOTP_SECRET environment variable.",
        };
      }
    } catch {
      // Ignore
    }

    return {
      success: false,
      needsSms2FA: false,
      message: "Could not initiate 2FA. Check your Fidelity security settings.",
    };
  }
}

export async function submit2FACode(code: string): Promise<LoginResult> {
  const { getPage } = await import("./browser.js");
  const page = await getPage();

  try {
    const codeInput = page.getByPlaceholder("XXXXXX");
    await codeInput.fill(code);

    // Check "Don't ask me again"
    try {
      const rememberLabel = page
        .locator("label")
        .filter({ hasText: "Don't ask me again on this" });
      if (await rememberLabel.isVisible()) {
        await rememberLabel.click();
      }
    } catch {
      // Optional
    }

    // Click Submit
    await page.getByRole("button", { name: "Submit" }).click();

    // Wait for redirect to summary
    await page.waitForURL("**/portfolio/summary", { timeout: 30000 });
    await waitForLoadingComplete(page);
    await saveSession();

    return {
      success: true,
      needsSms2FA: false,
      message: "2FA verification successful. Login complete.",
    };
  } catch (e) {
    return {
      success: false,
      needsSms2FA: false,
      message: `2FA submission failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
