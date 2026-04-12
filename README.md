# @tasque/fidelity-mcp

MCP server for Fidelity brokerage accounts via Playwright browser automation.

> **Warning** — Fidelity has no public API. This automates the web interface, which may violate their Terms of Service.

## Tools

| Tool | Description |
|------|-------------|
| `fidelity_login` | Log in to Fidelity (supports TOTP and SMS 2FA) |
| `fidelity_submit_2fa` | Submit SMS 2FA code |
| `fidelity_get_accounts` | List all accounts with balances |
| `fidelity_get_positions` | Get all holdings across accounts |
| `fidelity_transfer` | Transfer cash between Fidelity accounts |
| `fidelity_get_quote` | Get current stock/ETF price |
| `fidelity_place_order` | Place a buy/sell order (dry_run default) |
| `fidelity_batch_orders` | Place multiple orders sequentially (dry_run default) |
| `fidelity_status` | Check browser session status |
| `fidelity_logout` | Close session and save cookies |
| `fidelity_save_session` | Save browser state to disk |
| `fidelity_screenshot` | Take a full-page screenshot |
| `fidelity_page_content` | Get page URL and interactive elements |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIDELITY_USERNAME` | Yes | Fidelity login username |
| `FIDELITY_PASSWORD` | Yes | Fidelity login password |
| `FIDELITY_TOTP_SECRET` | No | Base32 TOTP secret for automatic 2FA |
| `FIDELITY_HEADLESS` | No | Set to `"false"` to show browser (default: `true`) |
| `FIDELITY_SESSION_DIR` | No | Session persistence directory (default: `~/.fidelity-mcp`) |
| `FIDELITY_SESSION_TITLE` | No | Session file identifier for multiple accounts |
| `FIDELITY_DEBUG` | No | Set to `"true"` for debug logging |
| `FIDELITY_TIMEOUT` | No | Default timeout in ms (default: `30000`) |

## Auth Setup

Set `FIDELITY_USERNAME` and `FIDELITY_PASSWORD`. For automatic 2FA, get your TOTP secret from Fidelity Security Settings > Authenticator app > "Can't scan the code?" and set `FIDELITY_TOTP_SECRET`. Without TOTP, the server falls back to SMS 2FA (requires calling `fidelity_submit_2fa`).

Requires Playwright Firefox: `npx playwright install firefox`

## Development

```bash
npm install
npx playwright install firefox
npm run build
npm start        # stdio mode
```
