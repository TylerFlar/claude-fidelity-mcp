import { parse } from "csv-parse/sync";
import { getPage, waitForLoadingCompleteDouble } from "./browser.js";
import type { Account, Stock } from "./types.js";

const POSITIONS_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/positions";

export async function getPositions(): Promise<Account[]> {
  const page = await getPage();

  await page.goto(POSITIONS_URL, { waitUntil: "domcontentloaded" });
  await waitForLoadingCompleteDouble(page, 150000); // Long timeout for large portfolios

  // Download positions CSV
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

  // Try new UI first
  let downloaded = false;
  try {
    const actionsBtn = page.getByRole("button", { name: "Available Actions" });
    await actionsBtn.click({ timeout: 5000 });
    const downloadItem = page.getByRole("menuitem", { name: "Download" });
    await downloadItem.click({ timeout: 5000 });
    downloaded = true;
  } catch {
    // Try old UI
    try {
      const downloadBtn = page.getByLabel("Download Positions");
      await downloadBtn.click({ timeout: 5000 });
      downloaded = true;
    } catch {
      throw new Error(
        "Could not find download button. Fidelity UI may have changed."
      );
    }
  }

  if (!downloaded) {
    throw new Error("Failed to initiate positions download.");
  }

  const download = await downloadPromise;
  const dlPath = await download.path();

  if (!dlPath) {
    throw new Error("Downloaded CSV path is null.");
  }

  const fs = await import("fs");
  const csvContent = fs.readFileSync(dlPath, "utf-8");

  if (!csvContent) {
    throw new Error("Downloaded CSV is empty.");
  }

  // Delete temp file
  try {
    fs.unlinkSync(dlPath);
  } catch {
    // Cleanup optional
  }

  return parsePositionsCsv(csvContent);
}

function parsePositionsCsv(csvContent: string): Account[] {
  const records: Record<string, string>[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const accountMap = new Map<string, Account>();

  for (const row of records) {
    const accountNumber = row["Account Number"]?.trim();
    const accountName = row["Account Name"]?.trim() ?? "";

    if (!accountNumber) continue;

    // Skip managed accounts (Y-prefixed)
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
    const ticker = row["Symbol"]?.trim() ?? "";
    const description = row["Description"]?.trim() ?? "";

    // Skip empty/pending rows
    if (!ticker || ticker === "Pending Activity") continue;

    const cleanNumber = (val: string | undefined): number => {
      if (!val) return 0;
      const cleaned = val.replace(/[$,]/g, "").trim();
      if (cleaned === "" || cleaned === "n/a" || cleaned === "--") return 0;
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    const quantity = cleanNumber(row["Quantity"]);
    const lastPrice = cleanNumber(row["Last Price"]);
    const lastPriceChange = cleanNumber(row["Last Price Change"]);
    const currentValue = cleanNumber(row["Current Value"]);

    // Cash positions (SPAXX, FCASH, etc.) - treat as balance
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

    const stock: Stock = {
      ticker,
      description,
      quantity: quantity || 1,
      lastPrice,
      lastPriceChange,
      currentValue,
    };

    account.stocks.push(stock);
  }

  return Array.from(accountMap.values());
}
