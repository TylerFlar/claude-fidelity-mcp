import { getPage, waitForLoadingComplete } from "./browser.js";
import type { Account } from "./types.js";

const TRANSFERS_URL =
  "https://digital.fidelity.com/ftgw/digital/transfer/?quicktransfer=cash-shares";

const ACCOUNT_REGEX = /(?<=\()(Z|\d)\d{6,}(?=\))/;
const NICKNAME_REGEX = /^.+?(?=\()/;

export interface AccountListItem {
  accountNumber: string;
  nickname: string;
  withdrawalBalance?: number;
}

export async function getAccountList(
  includeBalances = false
): Promise<AccountListItem[]> {
  const page = await getPage();

  await page.goto(TRANSFERS_URL, { waitUntil: "domcontentloaded" });
  await waitForLoadingComplete(page);

  const fromDropdown = page.getByLabel("From");
  await fromDropdown.waitFor({ state: "visible", timeout: 15000 });

  const options = await fromDropdown.locator("option").all();
  const accounts: AccountListItem[] = [];

  for (const option of options) {
    const text = (await option.textContent()) ?? "";
    const numberMatch = text.match(ACCOUNT_REGEX);
    const nicknameMatch = text.match(NICKNAME_REGEX);

    if (!numberMatch) continue;

    const account: AccountListItem = {
      accountNumber: numberMatch[0],
      nickname: nicknameMatch ? nicknameMatch[0].trim() : "",
    };

    if (includeBalances) {
      await fromDropdown.selectOption({ label: text.trim() });
      await page.waitForTimeout(500);
      await waitForLoadingComplete(page);

      try {
        const balanceCell = page.locator(
          "tr.pvd-table__row:nth-child(2) > td:nth-child(2)"
        );
        const balanceText = await balanceCell.textContent({ timeout: 5000 });
        if (balanceText) {
          account.withdrawalBalance = parseFloat(
            balanceText.replace(/[$,]/g, "")
          );
        }
      } catch {
        account.withdrawalBalance = 0;
      }
    }

    accounts.push(account);
  }

  return accounts;
}

export async function getAccountSummary(): Promise<Account[]> {
  // Uses the positions CSV approach for comprehensive data
  // This is called from positions.ts - here we provide the account list fallback
  const items = await getAccountList(true);
  return items.map((item) => ({
    accountNumber: item.accountNumber,
    accountName: item.nickname,
    nickname: item.nickname,
    balance: item.withdrawalBalance ?? 0,
    withdrawalBalance: item.withdrawalBalance ?? 0,
    stocks: [],
  }));
}

export async function transfer(
  fromAccount: string,
  toAccount: string,
  amount: number
): Promise<{ success: boolean; message: string }> {
  const page = await getPage();

  await page.goto(TRANSFERS_URL, { waitUntil: "domcontentloaded" });
  await waitForLoadingComplete(page);

  // Select "From" account
  const fromDropdown = page.getByLabel("From");
  await fromDropdown.waitFor({ state: "visible", timeout: 15000 });

  const fromOptions = await fromDropdown.locator("option").all();
  let fromFound = false;
  for (const option of fromOptions) {
    const text = (await option.textContent()) ?? "";
    if (text.includes(fromAccount)) {
      await fromDropdown.selectOption({ label: text.trim() });
      fromFound = true;
      break;
    }
  }
  if (!fromFound) {
    return {
      success: false,
      message: `Source account ${fromAccount} not found.`,
    };
  }

  await page.waitForTimeout(500);
  await waitForLoadingComplete(page);

  // Check available balance
  try {
    const balanceCell = page.locator(
      "tr.pvd-table__row:nth-child(2) > td:nth-child(2)"
    );
    const balanceText = await balanceCell.textContent({ timeout: 5000 });
    if (balanceText) {
      const available = parseFloat(balanceText.replace(/[$,]/g, ""));
      if (amount > available) {
        return {
          success: false,
          message: `Insufficient funds. Available: $${available.toFixed(2)}, Requested: $${amount.toFixed(2)}`,
        };
      }
    }
  } catch {
    // Continue anyway
  }

  // Select "To" account
  const toDropdown = page.getByLabel("To", { exact: true });
  const toOptions = await toDropdown.locator("option").all();
  let toFound = false;
  for (const option of toOptions) {
    const text = (await option.textContent()) ?? "";
    if (text.includes(toAccount)) {
      await toDropdown.selectOption({ label: text.trim() });
      toFound = true;
      break;
    }
  }
  if (!toFound) {
    return {
      success: false,
      message: `Destination account ${toAccount} not found.`,
    };
  }

  await page.waitForTimeout(500);

  // Fill amount
  const amountInput = page.locator("#transfer-amount");
  await amountInput.fill(amount.toFixed(2));

  // Submit
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForLoadingComplete(page);

  // Confirm
  try {
    await page.getByRole("button", { name: "Submit" }).click();
    await waitForLoadingComplete(page);

    const successText = page.getByText("Request submitted");
    await successText.waitFor({ state: "visible", timeout: 15000 });

    return {
      success: true,
      message: `Successfully transferred $${amount.toFixed(2)} from ${fromAccount} to ${toAccount}.`,
    };
  } catch (e) {
    return {
      success: false,
      message: `Transfer failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
