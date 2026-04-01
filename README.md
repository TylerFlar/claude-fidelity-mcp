# claude-fidelity-mcp

MCP server for interacting with Fidelity Investments brokerage accounts from Claude / Claude Code.

Since Fidelity has no public retail API, this uses **Playwright browser automation** (Firefox) to control Fidelity's web interface, with stealth measures and session persistence to minimize re-authentication.

## Features

- **Login with 2FA** - Supports automatic TOTP (authenticator app) and interactive SMS verification
- **Session persistence** - Saves cookies/localStorage so you don't re-login every time
- **Account listing** - View all accounts with names, numbers, and balances
- **Portfolio positions** - Get all holdings across accounts (ticker, quantity, price, value)
- **Stock quotes** - Get current and extended-hours prices
- **Order placement** - Buy/sell stocks with market or limit orders (dry-run by default)
- **Transfers** - Move cash between Fidelity accounts
- **Penny stock handling** - Auto-switches to limit orders for stocks under $1
- **Extended hours** - Automatically enables and adjusts for pre/post-market trading

## Tools

| Tool | Description |
|---|---|
| `fidelity_login` | Log in with username/password + TOTP or SMS 2FA |
| `fidelity_submit_2fa` | Complete SMS 2FA with the code from your phone |
| `fidelity_get_accounts` | List all accounts with names, numbers, balances |
| `fidelity_get_positions` | Get all holdings across all accounts |
| `fidelity_get_quote` | Get current price for a stock/ETF symbol |
| `fidelity_place_order` | Buy/sell stocks (dry-run by default) |
| `fidelity_transfer` | Transfer cash between Fidelity accounts |
| `fidelity_status` | Check if browser session is active |
| `fidelity_save_session` | Manually save session state |
| `fidelity_logout` | Close browser and save session |

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install firefox
```

### 2. Build

```bash
npm run build
```

### 3. Configure

Add to your global Claude config (`~/.claude.json`) or project config (`.claude/mcp.json`):

```json
{
  "mcpServers": {
    "fidelity": {
      "command": "node",
      "args": ["/path/to/claude-fidelity-mcp/build/index.js"],
      "env": {
        "FIDELITY_USERNAME": "your-username",
        "FIDELITY_PASSWORD": "your-password",
        "FIDELITY_TOTP_SECRET": "your-totp-secret",
        "FIDELITY_HEADLESS": "true",
        "FIDELITY_TIMEOUT": "30000"
      }
    }
  }
}
```

### 4. Set up TOTP (recommended)

For fully automatic login without manual 2FA prompts:

1. Go to Fidelity Security Settings > Authenticator app > **Connect**
2. Click "Can't scan the code?" to reveal the TOTP secret (a base32 string)
3. Copy the secret into `FIDELITY_TOTP_SECRET`
4. Also add it to your authenticator app (Google Authenticator, Authy, etc.) and verify the code with Fidelity to activate

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FIDELITY_USERNAME` | Yes | - | Fidelity login username |
| `FIDELITY_PASSWORD` | Yes | - | Fidelity login password |
| `FIDELITY_TOTP_SECRET` | No | - | TOTP secret for automatic 2FA |
| `FIDELITY_HEADLESS` | No | `true` | Set to `false` to see the browser |
| `FIDELITY_SESSION_DIR` | No | `~/.fidelity-mcp` | Where to save session files |
| `FIDELITY_SESSION_TITLE` | No | `default` | Session file identifier (for multiple accounts) |
| `FIDELITY_TIMEOUT` | No | `30000` | Default timeout in milliseconds |

## Project Structure

```
src/
  index.ts        # MCP server entry point + tool registrations
  browser.ts      # Playwright browser lifecycle, stealth, session persistence
  auth.ts         # Login flow, TOTP/SMS 2FA handling
  accounts.ts     # Account listing, balances, transfers
  positions.ts    # Portfolio positions via CSV download
  trading.ts      # Quotes and order placement
  types.ts        # TypeScript interfaces
```

## Notes

- **Dry-run by default** - `fidelity_place_order` previews orders without executing unless you set `dry_run: false`
- **Browser automation** - This relies on Fidelity's web UI, which may change. If tools break, selectors may need updating
- **Security** - Credentials are stored in your Claude config. Never commit them to version control
- **Rate limiting** - Avoid rapid repeated calls; Fidelity may flag automated access
