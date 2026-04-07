import { getPage, waitForLoadingComplete } from "./browser.js";
import type { OrderRequest, OrderResult, QuoteResult } from "./types.js";

const TRADE_URL =
  "https://digital.fidelity.com/ftgw/digital/trade-equity/index/orderEntry";

async function navigateToTrade(): Promise<void> {
  const page = await getPage();
  // Always force-navigate to get a clean order entry form.
  // After placing an order, the URL still contains "trade-equity" but the DOM
  // is on the confirmation page, causing stale element errors on the next order.
  await page.goto(TRADE_URL, { waitUntil: "domcontentloaded" });
  await waitForLoadingComplete(page);
}

async function selectAccount(accountNumber: string): Promise<void> {
  const page = await getPage();

  const dropdown = page.locator("#dest-acct-dropdown");
  await dropdown.click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  const accountOption = page
    .locator("button[role='option']")
    .filter({ hasText: accountNumber });

  try {
    await accountOption.click({ timeout: 5000 });
  } catch {
    // Retry: reload page and try again
    await page.goto(TRADE_URL, { waitUntil: "domcontentloaded" });
    await waitForLoadingComplete(page);
    await dropdown.click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await accountOption.click({ timeout: 5000 });
  }

  await page.waitForTimeout(2000);
}

async function enterSymbol(symbol: string): Promise<void> {
  const page = await getPage();

  const symbolInput = page.getByLabel("Symbol", { exact: true });
  await symbolInput.fill(symbol);
  await symbolInput.press("Enter");

  // Wait for quote to load
  await page.waitForSelector("#quote-panel", { timeout: 15000 });
  await waitForLoadingComplete(page);

  // Dismiss any autocomplete dropdown by clicking outside the symbol input
  await page.locator("#quote-panel").click();
  await page.waitForTimeout(500);
}

async function getLastPrice(): Promise<{
  price: number;
  isExtendedHours: boolean;
}> {
  const page = await getPage();

  const priceSpan = page.locator("#eq-ticket__last-price > span.last-price");
  const priceText = await priceSpan.textContent({ timeout: 10000 });

  if (!priceText) {
    throw new Error("Could not read stock price.");
  }

  const price = parseFloat(priceText.replace(/[$,]/g, ""));
  if (isNaN(price)) {
    throw new Error(`Invalid price: ${priceText}`);
  }

  // Check extended hours
  let isExtendedHours = false;
  try {
    const extToggle = page.locator("#eq-ticket_extendedhour");
    if (await extToggle.isVisible({ timeout: 2000 })) {
      const toggleWrapper = page.locator(".eq-ticket__extendedhour-toggle");
      const classes = (await toggleWrapper.getAttribute("class")) ?? "";
      if (classes.includes("pvd-switch--on")) {
        isExtendedHours = true;
      }
    }
  } catch {
    // Not in extended hours
  }

  return { price, isExtendedHours };
}

async function enableExtendedHours(): Promise<boolean> {
  const page = await getPage();

  try {
    const extToggle = page.locator("#eq-ticket_extendedhour");
    if (!(await extToggle.isVisible({ timeout: 2000 }))) {
      return false;
    }

    const toggleWrapper = page.locator(".eq-ticket__extendedhour-toggle");
    const classes = (await toggleWrapper.getAttribute("class")) ?? "";

    if (!classes.includes("pvd-switch--on")) {
      await extToggle.click();
      await page.waitForTimeout(2000);
    }

    return true;
  } catch {
    // Try fallback check
    try {
      const extText = page.getByText(
        "Extended hours trading: OffUntil 8:00 PM ET"
      );
      if (await extText.isVisible({ timeout: 1000 })) {
        await extText.click();
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      // No extended hours available
    }
    return false;
  }
}

export async function getQuote(symbol: string): Promise<QuoteResult> {
  await navigateToTrade();
  await enterSymbol(symbol);

  const { price, isExtendedHours } = await getLastPrice();

  const result: QuoteResult = {
    symbol: symbol.toUpperCase(),
    lastPrice: price,
    isExtendedHours,
  };

  // Try to get extended hours price
  if (!isExtendedHours) {
    const enabled = await enableExtendedHours();
    if (enabled) {
      const extPrice = await getLastPrice();
      result.extendedHoursPrice = extPrice.price;
    }
  }

  return result;
}

export interface BatchOrder {
  symbol: string;
  quantity: number;
  action: "buy" | "sell";
}

export interface BatchResult {
  symbol: string;
  quantity: number;
  success: boolean;
  message: string;
}

export async function placeBatchOrders(
  accountNumber: string,
  orders: BatchOrder[],
  dryRun: boolean,
): Promise<{ results: BatchResult[]; succeeded: number; failed: number }> {
  const results: BatchResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const result = await placeOrder({
        accountNumber,
        symbol: order.symbol,
        action: order.action,
        quantity: order.quantity,
        dryRun,
      });
      results.push({
        symbol: order.symbol,
        quantity: order.quantity,
        success: result.success,
        message: result.message,
      });
      if (result.success) succeeded++;
      else failed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        symbol: order.symbol,
        quantity: order.quantity,
        success: false,
        message: msg,
      });
      failed++;
    }
  }

  return { results, succeeded, failed };
}

export async function placeOrder(order: OrderRequest): Promise<OrderResult> {
  const page = await getPage();

  await navigateToTrade();
  await selectAccount(order.accountNumber);
  await enterSymbol(order.symbol);

  // Expand ticket if needed
  try {
    const expandBtn = page.getByRole("button", {
      name: "View expanded ticket",
    });
    if (await expandBtn.isVisible({ timeout: 2000 })) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // Already expanded or not available
  }

  // Get current price
  let { price, isExtendedHours } = await getLastPrice();

  // Enable extended hours if available
  const extEnabled = await enableExtendedHours();
  if (extEnabled && !isExtendedHours) {
    const updated = await getLastPrice();
    price = updated.price;
    isExtendedHours = updated.isExtendedHours;
  }

  // Select Buy or Sell
  const actionDropdown = page.locator("#dest-dropdownlist-button-action");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await actionDropdown.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      const optionName = order.action === "buy" ? "Buy" : "Sell";
      // Try multiple selector strategies for the dropdown option
      const option =
        page.locator(`[role='option']:has-text("${optionName}")`).first();
      await option.waitFor({ state: "visible", timeout: 3000 });
      await option.click({ timeout: 3000 });
      break;
    } catch {
      if (attempt === 4) {
        return {
          success: false,
          message: "Failed to select buy/sell action after 5 attempts.",
        };
      }
      await page.waitForTimeout(500);
    }
  }

  // Enter quantity
  const quantityDiv = page
    .locator("#eqt-mts-stock-quatity div")
    .filter({ hasText: "Quantity" });
  await quantityDiv.click();

  const quantityInput = page.locator(
    "#eqt-mts-stock-quatity input, #eqt-mts-stock-quatity [role='spinbutton']"
  );
  await quantityInput.fill(order.quantity.toString());

  // Determine order type
  let resolvedOrderType = order.orderType ?? "market";
  let resolvedLimitPrice = order.limitPrice;
  const precision = isExtendedHours || price < 1 ? 2 : 3;

  // Force limit for penny stocks, extended hours, or explicit limit
  if (price < 1 || isExtendedHours || resolvedLimitPrice !== undefined) {
    resolvedOrderType = "limit";

    if (resolvedLimitPrice === undefined) {
      const increment = price < 0.1 ? 0.0001 : 0.01;
      resolvedLimitPrice =
        order.action === "buy"
          ? parseFloat((price + increment).toFixed(precision))
          : parseFloat((price - increment).toFixed(precision));
    }
  }

  // Set order type
  if (resolvedOrderType === "limit") {
    const orderTypeSelector = page.locator(
      "#dest-dropdownlist-button-ordertype > span:nth-child(1)"
    );
    await orderTypeSelector.click({ timeout: 5000 });
    await page
      .getByRole("option", { name: "Limit", exact: true })
      .click({ timeout: 3000 });

    const limitInput = page.getByLabel("Limit price");
    await limitInput.fill(resolvedLimitPrice!.toFixed(precision));
  } else {
    // Market order
    const orderContainer = page.locator("#order-type-container-id");
    await orderContainer.click({ timeout: 5000 });
    await page
      .getByRole("option", { name: "Market", exact: true })
      .click({ timeout: 3000 });
  }

  // Preview order
  await page.getByRole("button", { name: "Preview order" }).click();
  await waitForLoadingComplete(page);

  // Wait for Place order button
  const placeOrderBtn = page.getByRole("button", { name: "Place order" });
  try {
    await placeOrderBtn.waitFor({ state: "visible", timeout: 10000 });
  } catch {
    // Try to extract error message
    let errorMsg = "Order preview failed.";
    try {
      const errorDialog = page.getByLabel("Error");
      if (await errorDialog.isVisible({ timeout: 2000 })) {
        errorMsg =
          (await errorDialog.textContent()) ?? "Unknown error in order preview.";
      }
    } catch {
      try {
        const errorFont = page.locator(
          '.pvd-inline-alert__content font[color="red"]'
        );
        if (await errorFont.isVisible({ timeout: 1000 })) {
          errorMsg =
            (await errorFont.textContent()) ?? "Order validation error.";
        }
      } catch {
        // Use default error
      }
    }

    return { success: false, message: errorMsg };
  }

  // Verify order details in preview
  const previewText = await page.locator(".order-preview, .preview-order").textContent().catch(() => "");
  if (previewText) {
    const upperSymbol = order.symbol.toUpperCase();
    if (!previewText.includes(upperSymbol) && !previewText.toLowerCase().includes(order.symbol.toLowerCase())) {
      return {
        success: false,
        message: `Order preview does not contain expected symbol ${upperSymbol}. Aborting for safety.`,
      };
    }
  }

  if (order.dryRun) {
    return {
      success: true,
      message: "Dry run complete. Order previewed but not placed.",
      orderDetails: {
        account: order.accountNumber,
        symbol: order.symbol.toUpperCase(),
        action: order.action,
        quantity: order.quantity,
        price,
        orderType: resolvedOrderType,
      },
    };
  }

  // Place the order
  await placeOrderBtn.click();
  await waitForLoadingComplete(page);

  try {
    const confirmation = page.getByText("Order received", { exact: true });
    await confirmation.waitFor({ state: "visible", timeout: 15000 });

    return {
      success: true,
      message: `Order placed successfully: ${order.action.toUpperCase()} ${order.quantity} ${order.symbol.toUpperCase()} @ ${resolvedOrderType === "limit" ? `$${resolvedLimitPrice!.toFixed(precision)} limit` : "market"}.`,
      orderDetails: {
        account: order.accountNumber,
        symbol: order.symbol.toUpperCase(),
        action: order.action,
        quantity: order.quantity,
        price,
        orderType: resolvedOrderType,
      },
    };
  } catch {
    return {
      success: false,
      message:
        "Order may not have been confirmed. Check your Fidelity account directly.",
    };
  }
}
