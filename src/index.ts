#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { login, submit2FACode } from "./auth.js";
import { getAccountList, transfer } from "./accounts.js";
import { getPositions } from "./positions.js";
import { getQuote, placeOrder, placeBatchOrders } from "./trading.js";
import { closeBrowser, getPage, isBrowserReady, saveSession } from "./browser.js";
import type { FidelityConfig } from "./types.js";
import * as path from "path";
import * as os from "os";

const server = new McpServer({
  name: "fidelity",
  version: "1.0.0",
});

function getConfig(): FidelityConfig {
  return {
    headless: process.env.FIDELITY_HEADLESS !== "false",
    sessionDir:
      process.env.BROWSER_DATA_DIR ??
      process.env.FIDELITY_SESSION_DIR ??
      path.join(os.homedir(), ".fidelity-mcp"),
    sessionTitle: process.env.FIDELITY_SESSION_TITLE,
    debug: process.env.FIDELITY_DEBUG === "true",
    timeout: parseInt(process.env.FIDELITY_TIMEOUT ?? "30000", 10),
  };
}

// ─── Login ──────────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_login",
  "Log in to Fidelity. Supports TOTP 2FA (automatic) and SMS 2FA (requires follow-up with fidelity_submit_2fa). Credentials can be passed directly or via env vars FIDELITY_USERNAME, FIDELITY_PASSWORD, FIDELITY_TOTP_SECRET.",
  {
    username: z
      .string()
      .optional()
      .describe(
        "Fidelity username. Falls back to FIDELITY_USERNAME env var."
      ),
    password: z
      .string()
      .optional()
      .describe(
        "Fidelity password. Falls back to FIDELITY_PASSWORD env var."
      ),
    totp_secret: z
      .string()
      .optional()
      .describe(
        "TOTP secret for authenticator app 2FA. Falls back to FIDELITY_TOTP_SECRET env var."
      ),
  },
  async ({ username, password, totp_secret }) => {
    const user = username ?? process.env.FIDELITY_USERNAME;
    const pass = password ?? process.env.FIDELITY_PASSWORD;
    const totp = totp_secret ?? process.env.FIDELITY_TOTP_SECRET;

    if (!user || !pass) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Username and password are required. Provide them as arguments or set FIDELITY_USERNAME and FIDELITY_PASSWORD environment variables.",
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await login(getConfig(), user, pass, totp);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Login failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Submit SMS 2FA Code ────────────────────────────────────────────────────────

server.tool(
  "fidelity_submit_2fa",
  "Submit the SMS 2FA code received on your phone to complete Fidelity login. Only use this after fidelity_login returns needsSms2FA=true.",
  {
    code: z.string().describe("The 6-digit SMS verification code."),
  },
  async ({ code }) => {
    try {
      const result = await submit2FACode(code);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `2FA submission failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Get Accounts ───────────────────────────────────────────────────────────────

server.tool(
  "fidelity_get_accounts",
  "List all Fidelity accounts with their names, numbers, and optionally withdrawal balances.",
  {
    include_balances: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to include withdrawal balances (slower)."),
  },
  async ({ include_balances }) => {
    try {
      const accounts = await getAccountList(include_balances);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(accounts, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get accounts: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Get Positions ──────────────────────────────────────────────────────────────

server.tool(
  "fidelity_get_positions",
  "Get all positions (holdings) across all Fidelity accounts. Returns account details with stock ticker, quantity, price, and value for each holding.",
  {},
  async () => {
    try {
      const positions = await getPositions();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(positions, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get positions: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Get Quote ──────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_get_quote",
  "Get the current price for a stock/ETF symbol via Fidelity's trade page.",
  {
    symbol: z.string().describe("The stock/ETF ticker symbol (e.g., AAPL, SPY)."),
  },
  async ({ symbol }) => {
    try {
      const quote = await getQuote(symbol);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(quote, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get quote: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Place Order ────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_place_order",
  "Place a buy or sell order for a stock/ETF on Fidelity. Supports market and limit orders. Use dry_run=true to preview without executing. For penny stocks (<$1) and extended hours, limit orders are used automatically.",
  {
    account_number: z
      .string()
      .describe("The Fidelity account number to trade in."),
    symbol: z.string().describe("The stock/ETF ticker symbol."),
    action: z
      .enum(["buy", "sell"])
      .describe("Whether to buy or sell."),
    quantity: z
      .number()
      .int()
      .positive()
      .describe("Number of shares to trade."),
    order_type: z
      .enum(["market", "limit"])
      .optional()
      .describe(
        "Order type. Defaults to market. Auto-set to limit for penny stocks and extended hours."
      ),
    limit_price: z
      .number()
      .positive()
      .optional()
      .describe("Limit price per share. Required for limit orders, auto-calculated if not provided."),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "If true (default), preview the order without placing it. Set to false to actually execute."
      ),
  },
  async ({ account_number, symbol, action, quantity, order_type, limit_price, dry_run }) => {
    try {
      const result = await placeOrder({
        accountNumber: account_number,
        symbol,
        action,
        quantity,
        orderType: order_type,
        limitPrice: limit_price,
        dryRun: dry_run,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Order failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Batch Orders ──────────────────────────────────────────────────────────────

server.tool(
  "fidelity_batch_orders",
  "Place multiple buy/sell orders sequentially in a single account. Useful for portfolio rebalancing. Each order is placed one at a time. Returns results for each order.",
  {
    account_number: z
      .string()
      .describe("The Fidelity account number to trade in."),
    orders: z
      .array(
        z.object({
          symbol: z.string().describe("Stock/ETF ticker symbol."),
          quantity: z.number().int().positive().describe("Number of shares."),
          action: z.enum(["buy", "sell"]).describe("Buy or sell."),
        })
      )
      .describe("Array of orders to place sequentially."),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true (default), preview all orders without placing. Set to false to execute."),
  },
  async ({ account_number, orders, dry_run }) => {
    try {
      const result = await placeBatchOrders(account_number, orders, dry_run);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.failed > 0,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Batch order failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Transfer ───────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_transfer",
  "Transfer cash between two Fidelity accounts. Validates available balance before submitting.",
  {
    from_account: z
      .string()
      .describe("Source account number."),
    to_account: z
      .string()
      .describe("Destination account number."),
    amount: z
      .number()
      .positive()
      .describe("Dollar amount to transfer."),
  },
  async ({ from_account, to_account, amount }) => {
    try {
      const result = await transfer(from_account, to_account, amount);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Transfer failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Status ─────────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_status",
  "Check whether the Fidelity browser session is active and logged in.",
  {},
  async () => {
    const ready = isBrowserReady();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              browserActive: ready,
              message: ready
                ? "Browser session is active. You can use Fidelity tools."
                : "No active session. Use fidelity_login to start.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Logout ─────────────────────────────────────────────────────────────────────

server.tool(
  "fidelity_logout",
  "Close the Fidelity browser session and save cookies for faster re-login next time.",
  {},
  async () => {
    try {
      await closeBrowser();
      return {
        content: [
          {
            type: "text",
            text: "Browser session closed and state saved.",
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Logout error: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Save Session ───────────────────────────────────────────────────────────────

server.tool(
  "fidelity_save_session",
  "Manually save the current browser session state (cookies/localStorage) for persistence across restarts.",
  {},
  async () => {
    try {
      await saveSession();
      return {
        content: [
          {
            type: "text",
            text: "Session state saved successfully.",
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to save session: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Screenshot / Debug ─────────────────────────────────────────────────────────

server.tool(
  "fidelity_screenshot",
  "Take a screenshot of the current Fidelity browser page. Useful for debugging when tools return unexpected results.",
  {
    url: z
      .string()
      .optional()
      .describe(
        "Optional URL to navigate to before taking the screenshot. If omitted, captures the current page."
      ),
  },
  async ({ url }) => {
    try {
      const page = await getPage();

      if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const { waitForLoadingCompleteDouble } = await import("./browser.js");
        await waitForLoadingCompleteDouble(page, 30000);
      }

      const screenshotBuffer = await page.screenshot({ fullPage: true });
      const base64 = screenshotBuffer.toString("base64");

      return {
        content: [
          {
            type: "text",
            text: `Screenshot of: ${page.url()}`,
          },
          {
            type: "image",
            data: base64,
            mimeType: "image/png",
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "fidelity_page_content",
  "Get the current page URL and key HTML structure. Useful for debugging when selectors fail.",
  {
    url: z
      .string()
      .optional()
      .describe("Optional URL to navigate to first."),
  },
  async ({ url }) => {
    try {
      const page = await getPage();

      if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const { waitForLoadingCompleteDouble } = await import("./browser.js");
        await waitForLoadingCompleteDouble(page, 30000);
      }

      const pageUrl = page.url();
      const title = await page.title();

      // Get all buttons, links, and interactive elements
      const interactiveElements = await page.evaluate(() => {
        const elements: string[] = [];
        const selectors = ["button", "a", "[role='button']", "[role='menuitem']", "[role='tab']"];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => {
            const text = (el.textContent ?? "").trim().substring(0, 80);
            const label = el.getAttribute("aria-label") ?? "";
            const id = el.id ? `#${el.id}` : "";
            if (text || label) {
              elements.push(`<${el.tagName.toLowerCase()}${id}> ${label ? `[${label}]` : ""} ${text}`);
            }
          });
        }
        return elements.slice(0, 100);
      });

      // Get table structure
      const tables = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll("table, [role='table'], [role='grid']").forEach((table, i) => {
          const headers = Array.from(table.querySelectorAll("th, [role='columnheader']"))
            .map((th) => (th.textContent ?? "").trim())
            .filter(Boolean);
          const rowCount = table.querySelectorAll("tr, [role='row']").length;
          results.push(`Table ${i}: ${headers.join(" | ")} (${rowCount} rows)`);
        });
        return results;
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `URL: ${pageUrl}`,
              `Title: ${title}`,
              "",
              "=== Interactive Elements ===",
              ...interactiveElements,
              "",
              "=== Tables ===",
              ...tables,
            ].join("\n"),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Start Server ───────────────────────────────────────────────────────────────

if (process.env.MCP_TRANSPORT === "http") {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const crypto = await import("crypto");

  const app = express();
  app.use(express.json());

  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "GET") {
      const transport = transports.get(sessionId!);
      if (!transport) { res.status(404).send("Session not found"); return; }
      await transport.handleRequest(req, res);
    } else if (req.method === "POST") {
      if (!sessionId) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => { transports.set(id, transport); },
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        try { await server.close(); } catch {} await server.connect(transport);
        await transport.handleRequest(req, res);
      } else {
        const transport = transports.get(sessionId);
        if (!transport) { res.status(404).send("Session not found"); return; }
        await transport.handleRequest(req, res);
      }
    } else if (req.method === "DELETE") {
      const transport = transports.get(sessionId!);
      if (transport) { await transport.close(); transports.delete(sessionId!); }
      res.status(200).send();
    } else {
      res.status(405).send("Method not allowed");
    }
  });

  const PORT = parseInt(process.env.MCP_PORT || "3100");
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Fidelity MCP listening on http://0.0.0.0:${PORT}/mcp`);
  });
} else {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  try { await server.close(); } catch {} await server.connect(transport);
}
