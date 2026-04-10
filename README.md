# claude-fidelity-mcp

MCP server for interacting with Fidelity Investments brokerage accounts via Playwright browser automation, designed for Claude Code and Claude Desktop.

> **Warning** — Fidelity has no public retail API. This server automates their web interface using a headless browser, which may violate Fidelity's Terms of Service. Use at your own risk.

## Architecture

The server runs over **stdio** transport using `@modelcontextprotocol/sdk`. It launches a **Playwright Firefox** browser instance with stealth measures (spoofed `navigator.webdriver`, plugins, and languages) to automate Fidelity's web UI. Authentication supports TOTP (via the `otpauth` library) and SMS 2FA flows. Session state (cookies/localStorage) is persisted to disk as JSON, allowing re-login without full re-authentication. Portfolio positions are retrieved via CSV download with a DOM-scraping fallback.

## Prerequisites

- **Node.js** >= 18
- **Playwright Firefox browser**: installed via `npx playwright install firefox`
- **Fidelity account** with login credentials
- **TOTP secret** (recommended) — for fully automatic 2FA without manual SMS codes

## Setup

### 1. Install & Build

```bash
npm install
npx playwright install firefox
npm run build
```

### 2. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIDELITY_USERNAME` | Yes | — | Fidelity login username |
| `FIDELITY_PASSWORD` | Yes | — | Fidelity login password |
| `FIDELITY_TOTP_SECRET` | No | — | Base32 TOTP secret for authenticator app 2FA. Get from Fidelity Security Settings > Authenticator app > "Can't scan the code?" |
| `FIDELITY_HEADLESS` | No | `true` | Set to `"false"` to show the browser window |
| `FIDELITY_SESSION_DIR` | No | `~/.fidelity-mcp` | Directory for session persistence files |
| `FIDELITY_SESSION_TITLE` | No | — | Session file identifier (use for multiple accounts) |
| `FIDELITY_DEBUG` | No | `false` | Set to `"true"` to enable debug logging |
| `FIDELITY_TIMEOUT` | No | `30000` | Default timeout in milliseconds |

### 3. MCP Client Configuration

Add to `~/.claude.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```json
{
  "mcpServers": {
    "fidelity": {
      "command": "node",
      "args": ["/absolute/path/to/claude-fidelity-mcp/build/index.js"],
      "env": {
        "FIDELITY_USERNAME": "your-username",
        "FIDELITY_PASSWORD": "your-password",
        "FIDELITY_TOTP_SECRET": "your-totp-base32-secret",
        "FIDELITY_HEADLESS": "true"
      }
    }
  }
}
```

## Tools Reference

### Authentication (2 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `fidelity_login` | `username?: string, password?: string, totp_secret?: string` | Log in to Fidelity. Credentials fall back to env vars. Supports automatic TOTP and interactive SMS 2FA. |
| `fidelity_submit_2fa` | `code: string` | Submit 6-digit SMS 2FA code after `fidelity_login` returns `needsSms2FA=true`. |

### Account Management (3 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `fidelity_get_accounts` | `include_balances?: boolean` | List all accounts with names, numbers, and optionally withdrawal balances (slower when enabled). Default: `false`. |
| `fidelity_get_positions` | *(none)* | Get all holdings across all accounts — ticker, quantity, price, value per position. Uses CSV download with DOM-scraping fallback. |
| `fidelity_transfer` | `from_account: string, to_account: string, amount: number` | Transfer cash between two Fidelity accounts. Validates available balance before submitting. |

### Trading (3 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `fidelity_get_quote` | `symbol: string` | Get current price for a stock/ETF. Returns extended-hours price when available. |
| `fidelity_place_order` | `account_number: string, symbol: string, action: "buy"\|"sell", quantity: number, order_type?: "market"\|"limit", limit_price?: number, dry_run?: boolean` | Place a buy/sell order. Defaults to `dry_run: true` (preview only). Auto-switches to limit orders for penny stocks (<$1) and extended hours. |
| `fidelity_batch_orders` | `account_number: string, orders: Array<{symbol, quantity, action}>, dry_run?: boolean` | Place multiple orders sequentially in one account. Defaults to `dry_run: true`. Returns per-order results with succeeded/failed counts. |

### Session & Debugging (5 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `fidelity_status` | *(none)* | Check whether the browser session is active and logged in. |
| `fidelity_logout` | *(none)* | Close browser session and save cookies for faster re-login. |
| `fidelity_save_session` | *(none)* | Manually save current browser state (cookies/localStorage) to disk. |
| `fidelity_screenshot` | `url?: string` | Take a full-page screenshot. Optionally navigate to a URL first. Returns base64 PNG. |
| `fidelity_page_content` | `url?: string` | Get current page URL, interactive elements, and table structures. Useful for debugging selector failures. |

## Internal API Layer

### `browser.ts` — Browser Lifecycle & Stealth

- **Purpose**: Manages a singleton Playwright Firefox instance with anti-detection measures
- **Stealth**: Overrides `navigator.webdriver` (→ `false`), `navigator.plugins` (→ `[1,2,3,4,5]`), `navigator.languages` (→ `["en-US","en"]`); custom user-agent string
- **Session persistence**: Stores `{ cookies, origins }` from Playwright's `context.storageState()` to `{sessionDir}/fidelity_session_{sessionTitle}.json`
- **Key functions**:
  - `initBrowser(config): Promise<Page>` — launch Firefox, load saved session, apply stealth scripts
  - `getPage(): Page` — return current page or throw if not initialized
  - `saveSession(): Promise<void>` — persist context storage state to disk
  - `closeBrowser(): Promise<void>` — save session, close browser, nullify references
  - `waitForLoadingComplete(page, timeout?)` — wait for Fidelity's loading spinners to disappear
  - `isBrowserReady(): boolean` — check if page exists and isn't closed

### `auth.ts` — Authentication & 2FA

- **Purpose**: Handles the full Fidelity login flow including 2FA
- **Login flow**: Navigate to login page → fill username/password → click "Log in" → detect 2FA prompt or portfolio summary
- **TOTP path**: Generates 6-digit code via `otpauth` library (base32 secret, SHA-1, 30s period) → fills code → clicks "Continue" → saves session
- **SMS path**: Clicks "Try another way" → "Text me the code" → returns `needsSms2FA: true` for follow-up via `submit2FACode()`
- **Key functions**:
  - `login(config, username, password, totpSecret?): Promise<LoginResult>`
  - `submit2FACode(code): Promise<LoginResult>`

### `accounts.ts` — Account Listing & Transfers

- **Purpose**: Retrieves account info from the transfer page and executes internal cash transfers
- **Approach**: Navigates to Fidelity's quick transfer page, parses account dropdowns using regex (`/(?<=\()(Z|\d)\d{6,}(?=\))/`) to extract account numbers
- **Key functions**:
  - `getAccountList(includeBalances?): Promise<AccountListItem[]>`
  - `transfer(from, to, amount): Promise<TransferResult>`

### `positions.ts` — Portfolio Positions

- **Purpose**: Retrieves all holdings across all accounts
- **Primary strategy**: Downloads CSV from the positions page via the "Available Actions" → "Download" menu, parses with `csv-parse`
- **Fallback strategy**: Scrapes the DOM directly, extracting data from table rows with regex-based account number detection
- **Cash handling**: Cash-equivalent symbols (SPAXX, FCASH, FDRXX, FZFXX) are added to account balance rather than listed as stock positions
- **Key function**: `getPositions(): Promise<Account[]>`

### `trading.ts` — Quotes & Order Execution

- **Purpose**: Fetches stock quotes and places buy/sell orders via Fidelity's trade ticket
- **Order logic**: Navigates to trade page → selects account → enters symbol → sets action/quantity/order type → previews → optionally executes
- **Auto limit orders**: Forced for penny stocks (<$1 price) and extended-hours trading; auto-calculates limit price with small offset if not provided
- **Key functions**:
  - `getQuote(symbol): Promise<QuoteResult>`
  - `placeOrder(order: OrderRequest): Promise<OrderResult>`
  - `placeBatchOrders(accountNumber, orders, dryRun): Promise<{results, succeeded, failed}>`

## Data Models

```typescript
interface FidelityConfig {
  headless: boolean;
  sessionDir: string;
  sessionTitle?: string;
  debug: boolean;
  timeout: number;
}

interface Stock {
  ticker: string;
  description: string;
  quantity: number;
  lastPrice: number;
  lastPriceChange: number;
  currentValue: number;
}

interface Account {
  accountNumber: string;
  accountName: string;
  nickname: string;
  balance: number;
  withdrawalBalance: number;
  stocks: Stock[];
}

type OrderAction = "buy" | "sell";
type OrderType = "market" | "limit";

interface OrderRequest {
  accountNumber: string;
  symbol: string;
  action: OrderAction;
  quantity: number;
  orderType?: OrderType;
  limitPrice?: number;
  dryRun?: boolean;
}

interface OrderResult {
  success: boolean;
  message: string;
  orderDetails?: {
    account: string;
    symbol: string;
    action: OrderAction;
    quantity: number;
    price: number;
    orderType: OrderType;
  };
}

interface QuoteResult {
  symbol: string;
  lastPrice: number;
  extendedHoursPrice?: number;
  isExtendedHours: boolean;
}

interface TransferResult {
  success: boolean;
  message: string;
}

interface LoginResult {
  success: boolean;
  needsSms2FA: boolean;
  message: string;
}
```

## Development

```bash
npm run dev    # Watch mode (tsc --watch)
npm run build  # Production build (tsc)
npm start      # Run built server (node build/index.js)
```

## Security Considerations

- **Credential storage**: Username, password, and TOTP secret are passed via environment variables in your MCP client config. Never commit these to version control.
- **Session files**: Saved to `~/.fidelity-mcp/` by default. These contain authentication cookies that grant account access — protect them accordingly.
- **Scope of access**: The server can view all accounts, positions, balances, and execute trades and transfers on your behalf.
- **Dry-run default**: `fidelity_place_order` and `fidelity_batch_orders` default to `dry_run: true` to prevent accidental execution.
- **Rate limiting**: Fidelity may flag or restrict accounts with automated access patterns. Avoid rapid repeated calls.
- **TOS compliance**: Automated access to Fidelity's web interface may violate their Terms of Service.

## License

MIT — see [LICENSE](LICENSE)
