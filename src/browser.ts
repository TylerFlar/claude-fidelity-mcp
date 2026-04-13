import { firefox, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { FidelityConfig } from "./types.js";

const LOADING_SELECTORS = [
  "div:nth-child(2) > .loading-spinner-mask-after",
  ".pvd-spinner__mask-inner",
  "pvd-loading-spinner",
  ".pvd3-spinner-root > .pvd-spinner__spinner > .pvd-spinner__visual > div > .pvd-spinner__mask-inner",
];

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let currentConfig: FidelityConfig | null = null;

function getSessionPath(config: FidelityConfig): string {
  const title = config.sessionTitle ?? "default";
  return path.join(config.sessionDir, `fidelity_session_${title}.json`);
}

export async function initBrowser(config: FidelityConfig): Promise<Page> {
  if (page && !page.isClosed()) {
    return page;
  }

  const sessionPath = getSessionPath(config);
  currentConfig = config;

  // Ensure session directory exists
  fs.mkdirSync(config.sessionDir, { recursive: true });

  // Initialize session file if it doesn't exist
  if (!fs.existsSync(sessionPath)) {
    fs.writeFileSync(sessionPath, JSON.stringify({ cookies: [], origins: [] }));
  }

  browser = await firefox.launch({
    headless: config.headless,
    args: ["--disable-webgl", "--disable-software-rasterizer"],
  });

  // Load saved session state
  let storageState: string | undefined;
  try {
    const data = fs.readFileSync(sessionPath, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed.cookies || parsed.origins) {
      storageState = sessionPath;
    }
  } catch {
    // No valid session, start fresh
  }

  context = await browser.newContext({
    storageState,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  page = await context.newPage();

  // Basic stealth: override navigator properties
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  return page;
}

export async function getPage(): Promise<Page> {
  if (!page || page.isClosed()) {
    throw new Error(
      "Browser not initialized. Call fidelity_login first."
    );
  }
  return page;
}

export async function saveSession(): Promise<void> {
  if (!context || !currentConfig) return;
  const sessionPath = getSessionPath(currentConfig);
  try {
    const state = await context.storageState();
    fs.writeFileSync(sessionPath, JSON.stringify(state, null, 2));
  } catch {
    // Silently fail if context is already closed
  }
}

export async function closeBrowser(): Promise<void> {
  await saveSession();
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  if (context) {
    await context.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  page = null;
  context = null;
  browser = null;
}

export async function waitForLoadingComplete(
  p: Page,
  timeoutMs = 30000
): Promise<void> {
  // Wait for all known loading spinners to disappear
  for (const selector of LOADING_SELECTORS) {
    try {
      await p.waitForSelector(selector, {
        state: "hidden",
        timeout: timeoutMs,
      });
    } catch {
      // Spinner not present or already gone
    }
  }
  // Small buffer for DOM to settle
  await p.waitForTimeout(500);
}

export async function waitForLoadingCompleteDouble(
  p: Page,
  timeoutMs = 30000
): Promise<void> {
  await waitForLoadingComplete(p, timeoutMs);
  await p.waitForTimeout(1000);
  await waitForLoadingComplete(p, timeoutMs);
}

export function isBrowserReady(): boolean {
  return page !== null && !page.isClosed();
}
