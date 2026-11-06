# Connect `@sentimentracker/signals-mcp` to Claude Desktop

Four steps. The server only reads signals and has no signing surface, so the one sensitive value is your API key. Do not commit the config file to git.

You need Node.js installed (Claude Desktop starts the server with `npx`) and an active SentimenTracker Pro subscription.

## 1. Create an API key

In the app, open Settings, then API keys, and click Create API Key. Copy the `snt_mcp_…` key straight away: it is shown once.

Keys expire one year after creation. Rotate one from the same page (the old key keeps working for 24 hours) or revoke it there.

## 2. Open the Claude Desktop config file

In Claude Desktop, open Settings, then Developer, then Edit Config. That opens `claude_desktop_config.json`, creating it if needed:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

## 3. Paste the config

```json
{
	"mcpServers": {
		"sentimentracker-signals": {
			"command": "npx",
			"args": ["-y", "@sentimentracker/signals-mcp"],
			"env": {
				"SNT_SIGNALS_API_KEY": "snt_mcp_PASTE_YOUR_API_KEY_HERE"
			}
		}
	}
}
```

If the file already has an `mcpServers` block (for example with `sentimentracker-hyperliquid`), add only the `sentimentracker-signals` entry inside it. Do not overwrite the whole block.

`SNT_SIGNALS_ENDPOINT` defaults to production (`https://api.sentimentracker.com/api`), so it only needs setting for staging or local development. Optional settings are listed under "Env reference" in the README.

## 4. Restart and check

Quit Claude Desktop completely (on macOS, Claude, then Quit Claude; closing the window is not enough) and open it again. In a new chat, the tools menu should list `sentimentracker-signals` with 6 tools.

First call, which should always work:

> Use `sentimentracker-signals` `list_indicators` to show me every indicator and its signal type.

Then a real signal:

> Use `get_indicator_signal` to fetch the current `sniperV3` signal for BTC on the 15m chart. Then `get_signal_confluence` across `sniperV3`, `momentumUltimaPlus`, `structurePro`, `strongBuyStrongSell` for the same symbol and tell me if there's directional agreement.

## Logs

```bash
# macOS
tail -F ~/Library/Logs/Claude/mcp-server-sentimentracker-signals.log
```

On Windows the logs are in `%APPDATA%\Claude\logs`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Server exits at start with "Invalid environment configuration" | The key is missing or still the placeholder. Paste the full `snt_mcp_…` key |
| `ENOENT` for `npx` | Claude Desktop cannot find Node.js. Install Node.js, or on macOS set `"command"` to the absolute path from `which npx` (for example `/opt/homebrew/bin/npx` on Apple Silicon) |
| `AUTH_EXPIRED` on every call | The API key expired or was revoked. Rotate or create one in Settings, then API keys |
| `AUTH_PREMIUM_REQUIRED` | The account has no active Pro plan, or the key lacks the `signals:read` scope |
| `BACKEND_RATE_LIMITED` | Per second limit, 3 open subscriptions, or the 50,000 calls per key per month quota. The hint says when to retry |
| `BACKEND_TIMEOUT` | Slow network. Raise `SNT_SIGNALS_REQUEST_TIMEOUT_MS` (default 15000) |
| `BACKEND_HTTP_ERROR status=502` | Temporary backend error. Retry |
| Tool returns null `latestSide` | The indicator's metadata shape doesn't match the confluence extractor's heuristics. Read the raw envelope with `get_indicator_signal` |

## Best practice queries

> What does the SentimenTracker indicator system say about ETH right now on 1h? Walk through `get_signal_confluence` for the 5 directional ones, then for any conflicting signal, dig in with `get_indicator_signal` to compare metadata.

> Compare `momentumUltimaPlus` on BTC at 15m vs 1h vs 4h. Highlight any timeframe where the active trade direction disagrees with the others.

## Running from a source checkout (developers)

Build once with `pnpm install && pnpm build`, then point Claude Desktop at the build instead of npm:

```json
{
	"mcpServers": {
		"sentimentracker-signals": {
			"command": "node",
			"args": ["/absolute/path/to/sentimentracker-signals-mcp/dist/index.js"],
			"env": {
				"SNT_SIGNALS_ENDPOINT": "https://api-stg.sentimentracker.com/api",
				"SNT_SIGNALS_API_KEY": "snt_mcp_PASTE_A_STAGING_KEY"
			}
		}
	}
}
```

A session JWT also works for quick tests: set `SNT_SIGNALS_SESSION_TOKEN` instead of `SNT_SIGNALS_API_KEY` and refresh it when calls return `AUTH_EXPIRED`.
