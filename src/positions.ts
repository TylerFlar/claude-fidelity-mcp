import { parse } from "csv-parse/sync";
import { getPage, waitForLoadingCompleteDouble } from "./browser.js";
import type { Account } from "./types.js";

const POSITIONS_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/positions";

export async function getPositions(): Promise<Account[]> {
  // Try CSV download first, fall back to page scraping
  try {
    const csvResult = await getPositionsViaCsv();
    if (csvResult.length > 0) return csvResult;
  } catch {
    // CSV download failed, try scraping
  }

  return await getPositionsViaScrape();
}

async function getPositionsViaCsv(): Promise<Account[]> {
  const page = await getPage();

  await page.goto(POSITIONS_URL, { waitUntil: "domcontentloaded" });
  await waitForLoadingCompleteDouble(page, 150000);

  // Set up download listener BEFORE clicking
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });

  // Open the Available Actions kebab menu, then click Download
  // Strategy 1: Use the known kebab menu item ID
  let clicked = false;

  try {
    // Click "Available Actions" button to open menu
    const actionsBtn = page.locator(
      "button[aria-label='Available Actions'], button:has-text('Available Actions')"
    );
    await actionsBtn.first().click({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Click the Download menu item by its ID pattern
    const downloadBtn = page.locator(
      "#kebabmenuitem-download, button:has-text('Download')[id*='kebab']"
    );
    await downloadBtn.first().click({ timeout: 5000 });
    clicked = true;
  } catch {
    // Strategy 2: Try role-based selectors
    try {
      const actionsBtn = page.getByRole("button", { name: "Available Actions" });
      await actionsBtn.click({ timeout: 5000 });
      await page.waitForTimeout(500);
      const downloadItem = page.getByRole("menuitem", { name: "Download" });
      await downloadItem.click({ timeout: 5000 });
      clicked = true;
    } catch {
      // Strategy 3: Try label-based
      try {
        const downloadBtn = page.getByLabel("Download Positions");
        await downloadBtn.click({ timeout: 5000 });
        clicked = true;
      } catch {
        // Strategy 4: Any element with download text
        try {
          const btn = page.locator("[id*='download'], [aria-label*='ownload']");
          await btn.first().click({ timeout: 5000 });
          clicked = true;
        } catch {
          throw new Error("Could not find download button.");
        }
      }
    }
  }

  if (!clicked) {
    throw new Error("Failed to click download.");
  }

  const download = await downloadPromise;
  const dlPath = await download.path();

  if (!dlPath) {
    throw new Error("Downloaded CSV path is null.");
  }

  const fs = await import("fs");
  const csvContent = fs.readFileSync(dlPath, "utf-8");

  // Delete temp file
  try {
    fs.unlinkSync(dlPath);
  } catch {
    // Cleanup optional
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error("Downloaded CSV is empty.");
  }

  return parsePositionsCsv(csvContent);
}

async function getPositionsViaScrape(): Promise<Account[]> {
  const page = await getPage();

  if (!page.url().includes("positions")) {
    await page.goto(POSITIONS_URL, { waitUntil: "domcontentloaded" });
    await waitForLoadingCompleteDouble(page, 60000);
  }

  // Scrape directly from the positions table (Table 0 with 304 rows)
  const data = await page.evaluate(() => {
    const results: {
      accountNumber: string;
      accountName: string;
      symbol: string;
      lastPrice: string;
      lastPriceChange: string;
      currentValue: string;
      quantity: string;
      costBasis: string;
      gainLoss: string;
      gainLossPct: string;
    }[] = [];

    // Find all table rows
    const rows = document.querySelectorAll("tr, [role='row']");
    let currentAccount = "";
    let currentAccountName = "";

    for (const row of rows) {
      const cells = row.querySelectorAll("td, th, [role='cell'], [role='gridcell']");
      const text = (row.textContent ?? "").trim();

      // Account header rows typically have account name and number
      // Look for patterns like "Individual (Z23385543)" or account numbers
      const acctMatch = text.match(/(Z?\d{6,})/);

      // Check if this is an account header row (fewer cells, contains account info)
      if (cells.length <= 3 && acctMatch) {
        currentAccount = acctMatch[1];
        // Try to get account name (text before the account number)
        const nameMatch = text.match(/^(.+?)(?:\s*[-–(]?\s*(?:Z?\d{6,}))/);
        currentAccountName = nameMatch ? nameMatch[1].trim() : currentAccount;
        continue;
      }

      // Position rows have many cells (symbol, price, quantity, etc.)
      if (cells.length >= 5 && currentAccount) {
        const cellTexts: string[] = [];
        cells.forEach((c) => cellTexts.push((c.textContent ?? "").trim()));

        // First cell is usually the symbol
        const symbol = cellTexts[0]?.replace(/\s+/g, " ").split(" ")[0] ?? "";

        // Skip non-ticker rows
        if (!symbol || symbol.length > 10 || !/^[A-Z0-9.*]+$/i.test(symbol)) continue;
        if (symbol === "Symbol" || symbol === "Total") continue;

        results.push({
          accountNumber: currentAccount,
          accountName: currentAccountName,
          symbol: symbol.toUpperCase(),
          lastPrice: cellTexts[1] ?? "",
          lastPriceChange: cellTexts[2] ?? "",
          currentValue: cellTexts[7] ?? "",
          quantity: cellTexts[9] ?? "",
          costBasis: cellTexts[10] ?? "",
          gainLoss: cellTexts[5] ?? "",
          gainLossPct: cellTexts[6] ?? "",
        });
      }
    }

    return results;
  });

  const accountMap = new Map<string, Account>();

  const cleanNum = (s: string): number => {
    if (!s) return 0;
    const cleaned = s.replace(/[$,%]/g, "").trim();
    if (cleaned === "" || cleaned === "n/a" || cleaned === "--") return 0;
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  for (const row of data) {
    if (!accountMap.has(row.accountNumber)) {
      accountMap.set(row.accountNumber, {
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        nickname: row.accountName,
        balance: 0,
        withdrawalBalance: 0,
        stocks: [],
      });
    }

    const account = accountMap.get(row.accountNumber)!;
    const ticker = row.symbol;

    if (
      ticker === "SPAXX" ||
      ticker === "FCASH" ||
      ticker === "FDRXX" ||
      ticker === "FZFXX"
    ) {
      const val = cleanNum(row.currentValue) || cleanNum(row.quantity);
      account.balance += val;
      account.withdrawalBalance += val;
    }

    account.stocks.push({
      ticker,
      description: "",
      quantity: cleanNum(row.quantity),
      lastPrice: cleanNum(row.lastPrice),
      lastPriceChange: cleanNum(row.lastPriceChange),
      currentValue: cleanNum(row.currentValue),
    });
  }

  return Array.from(accountMap.values());
}

function parsePositionsCsv(csvContent: string): Account[] {
  // Handle potential BOM and normalize line endings
  const cleaned = csvContent.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const records: Record<string, string>[] = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const accountMap = new Map<string, Account>();

  // Detect column names (Fidelity may change these)
  const firstRow = records[0] ?? {};
  const colNames = Object.keys(firstRow);

  // Flexible column matching
  const findCol = (patterns: string[]): string | undefined =>
    colNames.find((c) =>
      patterns.some((p) => c.toLowerCase().includes(p.toLowerCase()))
    );

  const accountCol = findCol(["Account Number", "Account", "Acct"]) ?? "Account Number";
  const nameCol = findCol(["Account Name", "Name"]) ?? "Account Name";
  const symbolCol = findCol(["Symbol", "Ticker"]) ?? "Symbol";
  const descCol = findCol(["Description", "Desc", "Name"]) ?? "Description";
  const qtyCol = findCol(["Quantity", "Qty", "Shares"]) ?? "Quantity";
  const priceCol = findCol(["Last Price", "Price", "Last"]) ?? "Last Price";
  const changeCol = findCol(["Last Price Change", "Price Change", "Change"]) ?? "Last Price Change";
  const valueCol = findCol(["Current Value", "Value", "Market Value"]) ?? "Current Value";

  for (const row of records) {
    const accountNumber = row[accountCol]?.trim();
    const accountName = row[nameCol]?.trim() ?? "";

    if (!accountNumber) continue;
    if (accountNumber.startsWith("Y")) continue;

    if (!accountMap.has(accountNumber)) {
      accountMap.set(accountNumber, {
        accountNumber,
        accountName,
        nickname: accountName,
        balance: 0,
        withdrawalBalance: 0,
        stocks: [],
      });
    }

    const account = accountMap.get(accountNumber)!;
    const ticker = row[symbolCol]?.trim() ?? "";
    const description = row[descCol]?.trim() ?? "";

    if (!ticker || ticker === "Pending Activity") continue;

    const cleanNumber = (val: string | undefined): number => {
      if (!val) return 0;
      const c = val.replace(/[$,]/g, "").trim();
      if (c === "" || c === "n/a" || c === "--") return 0;
      const parsed = parseFloat(c);
      return isNaN(parsed) ? 0 : parsed;
    };

    const quantity = cleanNumber(row[qtyCol]);
    const lastPrice = cleanNumber(row[priceCol]);
    const lastPriceChange = cleanNumber(row[changeCol]);
    const currentValue = cleanNumber(row[valueCol]);

    if (
      ticker === "SPAXX" ||
      ticker === "FCASH" ||
      ticker === "FDRXX" ||
      ticker === "FZFXX" ||
      description.toLowerCase().includes("cash")
    ) {
      account.balance += currentValue || quantity;
      account.withdrawalBalance += currentValue || quantity;
    }

    account.stocks.push({
      ticker,
      description,
      quantity: quantity || 1,
      lastPrice,
      lastPriceChange,
      currentValue,
    });
  }

  return Array.from(accountMap.values());
}
