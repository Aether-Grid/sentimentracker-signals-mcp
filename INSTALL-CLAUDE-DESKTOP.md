# Wire `@sentimentracker/signals-mcp` into Claude Desktop (macOS)

Five steps. Read-only by nature (no signing surface), so the only sensitive bit is your session token — don't commit the config file to git.

## 1 — Build the package once

```bash
cd /Applications/Claude-VS/Sentimentracker-App/sentimentracker-signals-mcp
pnpm install
pnpm build
```

Confirms `dist/index.js` exists.

## 2 — Get an auth credential

You have two options. Both require an active premium subscription.

### Option A — API key (recommended)

```bash
# Log into sentimentracker.com first, copy your session JWT from DevTools
curl -X POST https://api.sentimentracker.com/api/api-keys \
  -H "Authorization: Bearer <YOUR_SESSION_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Claude Desktop on this Mac", "scope": "signals:read"}'
```

Response includes `data.plaintext`: `snt_mcp_<24 chars>`. **Capture it immediately** — it's only shown once. Keys expire one year after minting. List via `GET /api-keys`, rotate via `POST /api-keys/:id/rotate` (old key keeps working for 24 hours), revoke via `DELETE /api-keys/:id`. All of this is also in the app under Settings → API keys.

### Option B — Session JWT (quick / dev)

1. Log into [sentimentracker.com](https://sentimentracker.com)
2. DevTools → Application → Cookies (or local storage) → copy session JWT
3. Refresh manually when you see `AUTH_EXPIRED` (typically 7-30 days)

## 3 — Open / create the Claude Desktop config

```bash
open ~/Library/Application\ Support/Claude/
```

If `claude_desktop_config.json` doesn't exist:

```bash
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

## 4 — Paste config

> If `mcpServers` already has other entries (e.g. `sentimentracker-hyperliquid`), only add the `sentimentracker-signals` key inside it — don't overwrite the whole block.

Using the API key (recommended):

```json
{
	"mcpServers": {
		"sentimentracker-signals": {
			"command": "node",
			"args": ["/Applications/Claude-VS/Sentimentracker-App/sentimentracker-signals-mcp/dist/index.js"],
			"env": {
				"SNT_SIGNALS_ENDPOINT": "https://api.sentimentracker.com/api",
				"SNT_SIGNALS_API_KEY": "snt_mcp_PASTE_YOUR_API_KEY_HERE",
				"SNT_SIGNALS_DEFAULT_PROVIDER": "hyperliquid"
			}
		}
	}
}
```

OR using a session JWT:

```json
{
	"mcpServers": {
		"sentimentracker-signals": {
			"command": "node",
			"args": ["/Applications/Claude-VS/Sentimentracker-App/sentimentracker-signals-mcp/dist/index.js"],
			"env": {
				"SNT_SIGNALS_ENDPOINT": "https://api.sentimentracker.com/api",
				"SNT_SIGNALS_SESSION_TOKEN": "PASTE_YOUR_PREMIUM_SESSION_JWT_HERE",
				"SNT_SIGNALS_DEFAULT_PROVIDER": "hyperliquid"
			}
		}
	}
}
```

If you also want the trading MCP at the same time:

```json
{
	"mcpServers": {
		"sentimentracker-signals": {
			"command": "node",
			"args": ["/Applications/Claude-VS/Sentimentracker-App/sentimentracker-signals-mcp/dist/index.js"],
			"env": {
				"SNT_SIGNALS_SESSION_TOKEN": "PASTE_YOUR_JWT",
				"SNT_SIGNALS_DEFAULT_PROVIDER": "hyperliquid"
			}
		},
		"sentimentracker-hyperliquid": {
			"command": "node",
			"args": ["/Applications/Claude-VS/Sentimentracker-App/sentimentracker-hyperliquid-mcp/dist/index.js"],
			"env": {
				"SNT_HL_MODE": "propose",
				"SNT_HL_MASTER_ADDRESS": "0xYOUR_MASTER_EOA"
			}
		}
	}
}
```

## 5 — Restart + verify

```bash
osascript -e 'quit app "Claude"'
sleep 2
open -a Claude
```

In a fresh chat:

```
/mcp
```

Should show `sentimentracker-signals` with 4 tools.

First call — should always work:

> Use `sentimentracker-signals` `list_indicators` to show me every indicator and its signal type.

Then try a real signal (needs your JWT + premium):

> Use `get_indicator_signal` to fetch the current `sniperV3` signal for BTC on the 15m chart. Then `get_signal_confluence` across `sniperV3`, `momentumUltimaPlus`, `structurePro`, `strongBuyStrongSell` for the same symbol — tell me if there's directional agreement.

## Logs

```bash
tail -F ~/Library/Logs/Claude/mcp-server-sentimentracker-signals.log
tail -F ~/Library/Logs/Claude/mcp*.log
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `AUTH_MISSING` at boot | No `SNT_SIGNALS_SESSION_TOKEN` set |
| `AUTH_EXPIRED` on every call | JWT expired (re-copy from sentimentracker.com) or the API key expired / was revoked (rotate it in Settings → API keys) |
| `AUTH_PREMIUM_REQUIRED` | Account isn't premium / sub expired, or the key lacks the `signals:read` scope |
| `BACKEND_RATE_LIMITED` | Per second bucket, 3 open subscriptions, or the 50,000 calls per month key quota — see the hint for when to retry |
| `BACKEND_TIMEOUT` | Network slow — raise `SNT_SIGNALS_REQUEST_TIMEOUT_MS` (default 15000) |
| `BACKEND_HTTP_ERROR status=502` | Backend transient — retry, check status |
| `ENOENT: node` | Claude Desktop's `PATH` doesn't include Homebrew node. Use absolute: `/opt/homebrew/bin/node` (Apple Silicon) or `/usr/local/bin/node` (Intel) |
| `Cannot find module .../dist/index.js` | Forgot `pnpm build` |
| Tool returns null `latestSide` | Indicator's metadata shape doesn't match the confluence extractor's heuristics — read the raw envelope via `get_indicator_signal` |

## Best-practice queries

> What does the Sentimentracker indicator system say about ETH right now on 1h? Walk through `get_signal_confluence` for the 5 directional ones, then for any conflicting signal, dig in with `get_indicator_signal` to compare metadata.

> Compare `momentumUltimaPlus` on BTC at 15m vs 1h vs 4h. Highlight any TF where the active trade direction disagrees with the others.
