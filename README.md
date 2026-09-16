# @sentimentracker/signals-mcp

A Model Context Protocol (MCP) server exposing Sentimentracker's 14 proprietary indicators as LLM-callable tools. Any MCP-aware client (Claude Desktop, Cursor, Cline, Continue, Windsurf, OpenAI Agents SDK) can ask "what is `sniperV3` saying about BTC on 15m right now?" and get the actual signal envelope from your premium subscription.

Pairs with [`@sentimentracker/hyperliquid-mcp`](../sentimentracker-hyperliquid-mcp) — that one signs and submits trades; this one reads signals.

## How it works

Thin HTTP wrapper. Tool calls map directly to the existing Sentimentracker backend `POST /superchart/indicators/calculate` route, which is the single source of truth for every indicator's proprietary signal cascade. **No calculator code lives in this package** — backend updates ship to every MCP user immediately, no version drift.

```
LLM client → MCP stdio → this server → HTTPS → sentimentracker backend → cached metadata
```

## Tools

| Tool | Purpose |
|---|---|
| `list_indicators` | Live catalog from the backend registry — key, displayName, signalKind, description. Call once at session start. |
| `get_indicator_signal` | Latest signal envelope (signals[], trades[], currentTrade) for (indicator, symbol, resolution). ~5KB payload — uses `metadataOnly=true`. The everyday tool. |
| `get_indicator_full` | Full per-bar plot arrays + metadata. Typically 100-800 KB; anything over 1 MB of JSON is refused with `RESULT_TOO_LARGE` (use `get_indicator_signal` instead). Use only when the LLM needs per-bar context. |
| `get_signal_confluence` | Fan-fetch up to 20 indicators in parallel for the same (symbol, resolution), return a confluence table. |
| `subscribe_signal` | Long-poll for a NEW signal on (indicator, symbol, resolution). Holds up to `timeoutMs` (1-50s) and resolves the instant a signal newer than `lastSeenSignalTs` is detected. |
| `propose_trade_from_signal` | Pure compute: turn a signal envelope into a payload ready for `@sentimentracker/hyperliquid-mcp`'s `propose_order`. Three sizing modes (notionalUsd / fixedBase / riskUsd) + optional TP/SL follow-up. |

## Supported indicators

The catalog is not shipped with this package. `list_indicators` reads
`GET /superchart/indicators` on the backend, caches it for five minutes,
and every other tool validates its `indicator` argument against that
list. When the backend registers a new `_specs/<key>.ts`, it appears here
on the next deploy with no MCP release. At the time of writing the
backend serves 14 indicators (Sniper v3, Momentum Ultima Plus, Structure
PRO, Strong Buy Strong Sell, MOM Algo V15, Institutional Algo, Momentum
Trend Predictor, Momentum Radar, Momentum Wave, Momentum Balance Finder,
Momentum Insider with Divergences, Momentum Levels V3, Divergences PRO,
Impulse Targets).

Tool annotations follow the MCP spec: every tool is `readOnlyHint` and
non destructive; `propose_trade_from_signal` is additionally
`openWorldHint: false` because it never leaves the process. Results are
returned as both text and `structuredContent`.

## Auth

Two paths; both work today.

| Env var | Status | When to use |
|---|---|---|
| `SNT_SIGNALS_SESSION_TOKEN` | Works today | Quick dev — log into Sentimentracker, copy session JWT, paste. Refresh on expiry (typically 7-30 days). |
| `SNT_SIGNALS_API_KEY` | **Works (recommended)** | Headless credential minted in Settings → API keys (or `POST /api-keys`). Premium only. Expires one year after minting; rotate any time from the same page (the old key keeps working for 24 hours). Use this for production / cron / agent loops. |

Mint an API key from your account:

```bash
# Authenticate via your normal session JWT
curl -X POST https://api.sentimentracker.com/api/api-keys \
  -H "Authorization: Bearer <YOUR_SESSION_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Claude Desktop — Mac", "scope": "signals:read"}'
# Response: { data: { key: {...}, plaintext: "snt_mcp_<24 chars>", warning: "..." } }
```

The `plaintext` field is shown **once** — capture and store securely. Lost keys can only be revoked + reminted, never recovered. List and revoke via `GET /api-keys` and `DELETE /api-keys/:id`.

The backend gates every indicator behind a premium subscription, so the JWT / API key must belong to a premium user. The MCP includes `Authorization: Bearer <jwt>` OR `x-sentimentracker-api-key: snt_mcp_<...>` automatically depending on which env var you set.

## Install + run

```bash
# Local dev
cd sentimentracker-signals-mcp
pnpm install
pnpm build
SNT_SIGNALS_SESSION_TOKEN=<your-jwt> node dist/index.js
```

Once published to npm:

```bash
npx -y @sentimentracker/signals-mcp
```

## Env reference

| Env var | Default | Notes |
|---|---|---|
| `SNT_SIGNALS_ENDPOINT` | `https://api.sentimentracker.com/api` | Override for staging / local dev. |
| `SNT_SIGNALS_SESSION_TOKEN` | *(required if no API key)* | Bearer JWT from your authenticated session. Expires; refresh manually. |
| `SNT_SIGNALS_API_KEY` | *(required if no session token)* | Long-lived `snt_mcp_…` key minted via `POST /api-keys`. Recommended for headless / production. |
| `SNT_SIGNALS_DEFAULT_PROVIDER` | `auto` | One of `auto` / `hyperliquid` / `binance` / `tiingo` / `intrinio` / `databento`. Per-call override via tool input. |
| `SNT_SIGNALS_REQUEST_TIMEOUT_MS` | `15000` | Fetch timeout (1000-60000 ms). |

## Error envelope

Every failure returns a structured error:

```json
{
	"code": "AUTH_PREMIUM_REQUIRED",
	"message": "Premium subscription required for indicators",
	"hint": "This indicator requires a Sentimentracker premium subscription.",
	"status": 403
}
```

| Code | Meaning | Agent action |
|---|---|---|
| `AUTH_MISSING` | No session/key configured | Operator must set env var |
| `AUTH_EXPIRED` | 401 from backend | Operator must refresh token |
| `AUTH_PREMIUM_REQUIRED` | 403 from backend | Operator must upgrade subscription |
| `BACKEND_TIMEOUT` | Fetch timed out | Retry (sparingly) or raise `SNT_SIGNALS_REQUEST_TIMEOUT_MS` |
| `BACKEND_HTTP_ERROR` | 5xx or other HTTP failure | Retry with backoff |
| `BACKEND_INVALID_RESPONSE` | Non-JSON or malformed body | Bug — file an issue |
| `INPUT_UNKNOWN_INDICATOR` | Tool was called with a key not in registry | Correct the input |
| `INPUT_INVALID` | Other input validation failure | Correct the input |

## Project layout

```
src/
├── index.ts              # stdio entry
├── server.ts             # McpServer factory
├── config.ts             # env parsing
├── client.ts             # HTTP client → /superchart/indicators/calculate
├── indicators.ts         # 14-indicator registry
├── errors.ts             # error hierarchy + toErrorPayload
└── tools/
    ├── _shared.ts        # defineTool wrapper + shared zod
    ├── index.ts          # registry
    ├── list-indicators.ts
    ├── get-indicator-signal.ts
    ├── get-indicator-full.ts
    ├── get-signal-confluence.ts
    ├── subscribe-signal.ts
    └── propose-trade-from-signal.ts
```

## Rate limits and quota

The backend layers three limits on top of the global per-IP limit. All of
them are per user, so the same user across machines shares one budget.

| Limit | Value | Signal |
|---|---|---|
| `POST /superchart/indicators/calculate` | 60 burst + 1/sec sustained (5× for premium) | `X-RateLimit-Limit` / `-Remaining` / `-Reset` (ISO 8601) on every response; `429` + `Retry-After` when exceeded |
| `POST /superchart/indicators/subscribe` | 10 burst + 0.5/sec sustained (5× for premium); at most 3 open long polls per user | same headers; `429` when a 4th subscription is opened |
| API key monthly quota | 50,000 successful calls per key per calendar month (UTC); session traffic is not metered | `X-RateLimit-Monthly-Limit` / `-Remaining`; `429` + `Retry-After` until the 1st |

Surfaced to MCP callers as `BackendError` with code `BACKEND_RATE_LIMITED`
and a `Retry after Ns.` hint.

## Composing with `@sentimentracker/hyperliquid-mcp`

The two MCPs are designed to chain — signals MCP reads, hyperliquid MCP signs:

```
LLM
 ├── get_indicator_signal(sniperV3 BTC 15m)   → signals-mcp
 │     ↓ signal envelope
 ├── propose_trade_from_signal(...)            → signals-mcp (pure compute)
 │     ↓ HL order payload + sister MCP target
 ├── propose_order(payload)                    → hyperliquid-mcp (no signing)
 │     ↓ rendered payload + safety check
 └── place_order(payload)                      → hyperliquid-mcp (signs + submits)
```

`propose_trade_from_signal` emits a `next.tool` / `next.server` / `next.arguments` triple that tells the agent exactly which MCP server + tool to call next, so well-instructed agents handle the chain without explicit narration.

## Roadmap

- Real WS push (replace long-poll) — eliminates 1s latency floor on subscribe
- Multi-symbol watchlists — one `subscribe_watchlist` covering N (indicator, symbol, resolution) tuples
- Per-key analytics dashboard — call counts, error rates, top symbols
- API-key scopes beyond `signals:read` (e.g. `signals:subscribe`, `meta:read`); scopes are enforced per route today
- Hosted remote transport (Streamable HTTP + OAuth 2.1) alongside stdio

## Releasing

1. Bump `version` in `package.json` and `SERVER_VERSION` in `src/version.ts` (a test keeps them equal).
2. Commit, then `git tag vX.Y.Z` and `git push origin main vX.Y.Z`.
3. The `publish` workflow runs the tests and publishes to npm through trusted publishing, with provenance. No token or passkey is involved.

## License

MIT
